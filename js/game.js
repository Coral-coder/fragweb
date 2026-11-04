// Shared game rules, map, and physics. Used by both the host simulation and every client.

export const TICK = 1 / 60;

export const PLAYER = {
  half: [0.4, 0.9, 0.4], // collision half-extents (1.8m tall)
  eye: 0.7,              // eye height above body centre
  speed: 12.5,
  airAccel: 40,
  groundAccel: 110,
  friction: 9,
  jump: 8.2,
  gravity: 22,
  step: 0.55,
  maxHealth: 100,
  overHealth: 200,
  maxArmor: 150,
};

// ---------------------------------------------------------------- weapons
export const WEAPONS = [
  { id: 0, key: '1', name: 'Sidearm',         kind: 'hit',    dmg: 18, interval: 0.32, spread: 0.004, pellets: 1,  ammo: null,      color: 0x9fe6ff },
  { id: 1, key: '2', name: 'Scattergun',      kind: 'hit',    dmg: 9,  interval: 0.95, spread: 0.07,  pellets: 10, ammo: 'shells',  color: 0xffc46b },
  { id: 2, key: '3', name: 'Pulse Rifle',     kind: 'hit',    dmg: 9,  interval: 0.085,spread: 0.018, pellets: 1,  ammo: 'cells',   color: 0x7dff9b },
  { id: 3, key: '4', name: 'Rocket Launcher', kind: 'rocket', dmg: 100, splash: 95, radius: 4.2, speed: 40, interval: 0.8, ammo: 'rockets', color: 0xff6a3d },
  { id: 4, key: '5', name: 'Rail Lance',      kind: 'hit',    dmg: 90, interval: 1.45, spread: 0,     pellets: 1,  ammo: 'slugs',   color: 0xd27bff },
];

export const AMMO_MAX = { shells: 40, cells: 250, rockets: 30, slugs: 20 };
export const START_AMMO = { shells: 0, cells: 0, rockets: 0, slugs: 0 };

// ---------------------------------------------------------------- map
// "Crucible Yard": an original symmetrical arena. Everything is axis-aligned boxes.
// Box: { min:[x,y,z], max:[x,y,z], k: material key }
function box(x0, y0, z0, x1, y1, z1, k = 'block') {
  return { min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], k };
}

function buildMap() {
  const B = [];
  const S = 32; // half-size of arena
  // floor + walls
  B.push(box(-S, -1, -S, S, 0, S, 'floor'));
  B.push(box(-S - 1, 0, -S - 1, S + 1, 22, -S, 'wall'));
  B.push(box(-S - 1, 0, S, S + 1, 22, S + 1, 'wall'));
  B.push(box(-S - 1, 0, -S, -S, 22, S, 'wall'));
  B.push(box(S, 0, -S, S + 1, 22, S, 'wall'));

  // central dais (top y=4) with stairs on north & south
  B.push(box(-5, 0, -5, 5, 4, 5, 'dais'));
  for (let i = 0; i < 8; i++) {
    const h = 4 - (i + 1) * 0.5;
    if (h <= 0) break;
    B.push(box(-2.5, 0, 5 + i * 0.8, 2.5, h, 5 + (i + 1) * 0.8, 'step'));
    B.push(box(-2.5, 0, -5 - (i + 1) * 0.8, 2.5, h, -5 - i * 0.8, 'step'));
  }

  // four corner towers (top y=7) and long ledges along north/south walls
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.push(box(sx * S, 0, sz * S, sx * (S - 7), 7, sz * (S - 7), 'tower'));
  }
  for (const sz of [-1, 1]) {
    B.push(box(-(S - 7), 6.4, sz * S, S - 7, 7, sz * (S - 4), 'ledge'));
  }

  // stairs up to towers along the east and west walls (14 steps of 0.5)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      const h = (i + 1) * 0.5;
      const z0 = sz * (S - 7 - 14 + i);
      const z1 = sz * (S - 7 - 14 + i + 1);
      B.push(box(sx * S, 0, z0, sx * (S - 3.5), h, z1, 'step'));
    }
  }

  // side bunkers east/west (top y=2.5) — jumpable via crates
  for (const sx of [-1, 1]) {
    B.push(box(sx * 14, 0, -4, sx * 20, 2.5, 4, 'block'));
    B.push(box(sx * 12.6, 0, -1, sx * 14, 1.3, 1, 'crate'));
  }

  // cover pillars and crates
  const pillars = [[-12, -14], [12, -14], [-12, 14], [12, 14], [0, -20], [0, 20]];
  for (const [x, z] of pillars) B.push(box(x - 1, 0, z - 1, x + 1, 5, z + 1, 'pillar'));
  const crates = [[-20, -12], [20, 12], [-8, 22], [8, -22], [-22, 18], [22, -18], [-7, -9], [7, 9]];
  for (const [x, z] of crates) B.push(box(x - 0.8, 0, z - 0.8, x + 0.8, 1.4, z + 0.8, 'crate'));

  return B;
}

export const MAP = {
  name: 'Crucible Yard',
  boxes: buildMap(),
  // jump pads: stepping on one sets your velocity
  pads: [
    { p: [-18, 0, -16], r: 1.3, v: [0, 18.5, -12.5] },
    { p: [18, 0, 16], r: 1.3, v: [0, 18.5, 12.5] },
    { p: [-18, 0, 16], r: 1.3, v: [0, 18.5, 12.5] },
    { p: [18, 0, -16], r: 1.3, v: [0, 18.5, -12.5] },
  ],
  spawns: [
    [-24, 1, 0], [24, 1, 0], [0, 1, -26], [0, 1, 26], [-10, 1, -24], [10, 1, 24],
    [-28.5, 8, -28.5], [28.5, 8, 28.5], [-28.5, 8, 28.5], [28.5, 8, -28.5],
    [-17, 4, 0], [17, 4, 0], [-26, 1, 20], [26, 1, -20],
  ],
  pickups: [
    { t: 'mega', p: [0, 4, 0] , respawn: 40 },
    { t: 'armor', p: [-28.5, 7, -28.5], respawn: 30 },
    { t: 'armor', p: [28.5, 7, 28.5], respawn: 30 },
    { t: 'health', p: [-28.5, 7, 28.5], respawn: 20 },
    { t: 'health', p: [28.5, 7, -28.5], respawn: 20 },
    { t: 'health', p: [-24, 0, 0], respawn: 20 },
    { t: 'health', p: [24, 0, 0], respawn: 20 },
    { t: 'shard', p: [-12, 5, -14], respawn: 25 },
    { t: 'shard', p: [12, 5, 14], respawn: 25 },
    { t: 'w1', p: [-17, 2.5, 0], respawn: 10 },
    { t: 'w1', p: [17, 2.5, 0], respawn: 10 },
    { t: 'w2', p: [0, 0, -14], respawn: 10 },
    { t: 'w2', p: [0, 0, 14], respawn: 10 },
    { t: 'w3', p: [-20, 0, 24], respawn: 10 },
    { t: 'w3', p: [20, 0, -24], respawn: 10 },
    { t: 'w4', p: [0, 7, -29.5], respawn: 15 },
    { t: 'w4', p: [0, 7, 29.5], respawn: 15 },
    { t: 'a_shells', p: [-8, 0, -4], respawn: 15 },
    { t: 'a_shells', p: [8, 0, 4], respawn: 15 },
    { t: 'a_cells', p: [-8, 0, 4], respawn: 15 },
    { t: 'a_cells', p: [8, 0, -4], respawn: 15 },
    { t: 'a_rockets', p: [-22, 0, -24], respawn: 15 },
    { t: 'a_rockets', p: [22, 0, 24], respawn: 15 },
    { t: 'a_slugs', p: [-14, 7, 29.5], respawn: 20 },
    { t: 'a_slugs', p: [14, 7, -29.5], respawn: 20 },
  ],
};

// what each pickup gives
export const PICKUP_INFO = {
  health:    { label: '+25 Health', color: 0x4cff8a },
  mega:      { label: 'Mega Health', color: 0x3da9ff },
  armor:     { label: '+50 Armor', color: 0xffd84a },
  shard:     { label: '+5 Armor', color: 0xffe9a0 },
  w1:        { label: 'Scattergun', color: WEAPONS[1].color, weapon: 1, ammo: ['shells', 12] },
  w2:        { label: 'Pulse Rifle', color: WEAPONS[2].color, weapon: 2, ammo: ['cells', 80] },
  w3:        { label: 'Rocket Launcher', color: WEAPONS[3].color, weapon: 3, ammo: ['rockets', 8] },
  w4:        { label: 'Rail Lance', color: WEAPONS[4].color, weapon: 4, ammo: ['slugs', 6] },
  a_shells:  { label: 'Shells', color: WEAPONS[1].color, ammo: ['shells', 10] },
  a_cells:   { label: 'Cells', color: WEAPONS[2].color, ammo: ['cells', 60] },
  a_rockets: { label: 'Rockets', color: WEAPONS[3].color, ammo: ['rockets', 5] },
  a_slugs:   { label: 'Slugs', color: WEAPONS[4].color, ammo: ['slugs', 4] },
};

// ---------------------------------------------------------------- physics
const H = PLAYER.half;

export function overlapsBox(p, b, h = H) {
  return p[0] + h[0] > b.min[0] && p[0] - h[0] < b.max[0] &&
         p[1] + h[1] > b.min[1] && p[1] - h[1] < b.max[1] &&
         p[2] + h[2] > b.min[2] && p[2] - h[2] < b.max[2];
}

function anyOverlap(p, boxes) {
  for (const b of boxes) if (overlapsBox(p, b)) return true;
  return false;
}

// Move a body {p, v, onGround} through the world, sliding along walls and stepping up stairs.
export function moveBody(body, dt, boxes = MAP.boxes) {
  const p = body.p, v = body.v;
  const wasGround = body.onGround;
  body.onGround = false;
  for (const axis of [0, 2, 1]) {
    const d = v[axis] * dt;
    if (d === 0 && axis !== 1) continue;
    p[axis] += d;
    for (const b of boxes) {
      if (!overlapsBox(p, b)) continue;
      if (axis !== 1) {
        const stepH = b.max[1] - (p[1] - H[1]);
        if (wasGround && stepH > 0 && stepH <= PLAYER.step) {
          const oldY = p[1];
          p[1] = b.max[1] + H[1] + 0.001;
          if (!anyOverlap(p, boxes)) continue;
          p[1] = oldY;
        }
        p[axis] = d > 0 ? b.min[axis] - H[axis] - 0.001 : b.max[axis] + H[axis] + 0.001;
        v[axis] = 0;
      } else {
        if (d <= 0) { p[1] = b.max[1] + H[1] + 0.0001; body.onGround = true; }
        else p[1] = b.min[1] - H[1] - 0.0001;
        v[1] = 0;
      }
    }
  }
  // stick to ground when walking down stairs
  if (wasGround && !body.onGround && v[1] <= 0) {
    const oldY = p[1];
    p[1] -= PLAYER.step;
    let hit = null;
    for (const b of boxes) if (overlapsBox(p, b)) { if (!hit || b.max[1] > hit.max[1]) hit = b; }
    if (hit && hit.max[1] <= oldY - H[1] + 0.01) { p[1] = hit.max[1] + H[1] + 0.0001; body.onGround = true; v[1] = 0; }
    else p[1] = oldY;
  }
}

// Apply movement input to a body. wish: {fwd, right, jump}, yaw in radians.
export function stepPlayer(body, input, yaw, dt) {
  const v = body.v;
  // wish direction (camera faces -z at yaw 0)
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  let wx = -sin * input.fwd + cos * input.right;
  let wz = -cos * input.fwd - sin * input.right;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  if (body.onGround) {
    // friction
    const sp = Math.hypot(v[0], v[2]);
    if (sp > 0) {
      const drop = Math.max(sp - PLAYER.friction * dt * Math.max(sp, 4), 0) / sp;
      v[0] *= drop; v[2] *= drop;
    }
    accelerate(v, wx, wz, PLAYER.speed, PLAYER.groundAccel, dt);
    if (input.jump) { v[1] = PLAYER.jump; body.onGround = false; }
  } else {
    accelerate(v, wx, wz, PLAYER.speed, PLAYER.airAccel * 0.5, dt);
  }
  v[1] -= PLAYER.gravity * dt;
  if (v[1] < -50) v[1] = -50;
  moveBody(body, dt);

  // jump pads
  for (const pad of MAP.pads) {
    const fy = body.p[1] - H[1];
    if (Math.abs(fy - pad.p[1]) < 0.15 && Math.hypot(body.p[0] - pad.p[0], body.p[2] - pad.p[2]) < pad.r) {
      v[0] = pad.v[0]; v[1] = pad.v[1]; v[2] = pad.v[2];
      body.onGround = false;
      return 'pad';
    }
  }
  return null;
}

function accelerate(v, wx, wz, wishSpeed, accel, dt) {
  if (wx === 0 && wz === 0) return;
  const cur = v[0] * wx + v[2] * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  v[0] += a * wx; v[2] += a * wz;
}

// ---------------------------------------------------------------- rays
// Ray vs AABB (slab test). Returns distance or Infinity.
export function rayBox(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
    } else {
      const inv = 1 / d[i];
      let t1 = (min[i] - o[i]) * inv, t2 = (max[i] - o[i]) * inv;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function rayWorld(o, d, maxDist = 200) {
  let best = maxDist;
  for (const b of MAP.boxes) {
    const t = rayBox(o, d, b.min, b.max);
    if (t < best) best = t;
  }
  return best;
}

// Like rayWorld but also returns the surface normal of what was hit (null if nothing).
export function rayWorldHit(o, d, maxDist = 200) {
  let best = maxDist, hitBox = null;
  for (const b of MAP.boxes) {
    const t = rayBox(o, d, b.min, b.max);
    if (t < best) { best = t; hitBox = b; }
  }
  let n = null;
  if (hitBox) {
    const p = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    let bestErr = Infinity;
    for (let i = 0; i < 3; i++) {
      for (const [face, sign] of [[hitBox.min[i], -1], [hitBox.max[i], 1]]) {
        const err = Math.abs(p[i] - face);
        if (err < bestErr) { bestErr = err; n = [0, 0, 0]; n[i] = sign; }
      }
    }
  }
  return { t: best, n };
}

export function playerBox(p) {
  return { min: [p[0] - H[0], p[1] - H[1], p[2] - H[2]], max: [p[0] + H[0], p[1] + H[1], p[2] + H[2]] };
}

export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
