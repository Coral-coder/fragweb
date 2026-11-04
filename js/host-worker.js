// Web Worker wrapper around the Host simulation. Worker timers keep running at full
// speed even when the host's tab is hidden, so the match never stalls.
import { Host } from './host.js';
import { TICK } from './game.js';

let host = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'start') {
    host = new Host(m.opts, (cid, msg) => self.postMessage({ cid, msg }));
    let last = performance.now();
    let acc = 0;
    setInterval(() => {
      const now = performance.now();
      acc += (now - last) / 1000;
      last = now;
      if (acc > 0.5) acc = 0.5; // don't spiral after a stall
      while (acc >= TICK) { host.tick(); acc -= TICK; }
    }, 1000 * TICK / 2);
  } else if (!host) {
    return;
  } else if (m.t === 'msg') {
    host.message(m.cid, m.msg);
  } else if (m.t === 'leave') {
    host.leave(m.cid);
  }
};
