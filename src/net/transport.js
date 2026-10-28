// Connections between players.
//
// PeerTransport: real internet play over WebRTC using PeerJS (loaded from a CDN on
// demand, so no install is needed). The host registers a peer id built from the
// room code; friends connect to that id. Data then flows directly between players.
//
// LocalTransport: same interface over BroadcastChannel, for testing two tabs in one
// browser (add ?net=local to the URL).

const PREFIX = 'alien-survivor-v1-';
const PEERJS_URLS = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
];
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

let peerLib = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (peerLib) return peerLib;
  peerLib = new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (i >= PEERJS_URLS.length) { peerLib = null; reject(new Error('Could not load the network library (check your internet connection)')); return; }
      const s = document.createElement('script');
      s.src = PEERJS_URLS[i++];
      s.onload = () => (window.Peer ? resolve(window.Peer) : tryNext());
      s.onerror = () => { s.remove(); tryNext(); };
      document.head.appendChild(s);
    };
    tryNext();
  });
  return peerLib;
}

// wraps a PeerJS DataConnection in our tiny interface
function wrapPeerConn(dc) {
  const c = {
    id: dc.peer,
    send: (o) => { try { if (dc.open) dc.send(o); } catch { /* closed */ } },
    close: () => { try { dc.close(); } catch { /* ignore */ } },
    onData: null, onClose: null, onOpen: null,
  };
  dc.on('open', () => c.onOpen && c.onOpen());
  dc.on('data', (d) => c.onData && c.onData(d));
  dc.on('close', () => c.onClose && c.onClose());
  dc.on('error', () => c.onClose && c.onClose());
  return c;
}

export class PeerTransport {
  // host: resolves when the room is registered; onConn(conn) for every friend that joins
  async host(code, onConn) {
    const Peer = await loadPeerJS();
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, { config: ICE, debug: 0 });
      this.peer = peer;
      let ready = false;
      peer.on('open', () => { ready = true; resolve(); });
      peer.on('connection', (dc) => {
        const c = wrapPeerConn(dc);
        dc.on('open', () => onConn(c));
      });
      peer.on('error', (e) => {
        if (!ready) reject(new Error(e.type === 'unavailable-id' ? 'Room code already in use' : 'Network error: ' + (e.type || e.message)));
        else if (this.onError) this.onError(e);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
    });
  }

  // client: resolves with the connection to the host
  async join(code) {
    const Peer = await loadPeerJS();
    return new Promise((resolve, reject) => {
      const peer = new Peer(undefined, { config: ICE, debug: 0 });
      this.peer = peer;
      let done = false;
      const fail = (msg) => { if (!done) { done = true; reject(new Error(msg)); } };
      const timer = setTimeout(() => fail('No game found with that code'), 15000);
      peer.on('open', () => {
        const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        const c = wrapPeerConn(dc);
        c.onOpen = () => { if (!done) { done = true; clearTimeout(timer); resolve(c); } };
      });
      peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? 'No game found with that code' : 'Network error: ' + (e.type || e.message)));
    });
  }

  close() { try { this.peer && this.peer.destroy(); } catch { /* ignore */ } this.peer = null; }
}

// ---------------------------------------------------------------------------
export class LocalTransport {
  async host(code, onConn) {
    const ch = new BroadcastChannel('as-net-' + code);
    this.ch = ch;
    const conns = new Map();
    ch.onmessage = ({ data: m }) => {
      if (m.to !== 'host') return;
      if (m.type === 'open') {
        const c = { id: m.from, onData: null, onClose: null, send: (o) => ch.postMessage({ to: m.from, from: 'host', type: 'data', data: o }), close: () => ch.postMessage({ to: m.from, from: 'host', type: 'close' }) };
        conns.set(m.from, c);
        ch.postMessage({ to: m.from, from: 'host', type: 'opened' });
        onConn(c);
      } else {
        const c = conns.get(m.from);
        if (!c) return;
        if (m.type === 'data' && c.onData) c.onData(structuredClone(m.data));
        if (m.type === 'close') { conns.delete(m.from); c.onClose && c.onClose(); }
      }
    };
  }

  async join(code) {
    const ch = new BroadcastChannel('as-net-' + code);
    this.ch = ch;
    const me = 'c' + Math.random().toString(36).slice(2, 8);
    return new Promise((resolve, reject) => {
      const c = { id: 'host', onData: null, onClose: null, send: (o) => ch.postMessage({ to: 'host', from: me, type: 'data', data: o }), close: () => ch.postMessage({ to: 'host', from: me, type: 'close' }) };
      const timer = setTimeout(() => reject(new Error('No game found with that code')), 4000);
      ch.onmessage = ({ data: m }) => {
        if (m.to !== me) return;
        if (m.type === 'opened') { clearTimeout(timer); resolve(c); }
        if (m.type === 'data' && c.onData) c.onData(structuredClone(m.data));
        if (m.type === 'close' && c.onClose) c.onClose();
      };
      ch.postMessage({ to: 'host', from: me, type: 'open' });
    });
  }

  close() { try { this.ch && this.ch.close(); } catch { /* ignore */ } this.ch = null; }
}
