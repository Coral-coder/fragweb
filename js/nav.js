// Automatic navigation graph for bots, generated from the level boxes.
// Nodes sit on walkable surfaces on a grid; edges connect nodes a player can walk, step, jump or
// drop between. Jump pads add long one-way edges. Bots path-find with A*.
import { WORLD, PLAYER, anyOverlap, stepPlayer, lineClear, hazardAt, rayWorld } from './game.js';

const SP = 1.6; // grid spacing (metres)
const SLIM = [0.22, 0.88, 0.22]; // slimmer body for sampling, so narrow stair treads still get nodes
const fits = (p) => !anyOverlap(p, null, SLIM);

export function buildNav() {
  const nodes = [];
  const index = new Map(); // "ix,iz" -> [node ids] (several heights per column)
  const H = PLAYER.half[1];
  const [bx0, bx1, bz0, bz1] = WORLD.bounds;

  // sample coordinates along one axis of a box top: grid points inside, or the centre for thin boxes
  const samples = (lo, hi) => {
    const out = [];
    for (let i = Math.ceil((lo + 0.15) / SP - 1e-6); i * SP <= hi - 0.15 + 1e-6; i++) out.push(i * SP);
    if (!out.length && hi - lo >= 0.5) out.push((lo + hi) / 2);
    return out;
  };
  // 1) sample walkable points on top of every box
  for (const b of WORLD.boxes) {
    const top = b.max[1];
    for (const x of samples(b.min[0], b.max[0])) {
      for (const z of samples(b.min[2], b.max[2])) {
        const ix = Math.round(x / SP), iz = Math.round(z / SP);
        if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
        const p = [x, top + H + 0.02, z];
        if (!fits(p)) continue;
        if (hazardAt(p)) continue;
        const key = ix + ',' + iz;
        let col = index.get(key);
        if (!col) index.set(key, col = []);
        if (col.some(id => Math.abs(nodes[id].p[1] - p[1]) < 0.3)) continue;
        const id = nodes.length;
        nodes.push({ id, p: [x, top + H + 0.02, z], ix, iz, edges: [] });
        col.push(id);
      }
    }
  }

  // 2) connect neighbours
  const DIRS = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx || dz) DIRS.push([dx, dz]);
  const groundUnder = (x, y, z) => rayWorld([x, y, z], [0, -1, 0], H + 1.6) < H + 1.5;
  for (const n of nodes) {
    for (const [dx, dz] of DIRS) {
      const far = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      const col = index.get((n.ix + dx) + ',' + (n.iz + dz));
      if (!col) continue;
      for (const id of col) {
        const m = nodes[id];
        const dy = m.p[1] - n.p[1];
        if (dy > 2.6 || dy < -16) continue;
        const horiz = Math.hypot(m.p[0] - n.p[0], m.p[2] - n.p[2]);
        let type = 'walk';
        if (dy > 1.4) type = 'djump';
        else if (dy > PLAYER.step + 0.05) type = 'jump';
        else if (dy < -1.0) type = 'drop';
        if (horiz < 0.3) continue;
        // clearance: check the body along the segment at the higher of the two heights
        const hy = Math.max(n.p[1], m.p[1]) + 0.05;
        let blocked = false;
        for (const f of far ? [0.25, 0.5, 0.75] : [0.5]) {
          const q = [n.p[0] + (m.p[0] - n.p[0]) * f, hy, n.p[2] + (m.p[2] - n.p[2]) * f];
          if (!fits(q)) { blocked = true; break; }
          // no walking over holes (drops are fine, they end on the lower node)
          if (type !== 'drop' && !groundUnder(q[0], Math.min(n.p[1], m.p[1]) + 0.05, q[2])) { blocked = true; break; }
        }
        if (blocked) continue;
        if (type === 'walk' && !lineClear([n.p[0], n.p[1] + 0.3, n.p[2]], [m.p[0], m.p[1] + 0.3, m.p[2]])) continue;
        // diagonal moves must not cut corners
        if (dx && dz && !far) {
          const a = [n.p[0] + dx * SP, n.p[1] + 0.05, n.p[2]], c = [n.p[0], n.p[1] + 0.05, n.p[2] + dz * SP];
          if (!fits(a) || !fits(c)) continue;
        }
        const cost = horiz + (type === 'jump' ? 2.5 : 0) + (type === 'djump' ? 6 : 0) + (type === 'drop' ? 1 : 0);
        n.edges.push({ to: m.id, cost, type });
      }
    }
  }

  // 3) jump pads: simulate the launch and link pad -> landing
  for (const pad of WORLD.pads) {
    const from = nearest(nodes, [pad.p[0], pad.p[1] + H, pad.p[2]], 2.5);
    if (from == null) continue;
    const body = { p: [pad.p[0], pad.p[1] + H + 0.05, pad.p[2]], v: [0, 0, 0], onGround: false };
    let launched = false;
    for (let t = 0; t < 6; t += 1 / 60) {
      if (stepPlayer(body, { fwd: 0, right: 0, jump: false }, 0, 1 / 60) === 'pad') launched = true;
      if (launched && body.onGround && t > 0.3) break;
    }
    const to = nearest(nodes, body.p, 2.5);
    if (to != null && to !== from) nodes[from].edges.push({ to, cost: 4, type: 'pad' });
  }

  // keep only the largest connected region reachable both ways is overkill; just drop isolated nodes
  return { nodes, index };
}

function nearest(nodes, p, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const n of nodes) {
    const d = Math.hypot(n.p[0] - p[0], (n.p[1] - p[1]) * 1.5, n.p[2] - p[2]);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

// Find the closest node to a position (uses the grid index; falls back to a scan).
export function nodeNear(nav, p, maxD = 4) {
  const ix = Math.round(p[0] / SP), iz = Math.round(p[2] / SP);
  let best = null, bd = maxD;
  for (let r = 0; r <= 2; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const col = nav.index.get((ix + dx) + ',' + (iz + dz));
      if (!col) continue;
      for (const id of col) {
        const n = nav.nodes[id];
        const dy = p[1] - n.p[1];
        if (dy < -1.2) continue; // node is above us
        const d = Math.hypot(n.p[0] - p[0], dy * 2, n.p[2] - p[2]);
        if (d < bd) { bd = d; best = id; }
      }
    }
    if (best != null) return best;
  }
  return nearest(nav.nodes, p, maxD * 2);
}

// A* search. Returns an array of node ids (start..goal) or null.
export function findPath(nav, start, goal, maxIter = 6000) {
  if (start == null || goal == null) return null;
  if (start === goal) return [start];
  const nodes = nav.nodes;
  const g = new Map([[start, 0]]);
  const came = new Map();
  const gp = nodes[goal].p;
  const h = (id) => { const p = nodes[id].p; return Math.hypot(p[0] - gp[0], p[1] - gp[1], p[2] - gp[2]); };
  const open = new Heap();
  open.push(start, h(start));
  const closed = new Set();
  let iter = 0;
  while (open.size && iter++ < maxIter) {
    const cur = open.pop();
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (came.has(c)) { c = came.get(c); path.push(c); }
      return path.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    const gc = g.get(cur);
    for (const e of nodes[cur].edges) {
      const ng = gc + e.cost;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng);
        came.set(e.to, cur);
        open.push(e.to, ng + h(e.to));
      }
    }
  }
  return null;
}

export function edgeType(nav, a, b) {
  const e = nav.nodes[a]?.edges.find(e => e.to === b);
  return e ? e.type : 'walk';
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(pri);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
