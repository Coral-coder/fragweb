// Networking. GitHub Pages can only serve static files, so there is no game server:
// the host player's browser runs the match (in a Web Worker) and other players connect
// to it peer-to-peer over WebRTC. PeerJS's free public broker is only used to introduce
// the browsers to each other; game traffic then flows directly between them over the LAN.

const PREFIX = 'fragweb-lan-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function makePeer(id) {
  if (!window.Peer) throw new Error('PeerJS failed to load (no internet?)');
  return id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
}

// Start hosting. Returns { send, code, online, addBot, kickBot, close }.
// onMsg receives every message the host sends to the local player.
export async function startHost(opts, onMsg, { online = true, onStatus = () => {} } = {}) {
  const worker = new Worker(new URL('./host-worker.js', import.meta.url), { type: 'module' });
  const conns = new Map();
  worker.onmessage = (e) => {
    const { cid, msg } = e.data;
    if (cid === 'local') onMsg(msg);
    else {
      const c = conns.get(cid);
      if (c && c.open) { try { c.send(msg); } catch { /* channel closing */ } }
    }
  };
  worker.onerror = (e) => onStatus('Host error: ' + (e.message || e));
  worker.postMessage({ t: 'start', opts });

  let code = null;
  let peer = null;
  if (online) {
    try {
      ({ peer, code } = await openHostPeer(onStatus));
    } catch (err) {
      onStatus('Could not reach the matchmaking broker — playing offline. (' + err.message + ')');
    }
  }

  if (peer) {
    let n = 0;
    peer.on('connection', (conn) => {
      const cid = 'c' + (++n);
      conn.on('open', () => conns.set(cid, conn));
      conn.on('data', (msg) => worker.postMessage({ t: 'msg', cid, msg }));
      const gone = () => { if (conns.has(cid)) { conns.delete(cid); worker.postMessage({ t: 'leave', cid }); } };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
  }

  return {
    code,
    online: !!peer,
    send: (msg) => worker.postMessage({ t: 'msg', cid: 'local', msg }),
    close: () => { worker.terminate(); if (peer) peer.destroy(); },
  };
}

function openHostPeer(onStatus, tries = 0) {
  return new Promise((resolve, reject) => {
    const code = randomCode();
    let peer;
    try { peer = makePeer(PREFIX + code); } catch (e) { reject(e); return; }
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('timed out')); }, 8000);
    peer.on('open', () => { clearTimeout(timer); resolve({ peer, code }); });
    peer.on('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      if (err.type === 'unavailable-id' && tries < 4) openHostPeer(onStatus, tries + 1).then(resolve, reject);
      else reject(new Error(err.type || err.message));
    });
  });
}

// Join a hosted game by room code. Returns { send, close }.
export function joinGame(code, onMsg, { onClose = () => {} } = {}) {
  code = String(code).trim().toUpperCase();
  return new Promise((resolve, reject) => {
    let peer;
    try { peer = makePeer(); } catch (e) { reject(e); return; }
    let settled = false;
    const fail = (msg) => { if (!settled) { settled = true; peer.destroy(); reject(new Error(msg)); } };
    const timer = setTimeout(() => fail('Timed out connecting to room ' + code), 15000);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') fail(`Room ${code} not found. Check the code and that the host's game is still open.`);
      else fail('Connection error: ' + (err.type || err.message));
    });
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { serialization: 'json', reliable: true });
      conn.on('open', () => {
        clearTimeout(timer);
        settled = true;
        resolve({
          send: (msg) => { if (conn.open) conn.send(msg); },
          close: () => peer.destroy(),
        });
      });
      conn.on('data', onMsg);
      conn.on('close', () => { if (settled) onClose(); });
      conn.on('error', () => fail('Could not open a connection to the host.'));
    });
  });
}
