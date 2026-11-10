// Authoritative match simulation. Runs inside a Web Worker in the host player's browser.
import {
  TICK, PLAYER, WEAPONS, PROJ, AMMO_MAX, START_AMMO, PICKUP_INFO, MODES, WORLD,
  setMap, stepPlayer, rayWorldHit, rayBox, playerBox, dirFromAngles, dist, lineClear, hazardAt,
} from './game.js';
import { buildNav } from './nav.js';
import { botThink, makeBotBrain } from './bots.js';

const BOT_NAMES = ['Vex', 'Cinder', 'Morrow', 'Quill', 'Tannin', 'Hollis', 'Juno', 'Rook', 'Pike', 'Sable', 'Wren', 'Ardent', 'Korra', 'Flint', 'Oso', 'Nyx'];
const SNAP_EVERY = 2;   // 60 Hz simulation, snapshots every 2 ticks (30 Hz)
const SPAWN_PROTECT = 1.5;
const FLAG_RETURN = 20;
const MULTI_WINDOW = 3.5;

export class Host {
  constructor(opts, send) {
    this.mutators = opts.mutators || {};
    this.mapId = opts.map || 'crucible';
    setMap(this.mapId, this.mutators);
    const allowed = WORLD.def.modes;
    this.mode = allowed.includes(opts.mode) ? opts.mode : allowed[0];
    this.teams = MODES[this.mode].teams;
    this.fragLimit = opts.fragLimit ?? (this.mode === 'duel' ? 10 : 25);
    this.capLimit = opts.capLimit ?? 3;
    this.timeLimit = (opts.timeLimit ?? 10) * 60;
    this.botSkill = Math.max(0, Math.min(3, opts.botSkill ?? 1));
    this.send = send;
    this.players = new Map();
    this.clients = new Set();
    this.projs = [];
    this.bursts = [];
    this.nextId = 1;
    this.nextProj = 1;
    this.time = 0;
    this.tickNo = 0;
    this.matchStart = 0;
    this.fightAt = 4;        // countdown before the first match
    this.intermission = 0;
    this.overtime = false;
    this.firstBlood = false;
    this.nav = null;
    const noPickups = !!this.mutators.instagib;
    this.pickups = WORLD.pickups.map(pk => ({ up: !noPickups && !PICKUP_INFO[pk.t]?.power, at: noPickups ? Infinity : 0 }));
    // powerups appear 30-45s into the match
    WORLD.pickups.forEach((pk, i) => { if (!noPickups && PICKUP_INFO[pk.t]?.power) this.pickups[i].at = 30 + Math.random() * 15; });
    this.flags = WORLD.flags && this.mode === 'ctf'
      ? WORLD.flags.map((p, team) => ({ team, home: p, p: [...p], state: 'home', carrier: null, returnAt: 0 }))
      : null;
    this.countdownSent = 0;
    for (let i = 0; i < (opts.bots ?? 0); i++) this.addBot();
  }

  ensureNav() { if (!this.nav) this.nav = buildNav(); return this.nav; }

  // ------------------------------------------------------------ connections
  join(cid, name) {
    const p = this.newPlayer(String(name || 'Player').slice(0, 16), false);
    p.cid = cid;
    this.clients.add(cid);
    this.send(cid, {
      t: 'welcome', id: p.id, map: this.mapId, mode: this.mode, mutators: this.mutators,
      fragLimit: this.fragLimit, capLimit: this.capLimit, timeLimit: this.timeLimit,
    });
    this.spawn(p);
    this.broadcast({ t: 'fx', k: 'msg', m: `${p.name} joined the match` });
    this.sendRoster();
  }

  leave(cid) {
    for (const p of [...this.players.values()]) if (p.cid === cid) {
      this.dropFlag(p);
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
        if (Array.isArray(m.v) && m.v.length === 3 && m.v.every(Number.isFinite)) p.v = m.v;
        p.onGround = !!m.g;
        p.yaw = +m.y || 0; p.pitch = +m.pi || 0;
        if (WEAPONS[m.w] && p.have[m.w]) p.w = m.w;
        p.zoom = !!m.z;
        break;
      case 'fire':
        this.fire(p, m.w, !!m.alt, m.o, m.d, m.n);
        break;
      case 'chat':
        this.broadcast({ t: 'fx', k: 'chat', from: p.name, team: p.team, m: String(m.m).slice(0, 120), teamOnly: !!m.team });
        break;
      case 'team':
        if (this.teams && !this.intermission) {
          this.dropFlag(p);
          p.team = p.team ? 0 : 1;
          if (p.alive) this.kill(p, null, -2);
          this.sendRoster();
        }
        break;
      case 'addbot': if (cid === 'local') { this.addBot(); this.sendRoster(); } break;
      case 'kickbot': if (cid === 'local') {
        const bot = [...this.players.values()].reverse().find(b => b.bot);
        if (bot) { this.dropFlag(bot); this.players.delete(bot.id); this.sendRoster(); }
      } break;
    }
  }

  byCid(cid) { for (const p of this.players.values()) if (p.cid === cid) return p; return null; }
  broadcast(msg) { for (const c of this.clients) this.send(c, msg); }
  announce(text, kind = 'info', to = null) {
    const msg = { t: 'fx', k: 'ann', m: text, kind };
    if (to) { if (to.cid != null) this.send(to.cid, msg); } else this.broadcast(msg);
  }

  // ------------------------------------------------------------ players
  newPlayer(name, bot) {
    const id = this.nextId++;
    let team = 0;
    if (this.teams) {
      let red = 0, blue = 0;
      for (const o of this.players.values()) o.team === 0 ? red++ : blue++;
      team = red <= blue ? 0 : 1;
    }
    const p = {
      id, name, bot, team, cid: null,
      p: [0, 1, 0], v: [0, 0, 0], yaw: 0, pitch: 0, onGround: false, airJumps: 1, jumpHeld: false, dodgeT: 0,
      w: 0, hp: 100, ar: 0, sh: 0, alive: false, have: [], ammo: {},
      lastFire: -10, frags: 0, deaths: 0, score: 0, caps: 0, returns: 0, respawnAt: 0, decayAt: 0,
      spree: 0, bestSpree: 0, multi: 0, multiT: -10, headshots: 0, shots: 0, hits: 0, flagKills: 0,
      amp: 0, boots: 0, prot: 0, zoom: false, carrying: -1, lastHurtBy: null, lastHurtT: -10,
      ai: bot ? makeBotBrain(this.botSkill, id) : null,
    };
    this.players.set(id, p);
    return p;
  }

  addBot() {
    const used = new Set([...this.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot${this.nextId}`;
    this.ensureNav();
    const b = this.newPlayer(name, true);
    this.spawn(b);
  }

  loadout(p) {
    p.have = [true, false, false, false, false, false, false, false];
    p.ammo = { ...START_AMMO };
    p.w = 0;
    if (this.mutators.instagib) { p.have = [false, false, false, false, false, false, true, false]; p.w = 6; p.ammo.slugs = 999; }
    else if (this.mutators.arsenal) {
      for (let i = 0; i < 7; i++) p.have[i] = true;
      p.ammo = { shells: 20, cells: 120, arc: 80, shards: 15, rockets: 12, slugs: 8, nova: 0 };
      p.w = 5;
    }
  }

  spawn(p) {
    let points = WORLD.spawns;
    if (this.teams && WORLD.teamSpawns) points = WORLD.teamSpawns[p.team];
    let best = null, bestScore = -Infinity;
    for (const s of points) {
      let near = 999;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        if (this.teams && o.team === p.team) { if (dist(o.p, s) < 1.2) near = Math.min(near, 0); continue; }
        near = Math.min(near, dist(o.p, s));
      }
      const score = Math.min(near, 50) + Math.random() * 10;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    p.p = [best[0], best[1] + 0.05, best[2]];
    p.v = [0, 0, 0];
    // face the map centre (or the enemy base in CTF)
    const target = this.flags ? this.flags[1 - p.team].home : [0, 0, 0];
    p.yaw = Math.atan2(-(target[0] - best[0]), -(target[2] - best[2]));
    p.pitch = 0;
    p.hp = 100; p.ar = 0; p.sh = 0; p.alive = true;
    p.amp = 0; p.boots = 0; p.prot = this.time + SPAWN_PROTECT; p.carrying = -1; p.zoom = false;
    p.spree = 0;
    this.loadout(p);
    if (p.ai) p.ai.reset(this.time);
    if (p.cid != null) this.send(p.cid, { t: 'fx', k: 'spawn', p: p.p, yaw: p.yaw, w: p.w });
  }

  // ------------------------------------------------------------ combat
  ammoCost(W, alt, n = 1) { const f = alt ? W.alt : W.primary; return (f.cost ?? 1) * n; }

  fire(p, w, alt, o, d, n) {
    const W = WEAPONS[w];
    if (!W || !p.alive || !p.have[w] || this.intermission || this.time < this.fightAt) return;
    const F = alt ? W.alt : W.primary;
    if (F.kind === 'zoom') return;
    // fire-rate check (a little slack for network jitter)
    if (this.time - p.lastFire < F.interval * 0.8) return;
    n = Math.max(1, Math.min(F.load || 1, n | 0 || 1));
    const cost = this.mutators.instagib ? 0 : this.ammoCost(W, alt, n);
    if (W.ammo && p.ammo[W.ammo] < Math.min(cost, 1)) return;
    if (!Array.isArray(o) || !Array.isArray(d) || !o.every(Number.isFinite) || !d.every(Number.isFinite)) return;
    const eye = [p.p[0], p.p[1] + PLAYER.eye, p.p[2]];
    if (dist(o, eye) > 2.5) o = eye;
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    d = [d[0] / dl, d[1] / dl, d[2] / dl];
    p.lastFire = this.time;
    p.prot = 0; // firing ends spawn protection
    if (W.ammo && cost) p.ammo[W.ammo] = Math.max(0, p.ammo[W.ammo] - cost);

    switch (F.kind) {
      case 'hit': this.fireHitscan(p, w, F, o, d); break;
      case 'burst':
        for (let i = 0; i < F.shots; i++) this.bursts.push({ at: this.time + i * F.gap, p, w, F });
        break;
      case 'proj': this.fireProjectiles(p, w, F, o, d, n); break;
      case 'beam': this.fireBeam(p, w, F, o, d); break;
      case 'blast': this.fireBlast(p, w, F); break;
    }
  }

  fireHitscan(p, w, F, o, d) {
    const dmgBy = new Map();
    const ends = [];
    const instagib = this.mutators.instagib;
    p.shots++;
    let anyHit = false;
    for (let i = 0; i < F.pellets; i++) {
      const s = F.spread;
      let dd = [d[0] + (Math.random() - 0.5) * 2 * s, d[1] + (Math.random() - 0.5) * 2 * s, d[2] + (Math.random() - 0.5) * 2 * s];
      const l = Math.hypot(...dd); dd = dd.map(x => x / l);
      const hit = rayWorldHit(o, dd, 300);
      let tHit = hit.t;
      let victim = null;
      for (const q of this.players.values()) {
        if (q === p || !q.alive || (this.teams && q.team === p.team)) continue;
        const bx = playerBox(q.p);
        const t = rayBox(o, dd, bx.min, bx.max);
        if (t < tHit) { tHit = t; victim = q; }
      }
      const end = [o[0] + dd[0] * tHit, o[1] + dd[1] * tHit, o[2] + dd[2] * tHit];
      ends.push(end);
      if (victim) {
        const head = F.head && end[1] > victim.p[1] + PLAYER.headZone;
        const prev = dmgBy.get(victim) || { dmg: 0, head: false };
        prev.dmg += instagib ? 999 : F.dmg * (head ? F.head : 1);
        prev.head ||= head;
        dmgBy.set(victim, prev);
        anyHit = true;
      }
    }
    if (anyHit) p.hits++;
    this.broadcast({ t: 'fx', k: 'shot', w, owner: p.id, a: o, b: ends });
    for (const [victim, r] of dmgBy) this.damage(victim, p, r.dmg, w, { head: r.head, dir: d });
  }

  fireProjectiles(p, w, F, o, d, n) {
    const spawned = [];
    const count = F.proj === 'shard' ? F.pellets : n;
    for (let i = 0; i < count; i++) {
      let dd = d;
      if (F.proj === 'shard') {
        const s = F.spread;
        dd = [d[0] + (Math.random() - 0.5) * 2 * s, d[1] + (Math.random() - 0.5) * 2 * s, d[2] + (Math.random() - 0.5) * 2 * s];
      } else if (count > 1) {
        // rocket volley: fan out horizontally
        const ang = (i - (count - 1) / 2) * 0.09;
        const c = Math.cos(ang), s = Math.sin(ang);
        dd = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
      }
      const l = Math.hypot(...dd); dd = dd.map(x => x / l);
      const speed = F.speed;
      const pr = {
        id: this.nextProj++, type: F.proj, owner: p.id, w,
        p: [o[0] + dd[0] * 0.7, o[1] + dd[1] * 0.7 - 0.1, o[2] + dd[2] * 0.7],
        v: [dd[0] * speed, dd[1] * speed + (F.proj === 'grenade' || F.proj === 'bomb' ? 3 : 0), dd[2] * speed],
        born: this.time, bounces: 0, amp: this.time < p.amp,
      };
      this.projs.push(pr);
      spawned.push([pr.id, pr.type, ...pr.p.map(x => +x.toFixed(2)), ...pr.v.map(x => +x.toFixed(2))]);
    }
    p.shots++;
    this.broadcast({ t: 'fx', k: 'proj', w, owner: p.id, a: o, list: spawned });
  }

  fireBeam(p, w, F, o, d) {
    // find the best target: direct hit, else the enemy closest to the crosshair inside a small cone
    let target = null, best = 0.07;
    const wall = rayWorldHit(o, d, F.range).t;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || (this.teams && q.team === p.team)) continue;
      const c = [q.p[0], q.p[1] + 0.2, q.p[2]];
      const to = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
      const l = Math.hypot(...to);
      if (l > F.range) continue;
      const bx = playerBox(q.p);
      const direct = rayBox(o, d, bx.min, bx.max);
      let ang = Math.acos(Math.max(-1, Math.min(1, (to[0] * d[0] + to[1] * d[1] + to[2] * d[2]) / l)));
      if (direct < wall) ang = 0;
      if (ang < best && lineClear(o, c)) { best = ang; target = q; }
    }
    p.shots++;
    const pts = [];
    if (target) {
      p.hits++;
      const c = [target.p[0], target.p[1] + 0.2, target.p[2]];
      pts.push(c);
      // chain to a second enemy
      let second = null, sd = F.chain;
      for (const q of this.players.values()) {
        if (q === p || q === target || !q.alive || (this.teams && q.team === p.team)) continue;
        const dd = dist(q.p, target.p);
        if (dd < sd && lineClear(c, [q.p[0], q.p[1] + 0.2, q.p[2]])) { sd = dd; second = q; }
      }
      this.damage(target, p, F.dmg, w, { dir: d, silent: true });
      if (second) {
        pts.push([second.p[0], second.p[1] + 0.2, second.p[2]]);
        this.damage(second, p, F.dmg * 0.5, w, { dir: d, silent: true });
      }
    } else {
      pts.push([o[0] + d[0] * wall, o[1] + d[1] * wall, o[2] + d[2] * wall]);
    }
    this.broadcast({ t: 'fx', k: 'arc', owner: p.id, a: o, pts, hit: !!target });
  }

  fireBlast(p, w, F) {
    const c = [p.p[0], p.p[1], p.p[2]];
    this.broadcast({ t: 'fx', k: 'blast', owner: p.id, p: c, r: F.radius });
    p.shots++;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const dd = dist(q.p, c);
      if (dd > F.radius || !lineClear([c[0], c[1] + 0.5, c[2]], [q.p[0], q.p[1] + 0.5, q.p[2]])) continue;
      const f = 1 - dd / F.radius;
      let k = [q.p[0] - c[0], 0, q.p[2] - c[2]];
      const kl = Math.hypot(...k) || 1;
      k = [k[0] / kl * F.push * (0.4 + f), 6 + 4 * f, k[2] / kl * F.push * (0.4 + f)];
      this.knock(q, k);
      if (!(this.teams && q.team === p.team)) { p.hits++; this.damage(q, p, F.dmg * (0.4 + 0.6 * f), w, { dir: k }); }
    }
  }

  knock(q, k) {
    if (q.cid != null) this.send(q.cid, { t: 'fx', k: 'knock', v: k });
    else { q.v[0] += k[0]; q.v[1] += k[1]; q.v[2] += k[2]; q.onGround = false; }
  }

  damage(v, a, amount, w, opts = {}) {
    if (!v.alive || this.intermission) return;
    if (this.teams && a && a !== v && a.team === v.team) return;
    if (v.prot > this.time && a && a !== v) return;
    const amped = opts.amp ?? (a && this.time < a.amp);
    if (a && amped && w >= 0) amount *= 2;
    if (a === v) amount *= 0.5;
    let rem = amount;
    const sAbs = Math.min(v.sh, rem); v.sh -= sAbs; rem -= sAbs;
    const aAbs = Math.min(v.ar, rem * 0.66); v.ar -= aAbs; rem -= aAbs;
    v.hp -= rem;
    v.ar = Math.round(v.ar); v.sh = Math.round(v.sh); v.hp = Math.round(v.hp);
    if (a && a !== v) { v.lastHurtBy = a.id; v.lastHurtT = this.time; }
    if (a && a !== v && this.mutators.vampire) a.hp = Math.min(150, a.hp + Math.round(amount * 0.5));
    if (v.cid != null) this.send(v.cid, { t: 'fx', k: 'hurt', dmg: Math.round(amount), from: a && a !== v ? a.p : null });
    if (a && a !== v && a.cid != null && !opts.silent) this.send(a.cid, { t: 'fx', k: 'hit', dmg: Math.round(amount), head: !!opts.head });
    if (a && a !== v && a.cid != null && opts.silent && this.tickNo % 6 === 0) this.send(a.cid, { t: 'fx', k: 'hit', dmg: Math.round(amount) });
    if (v.ai && a && a !== v) v.ai.hurtBy(a.id, this.time);
    if (v.hp <= 0) this.kill(v, a && a !== v ? a : null, w, !!opts.head);
  }

  kill(v, a, w, head = false) {
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.respawnAt = this.time + (this.mode === 'duel' ? 2 : 2.5);
    // environmental deaths shortly after being hit credit the attacker
    if (!a && v.lastHurtBy != null && this.time - v.lastHurtT < 4 && w < 0) a = this.players.get(v.lastHurtBy) || null;
    const suicide = !a || a === v;
    const events = [];
    if (suicide) { v.frags--; v.score--; }
    else if (this.teams && a.team === v.team) { a.frags--; a.score--; }
    else {
      a.frags++; a.score++;
      if (head) { a.headshots++; events.push('head'); }
      if (v.carrying >= 0) { a.flagKills++; a.score += 2; }
      // first blood
      if (!this.firstBlood) { this.firstBlood = true; events.push('first'); }
      // multi-kills
      if (this.time - a.multiT < MULTI_WINDOW) a.multi++; else a.multi = 1;
      a.multiT = this.time;
      // sprees
      a.spree++;
      a.bestSpree = Math.max(a.bestSpree, a.spree);
    }
    const endedSpree = v.spree >= 5 ? v.spree : 0;
    v.spree = 0;
    this.dropFlag(v);
    this.broadcast({
      t: 'fx', k: 'kill', killer: suicide ? null : a.id, victim: v.id, w, p: v.p, head,
      multi: suicide ? 0 : a.multi, spree: suicide ? 0 : a.spree, ended: endedSpree, first: events.includes('first'),
    });
    this.sendRoster();
    this.checkLead(a);
    this.checkEnd();
  }

  checkLead(a) {
    if (this.teams || !a) return;
    const sorted = [...this.players.values()].sort((x, y) => y.frags - x.frags);
    const left = this.fragLimit - (sorted[0]?.frags ?? 0);
    if (left > 0 && left <= 3 && sorted[0] === a && a.frags > (this.lastLeftAnnounced ?? -1)) {
      this.lastLeftAnnounced = a.frags;
      this.announce(left === 1 ? '1 frag left' : `${left} frags left`, 'big');
    }
  }

  explode(pos, owner, directVictim, pr) {
    const P = PROJ[pr.type];
    this.broadcast({ t: 'fx', k: 'boom', p: pos, type: pr.type, r: P.radius });
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const bx = playerBox(q.p);
      const c = [0, 1, 2].map(i => Math.max(bx.min[i], Math.min(pos[i], bx.max[i])));
      const d = dist(c, pos);
      if (d > P.radius && q !== directVictim) continue;
      if (q !== directVictim && P.radius > 0 && !lineClear([pos[0], pos[1] + 0.1, pos[2]], [q.p[0], q.p[1] + 0.3, q.p[2]])) continue;
      const f = P.radius > 0 ? Math.max(0, 1 - d / P.radius) : 0;
      let dmg = P.splash * f;
      if (q === directVictim) dmg = Math.max(dmg, P.dmg);
      let kd = [q.p[0] - pos[0], q.p[1] - pos[1] + 0.4, q.p[2] - pos[2]];
      const kl = Math.hypot(...kd) || 1; kd = kd.map(x => x / kl);
      const self = q.id === owner?.id;
      const imp = P.push * (self ? 1.4 : 1) * Math.max(f, q === directVictim ? 0.6 : 0);
      if (imp > 0.2) this.knock(q, kd.map(x => x * imp));
      if (dmg > 0.5) this.damage(q, owner, dmg, pr.w, { dir: kd, amp: pr.amp });
    }
    if (owner && directVictim) owner.hits++;
    if (P.cluster) {
      for (let i = 0; i < P.cluster; i++) {
        const a = Math.random() * Math.PI * 2, up = 0.3 + Math.random() * 0.7;
        const sp = 22 + Math.random() * 14;
        const v = [Math.cos(a) * sp * (1 - up * 0.5), up * sp * 0.6, Math.sin(a) * sp * (1 - up * 0.5)];
        this.projs.push({ id: this.nextProj++, type: 'shard', owner: owner?.id, w: pr.w, p: [pos[0], pos[1] + 0.3, pos[2]], v, born: this.time, bounces: 0, amp: pr.amp });
      }
    }
  }

  // ------------------------------------------------------------ CTF
  dropFlag(p) {
    if (!this.flags || p.carrying < 0) return;
    const f = this.flags[p.carrying];
    p.carrying = -1;
    // drop on the ground below the carrier (or return home if over the void/lava)
    const hit = rayWorldHit(p.p, [0, -1, 0], 40);
    const ground = [p.p[0], p.p[1] - hit.t, p.p[2]];
    if (!hit.n || hazardAt([ground[0], ground[1] + 0.9, ground[2]]) || ground[1] < WORLD.killY + 2) {
      this.returnFlag(f, null);
      return;
    }
    f.state = 'dropped'; f.carrier = null; f.p = ground; f.returnAt = this.time + FLAG_RETURN;
    this.broadcast({ t: 'fx', k: 'flag', ev: 'drop', team: f.team, who: p.id });
  }

  returnFlag(f, by) {
    f.state = 'home'; f.carrier = null; f.p = [...f.home];
    if (by) { by.returns++; by.score += 1; }
    this.broadcast({ t: 'fx', k: 'flag', ev: 'return', team: f.team, who: by ? by.id : null });
  }

  updateFlags() {
    for (const f of this.flags) {
      if (f.state === 'carried') {
        const c = this.players.get(f.carrier);
        if (!c || !c.alive) { if (c) this.dropFlag(c); else this.returnFlag(f, null); continue; }
        f.p = [c.p[0], c.p[1], c.p[2]];
      } else if (f.state === 'dropped' && this.time >= f.returnAt) {
        this.returnFlag(f, null);
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const f of this.flags) {
        if (f.state === 'carried') continue;
        const fp = f.p;
        if (Math.hypot(p.p[0] - fp[0], p.p[2] - fp[2]) > 1.4 || Math.abs(p.p[1] - 0.9 - fp[1]) > 1.8) continue;
        if (f.team !== p.team) {
          // grab the enemy flag
          f.state = 'carried'; f.carrier = p.id; p.carrying = f.team; p.prot = 0;
          this.broadcast({ t: 'fx', k: 'flag', ev: 'take', team: f.team, who: p.id });
        } else if (f.state === 'dropped') {
          this.returnFlag(f, p);
        } else if (f.state === 'home' && p.carrying >= 0) {
          // capture!
          const enemy = this.flags[p.carrying];
          p.carrying = -1;
          enemy.state = 'home'; enemy.carrier = null; enemy.p = [...enemy.home];
          p.caps++; p.score += 5;
          for (const o of this.players.values()) if (o.team === p.team && o !== p) o.score += 1;
          this.broadcast({ t: 'fx', k: 'flag', ev: 'cap', team: enemy.team, who: p.id });
          this.sendRoster();
          this.checkEnd();
        }
      }
    }
  }

  // ------------------------------------------------------------ match
  teamScores() {
    const s = [0, 0];
    for (const p of this.players.values()) s[p.team] += this.mode === 'ctf' ? p.caps : p.frags;
    return s;
  }

  checkEnd() {
    if (this.intermission) return;
    let reason = null;
    const scores = this.teamScores();
    if (this.mode === 'ctf') { if (Math.max(...scores) >= this.capLimit) reason = 'capture limit'; }
    else if (this.teams) { if (Math.max(...scores) >= this.fragLimit * 2) reason = 'frag limit'; }
    else for (const p of this.players.values()) if (p.frags >= this.fragLimit) reason = 'frag limit';
    const timeUp = this.time - this.matchStart >= this.timeLimit;
    if (!reason && timeUp) {
      // overtime when tied
      let tied;
      if (this.teams) tied = scores[0] === scores[1];
      else { const s = [...this.players.values()].map(p => p.frags).sort((a, b) => b - a); tied = s.length > 1 && s[0] === s[1]; }
      if (tied) {
        if (!this.overtime) { this.overtime = true; this.announce('Overtime! Next score wins', 'big'); }
        return;
      }
      reason = this.overtime ? 'overtime' : 'time limit';
    }
    if (!reason) return;
    this.endMatch(reason);
  }

  endMatch(reason) {
    const scores = this.teamScores();
    let winner, winTeam = -1;
    if (this.teams) {
      winTeam = scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1;
      winner = winTeam < 0 ? 'Draw' : winTeam === 0 ? 'Red team' : 'Blue team';
    } else {
      const top = [...this.players.values()].sort((x, y) => y.frags - x.frags)[0];
      winner = top ? top.name : 'Nobody';
    }
    this.intermission = this.time + 14;
    this.projs = [];
    this.bursts = [];
    const stats = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, bot: p.bot, frags: p.frags, deaths: p.deaths, score: p.score,
      caps: p.caps, returns: p.returns, acc: p.shots ? Math.round(100 * p.hits / p.shots) : 0, shots: p.shots,
      hs: p.headshots, spree: p.bestSpree,
    }));
    const award = (title, key, min, fmt = (v) => v) => {
      const c = stats.filter(s => s[key] >= min && (key !== 'acc' || s.shots >= 15)).sort((a, b) => b[key] - a[key])[0];
      return c ? { title, name: c.name, value: fmt(c[key]) } : null;
    };
    const awards = [
      award('Top Fragger', 'frags', 1, v => `${v} frags`),
      award('Sharpshooter', 'acc', 1, v => `${v}% accuracy`),
      award('Head Hunter', 'hs', 1, v => `${v} headshots`),
      award('Unstoppable Force', 'spree', 3, v => `${v}-frag spree`),
      this.mode === 'ctf' ? award('Flag Runner', 'caps', 1, v => `${v} captures`) : null,
      this.mode === 'ctf' ? award('Defender', 'returns', 1, v => `${v} returns`) : null,
    ].filter(Boolean);
    this.broadcast({ t: 'fx', k: 'end', winner, winTeam, reason, stats, awards, teams: scores });
    this.sendRoster();
  }

  restart() {
    this.intermission = 0;
    this.overtime = false;
    this.firstBlood = false;
    this.lastLeftAnnounced = -1;
    this.matchStart = this.time;
    this.fightAt = this.time + 4;
    this.countdownSent = 0;
    const noPickups = !!this.mutators.instagib;
    WORLD.pickups.forEach((pk, i) => {
      const power = PICKUP_INFO[pk.t]?.power;
      this.pickups[i] = { up: !noPickups && !power, at: noPickups ? Infinity : power ? this.time + 30 + Math.random() * 15 : 0 };
    });
    if (this.flags) for (const f of this.flags) { f.state = 'home'; f.carrier = null; f.p = [...f.home]; }
    for (const p of this.players.values()) {
      Object.assign(p, { frags: 0, deaths: 0, score: 0, caps: 0, returns: 0, spree: 0, bestSpree: 0, headshots: 0, shots: 0, hits: 0, multi: 0 });
      this.spawn(p);
    }
    this.sendRoster();
  }

  sendRoster() {
    const list = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, team: p.team, frags: p.frags, deaths: p.deaths, score: p.score, caps: p.caps, bot: p.bot,
    }));
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
      // countdown
      const left = Math.ceil(this.fightAt - this.time);
      if (left > 0 && left <= 3 && this.countdownSent !== left) { this.countdownSent = left; this.announce(String(left), 'count'); }
      if (this.time >= this.fightAt && this.countdownSent !== -1) { this.countdownSent = -1; this.announce('Fight!', 'count'); this.matchStart = this.time; }
      if (this.tickNo % 30 === 0) this.checkEnd();

      for (const b of this.bursts) {
        if (this.time >= b.at && b.p.alive) {
          const o = [b.p.p[0], b.p.p[1] + PLAYER.eye, b.p.p[2]];
          this.fireHitscan(b.p, b.w, { ...b.F, pellets: 1 }, o, dirFromAngles(b.p.yaw, b.p.pitch));
          b.done = true;
        } else if (!b.p.alive) b.done = true;
      }
      this.bursts = this.bursts.filter(b => !b.done);

      for (const p of this.players.values()) {
        if (!p.alive) { if (this.time >= p.respawnAt) this.spawn(p); continue; }
        if (p.bot) {
          p.jumpBoost = this.time < p.boots ? 1.55 : 1;
          botThink(this, p, dt);
        }
        if (p.p[1] < WORLD.killY) { this.damage(p, null, 9999, -1); continue; }
        const hz = hazardAt(p.p);
        if (hz) this.damage(p, null, hz.dps * dt, -3);
        if (!p.alive) continue;
        if (p.hp > 100 && this.time >= p.decayAt) { p.hp--; p.decayAt = this.time + 1; }
        if (p.sh > 0 && this.tickNo % 120 === 0) p.sh = Math.max(0, p.sh - 1);
        this.checkPickups(p);
        // powerup expiry notices
        if (p.amp && this.time > p.amp) { p.amp = 0; this.announce('Damage Amplifier expired', 'small', p); }
        if (p.boots && this.time > p.boots) { p.boots = 0; this.announce('Jump Boots expired', 'small', p); }
        if (p.amp && Math.abs(p.amp - this.time - 3) < dt / 2) this.announce('Amplifier fading…', 'small', p);
      }
      if (this.flags) this.updateFlags();
      this.updateProjectiles(dt);
      this.pickups.forEach((pk, i) => {
        if (!pk.up && this.time >= pk.at) {
          pk.up = true;
          const info = PICKUP_INFO[WORLD.pickups[i].t];
          if (info.power) this.broadcast({ t: 'fx', k: 'ann', m: `${info.label.replace(/!|\(.*\)/g, '').trim()} has spawned`, kind: 'small' });
        }
      });
    }
    if (this.tickNo % SNAP_EVERY === 0) this.sendSnapshots();
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const r of this.projs) {
      const P = PROJ[r.type];
      let done = false;
      const steps = r.type === 'shard' ? 4 : 3;
      for (let s = 0; s < steps && !done; s++) {
        const sd = dt / steps;
        r.v[1] -= P.grav * WORLD.gravScale * sd;
        const sp = Math.hypot(...r.v);
        if (sp < 1e-3) break;
        const dir = r.v.map(x => x / sp);
        const move = sp * sd;
        const hit = rayWorldHit(r.p, dir, move + P.r);
        let victim = null, tV = Infinity;
        const ownerTeam = this.players.get(r.owner)?.team;
        for (const q of this.players.values()) {
          if (!q.alive || (q.id === r.owner && this.time - r.born < 0.25)) continue;
          if (this.teams && q.id !== r.owner && q.team === ownerTeam) continue;
          const bx = playerBox(q.p);
          const t = rayBox(r.p, dir, bx.min.map(x => x - P.r), bx.max.map(x => x + P.r));
          if (t <= move && t < tV) { tV = t; victim = q; }
        }
        if (victim && tV <= hit.t) {
          r.p = r.p.map((x, i) => x + dir[i] * tV);
          if (r.type === 'shard') {
            const owner = this.players.get(r.owner);
            this.damage(victim, owner, P.dmg, r.w, { dir, amp: r.amp, silent: true });
            this.knock(victim, dir.map(x => x * P.push));
            if (owner && owner.cid != null) this.send(owner.cid, { t: 'fx', k: 'hit', dmg: P.dmg });
            this.broadcast({ t: 'fx', k: 'zap', p: r.p, c: 0xff9a3c });
          } else this.explode(r.p, this.players.get(r.owner), victim, r);
          done = true;
        } else if (hit.n && hit.t <= move + P.r) {
          r.p = r.p.map((x, i) => x + dir[i] * Math.max(0, hit.t - P.r));
          if (r.bounces < P.bounces && hit.n) {
            // bounce off the surface
            const n = hit.n;
            const dot = r.v[0] * n[0] + r.v[1] * n[1] + r.v[2] * n[2];
            const damp = r.type === 'shard' ? 0.75 : 0.5;
            r.v = r.v.map((x, i) => (x - 2 * dot * n[i]) * damp);
            r.bounces++;
            if (r.type === 'shard') this.broadcast({ t: 'fx', k: 'zap', p: r.p, c: 0xff9a3c, n });
            else this.broadcast({ t: 'fx', k: 'bounce', id: r.id, p: r.p.map(x => +x.toFixed(2)), v: r.v.map(x => +x.toFixed(2)) });
          } else if (r.type === 'shard') {
            this.broadcast({ t: 'fx', k: 'zap', p: r.p, c: 0xff9a3c, n: hit.n });
            done = true;
          } else if (P.fuse && r.bounces < P.bounces) {
            done = false;
          } else {
            this.explode(r.p, this.players.get(r.owner), null, r);
            done = true;
          }
        } else {
          r.p = r.p.map((x, i) => x + dir[i] * move);
        }
      }
      if (!done && this.time - r.born >= P.life) {
        if (r.type === 'shard') done = true;
        else { this.explode(r.p, this.players.get(r.owner), null, r); done = true; }
      }
      if (!done && r.p[1] < WORLD.killY - 10) done = true;
      if (!done) keep.push(r);
    }
    this.projs = keep;
  }

  checkPickups(p) {
    if (this.time < this.fightAt - 4) return;
    const feet = p.p[1] - PLAYER.half[1];
    WORLD.pickups.forEach((pk, i) => {
      const st = this.pickups[i];
      if (!st.up) return;
      if (Math.hypot(p.p[0] - pk.p[0], p.p[2] - pk.p[2]) > 1.3) return;
      if (feet < pk.p[1] - 0.6 || feet > pk.p[1] + 1.6) return;
      const info = PICKUP_INFO[pk.t];
      let took = false;
      switch (pk.t) {
        case 'health': if (p.hp < 100) { p.hp = Math.min(100, p.hp + 25); took = true; } break;
        case 'vial': if (p.hp < PLAYER.overHealth) { p.hp = Math.min(PLAYER.overHealth, p.hp + 5); took = true; } break;
        case 'mega': if (p.hp < PLAYER.overHealth) { p.hp = Math.min(PLAYER.overHealth, p.hp + 100); took = true; } break;
        case 'armor': if (p.ar < PLAYER.maxArmor) { p.ar = Math.min(PLAYER.maxArmor, p.ar + 50); took = true; } break;
        case 'shard': if (p.ar < PLAYER.maxArmor) { p.ar = Math.min(PLAYER.maxArmor, p.ar + 5); took = true; } break;
        case 'aegis': if (p.sh < PLAYER.maxShield) { p.sh = Math.min(PLAYER.maxShield, p.sh + 100); took = true; } break;
        case 'amp': p.amp = this.time + info.duration; took = true; break;
        case 'boots': p.boots = this.time + info.duration; took = true; break;
        default:
          if (info.weapon != null && !p.have[info.weapon]) { p.have[info.weapon] = true; took = true; }
          if (info.ammo) {
            const [kind, n] = info.ammo;
            if (p.ammo[kind] < AMMO_MAX[kind]) { p.ammo[kind] = Math.min(AMMO_MAX[kind], p.ammo[kind] + n); took = true; }
          }
      }
      if (!took) return;
      st.up = false; st.at = this.time + (info.respawn || 20);
      if (p.cid != null) this.send(p.cid, { t: 'fx', k: 'pick', pk: pk.t, label: info.label });
      if (info.power) this.broadcast({ t: 'fx', k: 'ann', m: `${p.name} has the ${info.label.replace(/!|\(.*\)/g, '').trim()}`, kind: 'small' });
      if (p.bot) { p.ai.picked(i); if (info.weapon != null) p.w = info.weapon; }
    });
  }

  sendSnapshots() {
    const pl = [];
    for (const p of this.players.values()) {
      const fl = (this.time < p.amp ? 1 : 0) | (this.time < p.boots ? 2 : 0) | (p.sh > 0 ? 4 : 0) | (p.carrying >= 0 ? 8 : 0) | (this.time < p.prot ? 16 : 0) | (p.zoom ? 32 : 0);
      pl.push([p.id, +p.p[0].toFixed(3), +p.p[1].toFixed(3), +p.p[2].toFixed(3), +p.yaw.toFixed(3), +p.pitch.toFixed(3), p.w, p.alive ? 1 : 0, p.team,
        +p.v[0].toFixed(2), +p.v[1].toFixed(2), +p.v[2].toFixed(2), p.onGround ? 1 : 0, fl]);
    }
    const pr = this.projs.map(r => [r.id, r.type, +r.p[0].toFixed(2), +r.p[1].toFixed(2), +r.p[2].toFixed(2), +r.v[0].toFixed(1), +r.v[1].toFixed(1), +r.v[2].toFixed(1)]);
    const pk = this.pickups.map(x => (x.up ? 1 : 0)).join('');
    const flags = this.flags ? this.flags.map(f => [f.state === 'home' ? 0 : f.state === 'carried' ? 1 : 2, +f.p[0].toFixed(2), +f.p[1].toFixed(2), +f.p[2].toFixed(2), f.carrier ?? 0]) : null;
    const elapsed = this.time - this.matchStart;
    const remaining = this.time < this.fightAt ? this.timeLimit : Math.max(0, Math.round(this.timeLimit - elapsed));
    for (const p of this.players.values()) {
      if (p.cid == null) continue;
      this.send(p.cid, {
        t: 'snap', pl, pr, pk, flags, tl: this.intermission ? 0 : remaining, ot: this.overtime ? 1 : 0,
        cd: this.time < this.fightAt ? Math.ceil(this.fightAt - this.time) : 0,
        me: {
          hp: p.hp, ar: p.ar, sh: p.sh, ammo: { ...p.ammo }, have: [...p.have], alive: p.alive,
          rs: p.alive ? 0 : Math.max(0, p.respawnAt - this.time),
          amp: Math.max(0, p.amp - this.time), boots: Math.max(0, p.boots - this.time), prot: this.time < p.prot,
        },
      });
    }
  }
}
