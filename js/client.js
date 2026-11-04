// Browser client: rendering, input, local movement prediction, HUD and sound.
import * as THREE from 'three';
import { TICK, PLAYER, WEAPONS, MAP, PICKUP_INFO, stepPlayer, rayWorld, dirFromAngles } from './game.js';
import { startHost, joinGame } from './net.js';

const $ = (id) => document.getElementById(id);
const TEAM_COLORS = [0xff4d4d, 0x3d9bff];
const FFA_COLORS = [0xff7a3d, 0x3dff8b, 0xd65cff, 0xffe14d, 0x3de0ff, 0xff4da6, 0x9cff3d, 0x8a8aff, 0xffb03d, 0x3dffd2, 0xff3d3d, 0xc8c8c8];

// ------------------------------------------------------------------ settings
const settings = { sens: 1, fov: 95, vol: 0.6, name: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('fragweb-settings') || '{}')); } catch { /* ignore */ }
function saveSettings() { try { localStorage.setItem('fragweb-settings', JSON.stringify(settings)); } catch { /* ignore */ } }

// ------------------------------------------------------------------ renderer / scene
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.Fog(0x0b1020, 40, 110);
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 300);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x2a1a10, 0.9));
const sun = new THREE.DirectionalLight(0xffe0c0, 1.6);
sun.position.set(25, 45, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 });
scene.add(sun);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ textures
function panelTexture(base, line, accent) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) { // grime
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 6, 2 + Math.random() * 6);
  }
  g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 125, 125);
  g.lineWidth = 1; g.strokeRect(10, 10, 108, 108);
  if (accent) { g.fillStyle = accent; g.fillRect(0, 60, 128, 4); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const MATS = {
  floor:  new THREE.MeshStandardMaterial({ map: panelTexture('#3a3f4a', '#23262e'), roughness: 0.85, metalness: 0.2 }),
  wall:   new THREE.MeshStandardMaterial({ map: panelTexture('#2c3448', '#1b2030', '#ff5a3640'), roughness: 0.9 }),
  tower:  new THREE.MeshStandardMaterial({ map: panelTexture('#4a3a35', '#2e2320'), roughness: 0.8 }),
  ledge:  new THREE.MeshStandardMaterial({ map: panelTexture('#505866', '#2e333c'), roughness: 0.6, metalness: 0.4 }),
  dais:   new THREE.MeshStandardMaterial({ map: panelTexture('#3d4d63', '#243042', '#36c9ff50'), roughness: 0.6, metalness: 0.3 }),
  step:   new THREE.MeshStandardMaterial({ map: panelTexture('#5c5a58', '#3a3836'), roughness: 0.8 }),
  block:  new THREE.MeshStandardMaterial({ map: panelTexture('#45505e', '#2b323b'), roughness: 0.8 }),
  pillar: new THREE.MeshStandardMaterial({ map: panelTexture('#5a4636', '#38291e', '#ffb03d40'), roughness: 0.7 }),
  crate:  new THREE.MeshStandardMaterial({ map: panelTexture('#6b5a3a', '#433620'), roughness: 0.9 }),
};

// Box geometry with UVs scaled to world size, so textures tile at 2m per panel.
function worldBox(sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / 2, uv.getY(i) * dims[f][1] / 2);
  }
  return g;
}

// ------------------------------------------------------------------ map
for (const b of MAP.boxes) {
  const s = [0, 1, 2].map(i => b.max[i] - b.min[i]);
  const m = new THREE.Mesh(worldBox(...s), MATS[b.k] || MATS.block);
  m.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  m.castShadow = b.k !== 'floor' && b.k !== 'wall';
  m.receiveShadow = true;
  scene.add(m);
  if (b.k === 'ledge' || b.k === 'dais' || b.k === 'tower') {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: b.k === 'tower' ? 0xff5a36 : 0x36c9ff }));
    edges.position.copy(m.position);
    scene.add(edges);
  }
}
// glowing strip lights on the walls
for (const z of [-31.9, 31.9]) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(50, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xff5a36 }));
  strip.position.set(0, 12, z); scene.add(strip);
}
for (const x of [-31.9, 31.9]) {
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 50), new THREE.MeshBasicMaterial({ color: 0x36c9ff }));
  strip.position.set(x, 12, 0); scene.add(strip);
}
// jump pads
const padMeshes = [];
for (const pad of MAP.pads) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(pad.r, pad.r, 0.08, 32), new THREE.MeshStandardMaterial({ color: 0x113344, emissive: 0x36c9ff, emissiveIntensity: 0.8 }));
  g.add(disc);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(pad.r * 0.8, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true }));
    ring.rotation.x = Math.PI / 2;
    ring.userData.phase = i / 3;
    g.add(ring);
  }
  g.position.set(pad.p[0], pad.p[1] + 0.04, pad.p[2]);
  scene.add(g);
  padMeshes.push(g);
}

// ------------------------------------------------------------------ pickups
function pickupMesh(t) {
  const info = PICKUP_INFO[t];
  const mat = new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.4 });
  const g = new THREE.Group();
  if (t === 'health') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.22), mat));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), mat));
  } else if (t === 'mega') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), mat));
  } else if (t === 'armor') {
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.5), mat));
  } else if (t === 'shard') {
    g.add(new THREE.Mesh(new THREE.TetrahedronGeometry(0.3), mat));
  } else if (t[0] === 'w') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 1.0), mat));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.35, 0.18), mat).translateY(-0.2).translateZ(0.25));
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat));
  }
  g.traverse(o => { o.castShadow = true; });
  return g;
}
const pickupMeshes = MAP.pickups.map(pk => {
  const m = pickupMesh(pk.t);
  m.position.set(pk.p[0], pk.p[1] + 0.8, pk.p[2]);
  scene.add(m);
  return m;
});

// ------------------------------------------------------------------ player models (original "frame" soldiers)
function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 128, 44);
  g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

function makeAvatar(color) {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.6, metalness: 0.5 });
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, emissive: color, emissiveIntensity: 0.15 });
  const glow = new THREE.MeshBasicMaterial({ color });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.38), paint); torso.position.y = 0.25;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.18), body); pack.position.set(0, 0.3, 0.27);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), body); head.position.y = 0.78;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), glow); visor.position.set(0, 0.8, -0.16);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), body); hips.position.y = -0.17;
  const legL = new THREE.Group(), legR = new THREE.Group();
  for (const [leg, x] of [[legL, -0.15], [legR, 0.15]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), paint); m.position.y = -0.31;
    leg.add(m); leg.position.set(x, -0.25, 0);
  }
  const arm = new THREE.Group();
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.7), body); gun.position.set(0, 0, -0.3);
  arm.add(gun); arm.position.set(0.36, 0.3, -0.1);
  for (const m of [torso, pack, head, visor, hips, gun]) m.castShadow = true;
  root.add(torso, pack, head, visor, hips, legL, legR, arm);
  root.userData = { legL, legR, arm, phase: 0 };
  return root;
}

// ------------------------------------------------------------------ first-person weapon
const viewModel = new THREE.Group();
camera.add(viewModel);
viewModel.position.set(0.28, -0.26, -0.45);
viewModel.scale.setScalar(0.75);
const vmMeshes = WEAPONS.map(W => {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x30343d, metalness: 0.7, roughness: 0.35 });
  const acc = new THREE.MeshStandardMaterial({ color: W.color, emissive: W.color, emissiveIntensity: 0.6 });
  const shapes = {
    0: [[0.08, 0.12, 0.34, 0, 0, 0, dark], [0.06, 0.04, 0.2, 0, 0.07, -0.02, acc], [0.06, 0.16, 0.08, 0, -0.12, 0.1, dark]],
    1: [[0.16, 0.14, 0.55, 0, 0, -0.05, dark], [0.07, 0.07, 0.6, -0.04, 0.03, -0.12, dark], [0.07, 0.07, 0.6, 0.04, 0.03, -0.12, dark], [0.17, 0.04, 0.3, 0, -0.08, 0.05, acc]],
    2: [[0.1, 0.14, 0.7, 0, 0, -0.1, dark], [0.04, 0.04, 0.5, 0, 0.09, -0.15, acc], [0.06, 0.2, 0.08, 0, -0.14, 0.05, dark]],
    3: [[0.2, 0.2, 0.7, 0, 0, -0.05, dark], [0.22, 0.05, 0.2, 0, 0.12, 0.1, acc], [0.12, 0.12, 0.12, 0, 0, -0.42, acc]],
    4: [[0.08, 0.12, 0.9, 0, 0, -0.18, dark], [0.03, 0.03, 0.85, 0, 0.08, -0.2, acc], [0.12, 0.06, 0.4, 0, -0.07, 0.02, acc]],
  }[W.id];
  for (const [sx, sy, sz, x, y, z, mat] of shapes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    g.add(m);
  }
  g.visible = false;
  viewModel.add(g);
  return g;
});
const muzzleFlash = new THREE.PointLight(0xffaa55, 0, 8);
muzzleFlash.position.set(0, 0, -0.8);
viewModel.add(muzzleFlash);

// ------------------------------------------------------------------ effects
const effects = [];
function addEffect(obj, life, update) { scene.add(obj); effects.push({ obj, life, age: 0, update }); }

function tracer(a, b, color, width = 1, life = 0.15) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (len < 0.1) return;
  const geom = new THREE.CylinderGeometry(0.012 * width, 0.012 * width, len, 6, 1, true);
  geom.translate(0, len / 2, 0);
  geom.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.set(...a);
  m.lookAt(b[0], b[1], b[2]);
  addEffect(m, life, (e, k) => { m.material.opacity = 0.9 * (1 - k); });
}
function spark(p, color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.set(...p);
  addEffect(m, 0.25, (e, k) => { m.scale.setScalar(1 + k * 2); m.material.opacity = 1 - k; });
}
function explosion(p) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false }));
  m.position.set(...p);
  const light = new THREE.PointLight(0xff8030, 30, 18);
  light.position.set(...p);
  scene.add(light);
  addEffect(m, 0.45, (e, k) => {
    m.scale.setScalar(0.5 + k * 4);
    m.material.opacity = 1 - k;
    m.material.color.setHSL(0.08 - k * 0.08, 1, 0.6 - k * 0.4);
    light.intensity = 30 * (1 - k);
    if (k >= 1) scene.remove(light);
  });
}
function gibs(p, color) {
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshStandardMaterial({ color }));
    m.position.set(p[0], p[1], p[2]);
    const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 8, (Math.random() - 0.5) * 8);
    addEffect(m, 1.4, (e, k, dt) => {
      v.y -= 20 * dt;
      m.position.addScaledVector(v, dt);
      if (m.position.y < 0.08) { m.position.y = 0.08; v.multiplyScalar(0.4); v.y = Math.abs(v.y); }
      m.rotation.x += dt * 8;
      m.scale.setScalar(1 - k * 0.8);
    });
  }
}

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
    case 'land': noise(0.08, 300, 1, 0.3); break;
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
  others: new Map(), // id -> {mesh, target:{p,yaw,pitch}, ...}
  roster: [], teams: [0, 0],
  rockets: new Map(),
  keys: {}, mouseDown: false, lastFire: -10, clock: 0, sendAcc: 0,
  playing: false, chatting: false, ended: false, lastKiller: null,
};

function rosterEntry(id) { return G.roster.find(r => r.id === id); }
function nameOf(id) { const r = rosterEntry(id); return r ? r.name : '???'; }
function colorOf(id, team) {
  if (G.mode === 'tdm') return TEAM_COLORS[team ?? rosterEntry(id)?.team ?? 0];
  return FFA_COLORS[id % FFA_COLORS.length];
}

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
  o.mesh = makeAvatar(col);
  o.name = r?.name;
  const tag = nameSprite(r ? r.name : '?', col);
  tag.position.y = 1.35;
  o.mesh.add(tag);
  scene.add(o.mesh);
}

function onSnap(m) {
  G.me = m.me;
  if (!m.me.alive && G.alive) { G.alive = false; }
  for (const [id, x, y, z, yaw, pitch, w, alive, team] of m.pl) {
    if (id === G.id) continue;
    let o = G.others.get(id);
    if (!o) {
      o = { mesh: null, cur: { p: [x, y, z], yaw }, target: { p: [x, y, z], yaw, pitch }, alive, team };
      G.others.set(id, o);
      rebuildAvatar(id, o);
    }
    if (o.team !== team) { o.team = team; rebuildAvatar(id, o); }
    if (!o.alive && alive) { o.cur.p = [x, y, z]; } // snap on respawn
    o.target = { p: [x, y, z], yaw, pitch };
    o.alive = alive; o.w = w;
    o.mesh.visible = !!alive;
  }
  // rockets
  const seen = new Set();
  for (const [id, x, y, z] of m.rk) {
    seen.add(id);
    let r = G.rockets.get(id);
    if (!r) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
      const light = new THREE.PointLight(0xff7030, 6, 7);
      mesh.add(light);
      scene.add(mesh);
      r = { mesh, prev: [x, y, z], p: [x, y, z], t: 0 };
      G.rockets.set(id, r);
      mesh.position.set(x, y, z);
    }
    r.prev = [r.mesh.position.x, r.mesh.position.y, r.mesh.position.z];
    r.p = [x, y, z];
    r.t = 0;
  }
  for (const [id, r] of G.rockets) if (!seen.has(id)) { scene.remove(r.mesh); G.rockets.delete(id); }
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
      G.yaw = m.yaw; G.pitch = 0; G.w = 0; G.alive = true;
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
      const o = G.others.get(m.owner);
      const from = o ? [o.cur.p[0], o.cur.p[1] + 0.3, o.cur.p[2]] : m.a;
      for (const b of m.b) { tracer(from, b, W.color, W.id === 4 ? 4 : 1, W.id === 4 ? 0.6 : 0.12); spark(b, W.color); }
      sfx('w' + m.w, m.a);
      break;
    }
    case 'boom': explosion(m.p); sfx('boom', m.p); break;
    case 'hit': flashHit(); sfx('hit'); break;
    case 'hurt': {
      const el = $('damage');
      el.style.opacity = Math.min(1, m.dmg / 60 + 0.2);
      setTimeout(() => { el.style.opacity = 0; }, 120);
      sfx('hurt');
      break;
    }
    case 'pick': {
      sfx('pick');
      const el = $('pickup-msg');
      el.textContent = m.label; el.style.opacity = 1;
      clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; }, 1400);
      const info = PICKUP_INFO[m.pk];
      if (info.weapon != null && G.w < info.weapon) G.w = info.weapon; // auto-switch to a better gun
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
  G.pitch = Math.max(-1.55, Math.min(1.55, G.pitch));
});
document.addEventListener('mousedown', (e) => { if (G.playing && e.button === 0) G.mouseDown = true; });
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
  if (n >= 1 && n <= WEAPONS.length && G.me.have[n - 1]) G.w = n - 1;
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
    if (G.me.have[w]) { G.w = w; return; }
  }
}

// ------------------------------------------------------------------ shooting
let recoil = 0;
function tryFire() {
  const W = WEAPONS[G.w];
  if (G.clock - G.lastFire < W.interval) return;
  if (W.ammo && (G.me.ammo[W.ammo] ?? 0) <= 0) {
    G.lastFire = G.clock; sfx('empty');
    // auto-switch to something that has ammo
    for (const w of [4, 3, 1, 2, 0]) if (G.me.have[w] && (!WEAPONS[w].ammo || G.me.ammo[WEAPONS[w].ammo] > 0)) { G.w = w; break; }
    return;
  }
  G.lastFire = G.clock;
  if (W.ammo) G.me.ammo[W.ammo]--; // predicted; the next snapshot corrects it
  const eye = [G.body.p[0], G.body.p[1] + PLAYER.eye, G.body.p[2]];
  const d = dirFromAngles(G.yaw, G.pitch);
  G.net.send({ t: 'fire', w: G.w, o: eye, d });
  sfx('w' + G.w);
  recoil = W.id === 4 ? 1 : W.id === 1 || W.id === 3 ? 0.7 : 0.25;
  muzzleFlash.intensity = 6;
  muzzleFlash.color.setHex(W.color);
  // local tracers (approximate — the host decides what actually hits)
  if (W.kind === 'hit') {
    const muzzle = new THREE.Vector3(0.28, -0.2, -0.9).applyMatrix4(camera.matrixWorld).toArray();
    for (let i = 0; i < W.pellets; i++) {
      const s = W.spread;
      let dd = [d[0] + (Math.random() - 0.5) * 2 * s, d[1] + (Math.random() - 0.5) * 2 * s, d[2] + (Math.random() - 0.5) * 2 * s];
      const l = Math.hypot(...dd); dd = dd.map(x => x / l);
      const t = rayWorld(eye, dd, 250);
      const end = [eye[0] + dd[0] * t, eye[1] + dd[1] * t, eye[2] + dd[2] * t];
      tracer(muzzle, end, W.color, W.id === 4 ? 4 : 1, W.id === 4 ? 0.6 : 0.1);
      spark(end, W.color);
    }
  }
  updateHUD();
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
let bob = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  G.clock += dt;

  if (G.net) {
    // local movement (client-side prediction; host trusts position on a LAN)
    if (G.alive) {
      const k = G.keys;
      const input = {
        fwd: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
        right: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0),
        jump: !!k.Space,
      };
      if (!G.playing) { input.fwd = input.right = 0; input.jump = false; }
      const wasGround = G.body.onGround;
      let rem = dt;
      while (rem > 0) {
        const sdt = Math.min(rem, 1 / 120);
        const jumpedFromGround = input.jump && G.body.onGround;
        const ev = stepPlayer(G.body, input, G.yaw, sdt);
        if (ev === 'pad') sfx('pad');
        else if (jumpedFromGround) sfx('jump');
        rem -= sdt;
      }
      if (!wasGround && G.body.onGround) sfx('land');
      if (G.mouseDown && G.playing) tryFire();
    }

    G.sendAcc += dt;
    if (G.sendAcc >= TICK) {
      G.sendAcc = 0;
      if (G.alive) G.net.send({ t: 'st', p: G.body.p.map(x => +x.toFixed(3)), v: G.body.v.map(x => +x.toFixed(2)), y: +G.yaw.toFixed(3), pi: +G.pitch.toFixed(3), w: G.w });
    }

    // camera
    const sp = Math.hypot(G.body.v[0], G.body.v[2]);
    if (G.alive) {
      if (G.body.onGround) bob += dt * sp * 1.4;
      camera.position.set(G.body.p[0], G.body.p[1] + PLAYER.eye + Math.sin(bob) * 0.04 * Math.min(1, sp / 9), G.body.p[2]);
      camera.rotation.set(G.pitch, G.yaw, 0, 'YXZ');
    } else {
      // death cam: drift up and look at the killer
      camera.position.y += (G.body.p[1] + 3 - camera.position.y) * dt * 2;
      const killer = G.others.get(G.lastKiller);
      if (killer && killer.alive) {
        const target = new THREE.Vector3(killer.cur.p[0], killer.cur.p[1] + 0.5, killer.cur.p[2]);
        const m = new THREE.Matrix4().lookAt(camera.position, target, camera.up);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        camera.quaternion.slerp(q, Math.min(1, dt * 3));
      }
    }
    viewModel.visible = G.alive;
    vmMeshes.forEach((m, i) => { m.visible = i === G.w; });
    recoil *= Math.pow(0.0005, dt);
    viewModel.position.set(0.28 + Math.cos(bob * 0.5) * 0.01, -0.26 + Math.abs(Math.sin(bob * 0.5)) * 0.012 + recoil * 0.03, -0.45 + recoil * 0.1);
    viewModel.rotation.x = recoil * 0.25;
    muzzleFlash.intensity *= Math.pow(0.0001, dt);

    // remote players: smooth toward latest snapshot
    for (const o of G.others.values()) {
      const a = Math.min(1, dt * 15);
      const prev = [...o.cur.p];
      for (let i = 0; i < 3; i++) o.cur.p[i] += (o.target.p[i] - o.cur.p[i]) * a;
      o.cur.yaw += angDiff(o.cur.yaw, o.target.yaw) * a;
      o.mesh.position.set(o.cur.p[0], o.cur.p[1], o.cur.p[2]);
      o.mesh.rotation.y = o.cur.yaw;
      const ud = o.mesh.userData;
      const moved = Math.hypot(o.cur.p[0] - prev[0], o.cur.p[2] - prev[2]) / Math.max(dt, 1e-4);
      ud.phase += dt * moved * 1.2;
      const swing = Math.sin(ud.phase) * Math.min(0.7, moved / 10);
      ud.legL.rotation.x = swing; ud.legR.rotation.x = -swing;
      ud.arm.rotation.x = o.target.pitch;
    }
    // rockets: interpolate between snapshots, leave a smoke trail
    for (const r of G.rockets.values()) {
      r.t = Math.min(1.5, r.t + dt * 15);
      const k = r.t;
      r.mesh.position.set(r.prev[0] + (r.p[0] - r.prev[0]) * k, r.prev[1] + (r.p[1] - r.prev[1]) * k, r.prev[2] + (r.p[2] - r.prev[2]) * k);
      if (Math.random() < 0.7) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.5, depthWrite: false }));
        s.position.copy(r.mesh.position);
        addEffect(s, 0.6, (e, kk) => { s.scale.setScalar(1 + kk * 3); s.material.opacity = 0.5 * (1 - kk); });
      }
    }
  } else {
    // menu backdrop: slow orbit around the arena
    const t = now / 1000 * 0.08;
    camera.position.set(Math.sin(t) * 38, 20, Math.cos(t) * 38);
    camera.lookAt(0, 2, 0);
    viewModel.visible = false;
  }

  // ambient animation
  const t = now / 1000;
  pickupMeshes.forEach((m, i) => { m.rotation.y = t * 1.6 + i; m.position.y = MAP.pickups[i].p[1] + 0.8 + Math.sin(t * 2 + i) * 0.12; });
  for (const g of padMeshes) for (const c of g.children) if (c.userData.phase != null) {
    const k = (t * 0.8 + c.userData.phase) % 1;
    c.position.y = k * 2.5; c.material.opacity = 1 - k; c.scale.setScalar(1 - k * 0.4);
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.age += dt;
    const k = Math.min(1, e.age / e.life);
    e.update(e, k, dt);
    if (k >= 1) {
      scene.remove(e.obj);
      e.obj.traverse?.(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
      effects.splice(i, 1);
    }
  }
  if (G.net && !G.alive) updateHUD();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ------------------------------------------------------------------ menus
$('name').value = settings.name || '';
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
