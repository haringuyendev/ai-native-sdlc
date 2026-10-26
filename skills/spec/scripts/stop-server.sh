#!/usr/bin/env bash
# Ends a visual-companion session started by start-server.sh.
#
#   stop-server.sh <session dir>     (the folder that holds content/ and state/)
#
# Prints exactly one JSON status line:
#   stopped      server signalled and gone; server-stopped written, server-info removed
#   stale_pid    pid file points at some other process; nothing signalled,
#                server-stopped written, server-info removed
#   not_running  no pid file; nothing touched
#   failed       process outlived SIGKILL; exit 1, nothing written
# Only a /tmp/brainstorm-* session is deleted afterwards; project sessions keep
# their screens, even when the project itself lives under /tmp.

SESSION_DIR="$1"
if [[ -z "$SESSION_DIR" ]]; then
  echo '{"error": "Usage: stop-server.sh <session_dir>"}'
  exit 1
fi

STATE_DIR="$SESSION_DIR/state"
PID_FILE="$STATE_DIR/server.pid"
ID_FILE="$STATE_DIR/server-instance-id"

if [[ ! -f "$PID_FILE" ]]; then
  echo '{"status": "not_running"}'
  exit 0
fi

# Leave the same tombstone the server writes on its own shutdown.
record_stop() {
  rm -f "$STATE_DIR/server-info"
  printf '{"reason":"%s","timestamp":%s}\n' "$1" "$(date +%s)" > "$STATE_DIR/server-stopped"
}

# The instance id start-server.sh generated, if it is well formed.
instance_id() {
  [[ -f "$ID_FILE" ]] || return 1
  local id
  id="$(tr -d '\r\n' < "$ID_FILE" 2>/dev/null)"
  [[ "$id" =~ ^[A-Za-z0-9_-]{32,64}$ ]] || return 1
  printf '%s' "$id"
}

# True when <pid>'s argv contains exactly --brainstorm-server-id=<id>.
# Linux: read /proc argv entries; elsewhere: match a whole word of `ps` output.
argv_carries() {
  local pid="$1" wanted="--brainstorm-server-id=$2" arg line
  if [[ -r "/proc/$pid/cmdline" ]]; then
    while IFS= read -r -d '' arg || [[ -n "$arg" ]]; do
      [[ "$arg" == "$wanted" ]] && return 0
    done < "/proc/$pid/cmdline"
    return 1
  fi
  line="$(ps -ww -p "$pid" -o command= 2>/dev/null || ps -f -p "$pid" 2>/dev/null | sed '1d')"
  [[ -n "$line" && " $line " == *" $wanted "* ]]
}

# A pid only counts as ours if it is alive AND carries this session's id;
# after a reboot or pid reuse the number alone proves nothing.
is_our_server() {
  local id
  kill -0 "$1" 2>/dev/null || return 1
  id="$(instance_id)" || return 1
  argv_carries "$1" "$id"
}

pid="$(cat "$PID_FILE")"

if ! is_our_server "$pid"; then
  rm -f "$PID_FILE" "$ID_FILE"
  record_stop "stale_pid"
  echo '{"status": "stale_pid"}'
  exit 0
fi

# SIGTERM, up to ~2 s of grace, then SIGKILL.
kill "$pid" 2>/dev/null
for _ in $(seq 20); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$pid" 2>/dev/null; then
  kill -9 "$pid" 2>/dev/null
  sleep 0.1
fi
if kill -0 "$pid" 2>/dev/null; then
  echo '{"status": "failed", "error": "process still running"}'
  exit 1
fi

rm -f "$PID_FILE" "$ID_FILE" "$STATE_DIR/server.log"
record_stop "stop-server.sh"
case "$SESSION_DIR" in
  /tmp/brainstorm-*) rm -rf "$SESSION_DIR" ;;
esac
echo '{"status": "stopped"}'
