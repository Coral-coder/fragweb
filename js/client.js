// FragWeb client: rendering, input, local movement prediction, effects, HUD and menus.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  TICK, PLAYER, WEAPONS, PROJ, PICKUP_INFO, MODES, MUTATORS, WORLD,
  setMap, stepPlayer, rayWorldHit, rayBox, playerBox, dirFromAngles,
} from './game.js';
import { MAPS } from './maps.js';
import { startHost, joinGame } from './net.js';
import {
  buildWeapon, buildAvatar, setAvatarWeapon, animateAvatar, setAvatarFx, nameSprite,
  Particles, Beams, Decals, LightPool, glowMat,
} from './gfx.js';
import { buildWorld, preloadTheme } from './world.js';
import { initAudio, sfx, speak, setVolume, setListener, audioSettings } from './audio.js';

const $ = (id) => document.getElementById(id);
const TEAM_COLORS = [0xff4d4d, 0x3d9bff];
const TEAM_NAMES = ['Red', 'Blue'];
const FFA_COLORS = [0xff7a3d, 0x3dff8b, 0xd65cff, 0xffe14d, 0x3de0ff, 0xff4da6, 0x9cff3d, 0x8a8aff, 0xffb03d, 0x3dffd2, 0xff3d3d, 0xc8c8c8];
const rand = (s) => (Math.random() - 0.5) * 2 * s;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------ settings
const settings = { sens: 1, fov: 100, vol: 0.6, name: '', quality: 'high', invert: false, voice: true, xcolor: '#ffffff', showfps: true, map: 'foundry', mode: 'dm', muts: {}, bots: 5, skill: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('fragweb-settings') || '{}')); } catch { /* ignore */ }
function saveSettings() { try { localStorage.setItem('fragweb-settings', JSON.stringify(settings)); } catch { /* ignore */ } }
if (!MAPS[settings.map]) settings.map = 'foundry';
setVolume(settings.vol);
audioSettings.voice = settings.voice;

// ------------------------------------------------------------------ renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1500);
scene.add(camera);

const fire = new Particles(scene, 4000, true);
const smoke = new Particles(scene, 2000, false);
const beams = new Beams(scene, 96);
const decals = new Decals(scene, 160);
const flashes = new LightPool(scene, 8);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// first-person weapon in its own scene so it never clips into walls
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.6;
const vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xb8ccff, 0x40281a, 1.3));
const vmKey = new THREE.DirectionalLight(0xffe0c8, 2.2); vmKey.position.set(1, 2, 1); vmScene.add(vmKey);
const vmRim = new THREE.DirectionalLight(0x36c9ff, 1.3); vmRim.position.set(-2, 0.5, -1); vmScene.add(vmRim);
const vmFlash = new THREE.PointLight(0xffaa55, 0, 3, 2); vmScene.add(vmFlash);
const vmRoot = new THREE.Group(); vmRoot.scale.setScalar(0.62); vmScene.add(vmRoot);
const vmWeapons = WEAPONS.map((W, i) => { const w = buildWeapon(i); w.group.visible = false; vmRoot.add(w.group); return w; });
const flashTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,150,0.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    g.save(); g.translate(64, 64); g.rotate(i * Math.PI / 3);
    const sg = g.createLinearGradient(0, 0, 60, 0); sg.addColorStop(0, 'rgba(255,230,180,0.9)'); sg.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = sg; g.beginPath(); g.moveTo(0, -5); g.lineTo(60, 0); g.lineTo(0, 5); g.fill(); g.restore();
  }
  return new THREE.CanvasTexture(c);
})();
const vmMuzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
vmMuzzle.visible = false;
vmScene.add(vmMuzzle);

// ------------------------------------------------------------------ quality
const QUALITY = {
  low:    { pr: 0.75, shadows: false, shadowSize: 1024, bloom: false },
  medium: { pr: 1,    shadows: true,  shadowSize: 2048, bloom: false },
  high:   { pr: Math.min(devicePixelRatio, 1.5), shadows: true, shadowSize: 4096, bloom: true },
};
const Q = () => QUALITY[settings.quality] || QUALITY.high;
function applyQuality() {
  const q = Q();
  renderer.setPixelRatio(q.pr);
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  }
  world?.setShadows(q.shadows, q.shadowSize);
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  camera.aspect = vmCamera.aspect = w / h;
  camera.updateProjectionMatrix(); vmCamera.updateProjectionMatrix();
  fire.setScale(h * renderer.getPixelRatio());
  smoke.setScale(h * renderer.getPixelRatio());
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ world loading
let world = null;
let worldMap = null;
let loadToken = 0;
async function loadMap(id, mutators = {}) {
  const token = ++loadToken;
  setMap(id, mutators);
  if (worldMap === id && world) return;
  $('loading').classList.remove('hidden');
  $('loading-text').textContent = `Loading ${MAPS[id].name}…`;
  await preloadTheme(MAPS[id].theme);
  if (token !== loadToken) return;
  world?.dispose();
  world = buildWorld(scene, MAPS[id], Q());
  worldMap = id;
  decals.pool.forEach(d => { d.visible = false; });
  $('loading').classList.add('hidden');
}

// ------------------------------------------------------------------ effects
function impact(p, n, color) {
  n = n || [0, 1, 0];
  for (let i = 0; i < 7; i++) fire.emit(p, [n[0] * 4 + rand(4), n[1] * 4 + rand(4) + 2, n[2] * 4 + rand(4)], color, 0.07, 0.25 + Math.random() * 0.2, { grav: 18 });
  fire.emit(p, [0, 0, 0], color, 0.5, 0.12, { alpha: 0.9 });
  smoke.emit(p, [n[0] * 0.8, n[1] * 0.8 + 0.4, n[2] * 0.8], 0x6a6560, 0.35, 0.7, { alpha: 0.35, grow: 2.5, drag: 2 });
  decals.add(p, n);
}
function fleshHit(p, color) {
  for (let i = 0; i < 10; i++) fire.emit(p, [rand(5), rand(4) + 2, rand(5)], color, 0.09, 0.35, { grav: 14 });
  fire.emit(p, [0, 0, 0], 0xffffff, 0.6, 0.1);
}
let shake = 0;
function shakeFrom(p, strength, range) {
  const d = camera.position.distanceTo(V(p));
  shake = Math.max(shake, Math.max(0, 1 - d / range) * strength);
}
function explosion(p, type, r) {
  const big = type === 'nova';
  const scale = big ? 3.2 : type === 'orb' ? 0.7 : type === 'grenade' || type === 'bomb' ? 0.9 : 1;
  if (type === 'orb') {
    flashes.flash(p, 0x7dff9b, 60, 12, 0.35);
    for (let i = 0; i < 30; i++) { const s = 4 + Math.random() * 5; fire.emit(p, [rand(1) * s, rand(1) * s, rand(1) * s], i % 2 ? 0x7dff9b : 0xe0ffe8, 0.5, 0.35, { drag: 4, grow: 1 }); }
    fire.emit(p, [0, 0, 0], 0xb0ffc8, 3.2, 0.25);
    sfx('plasma', p);
    shakeFrom(p, 0.3, 10);
    return;
  }
  flashes.flash(p, big ? 0xfff0b0 : 0xff8a40, big ? 600 : 120, big ? 70 : 22, big ? 1.4 : 0.5);
  fire.emit(p, [0, 0, 0], 0xffffff, 4 * scale, big ? 0.6 : 0.12);
  const n = big ? 160 : 40;
  for (let i = 0; i < n; i++) {
    const d = [rand(1), rand(1), rand(1)];
    const s = (3 + Math.random() * 7) * scale;
    fire.emit(p, [d[0] * s, d[1] * s + 2, d[2] * s], i % 3 ? (big ? 0xfff0a0 : 0xff7a2a) : 0xffc060, (0.9 + Math.random() * 0.8) * scale, (0.35 + Math.random() * 0.3) * (big ? 2 : 1), { grow: 1.2, drag: 3 });
  }
  for (let i = 0; i < (big ? 60 : 30); i++) fire.emit(p, [rand(14) * scale, (rand(10) + 6) * scale, rand(14) * scale], 0xffd080, 0.08, 0.6 + Math.random() * 0.5, { grav: 20 });
  for (let i = 0; i < (big ? 50 : 18); i++) {
    smoke.emit([p[0] + rand(0.8 * scale), p[1] + rand(0.8 * scale), p[2] + rand(0.8 * scale)], [rand(2) * scale, Math.random() * 2.5 * scale, rand(2) * scale], 0x2a2624, (1.2 + Math.random()) * scale, 1.6 + Math.random() * (big ? 3 : 1), { alpha: 0.55, grow: 2.2, drag: 1.5 });
  }
  if (big) {
    // expanding shockwave sphere
    for (let i = 0; i < 80; i++) { const a = Math.random() * 6.28, b = Math.random() * 3.14; const s = 30; fire.emit(p, [Math.cos(a) * Math.sin(b) * s, Math.cos(b) * s, Math.sin(a) * Math.sin(b) * s], 0xfff8d0, 1.6, 0.5, { drag: 2.5, grow: 2 }); }
  }
  const hit = rayWorldHit([p[0], p[1] + 0.2, p[2]], [0, -1, 0], 2.5);
  if (hit.n) decals.add([p[0], p[1] + 0.2 - hit.t, p[2]], hit.n, 2.4 * scale);
  sfx(big ? 'nova' : scale < 1 ? 'boomSmall' : 'boom', p, { range: big ? 250 : 90 });
  shakeFrom(p, big ? 1.5 : 0.6, big ? 60 : 18);
}
function gibs(p, color) {
  fire.emit(p, [0, 0, 0], color, 3, 0.2);
  for (let i = 0; i < 26; i++) smoke.emit(p, [rand(7), Math.random() * 8 + 2, rand(7)], i % 2 ? color : 0x2a2e36, 0.22, 1.2, { alpha: 1, grav: 20 });
  for (let i = 0; i < 12; i++) fire.emit(p, [rand(4), Math.random() * 5, rand(4)], color, 0.18, 0.5, { drag: 2, grow: 0.5, alpha: 0.7 });
  flashes.flash(p, color, 30, 8, 0.3);
}
// jagged lightning between points
function bolt(a, b, color, width = 0.02, life = 0.09) {
  const segs = Math.max(3, Math.min(14, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 1.5)));
  let prev = a;
  for (let i = 1; i <= segs; i++) {
    const f = i / segs;
    const j = i === segs ? 0 : 0.35;
    const p = [a[0] + (b[0] - a[0]) * f + rand(j), a[1] + (b[1] - a[1]) * f + rand(j), a[2] + (b[2] - a[2]) * f + rand(j)];
    beams.fire(prev, p, color, width, life);
    prev = p;
  }
  fire.emit(b, [0, 0, 0], color, 0.5, 0.08);
}
function blastRing(p, r) {
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    fire.emit([p[0], p[1] - 0.6, p[2]], [Math.cos(a) * r * 3, 0.5, Math.sin(a) * r * 3], 0x9fdcff, 0.35, 0.3, { drag: 3 });
  }
  fire.emit(p, [0, 0, 0], 0xcff0ff, r * 0.8, 0.15);
  flashes.flash(p, 0x5cc8ff, 60, r * 2, 0.3);
  sfx('blast', p);
  shakeFrom(p, 0.4, r * 2);
}

// ------------------------------------------------------------------ game state
const G = {
  net: null, isHost: false, code: null, ready: false,
  id: null, mode: 'dm', mutators: {}, fragLimit: 25, capLimit: 3, mapId: null,
  body: { p: [0, 2, 0], v: [0, 0, 0], onGround: false, airJumps: 1, jumpHeld: false, dodgeT: 0, jumpBoost: 1 },
  yaw: 0, pitch: 0, w: 0, lastW: 0,
  alive: false, me: { hp: 100, ar: 0, sh: 0, ammo: {}, have: [true], alive: false, rs: 0, amp: 0, boots: 0, prot: false },
  others: new Map(), roster: [], teams: [0, 0],
  projs: new Map(), ghosts: [],
  flagState: null,
  keys: {}, mouseDown: false, altDown: false, lastFire: -10, lastAlt: -10, clock: 0, sendAcc: 0,
  playing: false, chatting: false, chatTeam: false, ended: false, lastKiller: null,
  switchT: 1, mouseDX: 0, mouseDY: 0, zoom: false, load: 0, loadT: 0, dodgeQ: null, lastTap: {},
  countdown: 0, lastShotT: -10,
};
const isTeams = () => MODES[G.mode]?.teams;
function rosterEntry(id) { return G.roster.find(r => r.id === id); }
function nameOf(id) { const r = rosterEntry(id); return r ? r.name : '???'; }
function colorOf(id, team) {
  if (isTeams()) return TEAM_COLORS[team ?? rosterEntry(id)?.team ?? 0];
  return FFA_COLORS[id % FFA_COLORS.length];
}
function myTeam() { return rosterEntry(G.id)?.team ?? 0; }

// ------------------------------------------------------------------ projectiles (visual)
const PROJ_LOOK = {
  rocket:  { geo: (() => { const g = new THREE.CylinderGeometry(0.06, 0.09, 0.5, 10); g.rotateX(Math.PI / 2); return g; })(), mat: new THREE.MeshStandardMaterial({ color: 0x5a606c, metalness: 0.8, roughness: 0.3 }), glow: 0xffa040, trail: true },
  grenade: { geo: new THREE.SphereGeometry(0.14, 12, 8), mat: new THREE.MeshStandardMaterial({ color: 0x3a3a30, metalness: 0.6, roughness: 0.4 }), glow: 0xffc46b, blink: true },
  orb:     { geo: new THREE.SphereGeometry(0.28, 16, 12), mat: glowMat(0x7dff9b, 3), glow: 0x7dff9b, halo: 1.6 },
  shard:   { geo: (() => { const g = new THREE.BoxGeometry(0.05, 0.05, 0.5); return g; })(), mat: glowMat(0xffb060, 4), glow: null },
  bomb:    { geo: new THREE.SphereGeometry(0.2, 12, 8), mat: new THREE.MeshStandardMaterial({ color: 0x4a2a10, emissive: 0xff7a20, emissiveIntensity: 0.8, roughness: 0.5 }), glow: 0xff9a3c, trail: true },
  nova:    { geo: new THREE.IcosahedronGeometry(0.6, 3), mat: glowMat(0xfff27a, 5), glow: 0xfff27a, halo: 5 },
};
function makeProj(type, p, v) {
  const L = PROJ_LOOK[type];
  const mesh = new THREE.Mesh(L.geo, L.mat);
  mesh.position.set(...p);
  scene.add(mesh);
  return { mesh, type, p: [...p], v: [...v], t0: G.clock, born: G.clock };
}
function removeProj(r) { scene.remove(r.mesh); }

// ------------------------------------------------------------------ network messages
function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      G.id = m.id; G.mode = m.mode; G.mutators = m.mutators || {}; G.fragLimit = m.fragLimit; G.capLimit = m.capLimit; G.mapId = m.map;
      G.ready = false;
      loadMap(m.map, G.mutators).then(() => {
        G.ready = true;
        configureHUD();
      });
      break;
    case 'roster':
      G.roster = m.players; G.teams = m.teams;
      for (const [id, o] of G.others) if (!G.roster.find(r => r.id === id)) { scene.remove(o.mesh); G.others.delete(id); }
      for (const r of G.roster) { const o = G.others.get(r.id); if (o && (o.name !== r.name || o.team !== r.team)) { o.team = r.team; rebuildAvatar(r.id, o); } }
      updateScores();
      if (!$('scoreboard').classList.contains('hidden')) updateScoreboard();
      break;
    case 'snap': if (G.ready) onSnap(m); break;
    case 'fx': if (G.ready || m.k === 'spawn' || m.k === 'msg' || m.k === 'chat') onFx(m); break;
  }
}

function rebuildAvatar(id, o) {
  if (o.mesh) scene.remove(o.mesh);
  const r = rosterEntry(id);
  const col = colorOf(id, o.team ?? r?.team);
  o.mesh = buildAvatar(col);
  o.name = r?.name;
  const tag = nameSprite(r ? r.name : '?', col);
  tag.position.y = 1.25;
  o.tag = tag;
  o.mesh.add(tag);
  setAvatarWeapon(o.mesh, o.w || 0);
  o.mesh.visible = !!o.alive;
  scene.add(o.mesh);
}

function onSnap(m) {
  const wasAlive = G.me.alive;
  G.me = m.me;
  if (!m.me.alive && wasAlive) G.alive = false;
  G.countdown = m.cd;
  for (const [id, x, y, z, yaw, pitch, w, alive, team, vx, vy, vz, gr, fl] of m.pl) {
    if (id === G.id) { G.myFlags = fl; continue; }
    let o = G.others.get(id);
    if (!o) {
      o = { id, mesh: null, cur: { p: [x, y, z], yaw, pitch }, alive, team, w };
      G.others.set(id, o);
      rebuildAvatar(id, o);
    }
    if (o.team !== team) { o.team = team; rebuildAvatar(id, o); }
    if (!o.alive && alive) o.cur.p = [x, y, z];
    o.snap = { p: [x, y, z], v: [vx, vy, vz], t: G.clock };
    o.target = { yaw, pitch };
    o.ground = !!gr; o.fl = fl;
    o.alive = alive; o.w = w;
    setAvatarWeapon(o.mesh, w);
    o.mesh.visible = !!alive;
  }
  // projectiles
  const seen = new Set();
  for (const [id, type, x, y, z, vx, vy, vz] of m.pr) {
    seen.add(id);
    let r = G.projs.get(id);
    if (!r) { r = makeProj(type, [x, y, z], [vx, vy, vz]); G.projs.set(id, r); }
    r.p = [x, y, z]; r.v = [vx, vy, vz]; r.t0 = G.clock;
  }
  for (const [id, r] of G.projs) if (!seen.has(id) && G.clock - r.born > 0.15) { removeProj(r); G.projs.delete(id); }
  // pickups
  if (world) for (let i = 0; i < world.pickups.length; i++) world.pickups[i].visible = m.pk[i] === '1';
  // flags
  G.flagState = m.flags;
  if (m.flags && world?.flags) {
    m.flags.forEach(([state, x, y, z, carrier], team) => {
      const f = world.flags[team];
      f.visible = state !== 1;
      f.position.set(x, y + (state === 0 ? 0.2 : 0), z);
      const el = $('flag' + team);
      el.textContent = state === 0 ? 'Home' : state === 1 ? `Taken by ${nameOf(carrier)}` : 'Dropped';
      el.className = state === 0 ? '' : 'taken';
    });
  }
  // timer
  const tl = m.tl;
  $('timer').textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
  $('timer').classList.toggle('ot', !!m.ot);
  if (m.ot) $('timer').textContent = 'OVERTIME';
  if (!G.me.have[G.w]) switchTo(bestWeapon());
  updateHUD();
}

function onFx(m) {
  switch (m.k) {
    case 'spawn':
      G.body = { p: [...m.p], v: [0, 0, 0], onGround: false, airJumps: 1, jumpHeld: true, dodgeT: 0, jumpBoost: 1 };
      G.yaw = m.yaw; G.pitch = 0; G.w = m.w ?? 0; G.lastW = G.w; G.alive = true; G.switchT = 0; G.load = 0; G.zoom = false;
      G.me.alive = true;
      $('dead').classList.add('hidden');
      break;
    case 'knock':
      G.body.v[0] += m.v[0]; G.body.v[1] += m.v[1]; G.body.v[2] += m.v[2];
      G.body.onGround = false;
      break;
    case 'shot': {
      const W = WEAPONS[m.w];
      if (m.owner === G.id) break; // we drew our own already
      const from = muzzleOf(m.owner, m.a, W.color);
      for (const b of m.b) {
        beams.fire(from, b, W.color, m.w === 6 ? 0.035 : 0.012, m.w === 6 ? 0.7 : 0.09);
        if (m.w === 6) beams.fire(from, b, 0xffffff, 0.008, 0.35);
        const dir = [b[0] - m.a[0], b[1] - m.a[1], b[2] - m.a[2]];
        const l = Math.hypot(...dir) || 1;
        const hit = rayWorldHit(m.a, dir.map(x => x / l), l + 0.2);
        if (hit.n && hit.t >= l - 0.2) impact(b, hit.n, W.color); else fleshHit(b, W.color);
      }
      sfx('w' + m.w, m.a);
      break;
    }
    case 'proj': {
      const own = m.owner === G.id;
      for (const [id, type, x, y, z, vx, vy, vz] of m.list) {
        if (own) {
          const gi = G.ghosts.findIndex(g => g.type === type);
          if (gi >= 0) {
            const r = G.ghosts.splice(gi, 1)[0];
            r.p = [x, y, z]; r.v = [vx, vy, vz]; r.t0 = G.clock - 0.01;
            G.projs.set(id, r);
            continue;
          }
        }
        if (!G.projs.has(id)) G.projs.set(id, makeProj(type, [x, y, z], [vx, vy, vz]));
      }
      if (!own) {
        const W = WEAPONS[m.w];
        const from = muzzleOf(m.owner, m.a, W.color);
        smoke.emit(from, [0, 0.5, 0], 0x888080, 0.4, 0.5, { alpha: 0.4, grow: 2 });
        const alt = m.list.length && m.list[0][1] !== { 1: 'shard', 2: 'orb', 4: 'shard', 5: 'rocket', 7: 'nova' }[m.w];
        sfx('w' + m.w + (alt && m.w !== 5 ? 'alt' : ''), m.a);
      }
      break;
    }
    case 'arc': {
      const from = m.owner === G.id ? myMuzzle() : muzzleOf(m.owner, m.a, WEAPONS[3].color, true);
      let prev = from;
      for (const p of m.pts) { bolt(prev, p, m.hit ? 0x9fe0ff : 0x5cc8ff, m.hit ? 0.03 : 0.018); prev = p; }
      if (m.owner !== G.id) sfx('w3', m.a, { vol: 0.6 });
      break;
    }
    case 'blast': blastRing(m.p, m.r); break;
    case 'boom': {
      explosion(m.p, m.type, m.r);
      let best = null, bd = 3;
      for (const [id, r] of G.projs) { const d = r.mesh.position.distanceTo(V(m.p)); if (d < bd) { bd = d; best = id; } }
      if (best != null) { removeProj(G.projs.get(best)); G.projs.delete(best); }
      break;
    }
    case 'zap':
      for (let i = 0; i < 5; i++) fire.emit(m.p, [rand(4), rand(4) + 1, rand(4)], m.c, 0.06, 0.25, { grav: 12 });
      if (m.n) decals.add(m.p, m.n, 0.12);
      if (Math.random() < 0.4) sfx('ric', m.p, { vol: 0.6 });
      break;
    case 'bounce': {
      const r = G.projs.get(m.id);
      if (r) { r.p = m.p; r.v = m.v; r.t0 = G.clock; }
      sfx('zap', m.p, { vol: 0.5 });
      break;
    }
    case 'hit':
      flashHit(m.head);
      sfx(m.head ? 'headshot' : 'hit');
      break;
    case 'hurt': {
      const el = $('damage');
      el.style.opacity = Math.min(1, m.dmg / 60 + 0.2);
      setTimeout(() => { el.style.opacity = 0; }, 140);
      shake = Math.max(shake, Math.min(0.5, m.dmg / 80));
      if (m.from) damageDir(m.from);
      sfx('hurt');
      break;
    }
    case 'pick': {
      const info = PICKUP_INFO[m.pk];
      sfx(info.power ? 'pickPower' : /health|vial|mega/.test(m.pk) ? 'pickHealth' : /armor|shard|aegis/.test(m.pk) ? 'pickArmor' : 'pick');
      const el = $('pickup-msg');
      el.textContent = m.label; el.style.opacity = 1;
      el.style.color = '#' + new THREE.Color(info.color).getHexString();
      clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 1500);
      if (info.weapon != null && WEAPONS[info.weapon].rank > WEAPONS[G.w].rank && !G.mouseDown) switchTo(info.weapon);
      if (m.pk === 'amp') announce('Damage Amplifier!', 'big', 'Amplified');
      break;
    }
    case 'kill': onKill(m); break;
    case 'msg': chatLine(`<i>${esc(m.m)}</i>`); break;
    case 'chat':
      if (m.teamOnly && m.team !== myTeam()) break;
      chatLine(`<b class="${isTeams() ? 't' + m.team : ''}">${esc(m.from)}${m.teamOnly ? ' (team)' : ''}:</b> ${esc(m.m)}`);
      sfx('msg');
      break;
    case 'ann':
      if (m.kind === 'count') {
        announce(m.m, 'count', m.m === 'Fight!' ? 'Fight' : null);
        sfx(m.m === 'Fight!' ? 'fight' : 'count');
        if (m.m === 'Fight!') speak('Fight!', true);
      } else if (m.kind === 'big') { announce(m.m, 'big'); speak(m.m); }
      else notice(m.m);
      break;
    case 'flag': onFlag(m); break;
    case 'end': showEnd(m); break;
  }
}

function muzzleOf(id, fallback, color, quiet) {
  const o = G.others.get(id);
  if (!o || !o.mesh || !o.mesh.visible) return fallback;
  const mz = new THREE.Vector3(0, 0, -0.9);
  o.mesh.userData.gunMount.localToWorld(mz);
  const p = mz.toArray();
  if (!quiet) { fire.emit(p, [0, 0, 0], color, 0.6, 0.06); flashes.flash(p, color, 8, 6, 0.08); }
  return p;
}
function myMuzzle() {
  const vm = vmWeapons[G.w];
  const p = vm.muzzle.clone();
  vm.group.localToWorld(p);
  return p.applyMatrix4(camera.matrixWorld).toArray();
}

// ------------------------------------------------------------------ announcer & feed
const MULTI = { 2: 'Double Frag!', 3: 'Triple Frag!', 4: 'Quad Frag!', 5: 'Frag Storm!', 6: 'Annihilation!' };
const SPREE = { 5: 'Heating Up!', 10: 'On Fire!', 15: 'Unbreakable!', 20: 'Living Legend!', 25: 'Untouchable!' };
function onKill(m) {
  const wname = m.w >= 0 ? WEAPONS[m.w].name : m.w === -3 ? 'lava' : m.w === -2 ? 'team switch' : 'the void';
  const kn = m.killer != null ? nameOf(m.killer) : null;
  const vn = nameOf(m.victim);
  const meCls = (id) => (id === G.id ? 'me' : '');
  let text;
  if (m.killer == null) {
    const how = m.w === -3 ? 'melted' : m.w === -1 ? 'fell to their doom' : m.w === -2 ? 'switched teams' : 'blew themselves up';
    text = `<span class="${meCls(m.victim)}">${esc(vn)}</span><span class="w">${how}</span>`;
  } else {
    text = `<span class="${meCls(m.killer)}">${esc(kn)}</span><span class="w">${wname}</span><span class="${meCls(m.victim)}">${esc(vn)}</span>${m.head ? '<span class="hs">HEADSHOT</span>' : ''}`;
  }
  feed(text);
  const vo = G.others.get(m.victim);
  gibs(m.p, colorOf(m.victim, vo?.team));
  sfx('boomSmall', m.p, { vol: 0.4 });
  if (m.first) { announce('First Blood!', 'big', kn ? `${kn} drew first blood` : null); speak('First blood!', true); }
  if (m.victim === G.id) {
    G.alive = false; G.zoom = false; G.load = 0;
    sfx('die');
    G.lastKiller = m.killer;
    $('dead').classList.remove('hidden');
    $('deadby').textContent = m.killer != null && m.killer !== G.id ? `by ${kn} — ${wname}` : '';
  } else if (m.killer === G.id) {
    sfx('frag');
    if (m.head) { notice('HEADSHOT!'); speak('Headshot'); }
    if (m.multi >= 2) { const t = MULTI[Math.min(6, m.multi)]; announce(t, 'big'); speak(t.replace('!', '')); }
    if (SPREE[m.spree]) { announce(SPREE[m.spree], 'big', `${m.spree} frags without dying`); speak(SPREE[m.spree].replace('!', '')); }
    else if (!m.multi || m.multi < 2) notice(`You fragged ${vn}`);
  } else if (m.killer != null && SPREE[m.spree]) {
    notice(`${kn} is ${SPREE[m.spree].replace('!', '').toLowerCase()}`);
  }
  if (m.ended >= 5) notice(m.killer != null ? `${kn} ended ${vn}'s ${m.ended}-frag spree` : `${vn}'s spree ended`);
}
function onFlag(m) {
  const tn = TEAM_NAMES[m.team];
  const who = m.who != null ? nameOf(m.who) : null;
  const mine = m.team === myTeam();
  let t;
  switch (m.ev) {
    case 'take': t = m.who === G.id ? 'You have the flag!' : `${tn} flag taken!`; sfx('flagTake'); break;
    case 'drop': t = `${tn} flag dropped`; break;
    case 'return': t = `${tn} flag returned`; sfx('flagReturn'); break;
    case 'cap': t = `${TEAM_NAMES[1 - m.team]} team scores!`; sfx('flagCap'); break;
  }
  announce(t, m.ev === 'cap' || m.ev === 'take' ? 'big' : 'mid', who && m.ev !== 'return' ? (m.ev === 'cap' ? `${who} captured the ${tn} flag` : who) : (m.ev === 'return' && who ? `by ${who}` : null));
  speak(t.replace('!', ''), m.ev === 'cap');
  void mine;
}

let annTimer;
function announce(text, kind = 'big', sub = null) {
  const el = $('ann');
  const cls = kind === 'count' ? 'pop count' : 'pop';
  el.innerHTML = `<span class="${cls}">${esc(text)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
  el.style.color = kind === 'count' ? '#fff' : kind === 'mid' ? '#9fd8ff' : '#ffd84a';
  clearTimeout(annTimer);
  annTimer = setTimeout(() => { el.innerHTML = ''; }, kind === 'count' ? 900 : 2600);
}
let noticeTimer;
function notice(text) {
  $('notice').textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 2400);
}
function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  $('killfeed').prepend(d);
  setTimeout(() => d.remove(), 7000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
}
function chatLine(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  $('chatlog').append(d);
  setTimeout(() => d.remove(), 12000);
  while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
}
function flashHit(head) {
  const h = $('hitmarker');
  h.classList.toggle('head', !!head);
  h.style.transition = 'none'; h.style.opacity = 1;
  requestAnimationFrame(() => { h.style.transition = 'opacity 0.3s'; h.style.opacity = 0; });
}
function damageDir(from) {
  const dx = from[0] - G.body.p[0], dz = from[2] - G.body.p[2];
  const ang = Math.atan2(-dx, -dz) - G.yaw;
  const d = document.createElement('div');
  d.className = 'dmgdir';
  d.style.transform = `rotate(${-ang}rad)`;
  $('dmgdirs').append(d);
  setTimeout(() => { d.style.opacity = 0; }, 400);
  setTimeout(() => d.remove(), 1100);
}

// ------------------------------------------------------------------ HUD
const weaponSlots = WEAPONS.map(W => {
  const d = document.createElement('div');
  d.innerHTML = `<b>${W.key}</b>${W.name.split(' ')[0]}<i></i>`;
  $('weapons').append(d);
  return d;
});
function configureHUD() {
  const teams = isTeams();
  $('score-red').classList.toggle('hidden', !teams);
  $('score-blue').classList.toggle('hidden', !teams);
  $('flags').classList.toggle('hidden', G.mode !== 'ctf');
  $('btn-team').classList.toggle('hidden', !teams);
  updateScores();
}
function updateHUD() {
  const me = G.me;
  const hp = $('hp'); hp.textContent = Math.max(0, me.hp); hp.classList.toggle('low', me.hp < 30 && me.alive);
  $('ar').textContent = me.ar;
  $('sh-wrap').classList.toggle('hidden', !me.sh);
  $('sh').textContent = me.sh;
  const W = WEAPONS[G.w];
  $('wname').textContent = W.name;
  $('ammocount').textContent = W.ammo && !G.mutators.instagib ? me.ammo[W.ammo] : '∞';
  WEAPONS.forEach((w, i) => {
    const el = weaponSlots[i];
    el.classList.toggle('have', !!me.have[i]);
    el.classList.toggle('cur', i === G.w);
    const n = w.ammo ? me.ammo?.[w.ammo] ?? 0 : null;
    el.querySelector('i').textContent = me.have[i] ? (n == null || G.mutators.instagib ? '∞' : n) : '';
    el.classList.toggle('empty', me.have[i] && n === 0);
  });
  // power-ups
  let pw = '';
  if (me.amp > 0) pw += `<span class="pw c-amp">AMP ${Math.ceil(me.amp)}s</span>`;
  if (me.boots > 0) pw += `<span class="pw c-boots">BOOTS ${Math.ceil(me.boots)}s</span>`;
  if (me.prot) pw += `<span class="pw">SPAWN SHIELD</span>`;
  $('powers').innerHTML = pw;
  $('carry').classList.toggle('hidden', !(G.myFlags & 8) || !me.alive);
  if (!me.alive) $('respawn').textContent = me.rs > 0 ? `Respawning in ${me.rs.toFixed(1)}s` : 'Respawning…';
  // rocket volley pips
  $('pips').innerHTML = G.w === 5 && G.load ? '<i></i>'.repeat(G.load) : '';
}
function updateScores() {
  const me = rosterEntry(G.id);
  if (isTeams()) {
    $('score-red').textContent = G.teams[0];
    $('score-blue').textContent = G.teams[1];
    $('myscore').textContent = G.mode === 'ctf' ? `First to ${G.capLimit} captures` : `First to ${G.fragLimit * 2}`;
  } else if (me) {
    const sorted = [...G.roster].sort((a, b) => b.frags - a.frags);
    const rank = sorted.findIndex(r => r.id === G.id) + 1;
    const lead = sorted[0] && sorted[0].id !== G.id ? sorted[0].frags - me.frags : (sorted[1] ? me.frags - sorted[1].frags : 0);
    $('myscore').textContent = `${me.frags} / ${G.fragLimit} frags · ${ordinal(rank)} of ${sorted.length} · ${rank === 1 ? `+${lead}` : `-${lead}`}`;
  }
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function updateScoreboard() {
  const ctf = G.mode === 'ctf';
  const cols = ctf ? ['Score', 'Caps', 'Frags', 'Deaths'] : ['Frags', 'Deaths'];
  const row = (r) => `<tr class="${r.id === G.id ? 'me' : ''}"><td class="${isTeams() ? 't' + r.team : ''}">${esc(r.name)}${r.bot ? ' <small style="color:#8d99b5">bot</small>' : ''}</td>${
    (ctf ? [r.score, r.caps, r.frags, r.deaths] : [r.frags, r.deaths]).map(v => `<td class="num">${v}</td>`).join('')}</tr>`;
  const head = `<tr><th>PLAYER</th>${cols.map(c => `<th class="num">${c.toUpperCase()}</th>`).join('')}</tr>`;
  const key = ctf ? 'score' : 'frags';
  let html = `<h3>${MAPS[G.mapId]?.name || ''} — ${MODES[G.mode].name}${Object.keys(G.mutators).filter(k => G.mutators[k]).map(k => ' · ' + MUTATORS[k].name).join('')}</h3>`;
  if (isTeams()) {
    for (const t of [0, 1]) html += `<h3 class="t${t}">${TEAM_NAMES[t]} team — ${G.teams[t]}</h3><table>${head}${G.roster.filter(r => r.team === t).sort((a, b) => b[key] - a[key]).map(row).join('')}</table>`;
  } else html += `<table>${head}${[...G.roster].sort((a, b) => b.frags - a.frags).map(row).join('')}</table>`;
  $('scoreboard').innerHTML = html;
}
let endTimer;
function showEnd(m) {
  G.ended = true;
  const youWon = isTeams() ? m.winTeam === myTeam() : m.winner === nameOf(G.id);
  const title = isTeams() ? (m.winTeam < 0 ? 'DRAW' : `${TEAM_NAMES[m.winTeam].toUpperCase()} TEAM WINS`) : `${esc(m.winner).toUpperCase()} WINS`;
  speak(youWon ? 'Victory' : isTeams() && m.winTeam < 0 ? 'Draw' : 'Defeat', true);
  const ctf = G.mode === 'ctf';
  const stats = [...m.stats].sort((a, b) => (ctf ? b.score - a.score : b.frags - a.frags));
  const cols = ctf ? ['score', 'caps', 'frags', 'deaths', 'acc', 'spree'] : ['frags', 'deaths', 'acc', 'hs', 'spree'];
  const label = { score: 'SCORE', caps: 'CAPS', frags: 'FRAGS', deaths: 'DEATHS', acc: 'ACC %', hs: 'HEADSHOTS', spree: 'BEST SPREE' };
  $('endscreen').innerHTML = `
    <h2 style="color:${youWon ? '#4cff8a' : '#ffd84a'}">${title}</h2>
    <div class="reason">${esc(m.reason)}${isTeams() ? ` · <span class="t0">${m.teams[0]}</span> : <span class="t1">${m.teams[1]}</span>` : ''}</div>
    <div class="awards">${m.awards.map(a => `<div class="award"><div class="t">${esc(a.title)}</div><div class="n">${esc(a.name)}</div><div class="v">${esc(a.value)}</div></div>`).join('')}</div>
    <table><tr><th>PLAYER</th>${cols.map(c => `<th class="num">${label[c]}</th>`).join('')}</tr>
    ${stats.map(s => `<tr class="${s.id === G.id ? 'me' : ''}"><td class="${isTeams() ? 't' + s.team : ''}">${esc(s.name)}${s.bot ? ' <small style="color:#8d99b5">bot</small>' : ''}</td>${cols.map(c => `<td class="num">${s[c]}</td>`).join('')}</tr>`).join('')}
    </table>
    <div class="next">Next match starts in a few seconds…</div>`;
  $('endscreen').classList.remove('hidden');
  clearTimeout(endTimer);
  endTimer = setTimeout(() => { G.ended = false; $('endscreen').classList.add('hidden'); }, 13500);
}

// ------------------------------------------------------------------ input
canvas.addEventListener('click', () => { if (G.net && !G.chatting) lockPointer(); });
$('clicktoplay').addEventListener('click', lockPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function lockPointer() {
  initAudio();
  const r = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (r && r.catch) r.catch(() => canvas.requestPointerLock());
}
document.addEventListener('pointerlockchange', () => {
  G.playing = document.pointerLockElement === canvas;
  if (G.net) {
    $('pause').classList.toggle('hidden', G.playing || G.chatting);
    $('clicktoplay').classList.add('hidden');
  }
  if (!G.playing) { G.mouseDown = false; G.altDown = false; G.keys = {}; }
});
document.addEventListener('mousemove', (e) => {
  if (!G.playing) return;
  const s = 0.0022 * settings.sens * (G.zoom ? 0.35 : 1);
  G.yaw -= e.movementX * s;
  G.pitch -= e.movementY * s * (settings.invert ? -1 : 1);
  G.pitch = Math.max(-1.55, Math.min(1.55, G.pitch));
  G.mouseDX += e.movementX; G.mouseDY += e.movementY;
});
document.addEventListener('mousedown', (e) => {
  if (!G.playing) return;
  if (e.button === 0) { G.mouseDown = true; if (G.alive) tryFire(false); }
  if (e.button === 2) { G.altDown = true; if (G.alive) altPress(); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) G.mouseDown = false;
  if (e.button === 2) { G.altDown = false; altRelease(); }
});
document.addEventListener('wheel', (e) => { if (G.playing) cycleWeapon(e.deltaY > 0 ? 1 : -1); });
const DODGE_KEYS = { KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0] };
document.addEventListener('keydown', (e) => {
  if (G.chatting) {
    if (e.key === 'Enter') {
      const msg = $('chatin').value.trim();
      if (msg) G.net.send({ t: 'chat', m: msg, team: G.chatTeam });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
    return;
  }
  if (!G.net) return;
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); updateScoreboard(); }
  if (!G.playing) return;
  if (e.repeat) return;
  G.keys[e.code] = true;
  if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); openChat(false); }
  if (e.code === 'KeyY' && isTeams()) { e.preventDefault(); openChat(true); }
  // double-tap dodge
  if (DODGE_KEYS[e.code]) {
    const now = performance.now();
    if (now - (G.lastTap[e.code] || 0) < 260) { G.dodgeQ = { dir: DODGE_KEYS[e.code], t: G.clock }; G.lastTap[e.code] = 0; }
    else G.lastTap[e.code] = now;
  }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    const k = G.keys;
    const dx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), dz = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    G.dodgeQ = { dir: dx || dz ? [dx, dz] : [0, 1], t: G.clock };
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= WEAPONS.length && G.me.have[n - 1]) switchTo(n - 1);
  if (e.code === 'KeyQ' && G.me.have[G.lastW]) switchTo(G.lastW);
});
document.addEventListener('keyup', (e) => {
  G.keys[e.code] = false;
  if (e.code === 'Tab' && !G.ended) $('scoreboard').classList.add('hidden');
});
function openChat(team) {
  G.chatting = true; G.chatTeam = team;
  G.keys = {};
  document.exitPointerLock();
  $('chatin').placeholder = team ? 'Team chat… (Enter to send, Esc to cancel)' : 'Say something… (Enter to send, Esc to cancel)';
  $('chatin').classList.remove('hidden'); $('chatin').value = ''; $('chatin').focus();
}
function closeChat() {
  G.chatting = false;
  $('chatin').classList.add('hidden'); $('chatin').blur();
  lockPointer();
}
function cycleWeapon(dir) {
  for (let i = 1; i <= WEAPONS.length; i++) {
    const w = (G.w + dir * i + WEAPONS.length * 2) % WEAPONS.length;
    if (G.me.have[w]) { switchTo(w); return; }
  }
}
function switchTo(w) {
  if (w === G.w) return;
  G.lastW = G.w; G.w = w; G.switchT = 0; G.load = 0;
  if (G.zoom) { G.zoom = false; }
}
function hasAmmo(w, alt = false) {
  const W = WEAPONS[w];
  if (!W.ammo || G.mutators.instagib) return true;
  const F = alt ? W.alt : W.primary;
  return (G.me.ammo[W.ammo] ?? 0) >= Math.min(F.cost ?? 1, 1);
}
function bestWeapon() {
  const order = [...WEAPONS].sort((a, b) => b.rank - a.rank).map(W => W.id);
  for (const w of order) if (G.me.have[w] && hasAmmo(w) && w !== 7) return w;
  return G.me.have.findIndex(Boolean);
}

// ------------------------------------------------------------------ shooting
let recoil = 0, vmFlashT = 0;
function aimRay() {
  return { eye: [G.body.p[0], G.body.p[1] + PLAYER.eye, G.body.p[2]], d: dirFromAngles(G.yaw, G.pitch) };
}
function tryFire(alt) {
  if (!G.alive || G.countdown > 0 || G.switchT < 0.6) return;
  const W = WEAPONS[G.w];
  const F = alt ? W.alt : W.primary;
  if (F.kind === 'zoom') return;
  const last = G.lastFire;
  if (G.clock - last < F.interval) return;
  if (!hasAmmo(G.w, alt)) {
    G.lastFire = G.clock; sfx('empty');
    switchTo(bestWeapon());
    return;
  }
  G.lastFire = G.clock;
  G.lastShotT = G.clock;
  const n = alt && F.load ? Math.max(1, G.load) : 1;
  if (W.ammo && !G.mutators.instagib) G.me.ammo[W.ammo] = Math.max(0, G.me.ammo[W.ammo] - (F.cost ?? 1) * n);
  const { eye, d } = aimRay();
  G.net.send({ t: 'fire', w: G.w, alt, o: eye, d, n });
  sfx('w' + G.w + (alt && G.w !== 5 ? 'alt' : ''));
  recoil = Math.min(1.4, recoil + ({ 0: 0.4, 1: 0.8, 2: 0.18, 3: 0.08, 4: 0.9, 5: 0.8, 6: 1, 7: 1.4 }[G.w]) * (alt ? 1.2 : 1));
  if (G.w === 1 || G.w === 6 || G.w === 4) G.pitch = Math.min(1.55, G.pitch + 0.012);
  if (F.kind !== 'beam' || Math.random() < 0.3) vmFlashT = 0.06;
  const muzzle = myMuzzle();
  flashes.flash(muzzle, W.color, 8, 7, 0.07);

  if (F.kind === 'proj' && F.proj !== 'shard') {
    for (let i = 0; i < n; i++) {
      let dd = d;
      if (n > 1) { const ang = (i - (n - 1) / 2) * 0.09; const c = Math.cos(ang), s = Math.sin(ang); dd = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c]; }
      const v = dd.map(x => x * F.speed);
      if (F.proj === 'grenade' || F.proj === 'bomb') v[1] += 3;
      const r = makeProj(F.proj, [eye[0] + dd[0] * 0.7, eye[1] + dd[1] * 0.7 - 0.1, eye[2] + dd[2] * 0.7], v);
      G.ghosts.push(r);
      setTimeout(() => { const gi = G.ghosts.indexOf(r); if (gi >= 0) { G.ghosts.splice(gi, 1); removeProj(r); } }, 700);
    }
    for (let i = 0; i < 6; i++) smoke.emit(muzzle, [rand(1) + d[0] * 2, rand(1) + d[1] * 2, rand(1) + d[2] * 2], 0x777070, 0.3, 0.6, { alpha: 0.4, grow: 3, drag: 3 });
    if (G.w === 7) { shake = 0.5; recoil = 1.4; }
  } else if (F.kind === 'beam') {
    const hit = rayWorldHit(eye, d, F.range);
    const end = [eye[0] + d[0] * hit.t, eye[1] + d[1] * hit.t, eye[2] + d[2] * hit.t];
    bolt(muzzle, end, 0x5cc8ff, 0.016, 0.06);
  } else if (F.kind === 'blast') {
    // drawn when the host confirms
  } else if (F.kind === 'hit' || F.kind === 'burst') {
    const shots = F.kind === 'burst' ? 1 : F.pellets;
    for (let i = 0; i < shots; i++) localTracer(eye, d, F.spread, W, muzzle);
    if (F.kind === 'burst') {
      for (let k = 1; k < F.shots; k++) setTimeout(() => {
        if (!G.alive) return;
        const a = aimRay();
        localTracer(a.eye, a.d, F.spread, W, myMuzzle());
        sfx('w0alt'); vmFlashT = 0.05; recoil = Math.min(1.4, recoil + 0.3);
      }, k * F.gap * 1000);
    }
  }
  updateHUD();
}
function localTracer(eye, d, s, W, muzzle) {
  let dd = [d[0] + rand(s), d[1] + rand(s), d[2] + rand(s)];
  const l = Math.hypot(...dd); dd = dd.map(x => x / l);
  const hit = rayWorldHit(eye, dd, 300);
  let t = hit.t, who = null;
  for (const o of G.others.values()) {
    if (!o.alive || (isTeams() && o.team === myTeam())) continue;
    const bx = playerBox(o.cur.p);
    const tp = rayBox(eye, dd, bx.min, bx.max);
    if (tp < t) { t = tp; who = o; }
  }
  const end = [eye[0] + dd[0] * t, eye[1] + dd[1] * t, eye[2] + dd[2] * t];
  beams.fire(muzzle, end, W.color, W.id === 6 ? 0.035 : 0.012, W.id === 6 ? 0.7 : 0.08);
  if (W.id === 6) {
    beams.fire(muzzle, end, 0xffffff, 0.008, 0.35);
    for (let i = 0; i < 14; i++) { const f = i / 14; fire.emit([muzzle[0] + (end[0] - muzzle[0]) * f, muzzle[1] + (end[1] - muzzle[1]) * f, muzzle[2] + (end[2] - muzzle[2]) * f], [rand(0.4), rand(0.4) + 0.3, rand(0.4)], W.color, 0.12, 0.5, { drag: 2 }); }
  }
  if (who) fleshHit(end, colorOf(who.id, who.team));
  else if (hit.n) impact(end, hit.n, W.color);
}
// right mouse button
function altPress() {
  const W = WEAPONS[G.w];
  if (W.alt.kind === 'zoom') { G.zoom = true; sfx('zoom'); return; }
  if (W.alt.load) { if (hasAmmo(G.w, true)) { G.load = 1; G.loadT = G.clock; sfx('load', null, { n: 1 }); } return; }
  tryFire(true);
}
function altRelease() {
  if (G.zoom) { G.zoom = false; sfx('zoom'); }
  if (G.load) { const W = WEAPONS[G.w]; G.lastFire = -10; tryFire(true); G.load = 0; void W; }
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
let bob = 0, bobAmt = 0, landDip = 0, stepAcc = 0;
const swayV = new THREE.Vector2();
const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion();
const fpsEl = { frames: 0, t: 0 };
const W_RECOVER = [0.0005, 0.002, 0.0005, 0.001, 0.002, 0.003, 0.004, 0.006];

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.25, (now - lastT) / 1000);
  const dt = Math.min(0.05, realDt);
  lastT = now;
  G.clock += realDt; // timers use real time so fire rates don't slow down on slow frames
  const t = now / 1000;

  if (G.net && G.ready) {
    // ---------------- local movement (client-side prediction)
    if (G.alive) {
      const k = G.keys;
      const input = {
        fwd: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
        right: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0),
        jump: !!k.Space, dodge: null,
      };
      if (!G.playing || G.countdown > 0 && false) { input.fwd = input.right = 0; input.jump = false; }
      if (G.dodgeQ && G.clock - G.dodgeQ.t > 0.2) G.dodgeQ = null;
      G.body.jumpBoost = G.me.boots > 0 ? 1.55 : 1;
      const wasGround = G.body.onGround;
      const fallSpeed = -G.body.v[1];
      let rem = dt;
      while (rem > 1e-6) {
        const sdt = Math.min(rem, 1 / 120);
        if (G.dodgeQ && (G.body.onGround || G.body.hitWall) && G.body.dodgeT <= 0) { input.dodge = G.dodgeQ.dir; G.dodgeQ = null; }
        const ev = stepPlayer(G.body, input, G.yaw, sdt);
        input.dodge = null;
        if (ev === 'pad') { sfx('pad'); for (let i = 0; i < 16; i++) fire.emit([G.body.p[0], G.body.p[1] - 0.9, G.body.p[2]], [rand(3), Math.random() * 6, rand(3)], 0x8fe8ff, 0.12, 0.5); }
        else if (ev) sfx(ev);
        rem -= sdt;
      }
      if (!wasGround && G.body.onGround && fallSpeed > 4) { sfx('land'); landDip = Math.min(0.25, fallSpeed * 0.012); }
      if (G.mouseDown && G.playing) tryFire(false);
      if (G.altDown && G.playing && G.w === 3) tryFire(true);
      if (G.altDown && G.playing && G.w !== 3 && WEAPONS[G.w].alt.kind !== 'zoom' && !WEAPONS[G.w].alt.load) tryFire(true);
      // rocket volley loading
      if (G.load && G.w === 5) {
        const F = WEAPONS[5].alt;
        const can = Math.min(F.load, G.me.ammo.rockets ?? 0);
        if (G.load < can && G.clock - G.loadT > F.loadTime) { G.load++; G.loadT = G.clock; sfx('load', null, { n: G.load }); updateHUD(); }
        if (G.load >= can && G.clock - G.loadT > 1.4) altRelease();
      }
      const sp = Math.hypot(G.body.v[0], G.body.v[2]);
      if (G.body.onGround && sp > 2) { stepAcc += dt * sp; if (stepAcc > 3.2) { stepAcc = 0; sfx('step'); } }
    }
    G.sendAcc += dt;
    if (G.sendAcc >= TICK) {
      G.sendAcc %= TICK;
      if (G.alive) G.net.send({ t: 'st', p: G.body.p.map(x => +x.toFixed(3)), v: G.body.v.map(x => +x.toFixed(2)), g: G.body.onGround ? 1 : 0, y: +G.yaw.toFixed(4), pi: +G.pitch.toFixed(4), w: G.w, z: G.zoom ? 1 : 0 });
    }

    // ---------------- camera
    const sp = Math.hypot(G.body.v[0], G.body.v[2]);
    bobAmt += ((G.body.onGround ? Math.min(1, sp / PLAYER.speed) : 0) - bobAmt) * Math.min(1, dt * 10);
    bob += dt * sp * 0.9;
    landDip *= Math.pow(0.002, dt);
    shake *= Math.pow(0.01, dt);
    if (G.alive) {
      camera.position.set(
        G.body.p[0] + rand(shake * 0.08),
        G.body.p[1] + PLAYER.eye + Math.abs(Math.sin(bob)) * 0.05 * bobAmt - landDip + rand(shake * 0.08),
        G.body.p[2] + rand(shake * 0.08));
      camera.rotation.set(G.pitch, G.yaw, Math.sin(bob) * 0.004 * bobAmt + rand(shake * 0.01), 'YXZ');
    } else {
      camera.position.y += (G.body.p[1] + 3 - camera.position.y) * dt * 2;
      const killer = G.others.get(G.lastKiller);
      if (killer && killer.alive) {
        tmpV.set(killer.cur.p[0], killer.cur.p[1] + 0.5, killer.cur.p[2]);
        tmpM.lookAt(camera.position, tmpV, camera.up);
        tmpQ.setFromRotationMatrix(tmpM);
        camera.quaternion.slerp(tmpQ, Math.min(1, dt * 3));
      }
    }
    const zooming = G.zoom && G.alive && G.w === 6;
    $('scope').classList.toggle('hidden', !zooming);
    $('crosshair').classList.toggle('hidden', zooming);
    const fovTarget = zooming ? 26 : settings.fov + Math.min(8, Math.max(0, sp - PLAYER.speed) * 0.5);
    if (Math.abs(camera.fov - fovTarget) > 0.05) { camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * (zooming ? 14 : 6)); camera.updateProjectionMatrix(); }
    setListener({ x: camera.position.x, y: camera.position.y, z: camera.position.z });

    // ---------------- first-person weapon animation
    G.switchT = Math.min(1, G.switchT + dt * 4);
    vmWeapons.forEach((w, i) => { w.group.visible = i === G.w && G.alive && !zooming; });
    const vm = vmWeapons[G.w];
    swayV.x += (-G.mouseDX * 0.0006 - swayV.x) * Math.min(1, dt * 8);
    swayV.y += (G.mouseDY * 0.0006 - swayV.y) * Math.min(1, dt * 8);
    swayV.clampScalar(-0.06, 0.06);
    G.mouseDX = G.mouseDY = 0;
    recoil *= Math.pow(W_RECOVER[G.w], dt);
    const raise = 1 - Math.pow(1 - G.switchT, 3);
    vmRoot.position.set(
      0.16 + swayV.x + Math.cos(bob) * 0.012 * bobAmt,
      -0.155 - (1 - raise) * 0.3 + swayV.y + Math.abs(Math.sin(bob)) * 0.012 * bobAmt - landDip * 0.15 + Math.sin(t * 1.6) * 0.003,
      -0.36 + recoil * 0.05);
    vmRoot.rotation.set(recoil * 0.12 + (1 - raise) * -0.6 - swayV.y * 2, swayV.x * 2 + 0.03, swayV.x * 1.5 - Math.cos(bob) * 0.01 * bobAmt);
    const firing = G.clock - G.lastShotT < 0.15;
    const P = vm.parts || {};
    if (P.spin) { vm.spinV = (vm.spinV || 0) + ((firing ? 30 : 0) - (vm.spinV || 0)) * Math.min(1, dt * 5); P.spin.rotation.z += vm.spinV * dt; }
    if (P.coils) {
      const charge = Math.min(1, (G.clock - G.lastFire) / WEAPONS[6].primary.interval);
      P.coils.forEach((c, i) => c.material.color.set(WEAPONS[6].color).multiplyScalar((charge * 5 > i ? 1 : 0.12) * (2.5 + Math.sin(t * 8 + i) * 0.5)));
    }
    if (P.prongs) P.prongs.forEach((pr, i) => { pr.scale.setScalar(firing ? 1.5 + Math.random() : 1); if (firing && Math.random() < 0.3) { const a = pr.getWorldPosition(new THREE.Vector3()); void a; } });
    if (P.drum) P.drum.rotation.z += ((firing ? 9 : 0)) * dt;
    if (P.vents) { const heat = Math.max(0, 1 - (G.clock - G.lastShotT) / 1.2); P.vents.forEach(v => v.material.color.setRGB(2 + heat * 4, 0.6 + heat, 0.1)); }
    if (P.core) { const s = 1 + Math.sin(t * 6) * 0.15; P.core.scale.setScalar(s); }
    if (P.pips) P.pips.forEach((p, i) => p.material.color.set(i < G.load ? 0xff6a20 : 0x331100).multiplyScalar(i < G.load ? 4 : 1));
    vmFlashT -= dt;
    const flashOn = vmFlashT > 0;
    vmMuzzle.visible = flashOn && G.alive && !zooming;
    vmFlash.intensity = flashOn ? 6 : 0;
    if (flashOn) {
      const p = vm.muzzle.clone(); vm.group.localToWorld(p);
      vmMuzzle.position.copy(p); vmFlash.position.copy(p);
      vmMuzzle.material.color.set(WEAPONS[G.w].color).lerp(new THREE.Color(0xffffff), 0.5);
      vmMuzzle.material.rotation = Math.random() * 6.28;
      vmMuzzle.scale.setScalar([1, 4, 5, 7].includes(G.w) ? 0.35 : 0.22);
    }

    // ---------------- remote players
    for (const o of G.others.values()) {
      if (!o.snap) continue;
      const age = Math.min(0.1, G.clock - o.snap.t);
      const tx = o.snap.p[0] + o.snap.v[0] * age;
      const ty = o.snap.p[1] + (o.ground ? 0 : o.snap.v[1] * age);
      const tz = o.snap.p[2] + o.snap.v[2] * age;
      const a = Math.min(1, dt * 20);
      o.cur.p[0] += (tx - o.cur.p[0]) * a; o.cur.p[1] += (ty - o.cur.p[1]) * a; o.cur.p[2] += (tz - o.cur.p[2]) * a;
      o.cur.yaw += angDiff(o.cur.yaw, o.target.yaw) * Math.min(1, dt * 25);
      o.cur.pitch += (o.target.pitch - o.cur.pitch) * Math.min(1, dt * 25);
      o.mesh.position.set(o.cur.p[0], o.cur.p[1], o.cur.p[2]);
      o.mesh.rotation.y = o.cur.yaw;
      animateAvatar(o.mesh, dt, Math.hypot(o.snap.v[0], o.snap.v[2]), !o.ground, o.cur.pitch);
      const carried = (o.fl & 8) && G.flagState ? G.flagState.findIndex(f => f[0] === 1 && f[4] === o.id) : -1;
      setAvatarFx(o.mesh, o.fl || 0, t, carried >= 0 ? TEAM_COLORS[carried] : 0xffffff);
      if (o.fl & 16) o.mesh.visible = o.alive && Math.sin(t * 30) > -0.3;
      // name tags: show for teammates always, enemies only when close and in view
      if (o.tag) o.tag.visible = isTeams() && o.team === myTeam() ? true : camera.position.distanceTo(o.mesh.position) < 25;
    }

    // ---------------- projectiles
    for (const r of [...G.projs.values(), ...G.ghosts]) {
      const age = G.clock - r.t0;
      const g = (PROJ[r.type].grav || 0) * WORLD.gravScale;
      const x = r.p[0] + r.v[0] * age, y = r.p[1] + r.v[1] * age - 0.5 * g * age * age, z = r.p[2] + r.v[2] * age;
      r.mesh.position.set(x, y, z);
      tmpV.set(x + r.v[0], y + r.v[1] - g * age, z + r.v[2]);
      r.mesh.lookAt(tmpV);
      const pp = [x, y, z];
      const L = PROJ_LOOK[r.type];
      if (r.type === 'rocket') {
        r.mesh.rotateY(Math.PI);
        fire.emit(pp, [rand(0.5), rand(0.5), rand(0.5)], 0xffa040, 0.35, 0.12);
        smoke.emit(pp, [rand(0.3), rand(0.3) + 0.3, rand(0.3)], 0x8a8580, 0.25, 0.9, { alpha: 0.35, grow: 3, drag: 1 });
      } else if (r.type === 'orb') {
        fire.emit(pp, [rand(0.6), rand(0.6), rand(0.6)], 0x7dff9b, 0.9, 0.12, { alpha: 0.6 });
      } else if (r.type === 'nova') {
        fire.emit(pp, [rand(2), rand(2), rand(2)], 0xfff27a, 2.4, 0.2, { alpha: 0.7 });
        if (Math.random() < 0.3) flashes.flash(pp, 0xfff27a, 40, 25, 0.12);
      } else if (r.type === 'shard') {
        if (Math.random() < 0.4) fire.emit(pp, [0, 0, 0], 0xffb060, 0.12, 0.15);
      } else if (L.trail) {
        smoke.emit(pp, [rand(0.2), 0.2, rand(0.2)], 0x6a6560, 0.18, 0.6, { alpha: 0.3, grow: 2 });
        fire.emit(pp, [0, 0, 0], L.glow, 0.25, 0.08);
      } else if (L.blink && Math.sin(t * 20) > 0) fire.emit(pp, [0, 0, 0], L.glow, 0.3, 0.05);
    }
    $('fps').style.display = settings.showfps ? '' : 'none';
  } else if (!G.net) {
    // menu backdrop: slow orbit around the selected map
    const a = t * 0.05;
    const R = WORLD ? Math.min(90, Math.max(WORLD.bounds[1] - WORLD.bounds[0], WORLD.bounds[3] - WORLD.bounds[2]) * 0.55) : 40;
    camera.position.set(Math.sin(a) * R, R * 0.42 + Math.sin(t * 0.2) * 3, Math.cos(a) * R);
    camera.lookAt(0, 2, 0);
    if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
  }

  world?.update(t);
  if (Math.random() < 0.25 && WORLD?.pads?.length) {
    const pad = WORLD.pads[Math.floor(Math.random() * WORLD.pads.length)];
    fire.emit([pad.p[0] + rand(pad.r * 0.7), pad.p[1] + 0.2, pad.p[2] + rand(pad.r * 0.7)], [0, 2 + Math.random() * 2, 0], MAPS[worldMap]?.theme.glowB ?? 0x8fe8ff, 0.08, 0.8);
  }
  // lava embers
  if (WORLD?.hazards?.length && Math.random() < 0.5) {
    const h = WORLD.hazards[0];
    fire.emit([h.min[0] + Math.random() * (h.max[0] - h.min[0]), h.max[1], h.min[2] + Math.random() * (h.max[2] - h.min[2])], [rand(0.5), 1.5 + Math.random() * 2, rand(0.5)], 0xff6a20, 0.12, 1.5);
  }
  fire.update(dt); smoke.update(dt); beams.update(dt); flashes.update(dt);
  if (G.net && !G.alive) updateHUD();

  // ---------------- render
  renderer.clear();
  if (world) { if (Q().bloom) composer.render(dt); else renderer.render(scene, camera); }
  if (G.net && G.alive && G.ready) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
  fpsEl.frames++; fpsEl.t += dt;
  if (fpsEl.t >= 0.5) { $('fps').textContent = Math.round(fpsEl.frames / fpsEl.t) + ' fps'; fpsEl.frames = 0; fpsEl.t = 0; }
}
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
window.fragweb = { G, camera, settings };

// ------------------------------------------------------------------ menus
function bindSetting(ids, key, parse = (v) => v, apply = () => {}) {
  for (const id of ids) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = settings[key];
    el.addEventListener(el.type === 'range' || el.type === 'color' ? 'input' : 'change', (e) => {
      settings[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
      for (const other of ids) if (other !== id) { const o = $(other); if (o.type === 'checkbox') o.checked = settings[key]; else o.value = settings[key]; }
      saveSettings(); apply();
      void e;
    });
  }
  apply();
}
bindSetting(['sens', 'sens2'], 'sens', Number);
bindSetting(['fov', 'fov2'], 'fov', Number, () => { if (G.net) { camera.fov = settings.fov; camera.updateProjectionMatrix(); } });
bindSetting(['vol', 'vol2'], 'vol', Number, () => setVolume(settings.vol));
bindSetting(['quality', 'quality2'], 'quality', String, applyQuality);
bindSetting(['invert'], 'invert');
bindSetting(['voice'], 'voice', Boolean, () => { audioSettings.voice = settings.voice; });
bindSetting(['showfps'], 'showfps');
bindSetting(['xcolor'], 'xcolor', String, () => document.documentElement.style.setProperty('--xh', settings.xcolor));

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    for (const p of ['host', 'join', 'settings', 'help']) $('tab-' + p).classList.toggle('hidden', tab.dataset.tab !== p);
  };
}
$('weapon-help').innerHTML = WEAPONS.map(W => `<div class="whelp"><b style="color:#${new THREE.Color(W.color).getHexString()}">${W.key}. ${W.name}</b> — ${W.desc}</div>`).join('');

// map cards with top-down previews
function drawPreview(cv, def) {
  const b = def.build();
  const g = cv.getContext('2d');
  const W = cv.width = 320, H = cv.height = 256;
  g.fillStyle = '#05070c'; g.fillRect(0, 0, W, H);
  const [x0, x1, z0, z1] = b.bounds;
  const pad = 10;
  const sc = Math.min((W - pad * 2) / (x1 - x0 + 4), (H - pad * 2) / (z1 - z0 + 4));
  const rot = (z1 - z0) > (x1 - x0) * 1.3; // draw long maps sideways
  const scR = rot ? Math.min((W - pad * 2) / (z1 - z0 + 4), (H - pad * 2) / (x1 - x0 + 4)) : sc;
  const tx = (x, z) => rot ? [W / 2 + z * scR, H / 2 + x * scR] : [W / 2 + x * sc, H / 2 + z * sc];
  const s = rot ? scR : sc;
  const boxes = [...b.boxes].sort((a, c) => a.max[1] - c.max[1]);
  const minY = Math.min(...boxes.map(x => x.max[1])), maxY = Math.max(...boxes.map(x => x.max[1]).filter(y => y < 18));
  for (const bx of boxes) {
    if (bx.max[1] > 18 && (bx.max[0] - bx.min[0] < 3 || bx.max[2] - bx.min[2] < 3)) { g.fillStyle = '#39415a'; }
    else {
      const k = Math.max(0, Math.min(1, (bx.max[1] - minY) / (maxY - minY + 0.01)));
      const hue = def.id === 'foundry' ? 25 : def.id === 'skyreach' || def.id === 'spires' ? 35 : 215;
      g.fillStyle = `hsl(${hue}, ${18 + k * 30}%, ${16 + k * 46}%)`;
    }
    const [ax, ay] = tx(bx.min[0], bx.min[2]);
    const [bx2, by2] = tx(bx.max[0], bx.max[2]);
    g.fillRect(Math.min(ax, bx2), Math.min(ay, by2), Math.abs(bx2 - ax), Math.abs(by2 - ay));
  }
  for (const h of b.hazards || []) {
    const [ax, ay] = tx(h.min[0], h.min[2]); const [bx2, by2] = tx(h.max[0], h.max[2]);
    g.fillStyle = 'rgba(255,90,20,0.75)'; g.fillRect(Math.min(ax, bx2), Math.min(ay, by2), Math.abs(bx2 - ax), Math.abs(by2 - ay));
  }
  for (const p of b.pads || []) { const [x, y] = tx(p.p[0], p.p[2]); g.fillStyle = '#36c9ff'; g.beginPath(); g.arc(x, y, Math.max(2.5, p.r * s), 0, 7); g.fill(); }
  if (b.flags) b.flags.forEach((f, i) => { const [x, y] = tx(f[0], f[2]); g.fillStyle = i ? '#3d9bff' : '#ff4d4d'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); });
}
const mapCards = {};
for (const def of Object.values(MAPS)) {
  const card = document.createElement('button');
  card.className = 'mapcard';
  card.innerHTML = `<canvas></canvas><div class="info"><div class="name">${def.name}</div><div class="meta">${def.size} · ${def.players} players · ${def.modes.map(m => MODES[m].name).join(', ')}</div><div class="desc">${def.desc}</div></div>`;
  drawPreview(card.querySelector('canvas'), def);
  card.onclick = () => selectMap(def.id);
  $('maps').append(card);
  mapCards[def.id] = card;
}
for (const [k, M] of Object.entries(MUTATORS)) {
  const l = document.createElement('label');
  l.className = 'mut';
  l.innerHTML = `<span><input type="checkbox" data-mut="${k}"><b>${M.name}</b></span><small>${M.desc}</small>`;
  const cb = l.querySelector('input');
  cb.checked = !!settings.muts[k];
  cb.onchange = () => { settings.muts[k] = cb.checked; saveSettings(); };
  $('muts').append(l);
}
function selectMap(id) {
  settings.map = id; saveSettings();
  for (const [k, c] of Object.entries(mapCards)) c.classList.toggle('active', k === id);
  const sel = $('mode');
  sel.innerHTML = MAPS[id].modes.map(m => `<option value="${m}">${MODES[m].name}</option>`).join('');
  sel.value = MAPS[id].modes.includes(settings.mode) ? settings.mode : MAPS[id].modes[0];
  modeChanged();
  if (!G.net) loadMap(id);
}
function modeChanged() {
  settings.mode = $('mode').value; saveSettings();
  $('mode-desc').textContent = MODES[settings.mode].desc;
  $('lbl-cap').classList.toggle('hidden', settings.mode !== 'ctf');
  $('lbl-frag').classList.toggle('hidden', settings.mode === 'ctf');
  if (settings.mode === 'duel') { $('bots').value = Math.min(+$('bots').value, 1); $('fraglimit').value = 10; }
}
$('mode').onchange = modeChanged;
$('bots').value = settings.bots; $('skill').value = settings.skill;
$('bots').onchange = () => { settings.bots = +$('bots').value; saveSettings(); };
$('skill').onchange = () => { settings.skill = +$('skill').value; saveSettings(); };

const params = new URLSearchParams(location.search);
if (params.get('room')) {
  $('code').value = params.get('room').toUpperCase();
  document.querySelector('.tab[data-tab="join"]').click();
}
$('name').value = settings.name || '';

function playerName() {
  const n = $('name').value.trim() || 'Player' + Math.floor(Math.random() * 100);
  settings.name = $('name').value.trim(); saveSettings();
  return n;
}
function status(s) { $('status').textContent = s; }
function setBusy(b) { for (const id of ['btn-host', 'btn-practice', 'btn-join']) $(id).disabled = b; }
function clampInt(v, lo, hi, def) { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }

async function host(online) {
  initAudio();
  setBusy(true);
  status(online ? 'Creating room…' : 'Starting practice…');
  const muts = {};
  for (const [k, v] of Object.entries(settings.muts)) if (v) muts[k] = true;
  const opts = {
    map: settings.map,
    mode: $('mode').value,
    mutators: muts,
    bots: clampInt($('bots').value, 0, 15, 5),
    botSkill: clampInt($('skill').value, 0, 3, 1),
    fragLimit: clampInt($('fraglimit').value, 5, 200, 25),
    capLimit: clampInt($('caplimit').value, 1, 20, 3),
    timeLimit: clampInt($('timelimit').value, 2, 60, 12),
  };
  try {
    const net = await startHost(opts, onMsg, { online, onStatus: status });
    G.net = net; G.isHost = true; G.code = net.code;
    net.send({ t: 'hello', name: playerName() });
    enterGame();
  } catch (e) {
    status('Could not start: ' + e.message);
  }
  setBusy(false);
}

async function join() {
  initAudio();
  const code = $('code').value.trim().toUpperCase();
  if (code.length < 4) { status('Enter the room code shown on the host\'s screen.'); return; }
  setBusy(true);
  status('Connecting to room ' + code + '…');
  try {
    const net = await joinGame(code, onMsg, { onClose: () => { alert('Lost connection to the host.'); location.href = location.pathname; } });
    G.net = net; G.code = code;
    net.send({ t: 'hello', name: playerName() });
    enterGame();
  } catch (e) {
    status(e.message);
  }
  setBusy(false);
}

function enterGame() {
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('clicktoplay').classList.remove('hidden');
  const link = G.code ? `${location.origin}${location.pathname}?room=${G.code}` : '';
  if (G.code) {
    $('room').innerHTML = `Room <b>${G.code}</b>`;
    $('pause-room').innerHTML = `Room code <b>${G.code}</b><br>Friends join at:<br><a href="${link}" target="_blank">${esc(link)}</a>`;
  } else {
    $('room').textContent = 'Offline practice';
    $('pause-room').textContent = 'Offline practice — nobody else can join.';
  }
  $('host-tools').classList.toggle('hidden', !G.isHost);
  if (G.isHost && G.code) setTimeout(() => announce(`Room ${G.code}`, 'mid', 'Friends open this page and enter the code'), 600);
}

$('btn-host').onclick = () => host(true);
$('btn-practice').onclick = () => host(false);
$('btn-join').onclick = join;
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('btn-resume').onclick = lockPointer;
$('btn-team').onclick = () => { G.net.send({ t: 'team' }); lockPointer(); };
$('btn-leave').onclick = () => {
  if (G.isHost && G.code && !confirm('You are the host — leaving ends the game for everyone. Leave?')) return;
  G.net.close();
  location.href = location.pathname;
};
$('btn-addbot').onclick = () => G.net.send({ t: 'addbot' });
$('btn-kickbot').onclick = () => G.net.send({ t: 'kickbot' });
addEventListener('beforeunload', (e) => { if (G.isHost && G.code) { e.preventDefault(); e.returnValue = ''; } });

applyQuality();
selectMap(settings.map);
requestAnimationFrame(frame);
