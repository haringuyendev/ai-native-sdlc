// In-page script for the visual companion. server.cjs inlines it into every
// screen it serves. Jobs: keep a WebSocket open to the server (with backoff),
// reload when the server says a screen changed, forward clicks on [data-choice]
// elements, and drive the selection styling used by toggleSelect(this).
//
// Under Node (unit tests) only the pure backoff helper is exported.
(function () {
  var MIN_RECONNECT_MS = 500;
  var MAX_RECONNECT_MS = 30000;
  var TOMBSTONE_AFTER_MS = 15000; // offline this long => cover the page with a "paused" notice
  var KEY_SLOT = 'brainstorm-session-key'; // written by the server's key hand-off page

  function nextReconnectDelay(current, max) {
    return Math.min(current * 2, max);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      nextReconnectDelay: nextReconnectDelay,
      MIN_RECONNECT_MS: MIN_RECONNECT_MS,
      MAX_RECONNECT_MS: MAX_RECONNECT_MS,
      TOMBSTONE_AFTER_MS: TOMBSTONE_AFTER_MS
    };
  }
  if (typeof window === 'undefined') return;

  /* ---- connection state ---- */
  var socket = null;
  var outbox = [];             // events clicked while offline, sent on reconnect
  var delay = MIN_RECONNECT_MS;
  var retryTimer = null;
  var offlineSince = null;
  var hadConnection = false;
  var pausedShown = false;

  function storedKey() {
    try { return window.sessionStorage ? window.sessionStorage.getItem(KEY_SLOT) : null; } catch (e) { return null; }
  }

  function keyedPath() {
    var key = storedKey();
    return key ? '/?key=' + encodeURIComponent(key) : '';
  }

  // The cookie normally authenticates the socket; the stored key is a backup
  // for a server that restarted and has not seen this tab yet.
  function socketUrl() {
    return 'ws://' + window.location.host + keyedPath();
  }

  // After an outage, go back through the keyed URL when we can so the
  // server sets a fresh cookie before the page settles on plain "/".
  function reloadAfterOutage() {
    var target = keyedPath();
    if (target) window.location.replace(target);
    else window.location.reload();
  }

  var STATUS_LOOK = {
    connecting: ['Connecting…', 'var(--text-tertiary)'],
    connected: ['Connected', 'var(--success)'],
    reconnecting: ['Reconnecting…', 'var(--warning)'],
    disconnected: ['Disconnected', 'var(--error)']
  };

  // Full-document screens have no .status pill; then this is a no-op.
  function showStatus(state) {
    var pill = document.querySelector('.status');
    if (!pill) return;
    var look = STATUS_LOOK[state] || STATUS_LOOK.disconnected;
    pill.textContent = look[0];
    pill.style.setProperty('--status-color', look[1]);
  }

  // Inline styles so the notice looks the same with or without the frame CSS.
  function showPausedNotice() {
    if (pausedShown) return;
    pausedShown = true;
    var cover = document.createElement('div');
    cover.id = 'bs-tombstone';
    cover.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999', 'display:flex', 'align-items:center',
      'justify-content:center', 'padding:2rem', 'text-align:center',
      'background:rgba(20,20,22,0.92)', 'color:#f5f5f7', 'font-family:system-ui,sans-serif'
    ].join(';');
    cover.innerHTML = '<div style="max-width:480px">' +
      '<h2 style="margin:0 0 .5rem;font-weight:600">Companion paused</h2>' +
      '<p style="margin:0;opacity:.85">The server behind this tab is not running right now. ' +
      'Once your coding agent starts it again, the page picks up where it was.</p></div>';
    if (document.body) document.body.appendChild(cover);
  }

  function scheduleRetry() {
    retryTimer = setTimeout(openSocket, delay);
    delay = nextReconnectDelay(delay, MAX_RECONNECT_MS);
  }

  function openSocket() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    showStatus(hadConnection ? 'reconnecting' : 'connecting');
    socket = new WebSocket(socketUrl());

    socket.onopen = function () {
      var wasPaused = pausedShown;
      hadConnection = true;
      offlineSince = null;
      delay = MIN_RECONNECT_MS;
      pausedShown = false;
      showStatus('connected');
      while (outbox.length) socket.send(JSON.stringify(outbox.shift()));
      if (wasPaused) reloadAfterOutage();
    };

    socket.onmessage = function (msg) {
      var data;
      try { data = JSON.parse(msg.data); } catch (e) { return; }
      if (data.type === 'reload') window.location.reload();
    };

    socket.onclose = function () {
      socket = null;
      if (offlineSince === null) offlineSince = Date.now();
      if (Date.now() - offlineSince >= TOMBSTONE_AFTER_MS) {
        showStatus('disconnected');
        showPausedNotice();
      } else {
        showStatus('reconnecting');
      }
      scheduleRetry();
    };

    // onclose is the single place that schedules a retry.
    socket.onerror = function () { try { socket.close(); } catch (e) {} };
  }

  function sendEvent(event) {
    event.timestamp = Date.now();
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
    else outbox.push(event);
  }

  /* ---- clicks ---- */
  document.addEventListener('click', function (e) {
    var hit = e.target.closest('[data-choice]');
    if (!hit) return;
    sendEvent({
      type: 'click',
      text: hit.textContent.trim(),
      choice: hit.dataset.choice,
      id: hit.id || null
    });
  });

  /* ---- selection styling for .options / .cards ---- */
  window.selectedChoice = null;

  window.toggleSelect = function (el) {
    var group = el.closest('.options') || el.closest('.cards');
    var many = Boolean(group) && group.dataset.multiselect !== undefined;
    if (many) {
      el.classList.toggle('selected');
    } else {
      if (group) group.querySelectorAll('.option, .card').forEach(function (o) { o.classList.remove('selected'); });
      el.classList.add('selected');
    }
    window.selectedChoice = el.dataset.choice;
  };

  // Escape hatch for full-document screens that want to report something themselves.
  window.brainstorm = {
    send: sendEvent,
    choice: function (value, metadata) {
      sendEvent(Object.assign({ type: 'choice', value: value }, metadata || {}));
    }
  };

  openSocket();
})();
