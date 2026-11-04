// Authoritative match simulation. Runs inside a Web Worker in the host player's browser
// (so it keeps ticking even if the host tab is in the background).
import {
  TICK, PLAYER, WEAPONS, AMMO_MAX, START_AMMO, MAP, PICKUP_INFO,
  stepPlayer, rayWorld, rayBox, playerBox, dirFromAngles, dist,
} from './game.js';

const BOT_NAMES = ['Vex', 'Cinder', 'Morrow', 'Quill', 'Tannin', 'Hollis', 'Juno', 'Rook', 'Pike', 'Sable', 'Wren', 'Ardent'];
const SNAP_EVERY = 2; // 60 Hz simulation, snapshots every 2 ticks (30 Hz)

export class Host {
  constructor(opts, send) {
    this.mode = opts.mode === 'tdm' ? 'tdm' : 'ffa';
    this.fragLimit = opts.fragLimit ?? 25;
    this.timeLimit = (opts.timeLimit ?? 10) * 60;
    this.send = send; // send(clientId, msg)
    this.players = new Map();
    this.clients = new Set();
    this.rockets = [];
    this.nextId = 1;
    this.nextRocket = 1;
    this.time = 0;
    this.tickNo = 0;
    this.matchStart = 0;
    this.intermission = 0;
    this.pickups = MAP.pickups.map(() => ({ up: true, at: 0 }));
    for (let i = 0; i < (opts.bots ?? 0); i++) this.addBot();
  }

  // ------------------------------------------------------------ connections
  join(cid, name) {
    const p = this.newPlayer(String(name || 'Player').slice(0, 16), false);
    p.cid = cid;
    this.clients.add(cid);
    this.send(cid, { t: 'welcome', id: p.id, mode: this.mode, fragLimit: this.fragLimit, timeLimit: this.timeLimit });
    this.spawn(p);
    this.broadcast({ t: 'fx', k: 'msg', m: `${p.name} joined the match` });
    this.sendRoster();
  }

  leave(cid) {
    for (const p of this.players.values()) if (p.cid === cid) {
      this.players.delete(p.id);
      this.broadcast({ t: 'fx', k: 'msg', m: `${p.name} left` });
    }
    this.clients.delete(cid);
    this.sendRoster();
  }

  message(cid, m) {
    const p = this.byCid(cid);
    if (!p) { if (m.t === 'hello') this.join(cid, m.name); return; }
    switch (m.t) {
      case 'st':
        if (!p.alive || this.intermission) return;
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) p.p = m.p;
        if (Array.isArray(m.v) && m.v.length === 3) p.v = m.v;
        p.onGround = !!m.g;
        p.yaw = +m.y || 0; p.pitch = +m.pi || 0;
        if (WEAPONS[m.w] && p.have[m.w]) p.w = m.w;
        break;
      case 'fire':
        this.fire(p, m.w, m.o, m.d);
        break;
      case 'chat':
        this.broadcast({ t: 'fx', k: 'chat', from: p.name, team: p.team, m: String(m.m).slice(0, 120) });
        break;
      case 'addbot': if (cid === 'local') { this.addBot(); this.sendRoster(); } break;
      case 'kickbot': if (cid === 'local') {
        const bot = [...this.players.values()].reverse().find(b => b.bot);
        if (bot) { this.players.delete(bot.id); this.sendRoster(); }
      } break;
    }
  }

  byCid(cid) { for (const p of this.players.values()) if (p.cid === cid) return p; return null; }
  broadcast(msg) { for (const c of this.clients) this.send(c, msg); }

  // ------------------------------------------------------------ players
  newPlayer(name, bot) {
    const id = this.nextId++;
    let team = 0;
    if (this.mode === 'tdm') {
      let red = 0, blue = 0;
      for (const o of this.players.values()) o.team === 0 ? red++ : blue++;
      team = red <= blue ? 0 : 1;
    }
    const p = {
      id, name, bot, team, cid: null,
      p: [0, 1, 0], v: [0, 0, 0], yaw: 0, pitch: 0, onGround: false,
      w: 0, hp: 100, ar: 0, alive: false, have: [true, false, false, false, false], ammo: { ...START_AMMO },
      lastFire: -10, frags: 0, deaths: 0, respawnAt: 0, decayAt: 0,
      ai: bot ? { goal: null, goalUntil: 0, target: null, strafe: 1, strafeUntil: 0, err: [0, 0], reactAt: 0, stuck: 0, lastP: [0, 0, 0] } : null,
    };
    this.players.set(id, p);
    return p;
  }

  addBot() {
    const used = new Set([...this.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot${this.nextId}`;
    const b = this.newPlayer(name, true);
    this.spawn(b);
  }

  spawn(p) {
    // pick the spawn point furthest from enemies (with a little randomness)
    let best = null, bestScore = -Infinity;
    for (const s of MAP.spawns) {
      let near = 999;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        if (this.mode === 'tdm' && o.team === p.team) continue;
        near = Math.min(near, dist(o.p, s));
      }
      const score = Math.min(near, 40) + Math.random() * 8;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    p.p = [best[0], best[1] + 0.05, best[2]];
    p.v = [0, 0, 0];
    p.yaw = Math.atan2(best[0], best[2]); // face the centre
    p.pitch = 0;
    p.hp = 100; p.ar = 0; p.alive = true; p.w = 0;
    p.have = [true, false, false, false, false];
    p.ammo = { ...START_AMMO };
    if (p.cid != null) this.send(p.cid, { t: 'fx', k: 'spawn', p: p.p, yaw: p.yaw });
  }

  // ------------------------------------------------------------ combat
  fire(p, w, o, d) {
    const W = WEAPONS[w];
    if (!W || !p.alive || !p.have[w] || this.intermission) return;
    if (this.time - p.lastFire < W.interval * 0.85) return;
    if (W.ammo && p.ammo[W.ammo] <= 0) return;
    if (!Array.isArray(o) || !Array.isArray(d)) return;
    // keep the claimed origin close to the server's view of the player
    const eye = [p.p[0], p.p[1] + PLAYER.eye, p.p[2]];
    if (dist(o, eye) > 2.5) o = eye;
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / dl, d[1] / dl, d[2] / dl];
    p.lastFire = this.time;
    if (W.ammo) p.ammo[W.ammo]--;

    if (W.kind === 'rocket') {
      const r = { id: this.nextRocket++, owner: p.id, p: [o[0] + d[0] * 0.6, o[1] + d[1] * 0.6, o[2] + d[2] * 0.6], v: [d[0] * W.speed, d[1] * W.speed, d[2] * W.speed], born: this.time };
      this.rockets.push(r);
      this.broadcast({ t: 'fx', k: 'shot', w, owner: p.id, a: o, b: [], rk: [r.id, ...r.p, ...r.v] });
      return;
    }

    const dmgBy = new Map();
    const ends = [];
    for (let i = 0; i < W.pellets; i++) {
      const s = W.spread;
      let dd = [d[0] + (Math.random() - 0.5) * 2 * s, d[1] + (Math.random() - 0.5) * 2 * s, d[2] + (Math.random() - 0.5) * 2 * s];
      const l = Math.hypot(...dd); dd = dd.map(x => x / l);
      let tHit = rayWorld(o, dd, 250);
      let victim = null;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const bx = playerBox(q.p);
        const t = rayBox(o, dd, bx.min, bx.max);
        if (t < tHit) { tHit = t; victim = q; }
      }
      ends.push([o[0] + dd[0] * tHit, o[1] + dd[1] * tHit, o[2] + dd[2] * tHit]);
      if (victim) dmgBy.set(victim, (dmgBy.get(victim) || 0) + W.dmg);
    }
    this.broadcast({ t: 'fx', k: 'shot', w, owner: p.id, a: o, b: ends });
    for (const [victim, dmg] of dmgBy) this.damage(victim, p, dmg, w, d);
  }

  damage(v, a, amount, w, dir) {
    if (!v.alive) return;
    if (this.mode === 'tdm' && a && a !== v && a.team === v.team) return;
    if (a === v) amount *= 0.5;
    const absorb = Math.min(v.ar, amount * 0.66);
    v.ar -= absorb;
    v.hp -= amount - absorb;
    v.ar = Math.round(v.ar); v.hp = Math.round(v.hp);
    if (v.cid != null) this.send(v.cid, { t: 'fx', k: 'hurt', dmg: Math.round(amount), from: a ? a.p : null });
    if (a && a !== v && a.cid != null) this.send(a.cid, { t: 'fx', k: 'hit', dmg: Math.round(amount) });
    if (v.ai && a && a !== v) { v.ai.target = a.id; }
    if (v.hp <= 0) this.kill(v, a, w);
  }

  kill(v, a, w) {
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.respawnAt = this.time + 2.5;
    if (!a || a === v) v.frags--;
    else if (this.mode === 'tdm' && a.team === v.team) a.frags--;
    else a.frags++;
    this.broadcast({ t: 'fx', k: 'kill', killer: a ? a.id : null, victim: v.id, w, p: v.p });
    this.sendRoster();
    this.checkEnd();
  }

  explode(pos, owner, directVictim) {
    const W = WEAPONS[3];
    this.broadcast({ t: 'fx', k: 'boom', p: pos });
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const bx = playerBox(q.p);
      const c = [0, 1, 2].map(i => Math.max(bx.min[i], Math.min(pos[i], bx.max[i])));
      const d = dist(c, pos);
      if (d > W.radius && q !== directVictim) continue;
      const f = Math.max(0, 1 - d / W.radius);
      let dmg = W.splash * f;
      if (q === directVictim) dmg = Math.max(dmg, W.dmg);
      // knockback
      let kd = [q.p[0] - pos[0], q.p[1] - pos[1] + 0.4, q.p[2] - pos[2]];
      const kl = Math.hypot(...kd) || 1; kd = kd.map(x => x / kl);
      const self = q.id === owner?.id;
      const imp = (self ? 17 : 12) * Math.max(f, q === directVictim ? 0.6 : 0);
      if (imp > 0) {
        const k = kd.map(x => x * imp);
        if (q.cid != null) this.send(q.cid, { t: 'fx', k: 'knock', v: k });
        else { q.v[0] += k[0]; q.v[1] += k[1]; q.v[2] += k[2]; q.onGround = false; }
      }
      if (dmg > 0.5) this.damage(q, owner, dmg, 3, kd);
    }
  }

  // ------------------------------------------------------------ match
  checkEnd() {
    if (this.intermission) return;
    let reason = null;
    const scores = this.teamScores();
    if (this.mode === 'tdm') {
      if (Math.max(...scores) >= this.fragLimit * 2) reason = 'frag limit';
    } else {
      for (const p of this.players.values()) if (p.frags >= this.fragLimit) reason = 'frag limit';
    }
    if (this.time - this.matchStart >= this.timeLimit) reason = 'time limit';
    if (!reason) return;
    let winner;
    if (this.mode === 'tdm') winner = scores[0] === scores[1] ? 'Draw' : scores[0] > scores[1] ? 'Red team' : 'Blue team';
    else {
      const top = [...this.players.values()].sort((x, y) => y.frags - x.frags)[0];
      winner = top ? top.name : 'Nobody';
    }
    this.intermission = this.time + 10;
    this.rockets = [];
    this.broadcast({ t: 'fx', k: 'end', winner, reason });
    this.sendRoster();
  }

  teamScores() {
    const s = [0, 0];
    for (const p of this.players.values()) s[p.team] += p.frags;
    return s;
  }

  restart() {
    this.intermission = 0;
    this.matchStart = this.time;
    this.pickups.forEach(pk => { pk.up = true; });
    for (const p of this.players.values()) { p.frags = 0; p.deaths = 0; this.spawn(p); }
    this.broadcast({ t: 'fx', k: 'msg', m: 'New match — fight!' });
    this.sendRoster();
  }

  sendRoster() {
    const list = [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, frags: p.frags, deaths: p.deaths, bot: p.bot }));
    this.broadcast({ t: 'roster', players: list, teams: this.teamScores() });
  }

  // ------------------------------------------------------------ tick
  tick() {
    const dt = TICK;
    this.time += dt;
    this.tickNo++;

    if (this.intermission) {
      if (this.time >= this.intermission) this.restart();
    } else {
      if (this.tickNo % 60 === 0) this.checkEnd();
      for (const p of this.players.values()) {
        if (!p.alive) { if (this.time >= p.respawnAt) this.spawn(p); continue; }
        if (p.bot) this.botThink(p, dt);
        if (p.p[1] < -20) { this.damage(p, null, 999, -1); continue; } // fell out
        if (p.hp > 100 && this.time >= p.decayAt) { p.hp--; p.decayAt = this.time + 1; }
        this.checkPickups(p);
      }
      this.updateRockets(dt);
      this.pickups.forEach((pk, i) => { if (!pk.up && this.time >= pk.at) pk.up = true; });
    }

    if (this.tickNo % SNAP_EVERY === 0) this.sendSnapshots();
  }

  updateRockets(dt) {
    const keep = [];
    for (const r of this.rockets) {
      let exploded = false;
      const steps = 3;
      for (let s = 0; s < steps && !exploded; s++) {
        const sd = dt / steps;
        const sp = Math.hypot(...r.v);
        const dir = r.v.map(x => x / sp);
        const move = sp * sd;
        const tWall = rayWorld(r.p, dir, move + 0.15);
        let victim = null, tV = Infinity;
        for (const q of this.players.values()) {
          if (!q.alive || (q.id === r.owner && this.time - r.born < 0.25)) continue;
          const bx = playerBox(q.p);
          const t = rayBox(r.p, dir, bx.min.map(x => x - 0.15), bx.max.map(x => x + 0.15));
          if (t <= move && t < tV) { tV = t; victim = q; }
        }
        if (victim && tV <= tWall) {
          r.p = r.p.map((x, i) => x + dir[i] * tV);
          this.explode(r.p, this.players.get(r.owner), victim); exploded = true;
        } else if (tWall <= move + 0.15) {
          r.p = r.p.map((x, i) => x + dir[i] * Math.max(0, tWall - 0.1));
          this.explode(r.p, this.players.get(r.owner), null); exploded = true;
        } else {
          r.p = r.p.map((x, i) => x + dir[i] * move);
        }
      }
      if (!exploded && this.time - r.born < 6) keep.push(r);
    }
    this.rockets = keep;
  }

  checkPickups(p) {
    const feet = p.p[1] - PLAYER.half[1];
    MAP.pickups.forEach((pk, i) => {
      const st = this.pickups[i];
      if (!st.up) return;
      if (Math.hypot(p.p[0] - pk.p[0], p.p[2] - pk.p[2]) > 1.3) return;
      if (feet < pk.p[1] - 0.6 || feet > pk.p[1] + 1.6) return;
      const info = PICKUP_INFO[pk.t];
      let took = false;
      if (pk.t === 'health') { if (p.hp < 100) { p.hp = Math.min(100, p.hp + 25); took = true; } }
      else if (pk.t === 'mega') { if (p.hp < PLAYER.overHealth) { p.hp = Math.min(PLAYER.overHealth, p.hp + 100); took = true; } }
      else if (pk.t === 'armor') { if (p.ar < PLAYER.maxArmor) { p.ar = Math.min(PLAYER.maxArmor, p.ar + 50); took = true; } }
      else if (pk.t === 'shard') { if (p.ar < PLAYER.maxArmor) { p.ar = Math.min(PLAYER.maxArmor, p.ar + 5); took = true; } }
      else {
        if (info.weapon != null && !p.have[info.weapon]) { p.have[info.weapon] = true; took = true; }
        if (info.ammo) {
          const [kind, n] = info.ammo;
          if (p.ammo[kind] < AMMO_MAX[kind]) { p.ammo[kind] = Math.min(AMMO_MAX[kind], p.ammo[kind] + n); took = true; }
        }
      }
      if (!took) return;
      st.up = false; st.at = this.time + pk.respawn;
      if (p.cid != null) this.send(p.cid, { t: 'fx', k: 'pick', pk: pk.t, label: info.label });
      if (p.bot && info.weapon != null) p.w = this.bestWeapon(p);
    });
  }

  sendSnapshots() {
    const pl = [];
    for (const p of this.players.values()) {
      pl.push([p.id, +p.p[0].toFixed(3), +p.p[1].toFixed(3), +p.p[2].toFixed(3), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.w, p.alive ? 1 : 0, p.team,
        +p.v[0].toFixed(2), +p.v[1].toFixed(2), +p.v[2].toFixed(2), p.onGround ? 1 : 0]);
    }
    const rk = this.rockets.map(r => [r.id, +r.p[0].toFixed(2), +r.p[1].toFixed(2), +r.p[2].toFixed(2), +r.v[0].toFixed(1), +r.v[1].toFixed(1), +r.v[2].toFixed(1)]);
    const pk = this.pickups.map(x => (x.up ? 1 : 0)).join('');
    const remaining = Math.max(0, Math.round(this.timeLimit - (this.time - this.matchStart)));
    for (const p of this.players.values()) {
      if (p.cid == null) continue;
      this.send(p.cid, {
        t: 'snap', pl, rk, pk, tl: this.intermission ? 0 : remaining,
        me: { hp: p.hp, ar: p.ar, ammo: { ...p.ammo }, have: [...p.have], alive: p.alive, rs: p.alive ? 0 : Math.max(0, p.respawnAt - this.time) },
      });
    }
  }

  // ------------------------------------------------------------ bots
  bestWeapon(p) {
    const order = [4, 3, 1, 2, 0];
    for (const w of order) {
      const W = WEAPONS[w];
      if (p.have[w] && (!W.ammo || p.ammo[W.ammo] > 0)) return w;
    }
    return 0;
  }

  canSee(a, b) {
    const o = [a.p[0], a.p[1] + PLAYER.eye, a.p[2]];
    const t = [b.p[0], b.p[1] + 0.3, b.p[2]];
    const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
    const l = Math.hypot(...d);
    return rayWorld(o, d.map(x => x / l), l) >= l - 0.1;
  }

  botThink(b, dt) {
    const ai = b.ai;
    // choose target: nearest visible enemy
    let target = null, tdist = Infinity;
    for (const q of this.players.values()) {
      if (q === b || !q.alive) continue;
      if (this.mode === 'tdm' && q.team === b.team) continue;
      const d = dist(b.p, q.p);
      if (d < tdist && d < 60 && this.canSee(b, q)) { tdist = d; target = q; }
    }
    if (target && ai.target !== target.id) { ai.target = target.id; ai.reactAt = this.time + 0.35 + Math.random() * 0.3; }
    if (!target) ai.target = null;

    // pick a roaming goal (pickups / spawn points)
    if (!ai.goal || this.time > ai.goalUntil || Math.hypot(b.p[0] - ai.goal[0], b.p[2] - ai.goal[2]) < 1.5) {
      const opts = [...MAP.pickups.filter((pk, i) => this.pickups[i].up).map(pk => pk.p), ...MAP.spawns];
      ai.goal = opts[Math.floor(Math.random() * opts.length)];
      ai.goalUntil = this.time + 8 + Math.random() * 6;
    }

    let moveYaw;
    const input = { fwd: 0, right: 0, jump: false };

    if (target) {
      b.w = this.bestWeapon(b);
      const W = WEAPONS[b.w];
      // aim (rockets at the feet, with lead)
      let aim = [target.p[0], target.p[1] + (W.kind === 'rocket' ? -0.6 : 0.35), target.p[2]];
      if (W.kind === 'rocket') {
        const tt = tdist / W.speed;
        aim = [aim[0] + target.v[0] * tt * 0.7, aim[1], aim[2] + target.v[2] * tt * 0.7];
      }
      const eye = [b.p[0], b.p[1] + PLAYER.eye, b.p[2]];
      const dx = aim[0] - eye[0], dy = aim[1] - eye[1], dz = aim[2] - eye[2];
      if (Math.random() < 0.05) ai.err = [(Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06];
      const wantYaw = Math.atan2(-dx, -dz) + ai.err[0];
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + ai.err[1];
      b.yaw = turn(b.yaw, wantYaw, 7 * dt);
      b.pitch += (wantPitch - b.pitch) * Math.min(1, 8 * dt);
      const off = Math.abs(angDiff(b.yaw, wantYaw));
      if (this.time >= ai.reactAt && off < 0.12) {
        const d = dirFromAngles(b.yaw, b.pitch);
        this.fire(b, b.w, eye, d);
      }
      // strafe and keep a comfortable distance
      if (this.time > ai.strafeUntil) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = this.time + 0.6 + Math.random() * 1.2; }
      input.right = ai.strafe;
      input.fwd = tdist > 16 ? 1 : tdist < 7 ? -1 : 0;
      if (b.onGround && Math.random() < 0.015) input.jump = true;
    } else {
      moveYaw = Math.atan2(-(ai.goal[0] - b.p[0]), -(ai.goal[2] - b.p[2]));
      b.yaw = turn(b.yaw, moveYaw, 5 * dt);
      b.pitch *= 0.9;
      input.fwd = 1;
    }

    // unstick
    const moved = Math.hypot(b.p[0] - ai.lastP[0], b.p[2] - ai.lastP[2]);
    ai.stuck = moved < 0.05 && (input.fwd || input.right) ? ai.stuck + dt : 0;
    ai.lastP = [...b.p];
    if (ai.stuck > 0.4 && b.onGround) { input.jump = true; }
    if (ai.stuck > 1.5) { ai.goal = null; ai.stuck = 0; }

    stepPlayer(b, input, b.yaw, dt);
  }
}

function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function turn(a, b, max) { const d = angDiff(a, b); return a + Math.max(-max, Math.min(max, d)); }
