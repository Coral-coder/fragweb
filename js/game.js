// Shared game rules and physics. Used by the host simulation, the bots and every client.
import { MAPS } from './maps.js';

export const TICK = 1 / 60;
export const GRAVITY = 22;

export const PLAYER = {
  half: [0.4, 0.9, 0.4], // collision half-extents (1.8m tall)
  eye: 0.7,              // eye height above body centre
  speed: 12.5,
  airAccel: 40,
  groundAccel: 110,
  friction: 9,
  jump: 8.2,
  airJump: 7.4,          // double jump
  dodgeSpeed: 17,
  dodgeUp: 5.2,
  dodgeCooldown: 0.45,
  step: 0.55,
  maxHealth: 100,
  overHealth: 199,
  maxArmor: 150,
  maxShield: 150,
  headZone: 0.52,        // hits above centre + this count as headshots
};

// ---------------------------------------------------------------- weapons
// kind: 'hit' (instant ray), 'proj' (projectile), 'beam' (continuous), 'burst', 'blast' (area), 'zoom'
export const WEAPONS = [
  {
    id: 0, key: '1', name: 'Sidearm', ammo: null, color: 0x9fe6ff, rank: 1,
    primary: { kind: 'hit', dmg: 20, interval: 0.34, spread: 0.003, pellets: 1, head: 1.5 },
    alt:     { kind: 'burst', dmg: 13, interval: 0.8, spread: 0.02, shots: 3, gap: 0.07 },
    desc: 'Accurate energy pistol. Alt: three-round burst. Never runs dry.',
  },
  {
    id: 1, key: '2', name: 'Scattergun', ammo: 'shells', color: 0xffc46b, rank: 3,
    primary: { kind: 'hit', dmg: 8, interval: 0.95, spread: 0.075, pellets: 10 },
    alt:     { kind: 'proj', proj: 'grenade', interval: 0.95, speed: 26, cost: 1 },
    desc: 'Close-range shredder. Alt: lobbed breach grenade.',
  },
  {
    id: 2, key: '3', name: 'Pulse Rifle', ammo: 'cells', color: 0x7dff9b, rank: 2,
    primary: { kind: 'hit', dmg: 9, interval: 0.085, spread: 0.016, pellets: 1 },
    alt:     { kind: 'proj', proj: 'orb', interval: 0.5, speed: 24, cost: 5 },
    desc: 'Rapid-fire rifle. Alt: slow plasma orb with splash damage.',
  },
  {
    id: 3, key: '4', name: 'Arc Caster', ammo: 'arc', color: 0x5cc8ff, rank: 4,
    primary: { kind: 'beam', dmg: 7, interval: 0.07, range: 22, chain: 7 },
    alt:     { kind: 'blast', dmg: 45, interval: 1.3, radius: 6.5, push: 16, cost: 15 },
    desc: 'Lightning beam that jumps to a second target. Alt: shockwave that throws enemies back.',
  },
  {
    id: 4, key: '5', name: 'Shard Cannon', ammo: 'shards', color: 0xff9a3c, rank: 5,
    primary: { kind: 'proj', proj: 'shard', interval: 0.9, speed: 62, pellets: 9, spread: 0.075, cost: 1 },
    alt:     { kind: 'proj', proj: 'bomb', interval: 1.0, speed: 28, cost: 1 },
    desc: 'Fires a fan of ricocheting hot shards. Alt: lobbed cluster bomb.',
  },
  {
    id: 5, key: '6', name: 'Rocket Launcher', ammo: 'rockets', color: 0xff6a3d, rank: 6,
    primary: { kind: 'proj', proj: 'rocket', interval: 0.85, speed: 40, cost: 1 },
    alt:     { kind: 'proj', proj: 'rocket', interval: 1.1, speed: 40, cost: 1, load: 3, loadTime: 0.38 },
    desc: 'Classic splash damage and rocket jumps. Alt: hold to load up to three, release to fire a spread.',
  },
  {
    id: 6, key: '7', name: 'Rail Lance', ammo: 'slugs', color: 0xd27bff, rank: 7,
    primary: { kind: 'hit', dmg: 85, interval: 1.4, spread: 0, pellets: 1, head: 140 / 85 },
    alt:     { kind: 'zoom' },
    desc: 'Long-range beam — headshots are lethal. Alt: hold to zoom.',
  },
  {
    id: 7, key: '8', name: 'Nova Charge', ammo: 'nova', color: 0xfff27a, rank: 9,
    primary: { kind: 'proj', proj: 'nova', interval: 2.0, speed: 16, cost: 1 },
    alt:     { kind: 'proj', proj: 'nova', interval: 2.0, speed: 16, cost: 1 },
    desc: 'Super-weapon. One shot. Enormous blast. Run.',
  },
];

export const PROJ = {
  rocket:  { r: 0.15, grav: 0,    life: 6,   dmg: 100, splash: 95, radius: 4.2, push: 12, bounces: 0 },
  grenade: { r: 0.15, grav: 20,   life: 2.2, dmg: 75,  splash: 75, radius: 3.8, push: 11, bounces: 2, fuse: true },
  orb:     { r: 0.3,  grav: 0,    life: 5,   dmg: 40,  splash: 35, radius: 2.6, push: 6,  bounces: 0 },
  shard:   { r: 0.06, grav: 4,    life: 1.4, dmg: 12,  splash: 0,  radius: 0,   push: 1.2, bounces: 2 },
  bomb:    { r: 0.18, grav: 18,   life: 3,   dmg: 60,  splash: 60, radius: 3.4, push: 10, bounces: 0, cluster: 10 },
  nova:    { r: 0.6,  grav: 0,    life: 9,   dmg: 400, splash: 300, radius: 13, push: 30, bounces: 0 },
};

export const AMMO_MAX = { shells: 40, cells: 300, arc: 200, shards: 40, rockets: 30, slugs: 25, nova: 1 };
export const START_AMMO = { shells: 0, cells: 0, arc: 0, shards: 0, rockets: 0, slugs: 0, nova: 0 };

// what each pickup gives
export const PICKUP_INFO = {
  health:    { label: '+25 Health', color: 0x4cff8a, respawn: 20 },
  vial:      { label: '+5 Health', color: 0x7dffb0, respawn: 25 },
  mega:      { label: 'Mega Health', color: 0x3da9ff, respawn: 45 },
  armor:     { label: '+50 Armor', color: 0xffd84a, respawn: 30 },
  shard:     { label: '+5 Armor', color: 0xffe9a0, respawn: 25 },
  aegis:     { label: 'Aegis Field (+100 shield)', color: 0x7ab8ff, respawn: 60, power: true },
  amp:       { label: 'Damage Amplifier!', color: 0xc45cff, respawn: 90, power: true, duration: 30 },
  boots:     { label: 'Jump Boots', color: 0x5cffd6, respawn: 45, power: true, duration: 30 },
  w1: { label: 'Scattergun',      color: WEAPONS[1].color, weapon: 1, ammo: ['shells', 12],  respawn: 12 },
  w2: { label: 'Pulse Rifle',     color: WEAPONS[2].color, weapon: 2, ammo: ['cells', 100],  respawn: 12 },
  w3: { label: 'Arc Caster',      color: WEAPONS[3].color, weapon: 3, ammo: ['arc', 80],     respawn: 12 },
  w4: { label: 'Shard Cannon',    color: WEAPONS[4].color, weapon: 4, ammo: ['shards', 12],  respawn: 12 },
  w5: { label: 'Rocket Launcher', color: WEAPONS[5].color, weapon: 5, ammo: ['rockets', 8],  respawn: 12 },
  w6: { label: 'Rail Lance',      color: WEAPONS[6].color, weapon: 6, ammo: ['slugs', 8],    respawn: 15 },
  w7: { label: 'NOVA CHARGE',     color: WEAPONS[7].color, weapon: 7, ammo: ['nova', 1],     respawn: 120, power: true },
  a_shells:  { label: 'Shells',  color: WEAPONS[1].color, ammo: ['shells', 10],  respawn: 15 },
  a_cells:   { label: 'Cells',   color: WEAPONS[2].color, ammo: ['cells', 80],   respawn: 15 },
  a_arc:     { label: 'Arc Cells', color: WEAPONS[3].color, ammo: ['arc', 60],   respawn: 15 },
  a_shards:  { label: 'Shards',  color: WEAPONS[4].color, ammo: ['shards', 10],  respawn: 15 },
  a_rockets: { label: 'Rockets', color: WEAPONS[5].color, ammo: ['rockets', 6],  respawn: 15 },
  a_slugs:   { label: 'Slugs',   color: WEAPONS[6].color, ammo: ['slugs', 5],    respawn: 20 },
};

export const MODES = {
  dm:  { name: 'Deathmatch', teams: false, desc: 'Every player for themselves. Most frags wins.' },
  tdm: { name: 'Team Deathmatch', teams: true, desc: 'Red vs Blue. Team frags add up.' },
  ctf: { name: 'Capture the Flag', teams: true, desc: 'Steal the enemy flag and bring it home while yours is safe.' },
  duel: { name: 'Duel', teams: false, desc: 'One on one. Short respawn protection, high stakes.' },
};

export const MUTATORS = {
  instagib: { name: 'Instagib', desc: 'Everyone has an unlimited Rail Lance that kills in one hit. No pickups.' },
  lowgrav:  { name: 'Low Gravity', desc: 'Floaty jumps and long rocket flights.' },
  arsenal:  { name: 'Full Arsenal', desc: 'Spawn with every weapon (except the Nova) and some ammo.' },
  vampire:  { name: 'Vampire', desc: 'Damage you deal heals you.' },
};

// ---------------------------------------------------------------- world (current map)
export let WORLD = null;

export function setMap(id, mutators = {}) {
  const def = MAPS[id] || MAPS[Object.keys(MAPS)[0]];
  const built = def.build();
  WORLD = {
    id: def.id, def,
    boxes: built.boxes,
    deco: built.decos || [],
    pads: built.pads || [],
    spawns: built.spawns,
    teamSpawns: built.teamSpawns || null,
    pickups: built.pickups || [],
    flags: built.flags || null,
    hazards: built.hazards || [],
    killY: built.killY ?? -30,
    bounds: built.bounds,
    gravity: GRAVITY * (mutators.lowgrav ? 0.42 : 1) * (def.gravity || 1),
  };
  WORLD.gravScale = WORLD.gravity / GRAVITY;
  // spatial grid of boxes for fast collision/ray queries on large maps
  buildGrid(WORLD);
  return WORLD;
}

const CELL = 8;
function buildGrid(w) {
  w.grid = new Map();
  for (const b of w.boxes) {
    for (let gx = Math.floor(b.min[0] / CELL); gx <= Math.floor(b.max[0] / CELL); gx++) {
      for (let gz = Math.floor(b.min[2] / CELL); gz <= Math.floor(b.max[2] / CELL); gz++) {
        const k = gx * 10007 + gz;
        let l = w.grid.get(k);
        if (!l) w.grid.set(k, l = []);
        l.push(b);
      }
    }
  }
}

let queryStamp = 0;
function boxesNear(minX, minZ, maxX, maxZ) {
  const out = [];
  const stamp = ++queryStamp;
  for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
    for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
      const l = WORLD.grid.get(gx * 10007 + gz);
      if (!l) continue;
      for (const b of l) if (b._q !== stamp) { b._q = stamp; out.push(b); }
    }
  }
  return out;
}

// ---------------------------------------------------------------- physics
const H = PLAYER.half;

export function overlapsBox(p, b, h = H) {
  return p[0] + h[0] > b.min[0] && p[0] - h[0] < b.max[0] &&
         p[1] + h[1] > b.min[1] && p[1] - h[1] < b.max[1] &&
         p[2] + h[2] > b.min[2] && p[2] - h[2] < b.max[2];
}

export function anyOverlap(p, boxes = null, h = H) {
  boxes ||= boxesNear(p[0] - 1, p[2] - 1, p[0] + 1, p[2] + 1);
  for (const b of boxes) if (overlapsBox(p, b, h)) return true;
  return false;
}

// Move a body {p, v, onGround} through the world, sliding along walls and stepping up stairs.
export function moveBody(body, dt) {
  const p = body.p, v = body.v;
  const reach = Math.max(Math.abs(v[0]), Math.abs(v[2]), Math.abs(v[1])) * dt + 1.5;
  const boxes = boxesNear(p[0] - reach, p[2] - reach, p[0] + reach, p[2] + reach);
  const wasGround = body.onGround;
  body.onGround = false;
  body.hitWall = false;
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
        body.hitWall = true;
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

// Apply one step of movement input to a body.
// input: { fwd, right, jump (held), dodge: null | [dx, dz] in local space (-1..1) }
// body: { p, v, onGround, airJumps, jumpHeld, dodgeT, jumpBoost }
// Returns an event string ('jump', 'airjump', 'dodge', 'pad') or null.
export function stepPlayer(body, input, yaw, dt) {
  const v = body.v;
  const g = WORLD.gravity;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  let wx = -sin * input.fwd + cos * input.right;
  let wz = -cos * input.fwd - sin * input.right;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  body.dodgeT = Math.max(0, (body.dodgeT || 0) - dt);
  const boost = body.jumpBoost || 1;
  const jumpScale = Math.sqrt(WORLD.gravScale) * boost;
  let ev = null;

  const pressed = input.jump && !body.jumpHeld;
  body.jumpHeld = !!input.jump;

  if (input.dodge && body.dodgeT <= 0 && (body.onGround || body.hitWall)) {
    const [dx, dz] = input.dodge;
    const ddx = -sin * -dz + cos * dx;
    const ddz = -cos * -dz - sin * dx;
    const dl = Math.hypot(ddx, ddz) || 1;
    v[0] = ddx / dl * PLAYER.dodgeSpeed;
    v[2] = ddz / dl * PLAYER.dodgeSpeed;
    v[1] = PLAYER.dodgeUp * Math.sqrt(WORLD.gravScale);
    body.onGround = false;
    body.dodgeT = PLAYER.dodgeCooldown;
    body.airJumps = 0; // no double jump out of a dodge
    ev = 'dodge';
  } else if (body.onGround) {
    body.airJumps = 1;
    const sp = Math.hypot(v[0], v[2]);
    if (sp > 0) {
      const drop = Math.max(sp - PLAYER.friction * dt * Math.max(sp, 4), 0) / sp;
      v[0] *= drop; v[2] *= drop;
    }
    accelerate(v, wx, wz, PLAYER.speed, PLAYER.groundAccel, dt);
    if (input.jump) { v[1] = PLAYER.jump * jumpScale; body.onGround = false; ev = 'jump'; }
  } else {
    accelerate(v, wx, wz, PLAYER.speed, PLAYER.airAccel * 0.5, dt);
    if (pressed && body.airJumps > 0 && v[1] < PLAYER.jump * jumpScale * 0.7) {
      body.airJumps--;
      v[1] = PLAYER.airJump * jumpScale;
      ev = 'airjump';
    }
  }
  v[1] -= g * dt;
  if (v[1] < -55) v[1] = -55;
  moveBody(body, dt);

  for (const pad of WORLD.pads) {
    const fy = body.p[1] - H[1];
    if (Math.abs(fy - pad.p[1]) < 0.2 && Math.hypot(body.p[0] - pad.p[0], body.p[2] - pad.p[2]) < pad.r) {
      const s = Math.sqrt(WORLD.gravScale);
      v[0] = pad.v[0] * s; v[1] = pad.v[1] * s; v[2] = pad.v[2] * s;
      body.onGround = false;
      body.airJumps = 1;
      return 'pad';
    }
  }
  return ev;
}

function accelerate(v, wx, wz, wishSpeed, accel, dt) {
  if (wx === 0 && wz === 0) return;
  const cur = v[0] * wx + v[2] * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  v[0] += a * wx; v[2] += a * wz;
}

// Which hazard (if any) is the body standing in.
export function hazardAt(p) {
  for (const h of WORLD.hazards) {
    if (p[0] > h.min[0] && p[0] < h.max[0] && p[1] - H[1] < h.max[1] && p[1] + H[1] > h.min[1] && p[2] > h.min[2] && p[2] < h.max[2]) return h;
  }
  return null;
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

function boxesAlongRay(o, d, maxDist) {
  const ex = [o[0] + d[0] * maxDist, o[2] + d[2] * maxDist];
  return boxesNear(Math.min(o[0], ex[0]) - 0.5, Math.min(o[2], ex[1]) - 0.5, Math.max(o[0], ex[0]) + 0.5, Math.max(o[2], ex[1]) + 0.5);
}

export function rayWorld(o, d, maxDist = 300) {
  return rayWorldHit(o, d, maxDist).t;
}

// Ray against the level. Returns { t, n } — distance and surface normal (null if nothing hit).
export function rayWorldHit(o, d, maxDist = 300) {
  let best = maxDist, hitBox = null;
  // long rays: walk the grid in chunks so we don't gather half the map at once
  const step = 24;
  for (let s = 0; s < maxDist; s += step) {
    const o2 = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
    const seg = Math.min(step, maxDist - s);
    for (const b of boxesAlongRay(o2, d, seg)) {
      const t = rayBox(o, d, b.min, b.max);
      if (t < best) { best = t; hitBox = b; }
    }
    if (hitBox && best <= s + seg) break;
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

export function lineClear(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-6) return true;
  return rayWorld(a, [d[0] / l, d[1] / l, d[2] / l], l) >= l - 0.05;
}

export function playerBox(p) {
  return { min: [p[0] - H[0], p[1] - H[1], p[2] - H[2]], max: [p[0] + H[0], p[1] + H[1], p[2] + H[2]] };
}

export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

// Deterministic spread pattern so clients and host agree on pellet directions for a given seed.
export function spreadDirs(d, spread, n, seed) {
  let s = seed >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const dd = [d[0] + r() * 2 * spread, d[1] + r() * 2 * spread, d[2] + r() * 2 * spread];
    const l = Math.hypot(dd[0], dd[1], dd[2]);
    out.push([dd[0] / l, dd[1] / l, dd[2] / l]);
  }
  return out;
}
