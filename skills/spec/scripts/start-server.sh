#!/usr/bin/env bash
# Launches server.cjs for one visual-companion session and prints the single
# JSON line the agent needs ({"type":"server-started",...,"url":...?key=...}).
#
#   start-server.sh [--project-dir <path>] [--open] [--host <bind>] [--url-host <name>]
#                   [--idle-timeout-minutes <n>] [--foreground | --background]
#
# --project-dir   session under <path>/.ai-sdlc/brainstorm/<pid>-<epoch>, kept after
#                 stop; port and key are remembered for the next start. Without it
#                 the session lives in /tmp/brainstorm-<pid>-<epoch>.
# --open          let the server open a browser when the first screen shows up.
# --host          interface to listen on (127.0.0.1 unless told otherwise).
# --url-host      host name to print in the URL (localhost for a loopback bind).
# --idle-timeout-minutes  stop after this many quiet minutes (server default: 240).
# --foreground / --background  override the automatic choice of mode.
#
# Errors are JSON on stdout with exit 1.

HERE="$(cd "$(dirname "$0")" && pwd)"

fail_json() {
  echo "{\"error\": \"$1\"}"
  exit 1
}

# ---- arguments --------------------------------------------------------------
PROJECT_DIR=""
BIND_HOST="127.0.0.1"
URL_HOST=""
IDLE_MINUTES=""
WANT_FG=""
WANT_BG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)          PROJECT_DIR="$2"; shift 2 ;;
    --host)                 BIND_HOST="$2"; shift 2 ;;
    --url-host)             URL_HOST="$2"; shift 2 ;;
    --idle-timeout-minutes) IDLE_MINUTES="$2"; shift 2 ;;
    --open)                 export BRAINSTORM_OPEN=1; shift ;;
    --foreground|--no-daemon) WANT_FG=1; shift ;;
    --background|--daemon)    WANT_BG=1; shift ;;
    *)                      fail_json "Unknown argument: $1" ;;
  esac
done

if [[ -z "$URL_HOST" ]]; then
  case "$BIND_HOST" in
    127.0.0.1|localhost) URL_HOST="localhost" ;;
    *)                   URL_HOST="$BIND_HOST" ;;
  esac
fi

if [[ -n "$IDLE_MINUTES" ]]; then
  if ! [[ "$IDLE_MINUTES" =~ ^[0-9]+$ ]] || (( IDLE_MINUTES < 1 )); then
    fail_json "--idle-timeout-minutes must be a positive integer"
  fi
  export BRAINSTORM_IDLE_TIMEOUT_MS=$(( IDLE_MINUTES * 60000 ))
fi

# ---- foreground or background -----------------------------------------------
# Git Bash / MSYS / Cygwin, detected by any of the usual signals.
on_windows_shell() {
  case "${OSTYPE:-}" in msys*|cygwin*|mingw*) return 0 ;; esac
  [[ -n "${MSYSTEM:-}" ]] && return 0
  case "$(uname -s 2>/dev/null)" in MSYS*|MINGW*|CYGWIN*) return 0 ;; esac
  return 1
}

# Where detached children get reaped (Codex CI, Windows shells) the server
# must stay attached, unless the caller said otherwise. --foreground beats
# --background when both are given.
if [[ -n "$WANT_FG" ]]; then
  MODE="foreground"
elif [[ -n "$WANT_BG" ]]; then
  MODE="background"
elif [[ -n "${CODEX_CI:-}" ]] || on_windows_shell; then
  MODE="foreground"
else
  MODE="background"
fi

# ---- session folder ---------------------------------------------------------
# The log, server-info and remembered key all hold the secret: owner-only files.
umask 077

SESSION_ID="$$-$(date +%s)"
if [[ -n "$PROJECT_DIR" ]]; then
  # Never commit companion scratch; an existing .gitignore is left alone.
  if [[ ! -e "$PROJECT_DIR/.ai-sdlc/.gitignore" ]]; then
    mkdir -p "$PROJECT_DIR/.ai-sdlc"
    printf '*\n' > "$PROJECT_DIR/.ai-sdlc/.gitignore"
  fi
  SESSION_DIR="$PROJECT_DIR/.ai-sdlc/brainstorm/$SESSION_ID"
  export BRAINSTORM_PORT_FILE="$PROJECT_DIR/.ai-sdlc/brainstorm/.last-port"
  export BRAINSTORM_TOKEN_FILE="$PROJECT_DIR/.ai-sdlc/brainstorm/.last-token"
else
  SESSION_DIR="/tmp/brainstorm-$SESSION_ID"
fi

STATE_DIR="$SESSION_DIR/state"
PID_FILE="$STATE_DIR/server.pid"
LOG_FILE="$STATE_DIR/server.log"
mkdir -p "$SESSION_DIR/content" "$STATE_DIR"

# A random id passed on the server's command line; stop-server.sh checks the
# process for it before sending any signal.
INSTANCE_ID=""
if [[ -r /dev/urandom ]]; then
  INSTANCE_ID="$(od -An -N24 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
fi
if ! [[ "$INSTANCE_ID" =~ ^[A-Za-z0-9_-]{32,64}$ ]]; then
  INSTANCE_ID="$(printf '%08x%08x%08x%08x' "$$" "$(date +%s)" "${RANDOM:-0}" "${RANDOM:-0}")"
fi
printf '%s\n' "$INSTANCE_ID" > "$STATE_DIR/server-instance-id"
chmod 600 "$STATE_DIR/server-instance-id" 2>/dev/null || true

# Defensive: a leftover pid file in this folder means a server to retire.
if [[ -f "$PID_FILE" ]]; then
  kill "$(cat "$PID_FILE")" 2>/dev/null
  rm -f "$PID_FILE"
fi

# ---- owner process ----------------------------------------------------------
# $PPID is the throwaway shell the agent ran us in; the agent is one level up.
# The server watches that process and exits when it disappears.
OWNER_PID="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
[[ -z "$OWNER_PID" || "$OWNER_PID" == "1" ]] && OWNER_PID="$PPID"
# MSYS PIDs mean nothing to Windows Node; leave the idle timeout in charge.
on_windows_shell && OWNER_PID=""

cd "$HERE" || exit 1

# The one launch command for both modes. It is started directly (never through
# a function or subshell) so that $! is the node process itself: `env` execs
# node, and stop-server.sh looks for the instance id in that PID's argv.
SERVER_CMD=(env BRAINSTORM_DIR="$SESSION_DIR" BRAINSTORM_HOST="$BIND_HOST" BRAINSTORM_URL_HOST="$URL_HOST"
            BRAINSTORM_OWNER_PID="$OWNER_PID" node server.cjs "--brainstorm-server-id=$INSTANCE_ID")

if [[ "$MODE" == "foreground" ]]; then
  "${SERVER_CMD[@]}" &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
  wait "$SERVER_PID"
  exit $?
fi

nohup "${SERVER_CMD[@]}" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null
echo "$SERVER_PID" > "$PID_FILE"

# ---- wait for the announcement ----------------------------------------------
# Up to 5 s for the server-started line, then 2 s more to make sure nothing
# reaped the process right after it spoke.
still_alive_for_two_seconds() {
  local n
  for n in $(seq 20); do
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    sleep 0.1
  done
  return 0
}

for tick in $(seq 50); do
  if grep -q "server-started" "$LOG_FILE" 2>/dev/null; then
    if ! still_alive_for_two_seconds; then
      fail_json "Server started but was killed. Retry in a persistent terminal with: $HERE/start-server.sh${PROJECT_DIR:+ --project-dir $PROJECT_DIR} --host $BIND_HOST --url-host $URL_HOST --foreground"
    fi
    grep "server-started" "$LOG_FILE" | head -1
    exit 0
  fi
  sleep 0.1
done

fail_json "Server failed to start within 5 seconds"
