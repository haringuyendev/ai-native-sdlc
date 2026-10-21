'use strict';
// Mockup server behind the spec skill's visual companion.
//
// What it does, in one breath: it serves the newest .html file of
// <session>/content to a browser tab that proves it holds the session key,
// pushes a "reload" over a WebSocket whenever that folder changes, and appends
// every click that names a choice to <session>/state/events. Everything it
// needs comes from BRAINSTORM_* variables set by start-server.sh.
//
// Plain Node, no packages: the WebSocket side is a minimal RFC 6455 codec
// (text, ping, pong and close frames only, client frames must be masked).

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

/* ------------------------------------------------------------------------ */
/* WebSocket codec                                                          */
/* ------------------------------------------------------------------------ */

const OPCODES = { TEXT: 0x1, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_PAYLOAD_BYTES = 10 * 1024 * 1024;

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(String(clientKey) + HANDSHAKE_GUID).digest('base64');
}

// Server-to-client frames are never masked and always final.
function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  let head;
  if (body.length <= 125) {
    head = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length <= 0xffff) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(body.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(body.length), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, body]);
}

// Reads one client frame from the front of `buf`.
// Returns null while the frame is still incomplete; throws on an unmasked or
// oversized frame (the caller then closes the socket).
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  if ((buf[1] & 0x80) === 0) throw new Error('Client frames must be masked');

  let length = buf[1] & 0x7f;
  let cursor = 2;
  if (length === 126) {
    if (buf.length < 4) return null;
    length = buf.readUInt16BE(2);
    cursor = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(MAX_FRAME_PAYLOAD_BYTES)) throw new Error('WebSocket frame payload exceeds maximum allowed size');
    length = Number(big);
    cursor = 10;
  }
  if (length > MAX_FRAME_PAYLOAD_BYTES) throw new Error('WebSocket frame payload exceeds maximum allowed size');

  const end = cursor + 4 + length;
  if (buf.length < end) return null;
  const mask = buf.subarray(cursor, cursor + 4);
  const payload = Buffer.from(buf.subarray(cursor + 4, end));
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { opcode, payload, bytesConsumed: end };
}

/* ------------------------------------------------------------------------ */
/* Settings                                                                  */
/* ------------------------------------------------------------------------ */

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const pickRandomPort = () => 49152 + Math.floor(Math.random() * 16383);
const newToken = () => crypto.randomBytes(32).toString('hex');

function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readFileTrimmed(file) {
  try { return fs.readFileSync(file, 'utf-8').trim(); } catch (e) { return null; }
}

function lockDown(file) {
  try { fs.chmodSync(file, 0o600); } catch (e) { /* not fatal */ }
}

// Port preference: BRAINSTORM_PORT, then the port this project used last time
// (so an open tab finds the server again after a restart), then a random one.
function choosePort(cfg) {
  if (cfg.explicitPort) return Number(cfg.explicitPort);
  if (cfg.portFile) {
    const remembered = Number(readFileTrimmed(cfg.portFile));
    if (Number.isInteger(remembered) && remembered > 1023 && remembered < 65536) return remembered;
  }
  return pickRandomPort();
}

// Key preference mirrors the port: explicit env, remembered file, fresh.
// `origin` matters later when the preferred port turns out to be busy.
function chooseToken(cfg) {
  if (cfg.explicitToken) return { value: cfg.explicitToken, origin: 'env' };
  if (cfg.tokenFile) {
    const remembered = readFileTrimmed(cfg.tokenFile);
    if (remembered && /^[0-9a-f]{32,}$/i.test(remembered)) {
      lockDown(cfg.tokenFile);
      return { value: remembered, origin: 'file' };
    }
  }
  return { value: newToken(), origin: 'generated' };
}

function pluginVersion() {
  const manifest = path.join(__dirname, '..', '..', '..', 'package.json');
  try {
    const { version } = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
    if (version) return String(version);
  } catch (e) { /* fall through */ }
  return 'unknown';
}

function readSettings(env) {
  const host = env.BRAINSTORM_HOST || '127.0.0.1';
  const sessionDir = env.BRAINSTORM_DIR || '/tmp/brainstorm';
  const ownerPid = env.BRAINSTORM_OWNER_PID ? Number(env.BRAINSTORM_OWNER_PID) : null;
  return {
    host,
    urlHost: env.BRAINSTORM_URL_HOST || (host === '127.0.0.1' ? 'localhost' : host),
    contentDir: path.join(sessionDir, 'content'),
    stateDir: path.join(sessionDir, 'state'),
    explicitPort: env.BRAINSTORM_PORT || null,
    explicitToken: env.BRAINSTORM_TOKEN || null,
    portFile: env.BRAINSTORM_PORT_FILE || null,
    tokenFile: env.BRAINSTORM_TOKEN_FILE || null,
    ownerPid,
    autoOpen: Boolean(env.BRAINSTORM_OPEN),
    openCommand: env.BRAINSTORM_OPEN_CMD || null,
    idleTimeoutMs: positiveNumber(env.BRAINSTORM_IDLE_TIMEOUT_MS, FOUR_HOURS_MS),
    checkEveryMs: positiveNumber(env.BRAINSTORM_LIFECYCLE_CHECK_MS, 60 * 1000),
    version: pluginVersion(),
  };
}

/* ------------------------------------------------------------------------ */
/* Pages                                                                     */
/* ------------------------------------------------------------------------ */

const FRAME_HTML = fs.readFileSync(path.join(__dirname, 'frame-template.html'), 'utf-8');
const HELPER_TAG = '<script>\n' + fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf-8') + '\n</script>';

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function withBranding(html, version) {
  const badge = '<div class="brand"><span class="brand-copy">ai-native-sdlc v' + escapeHtml(version) + '</span></div>';
  return html.split('<!-- BRANDING -->').join(badge);
}

// A screen that opens with a doctype or <html> is shown as written; anything
// else is a fragment and goes into the frame at the CONTENT marker.
function looksLikeWholeDocument(html) {
  const start = html.trimStart().slice(0, 9).toLowerCase();
  return start.startsWith('<!doctype') || start.startsWith('<html');
}

function renderScreen(raw, version) {
  if (looksLikeWholeDocument(raw)) return raw;
  return withBranding(FRAME_HTML, version).replace('<!-- CONTENT -->', () => raw);
}

function injectHelper(html) {
  return html.includes('</body>') ? html.replace('</body>', HELPER_TAG + '\n</body>') : html + HELPER_TAG;
}

function placeholderPage(version) {
  return withBranding(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Brainstorm Companion</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
h1 { color: #333; }
p { color: #666; }
.brand { display: flex; align-items: center; margin-bottom: 1.5rem; min-width: 0; overflow: hidden; color: #666; font-size: 0.9rem; line-height: 1; }
.brand-copy { display: block; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 1; }
</style>
</head>
<body><!-- BRANDING --><h1>Brainstorm Companion</h1>
<p>Nothing to show yet. The first screen appears here as soon as the agent writes it.</p></body></html>`, version);
}

const KEY_REQUIRED_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Session key required</title>
<style>body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
h1 { color: #333; } p { color: #666; } code { background: #f0f0f0; border-radius: 4px; padding: 0.1em 0.3em; }</style>
</head>
<body><h1>Session key required</h1>
<p>Open the link exactly as your coding agent printed it. The
<code>?key=&hellip;</code> ending is what lets this browser in.</p></body></html>`;

// Answer to the keyed URL: remember the key for helper.js, then drop it from
// the address bar. The cookie set alongside this response authenticates `/`.
function keyHandoffPage(key) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Opening Brainstorm Companion</title></head>
<body>
<script>
try { sessionStorage.setItem('brainstorm-session-key', ${JSON.stringify(String(key))}); } catch (e) {}
location.replace('/');
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------------ */
/* Content folder                                                            */
/* ------------------------------------------------------------------------ */

const isScreenName = (name) => Boolean(name) && !name.startsWith('.') && name.endsWith('.html');

// Only plain, single-link files that really live in the content folder are
// served; symlinks and hard links could otherwise expose files elsewhere.
function isServableFile(contentDir, file) {
  try {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1) return false;
    return fs.realpathSync(file).startsWith(fs.realpathSync(contentDir) + path.sep);
  } catch (e) {
    return false;
  }
}

function newestScreen(contentDir) {
  let best = null;
  for (const name of fs.readdirSync(contentDir)) {
    if (!isScreenName(name)) continue;
    const file = path.join(contentDir, name);
    if (!isServableFile(contentDir, file)) continue;
    const mtime = fs.statSync(file).mtime.getTime();
    if (!best || mtime > best.mtime) best = { file, mtime };
  }
  return best ? best.file : null;
}

const CONTENT_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

/* ------------------------------------------------------------------------ */
/* Request helpers                                                           */
/* ------------------------------------------------------------------------ */

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function splitUrl(raw) {
  const at = raw.indexOf('?');
  return at < 0
    ? { pathname: raw, params: new URLSearchParams() }
    : { pathname: raw.slice(0, at), params: new URLSearchParams(raw.slice(at + 1)) };
}

// When a name repeats, the last occurrence wins (as a name -> value map would).
function cookieValue(header, name) {
  let found = null;
  for (const piece of String(header || '').split(';')) {
    const eq = piece.indexOf('=');
    if (eq >= 0 && piece.slice(0, eq).trim() === name) found = piece.slice(eq + 1).trim();
  }
  return found;
}

function hardenedHeaders(extra) {
  return Object.assign({
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
  }, extra);
}

function bracketIpv6(host) {
  const h = String(host);
  if (h.startsWith('[') && h.endsWith(']')) return h;
  return h.includes(':') ? '[' + h + ']' : h;
}

// Picks the OS browser opener. Returns null on a headless Linux box.
function browserLauncherForPlatform(url, { platform = process.platform, osRelease = os.release(), env = process.env } = {}) {
  if (platform === 'darwin') return { bin: 'open', args: [url] };
  const wsl = platform === 'linux' && /microsoft/i.test(osRelease);
  if (platform === 'win32' || wsl) return { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { bin: 'xdg-open', args: [url] };
  return null;
}

/* ------------------------------------------------------------------------ */
/* The running companion                                                     */
/* ------------------------------------------------------------------------ */

function runCompanion(cfg) {
  fs.mkdirSync(cfg.contentDir, { recursive: true });
  fs.mkdirSync(cfg.stateDir, { recursive: true });

  const eventsFile = path.join(cfg.stateDir, 'events');
  const infoFile = path.join(cfg.stateDir, 'server-info');
  const stoppedFile = path.join(cfg.stateDir, 'server-stopped');
  const log = (obj) => console.log(JSON.stringify(obj));

  let port = choosePort(cfg);
  const token = chooseToken(cfg);
  let usedFallbackPort = false;
  let lastActivity = Date.now();
  let ownerPid = cfg.ownerPid;
  const sockets = new Set();

  const cookieName = () => 'brainstorm-key-' + port;
  const publicUrl = () => 'http://' + bracketIpv6(cfg.urlHost) + ':' + port + '/?key=' + token.value;
  const markActive = () => { lastActivity = Date.now(); };

  // A request passes with ?key=<key>, or, when no key parameter is present,
  // with the session cookie. A wrong key in the query is never rescued by a cookie.
  function authorized(req) {
    const { params } = splitUrl(req.url);
    if (params.has('key')) {
      const given = params.get('key');
      return Boolean(given) && sameSecret(given, token.value);
    }
    const fromCookie = cookieValue(req.headers.cookie, cookieName());
    return Boolean(fromCookie) && sameSecret(fromCookie, token.value);
  }

  // Browsers always send Origin on a WebSocket; it must name this very host.
  function originAllowed(req) {
    const originHeader = req.headers.origin;
    if (!originHeader) return true;
    return Boolean(req.headers.host) && originHeader === 'http://' + req.headers.host;
  }

  /* ---- HTTP ---- */

  function send(res, status, type, body) {
    res.writeHead(status, hardenedHeaders(type ? { 'Content-Type': type } : {}));
    res.end(body);
  }

  function onRequest(req, res) {
    if (!authorized(req)) return send(res, 403, 'text/html; charset=utf-8', KEY_REQUIRED_PAGE);
    markActive();
    res.setHeader('Set-Cookie', cookieName() + '=' + token.value + '; HttpOnly; SameSite=Strict; Path=/');

    const { pathname, params } = splitUrl(req.url);
    const isGet = req.method === 'GET';

    if (isGet && pathname === '/' && params.get('key')) {
      return send(res, 200, 'text/html; charset=utf-8', keyHandoffPage(params.get('key')));
    }
    if (isGet && pathname === '/') {
      const screen = newestScreen(cfg.contentDir);
      const page = screen ? renderScreen(fs.readFileSync(screen, 'utf-8'), cfg.version) : placeholderPage(cfg.version);
      return send(res, 200, 'text/html; charset=utf-8', injectHelper(page));
    }
    if (isGet && pathname.startsWith('/files/')) {
      const name = path.basename(pathname.slice('/files/'.length));
      const file = path.join(cfg.contentDir, name);
      if (!name || name.startsWith('.') || !isServableFile(cfg.contentDir, file)) return send(res, 404, null, 'Not found');
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return send(res, 200, type, fs.readFileSync(file));
    }
    return send(res, 404, null, 'Not found');
  }

  /* ---- WebSocket ---- */

  function recordMessage(text) {
    let event;
    try {
      event = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e.message);
      return;
    }
    markActive();
    log(Object.assign({ source: 'user-event' }, event));
    // Only events that carry a choice are worth reading back on the next turn.
    if (event && event.choice) fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
  }

  function onUpgrade(req, socket) {
    const wsKey = req.headers['sec-websocket-key'];
    if (!authorized(req) || !originAllowed(req) || !wsKey) { socket.destroy(); return; }

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + computeAcceptKey(wsKey),
      '', '',
    ].join('\r\n'));
    sockets.add(socket);

    const hangUp = (body) => { sockets.delete(socket); socket.end(encodeFrame(OPCODES.CLOSE, body || Buffer.alloc(0))); };
    let pending = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        let frame;
        try { frame = decodeFrame(pending); } catch (e) { hangUp(); return; }
        if (!frame) return;
        pending = pending.subarray(frame.bytesConsumed);

        if (frame.opcode === OPCODES.TEXT) recordMessage(frame.payload.toString());
        else if (frame.opcode === OPCODES.PING) socket.write(encodeFrame(OPCODES.PONG, frame.payload));
        else if (frame.opcode === OPCODES.CLOSE) { hangUp(); return; }
        else if (frame.opcode !== OPCODES.PONG) {
          const unsupported = Buffer.alloc(2);
          unsupported.writeUInt16BE(1003);
          hangUp(unsupported);
          return;
        }
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  }

  function broadcast(message) {
    const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(message)));
    for (const s of sockets) {
      try { s.write(frame); } catch (e) { sockets.delete(s); }
    }
  }

  /* ---- Opening the browser (once, opt-in) ---- */

  let openAttempted = false;
  function openBrowserOnce() {
    if (openAttempted) return;
    openAttempted = true;
    if (!cfg.autoOpen) return;
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') return; // remote bind: nothing local to open
    if (sockets.size > 0) return; // a tab is already watching
    const url = publicUrl();
    try {
      if (cfg.openCommand) {
        // The operator chose this command; it runs through a shell on purpose.
        childProcess.exec(cfg.openCommand + ' ' + JSON.stringify(url), () => {});
        return;
      }
      const launcher = browserLauncherForPlatform(url);
      // execFile keeps the URL a single argv entry, out of reach of the shell.
      if (launcher) childProcess.execFile(launcher.bin, launcher.args, () => {});
    } catch (e) { /* opening the browser is a convenience only */ }
  }

  /* ---- Watching for new screens ---- */

  // fs.watch on macOS reports both creation and overwrite as 'rename', so new
  // screens are told apart from edits by remembering the names already seen.
  const seenScreens = new Set(fs.readdirSync(cfg.contentDir).filter(isScreenName));
  const settleTimers = new Map();

  function onScreenSettled(name) {
    settleTimers.delete(name);
    const file = path.join(cfg.contentDir, name);
    if (!fs.existsSync(file)) return;
    markActive();
    if (seenScreens.has(name)) {
      log({ type: 'screen-updated', file });
    } else {
      seenScreens.add(name);
      fs.rmSync(eventsFile, { force: true }); // clicks belong to the previous screen
      log({ type: 'screen-added', file });
      openBrowserOnce();
    }
    broadcast({ type: 'reload' });
  }

  const watcher = fs.watch(cfg.contentDir, (_kind, name) => {
    if (!isScreenName(name)) return;
    clearTimeout(settleTimers.get(name));
    settleTimers.set(name, setTimeout(onScreenSettled, 100, name));
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  /* ---- Lifecycle ---- */

  const server = http.createServer(onRequest);
  server.on('upgrade', onUpgrade);

  function ownerStillThere() {
    if (!ownerPid) return true;
    try { process.kill(ownerPid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  let watchdog = null;
  function shutdown(reason) {
    log({ type: 'server-stopped', reason });
    fs.rmSync(infoFile, { force: true });
    fs.writeFileSync(stoppedFile, JSON.stringify({ reason, timestamp: Date.now() }) + '\n');
    watcher.close();
    clearInterval(watchdog);
    // Open WebSockets would keep server.close() waiting forever.
    for (const s of sockets) { try { s.destroy(); } catch (e) { /* gone already */ } }
    server.close(() => process.exit(0));
  }

  watchdog = setInterval(() => {
    if (!ownerStillThere()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > cfg.idleTimeoutMs) shutdown('idle timeout');
  }, cfg.checkEveryMs);
  watchdog.unref();

  // An owner PID that is already gone at startup was resolved wrongly
  // (WSL, SSH, another user); trust the idle timeout alone in that case.
  if (ownerPid) {
    try { process.kill(ownerPid, 0); } catch (e) {
      if (e.code !== 'EPERM') {
        log({ type: 'owner-pid-invalid', pid: ownerPid, reason: 'dead at startup' });
        ownerPid = null;
      }
    }
  }

  function announce() {
    // Remember port and key for the next start of this project, but only when
    // we got the preferred port: after a fallback the remembered pair belongs to
    // whichever server holds that port, and its open tab must keep working.
    if (cfg.portFile && !usedFallbackPort) {
      try { fs.writeFileSync(cfg.portFile, String(port)); } catch (e) { /* best effort */ }
      if (cfg.tokenFile) {
        try {
          fs.writeFileSync(cfg.tokenFile, token.value, { mode: 0o600 });
          lockDown(cfg.tokenFile);
        } catch (e) { /* best effort */ }
      }
    }
    const info = JSON.stringify({
      type: 'server-started', port: Number(port), host: cfg.host, url_host: cfg.urlHost, url: publicUrl(),
      screen_dir: cfg.contentDir, state_dir: cfg.stateDir, idle_timeout_ms: cfg.idleTimeoutMs,
    });
    console.log(info);
    fs.writeFileSync(infoFile, info + '\n', { mode: 0o600 }); // carries the key
  }

  server.on('error', (err) => {
    const canRetry = err.code === 'EADDRINUSE' && !usedFallbackPort;
    if (canRetry && token.origin === 'env') {
      console.error('Server failed to bind: preferred port is in use and BRAINSTORM_TOKEN is set; refusing fallback with explicit token');
      process.exit(1);
    }
    if (!canRetry) {
      console.error('Server failed to bind:', err.message);
      process.exit(1);
    }
    // One retry on a random port. A remembered key stays with the remembered
    // port, so this server gets a fresh one.
    usedFallbackPort = true;
    port = pickRandomPort();
    if (token.origin === 'file') {
      token.value = newToken();
      token.origin = 'generated-fallback';
    }
    server.listen(port, cfg.host, announce);
  });

  server.listen(port, cfg.host, announce);
}

if (require.main === module) runCompanion(readSettings(process.env));

module.exports = {
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
  browserLauncherForPlatform,
  OPCODES,
  MAX_FRAME_PAYLOAD_BYTES,
};
