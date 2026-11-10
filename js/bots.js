// Bot AI: picks goals (items, enemies, flags), follows nav-graph paths, aims and fights.
import { WORLD, PLAYER, WEAPONS, PROJ, PICKUP_INFO, stepPlayer, lineClear, dist, dirFromAngles, rayWorld } from './game.js';
import { nodeNear, findPath, edgeType } from './nav.js';

// skill: 0 novice, 1 skilled, 2 adept, 3 master
const SKILL = [
  { react: 0.75, aimErr: 0.16, turn: 4.5, dodge: 0.0,  leadAcc: 0.4, strafe: 0.5, fov: 1.6 },
  { react: 0.45, aimErr: 0.09, turn: 7,   dodge: 0.25, leadAcc: 0.7, strafe: 0.8, fov: 2.0 },
  { react: 0.28, aimErr: 0.05, turn: 10,  dodge: 0.55, leadAcc: 0.9, strafe: 1,   fov: 2.4 },
  { react: 0.16, aimErr: 0.025, turn: 14, dodge: 0.85, leadAcc: 1,   strafe: 1,   fov: 2.8 },
];

export function makeBotBrain(skill, id) {
  const S = SKILL[skill];
  return {
    skill, S, role: id % 2 ? 'attack' : 'defend',
    path: null, pi: 0, goal: null, goalKind: null, goalUntil: 0, repathAt: 0,
    target: null, seenAt: 0, reactAt: 0, err: [0, 0], errAt: 0,
    strafe: 1, strafeUntil: 0, nextDodge: 0, stuckT: 0, lastP: [0, 0, 0], lastCheck: 0,
    djumpPhase: 0, avoidPickup: new Map(), altCharge: 0, wantJump: false,
    reset(t) { this.path = null; this.goal = null; this.target = null; this.goalUntil = 0; this.repathAt = 0; this.lastCheck = t; },
    hurtBy(aid, t) { if (!this.target) { this.target = aid; this.reactAt = t + S.react * 0.6; } },
    picked(i) { this.goal = null; this.goalUntil = 0; },
  };
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function turn(a, b, max) { const d = angDiff(a, b); return a + Math.max(-max, Math.min(max, d)); }

// ---------------------------------------------------------------- goals
function pickupValue(host, b, i) {
  const pk = WORLD.pickups[i];
  const info = PICKUP_INFO[pk.t];
  switch (pk.t) {
    case 'health': return b.hp < 100 ? (100 - b.hp) * 1.4 : 0;
    case 'vial': return b.hp < 150 ? 8 : 0;
    case 'mega': return b.hp < 190 ? 120 : 0;
    case 'armor': return b.ar < 150 ? 70 : 0;
    case 'shard': return b.ar < 150 ? 6 : 0;
    case 'aegis': return b.sh < 150 ? 100 : 0;
    case 'amp': return 160;
    case 'boots': return 35;
  }
  if (info.weapon != null) return b.have[info.weapon] ? (b.ammo[info.ammo[0]] < 10 ? 25 : 4) : 40 + WEAPONS[info.weapon].rank * 10;
  if (info.ammo) {
    const w = WEAPONS.findIndex(W => W.ammo === info.ammo[0]);
    return b.have[w] && b.ammo[info.ammo[0]] < 15 ? 20 : 0;
  }
  return 0;
}

function chooseGoal(host, b) {
  const ai = b.ai;
  // ---- capture the flag roles
  if (host.flags) {
    const mine = host.flags[b.team], theirs = host.flags[1 - b.team];
    if (b.carrying >= 0) return { pos: mine.home, kind: 'home', ttl: 30 };
    if (mine.state === 'carried') {
      const c = host.players.get(mine.carrier);
      if (c) return { pos: c.p, kind: 'hunt', ttl: 1.2 };
    }
    if (mine.state === 'dropped') return { pos: mine.p, kind: 'return', ttl: 3 };
    if (ai.role === 'attack' || b.hp > 120) {
      if (theirs.state === 'carried') {
        const c = host.players.get(theirs.carrier);
        if (c) return { pos: c.p, kind: 'escort', ttl: 2 };
      }
      // arm up first if a good item is close, otherwise go for the flag
      const armed = b.have.filter(Boolean).length;
      let near = null, nv = 0;
      WORLD.pickups.forEach((pk, i) => {
        if (!host.pickups[i].up) return;
        const d = dist(b.p, pk.p);
        if (d > (armed < 2 ? 25 : 10)) return;
        const v = pickupValue(host, b, i) / (d + 8);
        if (v > nv) { nv = v; near = pk; }
      });
      if (near && nv > 1) return { pos: near.p, kind: 'item', ttl: 6 };
      return { pos: theirs.p, kind: 'flag', ttl: 25 };
    }
    // defenders: patrol around our flag, picking up nearby items
    if (Math.random() < 0.5) {
      const h = mine.home;
      return { pos: [h[0] + (Math.random() - 0.5) * 30, h[1], h[2] - Math.sign(h[2]) * Math.random() * 18], kind: 'patrol', ttl: 8 };
    }
  }
  // ---- items
  let best = null, bestV = 0;
  WORLD.pickups.forEach((pk, i) => {
    if (!host.pickups[i].up) return;
    const v = pickupValue(host, b, i);
    if (v <= 0) return;
    const score = v / (dist(b.p, pk.p) + 12);
    if (score > bestV) { bestV = score; best = pk; }
  });
  if (best && bestV > 0.4) return { pos: best.p, kind: 'item', ttl: 15 };
  // ---- hunt a known enemy or wander
  const enemies = [...host.players.values()].filter(q => q.alive && q !== b && !(host.teams && q.team === b.team));
  if (enemies.length && Math.random() < 0.55) {
    const e = enemies[Math.floor(Math.random() * enemies.length)];
    return { pos: e.p, kind: 'hunt', ttl: 4 };
  }
  if (best) return { pos: best.p, kind: 'item', ttl: 15 };
  const s = WORLD.spawns[Math.floor(Math.random() * WORLD.spawns.length)];
  return { pos: s, kind: 'wander', ttl: 12 };
}

function repath(host, b, pos) {
  const nav = host.nav;
  const ai = b.ai;
  const start = nodeNear(nav, b.p, 4);
  const goal = nodeNear(nav, [pos[0], pos[1] + 0.92, pos[2]], 6);
  const path = findPath(nav, start, goal, 9000);
  ai.path = path; ai.pi = path && path.length > 1 ? 1 : 0;
  ai.repathAt = host.time + 0.8 + Math.random() * 0.6;
  return !!path;
}

// ---------------------------------------------------------------- combat helpers
function chooseWeapon(host, b, d) {
  const has = (w) => b.have[w] && (!WEAPONS[w].ammo || b.ammo[WEAPONS[w].ammo] > 0);
  if (host.mutators.instagib) return 6;
  const prefs = d < 7 ? [7, 4, 1, 3, 5, 2, 0, 6]
    : d < 18 ? [7, 5, 3, 4, 2, 1, 6, 0]
    : d < 35 ? [7, 6, 5, 2, 3, 0, 4, 1]
    : [7, 6, 2, 0, 5, 4, 3, 1];
  for (const w of prefs) if (has(w)) { if (w === 7 && d < 14) continue; return w; }
  return 0;
}

function findTarget(host, b) {
  const ai = b.ai;
  const eye = [b.p[0], b.p[1] + PLAYER.eye, b.p[2]];
  let best = null, bestScore = Infinity;
  for (const q of host.players.values()) {
    if (q === b || !q.alive || (host.teams && q.team === b.team)) continue;
    const d = dist(b.p, q.p);
    if (d > 90) continue;
    // field of view (bots notice things behind them only when close or recently hurt)
    const ang = Math.abs(angDiff(b.yaw, Math.atan2(-(q.p[0] - b.p[0]), -(q.p[2] - b.p[2]))));
    if (ang > ai.S.fov && d > 8 && ai.target !== q.id) continue;
    if (!lineClear(eye, [q.p[0], q.p[1] + 0.5, q.p[2]])) continue;
    let score = d;
    if (q.carrying >= 0) score -= 40;
    if (q.id === ai.target) score -= 10;
    if (score < bestScore) { bestScore = score; best = q; }
  }
  return best;
}

// ---------------------------------------------------------------- main think
export function botThink(host, b, dt) {
  const ai = b.ai, S = ai.S, t = host.time;
  if (!host.nav) return;
  const input = { fwd: 0, right: 0, jump: false, dodge: null };

  // ---- perception
  const target = findTarget(host, b);
  if (target) {
    if (ai.target !== target.id) { ai.target = target.id; ai.reactAt = t + S.react * (0.7 + Math.random() * 0.6); }
    ai.seenAt = t;
  } else if (t - ai.seenAt > 2.5) ai.target = null;

  // ---- goals and paths
  if (!ai.goal || t > ai.goalUntil || (ai.goalKind === 'item' && ai.goal && dist(b.p, ai.goal) < 1.2)) {
    const g = chooseGoal(host, b);
    ai.goal = g.pos; ai.goalKind = g.kind; ai.goalUntil = t + g.ttl;
    if (!repath(host, b, ai.goal)) { ai.goalUntil = t + 0.5; }
  } else if (t > ai.repathAt && (ai.goalKind === 'hunt' || ai.goalKind === 'escort' || !ai.path || ai.pi >= ai.path.length)) {
    if (ai.goalKind === 'hunt' || ai.goalKind === 'escort') {
      const g = chooseGoal(host, b); ai.goal = g.pos; ai.goalKind = g.kind;
    }
    repath(host, b, ai.goal);
  }

  // ---- follow the path
  let moveDir = null, edge = 'walk';
  const nodes = host.nav.nodes;
  if (ai.path && ai.pi < ai.path.length) {
    let wp = nodes[ai.path[ai.pi]].p;
    let dx = wp[0] - b.p[0], dz = wp[2] - b.p[2];
    const dy = wp[1] - b.p[1];
    const hd = Math.hypot(dx, dz);
    edge = ai.pi > 0 ? edgeType(host.nav, ai.path[ai.pi - 1], ai.path[ai.pi]) : 'walk';
    if (hd < 0.75 && Math.abs(dy) < 1.4 || (edge === 'drop' && hd < 0.9) || (edge === 'pad' && b.v[1] > 5)) {
      ai.pi++;
      if (ai.pi < ai.path.length) { wp = nodes[ai.path[ai.pi]].p; dx = wp[0] - b.p[0]; dz = wp[2] - b.p[2]; }
    }
    // smooth: look one node further when there is a clear walk
    if (ai.pi + 1 < ai.path.length && edge === 'walk') {
      const nx = nodes[ai.path[ai.pi + 1]].p;
      if (Math.abs(nx[1] - b.p[1]) < 0.6 && lineClear([b.p[0], b.p[1], b.p[2]], [nx[0], nx[1], nx[2]])) { dx = nx[0] - b.p[0]; dz = nx[2] - b.p[2]; }
    }
    const l = Math.hypot(dx, dz);
    if (l > 0.01) moveDir = [dx / l, dz / l];
    const nextEdge = ai.pi > 0 && ai.pi < ai.path.length ? edgeType(host.nav, ai.path[ai.pi - 1], ai.path[ai.pi]) : 'walk';
    if ((nextEdge === 'jump' || nextEdge === 'djump') && b.onGround && hd < 2.2) input.jump = true;
    if (nextEdge === 'djump' && !b.onGround && b.v[1] < 1.5 && b.airJumps > 0) { input.jump = true; b.jumpHeld = false; }
  } else if (ai.goal) {
    // no path: only walk straight at the goal if the ground ahead is safe, otherwise pick something else soon
    const dx = ai.goal[0] - b.p[0], dz = ai.goal[2] - b.p[2];
    const l = Math.hypot(dx, dz);
    if (l > 0.5 && safeToMove(b, dx / l, dz / l, 1.5)) moveDir = [dx / l, dz / l];
    else if (ai.goalUntil > t + 1) ai.goalUntil = t + 1;
  }

  // ---- combat
  let wantYaw = moveDir ? Math.atan2(-moveDir[0], -moveDir[1]) : b.yaw;
  let wantPitch = 0;
  const tgt = ai.target != null ? host.players.get(ai.target) : null;
  if (tgt && tgt.alive && t - ai.seenAt < 0.6) {
    const d = dist(b.p, tgt.p);
    const w = chooseWeapon(host, b, d);
    if (w !== b.w) { b.w = w; b.lastFire = Math.max(b.lastFire, t - WEAPONS[w].primary.interval + 0.25); }
    const W = WEAPONS[b.w];
    const F = W.primary;
    const eye = [b.p[0], b.p[1] + PLAYER.eye, b.p[2]];
    // aim point: head for rail on high skill, feet for rockets, lead for projectiles
    let aim = [tgt.p[0], tgt.p[1] + 0.3, tgt.p[2]];
    if (F.kind === 'proj') {
      const speed = F.speed;
      const tt = d / speed * S.leadAcc;
      aim = [aim[0] + tgt.v[0] * tt, aim[1], aim[2] + tgt.v[2] * tt];
      // splash weapons aim at the feet, but only if the feet are actually visible
      const feet = [aim[0], tgt.p[1] - 0.8, aim[2]];
      if (PROJ[F.proj].radius > 1 && tgt.onGround && lineClear(eye, feet)) aim = feet;
    } else if (b.w === 6 && ai.skill >= 2) aim[1] = tgt.p[1] + 0.65;
    if (t > ai.errAt) {
      const moving = Math.min(1, Math.hypot(tgt.v[0], tgt.v[2]) / 10);
      ai.err = [(Math.random() - 0.5) * 2 * S.aimErr * (0.5 + moving), (Math.random() - 0.5) * S.aimErr * (0.5 + moving)];
      ai.errAt = t + 0.25 + Math.random() * 0.4;
    }
    const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2];
    wantYaw = Math.atan2(-dx, -dz) + ai.err[0];
    wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + ai.err[1];
    const off = Math.abs(angDiff(b.yaw, wantYaw));
    // fire
    if (t >= ai.reactAt && off < (F.kind === 'beam' ? 0.25 : 0.1 + 0.6 / Math.max(4, d)) && t - b.lastFire >= F.interval) {
      let alt = false;
      if (b.w === 2 && d > 10 && d < 30 && Math.random() < 0.2) alt = true;
      if (b.w === 1 && d > 8 && Math.random() < 0.3) alt = true;
      if (b.w === 4 && d > 10 && Math.random() < 0.3) alt = true;
      if (b.w === 3 && d < 5 && Math.random() < 0.3) alt = true;
      if (b.w === 0 && d < 15 && Math.random() < 0.3) alt = true;
      if (b.w === 6) alt = false;
      const FF = alt ? W.alt : F;
      // never fire a splash projectile into a nearby wall
      let safe = true;
      if (FF.kind === 'proj' && PROJ[FF.proj].radius > 1) {
        const dir = dirFromAngles(b.yaw, b.pitch);
        if (rayWorld(eye, dir, PROJ[FF.proj].radius + 2) < PROJ[FF.proj].radius + 1.5) safe = false;
        if (d < PROJ[FF.proj].radius + 1) safe = false;
      }
      if (!safe) { ai.errAt = 0; b.w = b.have[2] && b.ammo.cells > 0 ? 2 : b.have[1] && b.ammo.shells > 0 ? 1 : 0; }
      else if (t - b.lastFire >= FF.interval) {
        const n = alt && FF.load ? Math.min(FF.load, 1 + Math.floor(Math.random() * 3)) : 1;
        host.fire(b, b.w, alt, eye, dirFromAngles(b.yaw, b.pitch), n);
      }
    }
    // keep distance & strafe while fighting (unless chasing a flag carrier / carrying)
    if (t > ai.strafeUntil) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = t + 0.4 + Math.random() * 1.1; }
    const fightMove = ai.goalKind !== 'home' && ai.goalKind !== 'flag' && ai.goalKind !== 'hunt';
    const sx = Math.cos(wantYaw), sz = -Math.sin(wantYaw); // right vector of the aim
    const fx = -Math.sin(wantYaw), fz = -Math.cos(wantYaw);
    const ideal = b.w === 6 ? 30 : b.w === 1 || b.w === 4 || b.w === 3 ? 6 : 14;
    const fwd = d > ideal + 6 ? 1 : d < ideal - 4 ? -1 : 0;
    const strafe = ai.strafe * S.strafe;
    if (fightMove || !moveDir) {
      const mx = fx * fwd + sx * strafe, mz = fz * fwd + sz * strafe;
      const ml = Math.hypot(mx, mz);
      if (ml > 0.01 && safeToMove(b, mx / ml, mz / ml)) moveDir = [mx / ml, mz / ml];
    } else if (moveDir && edge === 'walk') {
      // add a little strafe to the path direction
      const mx = moveDir[0] + sx * strafe * 0.35, mz = moveDir[1] + sz * strafe * 0.35;
      const ml = Math.hypot(mx, mz);
      if (safeToMove(b, mx / ml, mz / ml)) moveDir = [mx / ml, mz / ml];
    }
    // dodge sideways now and then
    if (S.dodge > 0 && b.onGround && t > ai.nextDodge && edge === 'walk') {
      ai.nextDodge = t + 1.2 + Math.random() * 2.5;
      if (Math.random() < S.dodge && safeToMove(b, sx * ai.strafe, sz * ai.strafe, 5)) input.dodge = [ai.strafe, 0];
    }
  } else if (ai.goalKind === 'hunt' || ai.goalKind === 'flag') {
    b.w = chooseWeapon(host, b, 20);
  }

  b.yaw = turn(b.yaw, wantYaw, S.turn * dt);
  b.pitch += (Math.max(-1.4, Math.min(1.4, wantPitch)) - b.pitch) * Math.min(1, S.turn * dt);

  // translate world move direction into input relative to where we're looking
  if (moveDir) {
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
    input.fwd = moveDir[0] * fx + moveDir[1] * fz;
    input.right = moveDir[0] * rx + moveDir[1] * rz;
  }

  // ---- stuck detection
  if (t - ai.lastCheck > 1) {
    const moved = Math.hypot(b.p[0] - ai.lastP[0], b.p[2] - ai.lastP[2]);
    ai.stuckT = moved < 0.6 && moveDir ? ai.stuckT + (t - ai.lastCheck) : 0;
    ai.lastP = [...b.p]; ai.lastCheck = t;
    if (ai.stuckT > 1.5) { input.jump = true; repath(host, b, ai.goal || b.p); }
    if (ai.stuckT > 4) { ai.goal = null; ai.stuckT = 0; }
  }

  stepPlayer(b, input, b.yaw, dt);
}

// Is there ground (and no hazard) along this direction for a few metres?
function safeToMove(b, dx, dz, ahead = 2) {
  for (const f of [0.6, ahead * 0.5, ahead]) {
    const p = [b.p[0] + dx * f, b.p[1], b.p[2] + dz * f];
    const down = rayWorld(p, [0, -1, 0], 6);
    if (down > 3.2) return false;
    for (const h of WORLD.hazards) {
      if (p[0] > h.min[0] && p[0] < h.max[0] && p[2] > h.min[2] && p[2] < h.max[2] && p[1] - down < h.max[1] + 0.5) return false;
    }
  }
  return true;
}
