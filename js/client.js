// Browser client: rendering, input, local movement prediction, HUD and sound.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TICK, PLAYER, WEAPONS, MAP, PICKUP_INFO, stepPlayer, rayWorldHit, rayBox, playerBox, dirFromAngles } from './game.js';
import { startHost, joinGame } from './net.js';
import {
  makeMaterials, buildArena, buildSky, buildWeapon, buildAvatar, setAvatarWeapon, animateAvatar,
  buildPickup, nameSprite, Particles, Beams, Decals, LightPool, glowMat,
} from './gfx.js';

const $ = (id) => document.getElementById(id);
const TEAM_COLORS = [0xff4d4d, 0x3d9bff];
const FFA_COLORS = [0xff7a3d, 0x3dff8b, 0xd65cff, 0xffe14d, 0x3de0ff, 0xff4da6, 0x9cff3d, 0x8a8aff, 0xffb03d, 0x3dffd2, 0xff3d3d, 0xc8c8c8];

// ------------------------------------------------------------------ settings
const settings = { sens: 1, fov: 100, vol: 0.6, name: '', quality: 'high' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('fragweb-settings') || '{}')); } catch { /* ignore */ }
function saveSettings() { try { localStorage.setItem('fragweb-settings', JSON.stringify(settings)); } catch { /* ignore */ } }

// ------------------------------------------------------------------ renderer / scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x120c18, 60, 260);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 900);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x9ab8ff, 0x3a2418, 0.75));
const sun = new THREE.DirectionalLight(0xffd2b0, 2.2);
sun.position.set(-30, 50, -40);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
// coloured fill lights in the corners (static count — never added/removed at runtime)
for (const [x, z, c] of [[-26, -26, 0xff6a36], [26, 26, 0xff6a36], [-26, 26, 0x36c9ff], [26, -26, 0x36c9ff], [0, 0, 0x6ab8ff]]) {
  const l = new THREE.PointLight(c, 40, 30, 1.6);
  l.position.set(x, x === 0 ? 7 : 9, z);
  scene.add(l);
}

const mats = makeMaterials();
const { padMeshes } = buildArena(scene, mats);
const sky = buildSky(scene);
const fire = new Particles(scene, 3000, true);   // additive: sparks, flames, glows
const smoke = new Particles(scene, 1500, false); // alpha: smoke, debris
const beams = new Beams(scene);
const decals = new Decals(scene);
const flashes = new LightPool(scene, 6);

// post-processing (bloom) for High quality
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// first-person weapon renders in its own scene so it never clips into walls
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.6;
const vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0xb8ccff, 0x40281a, 1.3));
const vmKey = new THREE.DirectionalLight(0xffe0c8, 2.2); vmKey.position.set(1, 2, 1); vmScene.add(vmKey);
const vmRim = new THREE.DirectionalLight(0x36c9ff, 1.4); vmRim.position.set(-2, 0.5, -1); vmScene.add(vmRim);
const vmFlash = new THREE.PointLight(0xffaa55, 0, 3, 2); vmScene.add(vmFlash);
const vmRoot = new THREE.Group(); vmRoot.scale.setScalar(0.62); vmScene.add(vmRoot);
const vmWeapons = WEAPONS.map((W, i) => {
  const w = buildWeapon(i);
  w.group.visible = false;
  vmRoot.add(w.group);
  return w;
});
// muzzle flash sprite
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
  low:    { pr: 0.75, shadows: false, shadowSize: 512,  bloom: false },
  medium: { pr: 1,    shadows: true,  shadowSize: 1024, bloom: false },
  high:   { pr: Math.min(devicePixelRatio, 1.5), shadows: true, shadowSize: 2048, bloom: true },
};
function applyQuality() {
  const q = QUALITY[settings.quality] || QUALITY.high;
  renderer.setPixelRatio(q.pr);
  if (renderer.shadowMap.enabled !== q.shadows) {
    renderer.shadowMap.enabled = q.shadows;
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
  }
  if (sun.shadow.mapSize.x !== q.shadowSize) {
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }
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
applyQuality();

// ------------------------------------------------------------------ pickups
const pickupMeshes = MAP.pickups.map(pk => {
  const m = buildPickup(pk.t);
  m.position.set(pk.p[0], pk.p[1] + 0.85, pk.p[2]);
  scene.add(m);
  return m;
});

// ------------------------------------------------------------------ effects
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function rand(s) { return (Math.random() - 0.5) * 2 * s; }

function impact(p, n, color) {
  n = n || [0, 1, 0];
  for (let i = 0; i < 7; i++) {
    fire.emit(p, [n[0] * 4 + rand(4), n[1] * 4 + rand(4) + 2, n[2] * 4 + rand(4)], color, 0.07, 0.25 + Math.random() * 0.2, { grav: 18 });
  }
  fire.emit(p, [0, 0, 0], color, 0.5, 0.12, { alpha: 0.9 });
  smoke.emit(p, [n[0] * 0.8, n[1] * 0.8 + 0.4, n[2] * 0.8], 0x6a6560, 0.35, 0.7, { alpha: 0.35, grow: 2.5, drag: 2 });
  if (n) decals.add(p, n);
}
function fleshHit(p, color) {
  for (let i = 0; i < 10; i++) fire.emit(p, [rand(5), rand(4) + 2, rand(5)], color, 0.09, 0.35, { grav: 14 });
  fire.emit(p, [0, 0, 0], 0xffffff, 0.6, 0.1);
}
function explosion(p) {
  flashes.flash(p, 0xff8a40, 120, 22, 0.5);
  fire.emit(p, [0, 0, 0], 0xffffff, 4, 0.12);
  for (let i = 0; i < 40; i++) {
    const d = [rand(1), rand(1), rand(1)];
    const s = 3 + Math.random() * 7;
    fire.emit(p, [d[0] * s, d[1] * s + 2, d[2] * s], i % 3 ? 0xff7a2a : 0xffc060, 0.9 + Math.random() * 0.8, 0.35 + Math.random() * 0.3, { grow: 1.2, drag: 3 });
  }
  for (let i = 0; i < 30; i++) {
    fire.emit(p, [rand(14), rand(10) + 6, rand(14)], 0xffd080, 0.08, 0.6 + Math.random() * 0.5, { grav: 20 });
  }
  for (let i = 0; i < 18; i++) {
    smoke.emit([p[0] + rand(0.8), p[1] + rand(0.8), p[2] + rand(0.8)], [rand(2), Math.random() * 2.5, rand(2)], 0x2a2624, 1.2 + Math.random(), 1.6 + Math.random(), { alpha: 0.55, grow: 2.2, drag: 1.5 });
  }
  // scorch mark
  const hit = rayWorldHit([p[0], p[1] + 0.2, p[2]], [0, -1, 0], 2.5);
  if (hit.n) decals.add([p[0], p[1] + 0.2 - hit.t, p[2]], hit.n, 2.4);
  const d = camera.position.distanceTo(V(p));
  shake = Math.max(shake, Math.max(0, 1 - d / 18) * 0.6);
}
function gibs(p, color) {
  fire.emit(p, [0, 0, 0], color, 3, 0.2);
  for (let i = 0; i < 26; i++) smoke.emit(p, [rand(7), Math.random() * 8 + 2, rand(7)], i % 2 ? color : 0x2a2e36, 0.22, 1.2, { alpha: 1, grav: 20 });
  for (let i = 0; i < 12; i++) fire.emit(p, [rand(4), Math.random() * 5, rand(4)], color, 0.18, 0.5, { drag: 2, grow: 0.5, alpha: 0.7 });
  flashes.flash(p, color, 30, 8, 0.3);
}
let shake = 0;
// ------------------------------------------------------------------ sound (synthesised, no audio files)
let actx = null, master = null;
function audio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = settings.vol;
    master.connect(actx.destination);
  }
  return actx;
}
function noiseBuf() {
  const a = audio();
  if (!noiseBuf.b) {
    noiseBuf.b = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf.b;
}
function sfx(kind, pos) {
  if (!actx) return;
  const a = actx, t = a.currentTime;
  let vol = 1;
  if (pos) {
    const d = camera.position.distanceTo(new THREE.Vector3(...pos));
    vol = Math.max(0, 1 - d / 60) ** 1.5;
    if (vol < 0.02) return;
  }
  const out = a.createGain(); out.connect(master);
  const noise = (dur, freq, q = 1, gain = 1, type = 'lowpass') => {
    const s = a.createBufferSource(); s.buffer = noiseBuf();
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain(); g.gain.setValueAtTime(gain * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur);
    return f;
  };
  const tone = (type, f0, f1, dur, gain = 0.3) => {
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(gain * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur);
  };
  switch (kind) {
    case 'w0': tone('square', 900, 200, 0.12, 0.18); noise(0.08, 3000, 1, 0.4); break;
    case 'w1': noise(0.35, 1400, 0.7, 1.1); tone('sawtooth', 160, 40, 0.25, 0.3); break;
    case 'w2': tone('sawtooth', 1400, 500, 0.06, 0.12); noise(0.05, 5000, 1, 0.25, 'bandpass'); break;
    case 'w3': noise(0.5, 600, 0.5, 0.6); tone('triangle', 220, 60, 0.4, 0.3); break;
    case 'w4': tone('sawtooth', 2400, 80, 0.6, 0.25); tone('sine', 120, 40, 0.5, 0.4); noise(0.3, 6000, 2, 0.3, 'highpass'); break;
    case 'boom': noise(1.0, 400, 0.4, 1.6); tone('sine', 90, 30, 0.8, 0.8); break;
    case 'jump': tone('sine', 300, 500, 0.12, 0.08); break;
    case 'pad': tone('sine', 200, 1200, 0.45, 0.25); break;
    case 'land': noise(0.1, 260, 1, 0.45); tone('sine', 90, 50, 0.1, 0.2); break;
    case 'step': noise(0.05, 500 + Math.random() * 300, 2, 0.12, 'bandpass'); break;
    case 'pick': tone('square', 660, 660, 0.06, 0.12); setTimeout(() => sfx('pick2'), 70); break;
    case 'pick2': tone('square', 990, 990, 0.08, 0.12); break;
    case 'hit': tone('sine', 1800, 1600, 0.05, 0.2); break;
    case 'hurt': noise(0.15, 500, 1, 0.6); tone('sine', 140, 70, 0.15, 0.4); break;
    case 'frag': tone('square', 440, 440, 0.08, 0.15); setTimeout(() => { if (actx) sfx('frag2'); }, 90); break;
    case 'frag2': tone('square', 880, 880, 0.14, 0.15); break;
    case 'die': tone('sawtooth', 300, 40, 0.7, 0.25); break;
    case 'empty': tone('square', 200, 180, 0.04, 0.1); break;
  }
}

// ------------------------------------------------------------------ game state
const G = {
  net: null, isHost: false, code: null,
  id: null, mode: 'ffa', fragLimit: 25,
  body: { p: [0, 2, 0], v: [0, 0, 0], onGround: false },
  yaw: 0, pitch: 0, w: 0,
  alive: false, me: { hp: 100, ar: 0, ammo: {}, have: [true, false, false, false, false], alive: false, rs: 0 },
  others: new Map(), // id -> remote player
  roster: [], teams: [0, 0],
  rockets: new Map(), ghosts: [],
  keys: {}, mouseDown: false, lastFire: -10, clock: 0, sendAcc: 0,
  playing: false, chatting: false, ended: false, lastKiller: null,
  switchT: 1, lastW: 0, mouseDX: 0, mouseDY: 0,
};

function rosterEntry(id) { return G.roster.find(r => r.id === id); }
function nameOf(id) { const r = rosterEntry(id); return r ? r.name : '???'; }
function colorOf(id, team) {
  if (G.mode === 'tdm') return TEAM_COLORS[team ?? rosterEntry(id)?.team ?? 0];
  return FFA_COLORS[id % FFA_COLORS.length];
}

// ------------------------------------------------------------------ rockets (visual)
const rocketGeo = new THREE.CylinderGeometry(0.06, 0.09, 0.5, 10); rocketGeo.rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x5a606c, metalness: 0.8, roughness: 0.3 });
const rocketGlow = glowMat(0xffa040, 4);
const rocketTailGeo = new THREE.SphereGeometry(0.1, 8, 6);
function makeRocket(p, v) {
  const mesh = new THREE.Mesh(rocketGeo, rocketMat);
  const tail = new THREE.Mesh(rocketTailGeo, rocketGlow); tail.position.z = 0.27; mesh.add(tail);
  mesh.position.set(...p);
  scene.add(mesh);
  return { mesh, p: [...p], v: [...v], t0: G.clock, born: G.clock };
}
function removeRocket(r) { scene.remove(r.mesh); }
// ------------------------------------------------------------------ network messages
function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      G.id = m.id; G.mode = m.mode; G.fragLimit = m.fragLimit;
      break;
    case 'roster':
      G.roster = m.players; G.teams = m.teams;
      for (const [id, o] of G.others) {
        if (!G.roster.find(r => r.id === id)) { scene.remove(o.mesh); G.others.delete(id); }
      }
      for (const r of G.roster) { const o = G.others.get(r.id); if (o && o.name !== r.name) { rebuildAvatar(r.id, o); } }
      updateScoreboard(); updateMyScore();
      break;
    case 'snap': onSnap(m); break;
    case 'fx': onFx(m); break;
  }
}

function rebuildAvatar(id, o) {
  scene.remove(o.mesh);
  const r = rosterEntry(id);
  const col = colorOf(id, r?.team);
  o.mesh = buildAvatar(col);
  o.name = r?.name;
  const tag = nameSprite(r ? r.name : '?', col);
  tag.position.y = 1.25;
  o.mesh.add(tag);
  setAvatarWeapon(o.mesh, o.w || 0);
  o.mesh.visible = !!o.alive;
  scene.add(o.mesh);
}

function onSnap(m) {
  G.me = m.me;
  if (!m.me.alive && G.alive) { G.alive = false; }
  for (const [id, x, y, z, yaw, pitch, w, alive, team, vx = 0, vy = 0, vz = 0, gr = 1] of m.pl) {
    if (id === G.id) continue;
    let o = G.others.get(id);
    if (!o) {
      o = { id, mesh: null, cur: { p: [x, y, z], yaw, pitch }, alive, team, w };
      G.others.set(id, o);
      rebuildAvatar(id, o);
    }
    if (o.team !== team) { o.team = team; rebuildAvatar(id, o); }
    if (!o.alive && alive) { o.cur.p = [x, y, z]; } // snap on respawn
    // latest authoritative state; rendered position is extrapolated from it each frame
    o.snap = { p: [x, y, z], v: [vx, vy, vz], t: G.clock };
    o.target = { yaw, pitch };
    o.ground = !!gr;
    o.alive = alive; o.w = w;
    setAvatarWeapon(o.mesh, w);
    o.mesh.visible = !!alive;
  }
  // rockets
  const seen = new Set();
  for (const [id, x, y, z, vx = 0, vy = 0, vz = 0] of m.rk) {
    seen.add(id);
    let r = G.rockets.get(id);
    if (!r) { r = makeRocket([x, y, z], [vx, vy, vz]); G.rockets.set(id, r); }
    r.p = [x, y, z]; r.v = [vx, vy, vz]; r.t0 = G.clock;
  }
  for (const [id, r] of G.rockets) if (!seen.has(id) && G.clock - r.born > 0.15) { removeRocket(r); G.rockets.delete(id); }
  // pickups
  for (let i = 0; i < pickupMeshes.length; i++) pickupMeshes[i].visible = m.pk[i] === '1';
  // timer
  const tl = m.tl;
  $('timer').textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
  // if a weapon was lost (death) fall back
  if (!G.me.have[G.w]) G.w = 0;
  updateHUD();
}

function onFx(m) {
  switch (m.k) {
    case 'spawn':
      G.body.p = [...m.p]; G.body.v = [0, 0, 0];
      G.yaw = m.yaw; G.pitch = 0; G.w = 0; G.alive = true; G.switchT = 0;
      G.me.alive = true;
      $('dead').classList.add('hidden');
      break;
    case 'knock':
      G.body.v[0] += m.v[0]; G.body.v[1] += m.v[1]; G.body.v[2] += m.v[2];
      G.body.onGround = false;
      break;
    case 'shot': {
      const W = WEAPONS[m.w];
      if (m.rk) {
        const [rid, x, y, z, vx, vy, vz] = m.rk;
        if (m.owner === G.id && G.ghosts.length) {
          // adopt the rocket we already drew locally
          const r = G.ghosts.shift();
          r.p = [x, y, z]; r.v = [vx, vy, vz]; r.t0 = G.clock - 0.01;
          G.rockets.set(rid, r);
        } else if (!G.rockets.has(rid)) G.rockets.set(rid, makeRocket([x, y, z], [vx, vy, vz]));
      }
      if (m.owner === G.id) break; // we drew our own shots already
      const o = G.others.get(m.owner);
      let from = m.a;
      if (o && o.mesh) {
        const mz = new THREE.Vector3(0, 0, -0.9);
        o.mesh.userData.gunMount.localToWorld(mz);
        from = mz.toArray();
        fire.emit(from, [0, 0, 0], W.color, 0.6, 0.06);
        flashes.flash(from, W.color, 8, 6, 0.08);
      }
      for (const b of m.b) {
        beams.fire(from, b, W.color, W.id === 4 ? 0.035 : 0.012, W.id === 4 ? 0.7 : 0.09);
        if (W.id === 4) beams.fire(from, b, 0xffffff, 0.008, 0.35);
        const dir = [b[0] - m.a[0], b[1] - m.a[1], b[2] - m.a[2]];
        const l = Math.hypot(...dir) || 1;
        const hit = rayWorldHit(m.a, dir.map(x => x / l), l + 0.2);
        if (hit.n && hit.t >= l - 0.2) impact(b, hit.n, W.color); else fleshHit(b, W.color);
      }
      sfx('w' + m.w, m.a);
      break;
    }
    case 'boom': {
      explosion(m.p); sfx('boom', m.p);
      // remove the nearest rocket immediately rather than waiting for the next snapshot
      let best = null, bd = 3;
      for (const [id, r] of G.rockets) { const d = r.mesh.position.distanceTo(V(m.p)); if (d < bd) { bd = d; best = id; } }
      if (best != null) { removeRocket(G.rockets.get(best)); G.rockets.delete(best); }
      break;
    }
    case 'hit': flashHit(); sfx('hit'); break;
    case 'hurt': {
      const el = $('damage');
      el.style.opacity = Math.min(1, m.dmg / 60 + 0.2);
      setTimeout(() => { el.style.opacity = 0; }, 120);
      shake = Math.max(shake, Math.min(0.5, m.dmg / 80));
      sfx('hurt');
      break;
    }
    case 'pick': {
      sfx('pick');
      const el = $('pickup-msg');
      el.textContent = m.label; el.style.opacity = 1;
      clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 1400);
      const info = PICKUP_INFO[m.pk];
      if (info.weapon != null && G.w < info.weapon) switchTo(info.weapon); // auto-switch to a better gun
      break;
    }
    case 'kill': {
      const wname = m.w >= 0 ? WEAPONS[m.w].name : 'gravity';
      let text;
      if (m.killer == null || m.killer === m.victim) text = `<span>${esc(nameOf(m.victim))}</span><span class="w">${m.w === 3 ? 'blew themselves up' : 'fell'}</span>`;
      else text = `<span>${esc(nameOf(m.killer))}</span><span class="w">${wname}</span><span>${esc(nameOf(m.victim))}</span>`;
      feed(text);
      const vo = G.others.get(m.victim);
      gibs(m.p, colorOf(m.victim, vo?.team));
      if (m.victim === G.id) {
        G.alive = false; sfx('die');
        G.lastKiller = m.killer;
        $('dead').classList.remove('hidden');
        $('deadby').textContent = m.killer && m.killer !== G.id ? `by ${nameOf(m.killer)} (${wname})` : '';
      } else if (m.killer === G.id) {
        sfx('frag');
        centerMsg(`You fragged ${nameOf(m.victim)}`, 1500);
      }
      break;
    }
    case 'msg': centerMsg(m.m, 2500); chatLine(`<i>${esc(m.m)}</i>`); break;
    case 'chat': chatLine(`<b class="${G.mode === 'tdm' ? 't' + m.team : ''}">${esc(m.from)}:</b> ${esc(m.m)}`); break;
    case 'end':
      G.ended = true;
      centerMsg(`${m.winner} wins! (${m.reason})<br><small>Next match in 10 seconds…</small>`, 9500);
      $('scoreboard').classList.remove('hidden');
      setTimeout(() => { G.ended = false; if (!G.keys.Tab) $('scoreboard').classList.add('hidden'); }, 10000);
      break;
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function feed(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  $('killfeed').prepend(d);
  setTimeout(() => d.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
}
function chatLine(html) {
  const d = document.createElement('div'); d.innerHTML = html;
  $('chatlog').append(d);
  setTimeout(() => d.remove(), 10000);
  while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
}
let centerTimer;
function centerMsg(html, ms) {
  $('center-msg').innerHTML = html;
  clearTimeout(centerTimer);
  centerTimer = setTimeout(() => { $('center-msg').innerHTML = ''; }, ms);
}
function flashHit() {
  const h = $('hitmarker'); h.style.transition = 'none'; h.style.opacity = 1;
  requestAnimationFrame(() => { h.style.transition = 'opacity 0.25s'; h.style.opacity = 0; });
}

// ------------------------------------------------------------------ HUD
const weaponSlots = WEAPONS.map(W => {
  const d = document.createElement('div');
  d.innerHTML = `<b>${W.key}</b>${W.name.split(' ')[0]}`;
  $('weapons').append(d);
  return d;
});
function updateHUD() {
  const me = G.me;
  const hp = $('hp'); hp.textContent = Math.max(0, me.hp); hp.classList.toggle('low', me.hp < 30);
  $('ar').textContent = me.ar;
  const W = WEAPONS[G.w];
  $('wname').textContent = W.name;
  $('ammocount').textContent = W.ammo ? me.ammo[W.ammo] : '∞';
  WEAPONS.forEach((w, i) => {
    weaponSlots[i].classList.toggle('have', !!me.have[i]);
    weaponSlots[i].classList.toggle('cur', i === G.w);
  });
  if (!me.alive) $('respawn').textContent = me.rs > 0 ? `Respawning in ${me.rs.toFixed(1)}s` : 'Respawning…';
}
function updateMyScore() {
  const me = rosterEntry(G.id);
  if (!me) return;
  if (G.mode === 'tdm') {
    $('myscore').innerHTML = `<span class="t0">${G.teams[0]}</span> : <span class="t1">${G.teams[1]}</span> &nbsp;<small>first to ${G.fragLimit * 2}</small>`;
  } else {
    const sorted = [...G.roster].sort((a, b) => b.frags - a.frags);
    const rank = sorted.findIndex(r => r.id === G.id) + 1;
    $('myscore').innerHTML = `${me.frags} frags · ${ordinal(rank)} of ${sorted.length}`;
  }
}
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function updateScoreboard() {
  const rows = (list) => list.sort((a, b) => b.frags - a.frags).map(r =>
    `<tr class="${r.id === G.id ? 'me' : ''}"><td class="${G.mode === 'tdm' ? 't' + r.team : ''}">${esc(r.name)}${r.bot ? ' <small>(bot)</small>' : ''}</td><td class="num">${r.frags}</td><td class="num">${r.deaths}</td></tr>`).join('');
  const head = '<tr><th>Player</th><th class="num">Frags</th><th class="num">Deaths</th></tr>';
  let html = `<h3>${MAP.name} — ${G.mode === 'tdm' ? 'Team Deathmatch' : 'Deathmatch'}</h3>`;
  if (G.mode === 'tdm') {
    for (const t of [0, 1]) {
      html += `<h4 class="t${t}">${t ? 'Blue' : 'Red'} team — ${G.teams[t]}</h4><table>${head}${rows(G.roster.filter(r => r.team === t))}</table>`;
    }
  } else html += `<table>${head}${rows([...G.roster])}</table>`;
  $('scoreboard').innerHTML = html;
}

// ------------------------------------------------------------------ input
canvas.addEventListener('click', () => { if (G.net && !G.chatting) lockPointer(); });
$('clicktoplay').addEventListener('click', lockPointer);
function lockPointer() {
  audio();
  const r = canvas.requestPointerLock?.({ unadjustedMovement: true });
  if (r && r.catch) r.catch(() => canvas.requestPointerLock());
}
document.addEventListener('pointerlockchange', () => {
  G.playing = document.pointerLockElement === canvas;
  if (G.net) {
    $('pause').classList.toggle('hidden', G.playing || G.chatting);
    $('clicktoplay').classList.add('hidden');
  }
  if (!G.playing) G.mouseDown = false;
});
document.addEventListener('mousemove', (e) => {
  if (!G.playing) return;
  const s = 0.0022 * settings.sens;
  G.yaw -= e.movementX * s;
  G.pitch -= e.movementY * s;
  G.mouseDX += e.movementX; G.mouseDY += e.movementY;
  G.pitch = Math.max(-1.55, Math.min(1.55, G.pitch));
});
document.addEventListener('mousedown', (e) => { if (G.playing && e.button === 0) { G.mouseDown = true; if (G.alive) tryFire(); } });
document.addEventListener('mouseup', (e) => { if (e.button === 0) G.mouseDown = false; });
document.addEventListener('wheel', (e) => { if (G.playing) cycleWeapon(e.deltaY > 0 ? 1 : -1); });
document.addEventListener('keydown', (e) => {
  if (G.chatting) {
    if (e.key === 'Enter') {
      const msg = $('chatin').value.trim();
      if (msg) G.net.send({ t: 'chat', m: msg });
      closeChat();
    } else if (e.key === 'Escape') closeChat();
    return;
  }
  if (!G.net) return;
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); updateScoreboard(); }
  if (!G.playing) return;
  G.keys[e.code] = true;
  if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); openChat(); }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= WEAPONS.length && G.me.have[n - 1]) switchTo(n - 1);
  if (e.code === 'KeyQ') cycleWeapon(-1);
  if (e.code === 'KeyE') cycleWeapon(1);
});
document.addEventListener('keyup', (e) => {
  G.keys[e.code] = false;
  if (e.code === 'Tab' && !G.ended) $('scoreboard').classList.add('hidden');
});
function openChat() {
  G.chatting = true;
  G.keys = {};
  document.exitPointerLock();
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
  G.lastW = G.w; G.w = w; G.switchT = 0;
}

// ------------------------------------------------------------------ shooting
let recoil = 0;
let lastShotT = -10;
function tryFire() {
  const W = WEAPONS[G.w];
  if (G.switchT < 0.6) return; // still raising the weapon
  if (G.clock - G.lastFire < W.interval) return;
  if (W.ammo && (G.me.ammo[W.ammo] ?? 0) <= 0) {
    G.lastFire = G.clock; sfx('empty');
    for (const w of [4, 3, 1, 2, 0]) if (G.me.have[w] && (!WEAPONS[w].ammo || G.me.ammo[WEAPONS[w].ammo] > 0)) { switchTo(w); break; }
    return;
  }
  G.lastFire = G.clock;
  lastShotT = G.clock;
  if (W.ammo) G.me.ammo[W.ammo]--; // predicted; the next snapshot corrects it
  const eye = [G.body.p[0], G.body.p[1] + PLAYER.eye, G.body.p[2]];
  const d = dirFromAngles(G.yaw, G.pitch);
  G.net.send({ t: 'fire', w: G.w, o: eye, d });
  sfx('w' + G.w);
  recoil = Math.min(1.4, recoil + (W.id === 4 ? 1 : W.id === 1 || W.id === 3 ? 0.8 : W.id === 2 ? 0.18 : 0.4));
  if (W.id === 1 || W.id === 4) G.pitch = Math.min(1.55, G.pitch + 0.012);
  vmFlashT = 0.06;

  // muzzle position in world space (from the first-person gun)
  const vm = vmWeapons[G.w];
  const mzLocal = vm.muzzle.clone();
  vm.group.localToWorld(mzLocal); // vm space
  // the viewmodel camera sits at the origin, so vm space == main camera space
  const muzzle = mzLocal.applyMatrix4(camera.matrixWorld).toArray();
  flashes.flash(muzzle, W.color, 10, 8, 0.07);

  if (W.kind === 'rocket') {
    const r = makeRocket([eye[0] + d[0] * 0.6, eye[1] + d[1] * 0.6, eye[2] + d[2] * 0.6], d.map(x => x * W.speed));
    G.ghosts.push(r);
    setTimeout(() => { const i = G.ghosts.indexOf(r); if (i >= 0) { G.ghosts.splice(i, 1); removeRocket(r); } }, 600);
    for (let i = 0; i < 8; i++) smoke.emit(muzzle, [rand(1) + d[0] * 2, rand(1) + d[1] * 2, rand(1) + d[2] * 2], 0x777070, 0.3, 0.6, { alpha: 0.4, grow: 3, drag: 3 });
  } else {
    // local tracers, stopping at walls or at players as we see them (the host decides real hits)
    for (let i = 0; i < W.pellets; i++) {
      const s = W.spread;
      let dd = [d[0] + rand(s), d[1] + rand(s), d[2] + rand(s)];
      const l = Math.hypot(...dd); dd = dd.map(x => x / l);
      const hit = rayWorldHit(eye, dd, 250);
      let t = hit.t, who = null;
      for (const o of G.others.values()) {
        if (!o.alive) continue;
        const bx = playerBox(o.cur.p);
        const tp = rayBox(eye, dd, bx.min, bx.max);
        if (tp < t) { t = tp; who = o; }
      }
      const end = [eye[0] + dd[0] * t, eye[1] + dd[1] * t, eye[2] + dd[2] * t];
      beams.fire(muzzle, end, W.color, W.id === 4 ? 0.035 : 0.012, W.id === 4 ? 0.7 : 0.08);
      if (W.id === 4) beams.fire(muzzle, end, 0xffffff, 0.008, 0.35);
      if (who) fleshHit(end, colorOf(who.id, who.team));
      else if (hit.n) impact(end, hit.n, W.color);
    }
    if (W.id === 4) for (let i = 0; i < 10; i++) fire.emit(muzzle, [d[0] * i * 0.8 + rand(0.3), d[1] * i * 0.8 + rand(0.3), d[2] * i * 0.8 + rand(0.3)], W.color, 0.12, 0.4, { drag: 2 });
  }
  updateHUD();
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
let bob = 0, bobAmt = 0, landDip = 0, stepAcc = 0, vmFlashT = 0;
const swayV = new THREE.Vector2();
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const fpsEl = { frames: 0, t: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  G.clock += dt;
  const t = now / 1000;

  if (G.net) {
    // ---------------- local movement (client-side prediction)
    if (G.alive) {
      const k = G.keys;
      const input = {
        fwd: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
        right: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0),
        jump: !!k.Space,
      };
      if (!G.playing) { input.fwd = input.right = 0; input.jump = false; }
      const wasGround = G.body.onGround;
      const fallSpeed = -G.body.v[1];
      let rem = dt;
      while (rem > 1e-6) {
        const sdt = Math.min(rem, 1 / 120);
        const jumpedFromGround = input.jump && G.body.onGround;
        const ev = stepPlayer(G.body, input, G.yaw, sdt);
        if (ev === 'pad') { sfx('pad'); for (let i = 0; i < 16; i++) fire.emit([G.body.p[0], G.body.p[1] - 0.9, G.body.p[2]], [rand(3), Math.random() * 6, rand(3)], 0x8fe8ff, 0.12, 0.5); }
        else if (jumpedFromGround) sfx('jump');
        rem -= sdt;
      }
      if (!wasGround && G.body.onGround) { sfx('land'); landDip = Math.min(0.25, fallSpeed * 0.012); }
      if (G.mouseDown && G.playing) tryFire();
      const sp = Math.hypot(G.body.v[0], G.body.v[2]);
      if (G.body.onGround && sp > 2) {
        stepAcc += dt * sp;
        if (stepAcc > 3.2) { stepAcc = 0; sfx('step'); }
      }
    }

    G.sendAcc += dt;
    if (G.sendAcc >= TICK) {
      G.sendAcc %= TICK;
      if (G.alive) G.net.send({ t: 'st', p: G.body.p.map(x => +x.toFixed(3)), v: G.body.v.map(x => +x.toFixed(2)), g: G.body.onGround ? 1 : 0, y: +G.yaw.toFixed(4), pi: +G.pitch.toFixed(4), w: G.w });
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
    const fovTarget = settings.fov + Math.min(8, Math.max(0, sp - PLAYER.speed) * 0.6);
    if (Math.abs(camera.fov - fovTarget) > 0.05) { camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }

    // ---------------- first-person weapon animation
    G.switchT = Math.min(1, G.switchT + dt * 4);
    vmWeapons.forEach((w, i) => { w.group.visible = i === G.w && G.alive; });
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
    if (vm.parts?.spin) {
      const firing = G.clock - lastShotT < 0.15;
      vm.spinV = (vm.spinV || 0) + ((firing ? 30 : 0) - (vm.spinV || 0)) * Math.min(1, dt * 5);
      vm.parts.spin.rotation.z += vm.spinV * dt;
    }
    if (vm.parts?.coils) {
      const charge = Math.min(1, (G.clock - G.lastFire) / WEAPONS[4].interval);
      vm.parts.coils.forEach((c, i) => {
        const on = charge * 5 > i ? 1 : 0.12;
        c.material.color.set(WEAPONS[4].color).multiplyScalar(on * (2.5 + Math.sin(t * 8 + i) * 0.5));
      });
    }
    // muzzle flash
    vmFlashT -= dt;
    const flashOn = vmFlashT > 0;
    vmMuzzle.visible = flashOn && G.alive;
    vmFlash.intensity = flashOn ? 6 : 0;
    if (flashOn) {
      const p = vm.muzzle.clone(); vm.group.localToWorld(p);
      vmMuzzle.position.copy(p);
      vmFlash.position.copy(p);
      vmMuzzle.material.color.set(WEAPONS[G.w].color).lerp(new THREE.Color(0xffffff), 0.5);
      vmMuzzle.material.rotation = Math.random() * 6.28;
      vmMuzzle.scale.setScalar(G.w === 1 || G.w === 3 ? 0.35 : 0.22);
    }

    // ---------------- remote players: extrapolate from the latest snapshot, then smooth
    for (const o of G.others.values()) {
      if (!o.snap) continue;
      const age = Math.min(0.1, G.clock - o.snap.t);
      const tx = o.snap.p[0] + o.snap.v[0] * age;
      const ty = o.snap.p[1] + (o.ground ? 0 : o.snap.v[1] * age);
      const tz = o.snap.p[2] + o.snap.v[2] * age;
      const a = Math.min(1, dt * 20);
      o.cur.p[0] += (tx - o.cur.p[0]) * a;
      o.cur.p[1] += (ty - o.cur.p[1]) * a;
      o.cur.p[2] += (tz - o.cur.p[2]) * a;
      o.cur.yaw += angDiff(o.cur.yaw, o.target.yaw) * Math.min(1, dt * 25);
      o.cur.pitch += (o.target.pitch - o.cur.pitch) * Math.min(1, dt * 25);
      o.mesh.position.set(o.cur.p[0], o.cur.p[1], o.cur.p[2]);
      o.mesh.rotation.y = o.cur.yaw;
      animateAvatar(o.mesh, dt, Math.hypot(o.snap.v[0], o.snap.v[2]), !o.ground, o.cur.pitch);
    }

    // ---------------- rockets: extrapolate along velocity, exhaust trail
    const allRockets = [...G.rockets.values(), ...G.ghosts];
    for (const r of allRockets) {
      const age = G.clock - r.t0;
      r.mesh.position.set(r.p[0] + r.v[0] * age, r.p[1] + r.v[1] * age, r.p[2] + r.v[2] * age);
      tmpV.set(r.mesh.position.x + r.v[0], r.mesh.position.y + r.v[1], r.mesh.position.z + r.v[2]);
      r.mesh.lookAt(tmpV);
      r.mesh.rotateY(Math.PI);
      const pp = r.mesh.position.toArray();
      fire.emit(pp, [rand(0.5), rand(0.5), rand(0.5)], 0xffa040, 0.35, 0.12);
      smoke.emit(pp, [rand(0.3), rand(0.3) + 0.3, rand(0.3)], 0x8a8580, 0.25, 0.9, { alpha: 0.35, grow: 3, drag: 1 });
    }
  } else {
    // menu backdrop: slow orbit around the arena
    const a = t * 0.06;
    camera.position.set(Math.sin(a) * 36, 16 + Math.sin(t * 0.2) * 3, Math.cos(a) * 36);
    camera.lookAt(0, 3, 0);
  }

  // ---------------- ambient animation
  pickupMeshes.forEach((m, i) => {
    const item = m.userData.item;
    item.rotation.y = t * 1.5 + i;
    item.position.y = Math.sin(t * 2 + i) * 0.1;
  });
  for (const g of padMeshes) for (const c of g.children) if (c.userData.phase != null) {
    const k = (t * 0.9 + c.userData.phase) % 1;
    c.position.y = k * 3; c.material.opacity = 1 - k; c.scale.setScalar(1 - k * 0.35);
  }
  if (Math.random() < 0.3) {
    const pad = MAP.pads[Math.floor(Math.random() * MAP.pads.length)];
    fire.emit([pad.p[0] + rand(pad.r * 0.7), pad.p[1] + 0.2, pad.p[2] + rand(pad.r * 0.7)], [0, 2 + Math.random() * 2, 0], 0x8fe8ff, 0.08, 0.8);
  }
  sky.material.uniforms.time.value = t;
  fire.update(dt); smoke.update(dt); beams.update(dt); flashes.update(dt);
  if (G.net && !G.alive) updateHUD();

  // ---------------- render
  const q = QUALITY[settings.quality] || QUALITY.high;
  renderer.clear();
  if (q.bloom) composer.render(dt); else renderer.render(scene, camera);
  if (G.net && G.alive) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }

  // fps counter
  fpsEl.frames++; fpsEl.t += dt;
  if (fpsEl.t >= 0.5) { $('fps').textContent = Math.round(fpsEl.frames / fpsEl.t) + ' fps'; fpsEl.frames = 0; fpsEl.t = 0; }
}
const W_RECOVER = [0.0005, 0.002, 0.0005, 0.003, 0.004];
requestAnimationFrame(frame);
window.fragweb = { G, camera }; // handy for debugging in the browser console
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ------------------------------------------------------------------ menus
$('name').value = settings.name || '';
$('quality').value = settings.quality;
$('quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); applyQuality(); };
$('sens').value = settings.sens; $('fov').value = settings.fov; $('vol').value = settings.vol;
$('sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); };
$('fov').oninput = (e) => { settings.fov = +e.target.value; camera.fov = settings.fov; camera.updateProjectionMatrix(); saveSettings(); };
$('vol').oninput = (e) => { settings.vol = +e.target.value; if (master) master.gain.value = settings.vol; saveSettings(); };
camera.fov = settings.fov; camera.updateProjectionMatrix();

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    $('tab-host').classList.toggle('hidden', tab.dataset.tab !== 'host');
    $('tab-join').classList.toggle('hidden', tab.dataset.tab !== 'join');
  };
}
const params = new URLSearchParams(location.search);
if (params.get('room')) {
  $('code').value = params.get('room').toUpperCase();
  document.querySelector('.tab[data-tab="join"]').click();
}

function playerName() {
  const n = $('name').value.trim() || 'Player' + Math.floor(Math.random() * 100);
  settings.name = $('name').value.trim(); saveSettings();
  return n;
}
function status(s) { $('status').textContent = s; }
function setBusy(b) { for (const id of ['btn-host', 'btn-practice', 'btn-join']) $(id).disabled = b; }

async function host(online) {
  audio();
  setBusy(true);
  status(online ? 'Creating room…' : 'Starting practice…');
  const opts = {
    mode: $('mode').value,
    bots: clampInt($('bots').value, 0, 10, 3),
    fragLimit: clampInt($('fraglimit').value, 5, 200, 25),
    timeLimit: clampInt($('timelimit').value, 1, 60, 10),
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
function clampInt(v, lo, hi, def) { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def; }

async function join() {
  audio();
  const code = $('code').value.trim().toUpperCase();
  if (code.length < 4) { status('Enter the room code shown on the host\'s screen.'); return; }
  setBusy(true);
  status('Connecting to room ' + code + '…');
  try {
    const net = await joinGame(code, onMsg, { onClose: () => { alert('Lost connection to the host.'); location.reload(); } });
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
  if (G.isHost && G.code) centerMsg(`Room code: ${G.code}<br><small>Friends open this page and enter the code</small>`, 7000);
}

$('btn-host').onclick = () => host(true);
$('btn-practice').onclick = () => host(false);
$('btn-join').onclick = join;
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('btn-resume').onclick = lockPointer;
$('btn-leave').onclick = () => {
  if (G.isHost && G.code && !confirm('You are the host — leaving ends the game for everyone. Leave?')) return;
  G.net.close();
  location.href = location.pathname;
};
$('btn-addbot').onclick = () => G.net.send({ t: 'addbot' });
$('btn-kickbot').onclick = () => G.net.send({ t: 'kickbot' });
addEventListener('beforeunload', (e) => { if (G.isHost && G.code) { e.preventDefault(); e.returnValue = ''; } });
