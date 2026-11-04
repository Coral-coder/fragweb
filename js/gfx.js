// Graphics: procedural textures, the arena, sky, player & weapon models, and pooled effects.
// Everything here is generated in code — no image or model files.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MAP, WEAPONS, PICKUP_INFO } from './game.js';

// ============================================================ procedural textures
const TEX = 512;

function canvas2d(size = TEX) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// Seeded random so textures look the same for every player.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Turns a greyscale height canvas into a normal map.
function heightToNormal(hc, strength = 2) {
  const n = hc.width;
  const src = hc.getContext('2d').getImageData(0, 0, n, n).data;
  const [oc, og] = canvas2d(n);
  const out = og.createImageData(n, n);
  const h = (x, y) => src[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
    const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * n + x) * 4;
    out.data[i] = (dx / l * 0.5 + 0.5) * 255;
    out.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
    out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  og.putImageData(out, 0, 0);
  return oc;
}

function toTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(g, r, n, size, color, alphaMax) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = color.replace('A', (r() * alphaMax).toFixed(3));
    const s = 1 + r() * size;
    g.fillRect(r() * TEX, r() * TEX, s, s);
  }
}

function rivet(cg, hg, x, y, r = 5) {
  const grad = cg.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  cg.fillStyle = grad; cg.beginPath(); cg.arc(x, y, r, 0, 7); cg.fill();
  const hgr = hg.createRadialGradient(x, y, 0, x, y, r);
  hgr.addColorStop(0, '#fff'); hgr.addColorStop(1, '#808080');
  hg.fillStyle = hgr; hg.beginPath(); hg.arc(x, y, r, 0, 7); hg.fill();
}

// Each painter draws colour (cg), height (hg) and optional emissive (eg) for one tile.
const PAINTERS = {
  floor(cg, hg, eg, r) {
    cg.fillStyle = '#3b4250'; cg.fillRect(0, 0, TEX, TEX);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, TEX, TEX);
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const x0 = tx * 256, y0 = ty * 256;
      const shade = 50 + Math.floor(r() * 14);
      cg.fillStyle = `rgb(${shade},${shade + 6},${shade + 16})`;
      cg.fillRect(x0 + 4, y0 + 4, 248, 248);
      if ((tx + ty) % 2 === 0) {
        // diamond tread plate
        for (let y = 12; y < 248; y += 16) for (let x = 12 + ((y / 16) % 2) * 8; x < 248; x += 16) {
          hg.save(); hg.translate(x0 + x, y0 + y); hg.rotate(Math.PI / 4);
          hg.fillStyle = '#b0b0b0'; hg.fillRect(-5, -1.5, 10, 3); hg.restore();
          cg.save(); cg.translate(x0 + x, y0 + y); cg.rotate(Math.PI / 4);
          cg.fillStyle = 'rgba(255,255,255,0.07)'; cg.fillRect(-5, -1.5, 10, 3); cg.restore();
        }
      } else {
        // smooth plate with inset panel
        hg.fillStyle = '#707070'; hg.fillRect(x0 + 30, y0 + 30, 196, 196);
        hg.fillStyle = '#808080'; hg.fillRect(x0 + 34, y0 + 34, 188, 188);
        cg.strokeStyle = 'rgba(0,0,0,0.35)'; cg.lineWidth = 3; cg.strokeRect(x0 + 31, y0 + 31, 194, 194);
      }
      // seams
      hg.fillStyle = '#202020'; hg.fillRect(x0, y0, 256, 4); hg.fillRect(x0, y0, 4, 256);
      cg.fillStyle = '#15181e'; cg.fillRect(x0, y0, 256, 4); cg.fillRect(x0, y0, 4, 256);
      for (const [dx, dy] of [[16, 16], [240, 16], [16, 240], [240, 240]]) rivet(cg, hg, x0 + dx, y0 + dy, 5);
    }
    noise(cg, r, 2500, 3, 'rgba(0,0,0,A)', 0.12);
    noise(cg, r, 600, 2, 'rgba(255,255,255,A)', 0.05);
    // scuffs
    for (let i = 0; i < 12; i++) {
      cg.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; cg.lineWidth = 1 + r() * 8;
      cg.beginPath(); const x = r() * TEX, y = r() * TEX; cg.moveTo(x, y); cg.lineTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 120); cg.stroke();
    }
  },
  wall(cg, hg, eg, r) {
    cg.fillStyle = '#2b3242'; cg.fillRect(0, 0, TEX, TEX);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, TEX, TEX);
    eg.fillStyle = '#000'; eg.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 4; i++) {
      const y = i * 128;
      const s = 38 + Math.floor(r() * 10);
      cg.fillStyle = `rgb(${s},${s + 6},${s + 20})`; cg.fillRect(0, y + 3, TEX, 122);
      hg.fillStyle = '#181818'; hg.fillRect(0, y, TEX, 3);
      cg.fillStyle = '#0d0f15'; cg.fillRect(0, y, TEX, 3);
      for (let x = 24; x < TEX; x += 64) { rivet(cg, hg, x, y + 12, 4); rivet(cg, hg, x, y + 116, 4); }
    }
    // vertical ribs
    for (const x of [0, 256]) {
      hg.fillStyle = '#c8c8c8'; hg.fillRect(x + 4, 0, 24, TEX);
      const gr = cg.createLinearGradient(x + 4, 0, x + 28, 0);
      gr.addColorStop(0, '#4a5468'); gr.addColorStop(0.5, '#5d687e'); gr.addColorStop(1, '#2c3344');
      cg.fillStyle = gr; cg.fillRect(x + 4, 0, 24, TEX);
    }
    // light panel
    cg.fillStyle = '#ff9a6a'; cg.fillRect(120, 300, 80, 10);
    eg.fillStyle = '#ff6a36'; eg.fillRect(120, 300, 80, 10);
    hg.fillStyle = '#606060'; hg.fillRect(116, 296, 88, 18);
    noise(cg, r, 2000, 3, 'rgba(0,0,0,A)', 0.15);
    // grime streaks
    for (let i = 0; i < 30; i++) {
      const x = r() * TEX, y = r() * TEX, h = 40 + r() * 160;
      const gr = cg.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, 'rgba(0,0,0,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      cg.fillStyle = gr; cg.fillRect(x, y, 2 + r() * 6, h);
    }
  },
  metal(cg, hg, eg, r) {
    cg.fillStyle = '#5a6272'; cg.fillRect(0, 0, TEX, TEX);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, TEX, TEX);
    // brushed lines
    for (let y = 0; y < TEX; y++) { cg.fillStyle = `rgba(255,255,255,${r() * 0.05})`; cg.fillRect(0, y, TEX, 1); }
    for (const [x0, y0, w, h] of [[0, 0, 256, 256], [256, 0, 256, 256], [0, 256, 512, 256]]) {
      hg.fillStyle = '#202020'; hg.fillRect(x0, y0, w, 3); hg.fillRect(x0, y0, 3, h);
      cg.fillStyle = '#20242c'; cg.fillRect(x0, y0, w, 3); cg.fillRect(x0, y0, 3, h);
      for (const [dx, dy] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) rivet(cg, hg, x0 + dx, y0 + dy, 5);
    }
    noise(cg, r, 1500, 3, 'rgba(0,0,0,A)', 0.15);
  },
  concrete(cg, hg, eg, r) {
    cg.fillStyle = '#5e5a56'; cg.fillRect(0, 0, TEX, TEX);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 200; i++) {
      const x = r() * TEX, y = r() * TEX, s = 10 + r() * 60;
      const gr = cg.createRadialGradient(x, y, 0, x, y, s);
      const v = r() < 0.5 ? '0,0,0' : '255,240,220';
      gr.addColorStop(0, `rgba(${v},${r() * 0.08})`); gr.addColorStop(1, `rgba(${v},0)`);
      cg.fillStyle = gr; cg.fillRect(x - s, y - s, s * 2, s * 2);
    }
    noise(cg, r, 6000, 2, 'rgba(0,0,0,A)', 0.2);
    noise(hg, r, 3000, 3, 'rgba(255,255,255,A)', 0.15);
    // formwork seams + tie holes
    for (const y of [0, 256]) { hg.fillStyle = '#404040'; hg.fillRect(0, y, TEX, 3); cg.fillStyle = 'rgba(0,0,0,0.4)'; cg.fillRect(0, y, TEX, 3); }
    for (const x of [64, 192, 320, 448]) for (const y of [64, 192, 320, 448]) {
      cg.fillStyle = 'rgba(0,0,0,0.45)'; cg.beginPath(); cg.arc(x, y, 5, 0, 7); cg.fill();
      hg.fillStyle = '#303030'; hg.beginPath(); hg.arc(x, y, 5, 0, 7); hg.fill();
    }
    // cracks
    for (let i = 0; i < 5; i++) {
      let x = r() * TEX, y = r() * TEX;
      cg.strokeStyle = 'rgba(0,0,0,0.35)'; hg.strokeStyle = '#505050'; cg.lineWidth = hg.lineWidth = 1.5;
      cg.beginPath(); hg.beginPath(); cg.moveTo(x, y); hg.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += r() * 30; cg.lineTo(x, y); hg.lineTo(x, y); }
      cg.stroke(); hg.stroke();
    }
  },
  crate(cg, hg, eg, r) {
    cg.fillStyle = '#7a5f30'; cg.fillRect(0, 0, TEX, TEX);
    hg.fillStyle = '#707070'; hg.fillRect(0, 0, TEX, TEX);
    // corrugation
    for (let x = 0; x < TEX; x += 24) {
      const gr = cg.createLinearGradient(x, 0, x + 24, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0.2)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.2)');
      cg.fillStyle = gr; cg.fillRect(x, 0, 24, TEX);
      const hgr = hg.createLinearGradient(x, 0, x + 24, 0);
      hgr.addColorStop(0, '#606060'); hgr.addColorStop(0.5, '#a0a0a0'); hgr.addColorStop(1, '#606060');
      hg.fillStyle = hgr; hg.fillRect(x, 0, 24, TEX);
    }
    // frame
    cg.fillStyle = '#4a3a1e'; hg.fillStyle = '#e0e0e0';
    for (const [x, y, w, h] of [[0, 0, TEX, 36], [0, TEX - 36, TEX, 36], [0, 0, 36, TEX], [TEX - 36, 0, 36, TEX]]) { cg.fillRect(x, y, w, h); hg.fillRect(x, y, w, h); }
    // hazard label & stencil
    cg.fillStyle = '#e8c547'; cg.fillRect(70, 200, 150, 50);
    cg.fillStyle = '#1a1a1a'; cg.font = 'bold 40px monospace'; cg.fillText('FW-' + Math.floor(r() * 90 + 10), 76, 240);
    cg.fillStyle = 'rgba(255,255,255,0.55)'; cg.font = 'bold 54px monospace'; cg.fillText('▲ 0' + Math.floor(r() * 9), 280, 420);
    noise(cg, r, 2500, 3, 'rgba(0,0,0,A)', 0.2);
    for (const [x, y] of [[18, 18], [494, 18], [18, 494], [494, 494]]) rivet(cg, hg, x, y, 7);
  },
  trim(cg, hg, eg, r) {
    // yellow/black hazard stripes
    cg.fillStyle = '#d9a90f'; cg.fillRect(0, 0, TEX, TEX);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, TEX, TEX);
    cg.fillStyle = '#16161a';
    for (let i = -TEX; i < TEX * 2; i += 128) {
      cg.beginPath(); cg.moveTo(i, 0); cg.lineTo(i + 64, 0); cg.lineTo(i + 64 + TEX, TEX); cg.lineTo(i + TEX, TEX); cg.fill();
    }
    noise(cg, r, 3000, 3, 'rgba(0,0,0,A)', 0.3);
    noise(cg, r, 400, 4, 'rgba(120,120,120,A)', 0.5); // chipped paint
  },
};

const texCache = {};
function textureSet(kind, seed = 7) {
  if (texCache[kind]) return texCache[kind];
  const [cc, cg] = canvas2d();
  const [hc, hg] = canvas2d();
  const [ec, eg] = canvas2d();
  eg.fillStyle = '#000'; eg.fillRect(0, 0, TEX, TEX);
  PAINTERS[kind](cg, hg, eg, rng(seed + kind.length * 101));
  const set = { map: toTex(cc), normalMap: toTex(heightToNormal(hc, kind === 'concrete' ? 3 : 4), false), emissiveMap: toTex(ec) };
  texCache[kind] = set;
  return set;
}

export function makeMaterials() {
  const std = (kind, o = {}) => {
    const t = textureSet(kind);
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.75, metalness: 0.3, ...o });
    m.normalScale.set(1, 1);
    return m;
  };
  return {
    floor: std('floor', { roughness: 0.6, metalness: 0.55 }),
    wall: std('wall', { emissiveMap: textureSet('wall').emissiveMap, emissive: 0xffffff, emissiveIntensity: 2, roughness: 0.7, metalness: 0.45 }),
    tower: std('concrete', { color: 0xd8b8a8, roughness: 0.9, metalness: 0.05 }),
    ledge: std('metal', { roughness: 0.45, metalness: 0.7 }),
    dais: std('metal', { color: 0x9fb8d8, roughness: 0.4, metalness: 0.75 }),
    step: std('concrete', { roughness: 0.92, metalness: 0.05 }),
    block: std('concrete', { color: 0xb0c0d0, roughness: 0.88, metalness: 0.05 }),
    pillar: std('concrete', { color: 0xe0c0a0, roughness: 0.88, metalness: 0.05 }),
    crate: std('crate', { roughness: 0.7, metalness: 0.4 }),
    trim: std('trim', { roughness: 0.55, metalness: 0.3 }),
    cap: new THREE.MeshStandardMaterial({ color: 0x8a94a8, roughness: 0.3, metalness: 0.9 }),
    glowOrange: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a36).multiplyScalar(3) }),
    glowBlue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x36c9ff).multiplyScalar(3) }),
  };
}

// ============================================================ geometry helpers
// Box geometry with UVs scaled to world size (texture tiles every `tile` metres).
function worldBox(sx, sy, sz, tile = 4) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return g;
}
function placed(geo, x, y, z) { geo.translate(x, y, z); return geo; }

// ============================================================ arena
export function buildArena(scene, mats, quality) {
  const groups = {};
  const add = (k, geo) => { (groups[k] ||= []).push(geo); };

  for (const b of MAP.boxes) {
    const s = [0, 1, 2].map(i => b.max[i] - b.min[i]);
    const c = [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2);
    const tile = b.k === 'crate' ? Math.max(s[0], s[1], s[2]) : b.k === 'wall' ? 8 : 4;
    add(b.k, placed(worldBox(s[0], s[1], s[2], tile), ...c));

    // decorative trims: metal caps along top edges, hazard stripes on step fronts, glow strips
    const top = b.max[1];
    if (['ledge', 'dais', 'tower', 'block', 'pillar'].includes(b.k)) {
      const t = 0.14;
      add('cap', placed(new THREE.BoxGeometry(s[0] + 0.08, t, t), c[0], top - t / 2 + 0.02, b.min[2]));
      add('cap', placed(new THREE.BoxGeometry(s[0] + 0.08, t, t), c[0], top - t / 2 + 0.02, b.max[2]));
      add('cap', placed(new THREE.BoxGeometry(t, t, s[2] + 0.08), b.min[0], top - t / 2 + 0.02, c[2]));
      add('cap', placed(new THREE.BoxGeometry(t, t, s[2] + 0.08), b.max[0], top - t / 2 + 0.02, c[2]));
    }
    if (b.k === 'step' && s[1] > 0.3) {
      add('trim', placed(worldBox(s[0] + 0.01, 0.08, s[2] + 0.01, 1), c[0], top - 0.035, c[2]));
    }
    if (b.k === 'dais') {
      for (const z of [b.min[2] - 0.02, b.max[2] + 0.02]) add('glowBlue', placed(new THREE.BoxGeometry(s[0] - 6, 0.08, 0.04), c[0], 1.2, z));
      for (const x of [b.min[0] - 0.02, b.max[0] + 0.02]) add('glowBlue', placed(new THREE.BoxGeometry(0.04, 0.08, s[2]), x, 1.2, c[2]));
    }
    if (b.k === 'tower') {
      const inX = c[0] > 0 ? b.min[0] - 0.02 : b.max[0] + 0.02;
      const inZ = c[2] > 0 ? b.min[2] - 0.02 : b.max[2] + 0.02;
      for (const y of [2, 4.5]) {
        add('glowOrange', placed(new THREE.BoxGeometry(0.04, 0.1, s[2] - 1), inX, y, c[2]));
        add('glowOrange', placed(new THREE.BoxGeometry(s[0] - 1, 0.1, 0.04), c[0], y, inZ));
      }
    }
    if (b.k === 'ledge') {
      const z = c[2] > 0 ? b.min[2] - 0.02 : b.max[2] + 0.02;
      add('glowBlue', placed(new THREE.BoxGeometry(s[0] - 1, 0.06, 0.04), c[0], b.min[1] + 0.15, z));
    }
  }

  // wall buttresses with vertical light strips (visual only)
  const S = 32;
  for (let i = -24; i <= 24; i += 8) {
    for (const z of [-S, S]) {
      const zz = z < 0 ? z + 0.4 : z - 0.4;
      add('ledge', placed(worldBox(1.2, 22, 0.8), i, 11, zz));
      add(i % 16 === 0 ? 'glowOrange' : 'glowBlue', placed(new THREE.BoxGeometry(0.12, 9, 0.05), i, 14, z < 0 ? zz + 0.42 : zz - 0.42));
    }
    for (const x of [-S, S]) {
      const xx = x < 0 ? x + 0.4 : x - 0.4;
      add('ledge', placed(worldBox(0.8, 22, 1.2), xx, 11, i));
      add(i % 16 === 0 ? 'glowBlue' : 'glowOrange', placed(new THREE.BoxGeometry(0.05, 9, 0.12), x < 0 ? xx + 0.42 : xx - 0.42, 14, i));
    }
  }
  // top rim of the arena walls
  for (const z of [-S, S]) add('cap', placed(new THREE.BoxGeometry(2 * S + 2, 0.5, 1.6), 0, 22, z));
  for (const x of [-S, S]) add('cap', placed(new THREE.BoxGeometry(1.6, 0.5, 2 * S + 2), x, 22, 0));
  // horizontal light bands
  for (const z of [-S + 0.02, S - 0.02]) add('glowOrange', placed(new THREE.BoxGeometry(2 * S - 4, 0.12, 0.04), 0, 12, z));
  for (const x of [-S + 0.02, S - 0.02]) add('glowBlue', placed(new THREE.BoxGeometry(0.04, 0.12, 2 * S - 4), x, 12, 0));

  // merge per material: a handful of draw calls instead of hundreds
  for (const [k, geos] of Object.entries(groups)) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mats[k] || mats.block);
    const isGlow = k.startsWith('glow');
    mesh.castShadow = !isGlow && k !== 'floor' && k !== 'wall';
    mesh.receiveShadow = !isGlow;
    scene.add(mesh);
    geos.forEach(g => g.dispose());
  }

  // jump pads: housing, glowing disc, hazard ring, rising rings
  const padMeshes = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fe8ff).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const pad of MAP.pads) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(pad.r + 0.35, pad.r + 0.45, 0.16, 40), mats.cap);
    housing.receiveShadow = true;
    const hazard = new THREE.Mesh(new THREE.RingGeometry(pad.r + 0.45, pad.r + 1.0, 40), mats.trim);
    hazard.rotation.x = -Math.PI / 2; hazard.position.y = -0.07;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(pad.r, pad.r, 0.18, 40), new THREE.MeshStandardMaterial({ color: 0x0a2030, emissive: 0x36c9ff, emissiveIntensity: 1.6, metalness: 0.5, roughness: 0.3 }));
    g.add(housing, hazard, disc);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(pad.r * 0.85, 0.035, 6, 40), ringMat.clone());
      ring.rotation.x = Math.PI / 2;
      ring.userData.phase = i / 3;
      g.add(ring);
    }
    g.position.set(pad.p[0], pad.p[1] + 0.08, pad.p[2]);
    scene.add(g);
    padMeshes.push(g);
  }
  return { padMeshes };
}

// ============================================================ sky & skyline
export function buildSky(scene) {
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float time;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float h = vDir.y;
        vec3 col = mix(vec3(0.10,0.06,0.10), vec3(0.02,0.03,0.08), smoothstep(-0.05,0.5,h));
        col += vec3(0.55,0.22,0.10) * pow(max(0.,1.-abs(h)*3.5),3.) * 0.6; // horizon glow
        float n = noise(vDir*3.0+vec3(time*0.01,0,0))*0.6 + noise(vDir*7.0)*0.4;
        col += vec3(0.25,0.08,0.35) * smoothstep(0.45,0.9,n) * smoothstep(0.0,0.4,h) * 0.6; // nebula
        float s = hash(floor(vDir*300.));
        col += vec3(1.) * step(0.9975, s) * smoothstep(0.05,0.3,h);
        // planet
        vec3 pd = normalize(vec3(-0.5,0.35,-0.8));
        float d = distance(vDir, pd);
        col = mix(col, vec3(0.9,0.55,0.4)*(0.6+0.4*noise(vDir*20.)), smoothstep(0.125,0.12,d));
        col += vec3(1.0,0.5,0.3)*0.25*smoothstep(0.25,0.12,d);
        gl_FragColor = vec4(col,1.);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  // distant industrial spires (silhouettes with lit windows)
  const geos = [];
  const winGeos = [];
  const r = rng(99);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + r() * 0.1;
    const d = 90 + r() * 120;
    const w = 6 + r() * 14, h = 30 + r() * 90;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    geos.push(placed(new THREE.BoxGeometry(w, h, w), x, h / 2 - 5, z));
    if (r() < 0.5) geos.push(placed(new THREE.CylinderGeometry(0.3, 0.3, 20, 4), x, h + 5, z));
    for (let k = 0; k < 6; k++) {
      winGeos.push(placed(new THREE.BoxGeometry(w + 0.2, 0.6, w + 0.2), x, 8 + r() * (h - 10), z));
    }
  }
  const city = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 1 }));
  const lights = new THREE.Mesh(mergeGeometries(winGeos), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a50).multiplyScalar(1.5) }));
  scene.add(city, lights);
  return sky;
}

// ============================================================ shared model materials
const M = {
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.85, roughness: 0.32 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.95, roughness: 0.22 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x1c1f25, metalness: 0.1, roughness: 0.7 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0, roughness: 0.95 }),
  armorDark: new THREE.MeshStandardMaterial({ color: 0x2a2e36, metalness: 0.7, roughness: 0.4 }),
  joint: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.4, roughness: 0.6 }),
};
const glowCache = new Map();
export function glowMat(color, power = 2.5) {
  const key = color + ':' + power;
  if (!glowCache.has(key)) glowCache.set(key, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), toneMapped: false }));
  return glowCache.get(key);
}

function rbox(w, h, d, r = 0.02, mat = M.gunmetal) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), mat);
}
function cyl(rt, rb, h, mat, seg = 16, axis = 'z') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  return m;
}
// Extrude a 2D side profile (y up, z forward = -x in shape space) into a bevelled solid.
function profile(points, width, mat, bevel = 0.008) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2); // shape x -> +z, so negative profile x points forward (-z)
  return new THREE.Mesh(geo, mat);
}
function at(m, x, y, z) { m.position.set(x, y, z); return m; }
const plateCache = new Map();
function plateMat(color) {
  if (!plateCache.has(color)) {
    const c = new THREE.Color(color).lerp(new THREE.Color(0x9aa3b0), 0.55);
    plateCache.set(color, new THREE.MeshStandardMaterial({ color: c, metalness: 0.6, roughness: 0.35 }));
  }
  return plateCache.get(color);
}
// painted armour plates on both sides of a gun body, with a glowing accent line
function sidePlates(g, accent, len, h, z, y, halfW) {
  for (const side of [-1, 1]) {
    g.add(at(rbox(0.008, h, len, 0.003, plateMat(accent)), side * (halfW + 0.006), y, z));
    g.add(at(rbox(0.004, 0.006, len * 0.8, 0.002, glowMat(accent, 3)), side * (halfW + 0.011), y - h * 0.25, z));
  }
}

// ============================================================ weapons (first-person + third-person)
// Each builder returns { group, muzzle: Vector3, parts: {...} } in metres, pointing down -z.
const WEAPON_BUILDERS = [
  // 0 — Sidearm: compact energy pistol
  (accent) => {
    const g = new THREE.Group();
    g.add(profile([[0.12, 0.02], [-0.16, 0.02], [-0.17, 0.05], [-0.16, 0.075], [0.1, 0.075], [0.13, 0.05]], 0.042, M.gunmetal));
    g.add(profile([[0.1, 0.02], [0.02, 0.02], [0.0, -0.11], [0.065, -0.12], [0.11, -0.02]], 0.038, M.polymer, 0.006));
    g.add(profile([[0.03, 0.0], [-0.04, 0.0], [-0.04, -0.03], [0.0, -0.04], [0.03, -0.03]], 0.012, M.gunmetal, 0.003)); // trigger guard
    g.add(at(rbox(0.046, 0.012, 0.18, 0.004, glowMat(accent, 3)), 0, 0.06, -0.02));
    g.add(at(cyl(0.012, 0.012, 0.04, M.steel), 0, 0.045, -0.18));
    g.add(at(rbox(0.012, 0.02, 0.012, 0.003, glowMat(accent, 4)), 0, 0.085, 0.09)); // rear sight
    sidePlates(g, accent, 0.16, 0.03, -0.02, 0.05, 0.021);
    return { group: g, muzzle: new THREE.Vector3(0, 0.045, -0.21) };
  },
  // 1 — Scattergun: heavy twin-barrel breacher
  (accent) => {
    const g = new THREE.Group();
    g.add(profile([[0.18, -0.02], [-0.18, -0.02], [-0.2, 0.05], [-0.18, 0.08], [0.16, 0.08], [0.2, 0.04]], 0.09, M.gunmetal));
    g.add(profile([[0.2, 0.03], [0.4, 0.0], [0.42, -0.08], [0.32, -0.08], [0.2, -0.03]], 0.06, M.polymer)); // stock
    g.add(profile([[0.12, -0.02], [0.05, -0.02], [0.03, -0.14], [0.09, -0.15], [0.13, -0.04]], 0.05, M.polymer, 0.006)); // grip
    for (const x of [-0.024, 0.024]) {
      g.add(at(cyl(0.022, 0.022, 0.42, M.steel), x, 0.02, -0.38));
      g.add(at(cyl(0.026, 0.026, 0.03, M.gunmetal), x, 0.02, -0.58));
    }
    g.add(at(rbox(0.1, 0.06, 0.16, 0.015, M.rubber), 0, -0.035, -0.32)); // pump
    for (let i = 0; i < 4; i++) g.add(at(rbox(0.012, 0.02, 0.03, 0.003, glowMat(accent, 3)), 0.047, 0.05, -0.1 + i * 0.045));
    sidePlates(g, accent, 0.26, 0.05, 0.0, 0.025, 0.045);
    return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.6) };
  },
  // 2 — Pulse Rifle: rotary triple-emitter with energy cell
  (accent) => {
    const g = new THREE.Group();
    g.add(profile([[0.22, -0.03], [-0.22, -0.03], [-0.25, 0.02], [-0.22, 0.07], [0.2, 0.07], [0.24, 0.03]], 0.07, M.gunmetal));
    g.add(profile([[0.24, 0.03], [0.42, 0.02], [0.44, -0.06], [0.24, -0.04]], 0.05, M.polymer));
    g.add(profile([[0.14, -0.03], [0.07, -0.03], [0.05, -0.15], [0.11, -0.16], [0.15, -0.05]], 0.045, M.polymer, 0.006));
    const spin = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      spin.add(at(cyl(0.011, 0.011, 0.36, M.steel, 10), Math.cos(a) * 0.022, Math.sin(a) * 0.022, 0));
    }
    spin.add(at(cyl(0.04, 0.04, 0.02, M.gunmetal, 16), 0, 0, -0.16));
    spin.add(at(cyl(0.04, 0.04, 0.02, M.gunmetal, 16), 0, 0, 0.1));
    spin.position.set(0, 0.02, -0.38);
    g.add(spin);
    g.add(at(cyl(0.022, 0.022, 0.16, glowMat(accent, 2.5), 12), 0.05, 0.0, -0.05)); // energy cell
    g.add(at(rbox(0.03, 0.02, 0.2, 0.004, M.polymer), 0, 0.085, -0.05)); // top rail
    g.add(at(rbox(0.03, 0.035, 0.05, 0.006, M.gunmetal), 0, 0.11, -0.02));
    g.add(at(rbox(0.02, 0.012, 0.004, 0.002, glowMat(0xff3b3b, 4)), 0, 0.115, -0.045));
    sidePlates(g, accent, 0.3, 0.05, 0.0, 0.02, 0.035);
    return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.58), parts: { spin } };
  },
  // 3 — Rocket Launcher: shoulder tube with ammo window
  (accent) => {
    const g = new THREE.Group();
    g.add(at(cyl(0.075, 0.075, 0.8, M.gunmetal, 24), 0, 0.03, -0.2));
    g.add(at(cyl(0.088, 0.088, 0.06, M.armorDark, 24), 0, 0.03, -0.6));
    g.add(at(cyl(0.083, 0.07, 0.08, M.armorDark, 24), 0, 0.03, 0.22));
    for (const z of [-0.45, -0.15, 0.08]) g.add(at(cyl(0.08, 0.08, 0.025, M.steel, 24), 0, 0.03, z));
    g.add(at(rbox(0.02, 0.05, 0.22, 0.008, glowMat(accent, 2.5)), 0.074, 0.03, -0.2)); // ammo window
    g.add(profile([[0.04, -0.04], [-0.03, -0.04], [-0.05, -0.17], [0.01, -0.18], [0.05, -0.06]], 0.05, M.polymer, 0.006));
    g.add(profile([[-0.3, -0.04], [-0.36, -0.04], [-0.37, -0.14], [-0.32, -0.15], [-0.29, -0.06]], 0.045, M.polymer, 0.006));
    g.add(at(rbox(0.05, 0.06, 0.12, 0.01, M.armorDark), -0.08, 0.1, -0.1)); // sight
    g.add(at(rbox(0.035, 0.035, 0.005, 0.003, glowMat(0xff4030, 3)), -0.08, 0.1, -0.162));
    return { group: g, muzzle: new THREE.Vector3(0, 0.03, -0.64) };
  },
  // 4 — Rail Lance: twin rails with charging coils and scope
  (accent) => {
    const g = new THREE.Group();
    g.add(profile([[0.2, -0.03], [-0.12, -0.03], [-0.14, 0.04], [0.18, 0.05], [0.22, 0.01]], 0.07, M.gunmetal));
    g.add(profile([[0.22, 0.02], [0.42, 0.03], [0.45, -0.07], [0.36, -0.08], [0.22, -0.03]], 0.05, M.polymer));
    g.add(profile([[0.12, -0.03], [0.05, -0.03], [0.03, -0.15], [0.09, -0.16], [0.13, -0.05]], 0.045, M.polymer, 0.006));
    for (const x of [-0.028, 0.028]) g.add(at(rbox(0.016, 0.05, 0.62, 0.005, M.steel), x, 0.01, -0.42));
    const coils = [];
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 8, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(3), toneMapped: false }));
      c.position.set(0, 0.01, -0.2 - i * 0.1);
      coils.push(c); g.add(c);
    }
    g.add(at(cyl(0.008, 0.008, 0.62, glowMat(accent, 4), 8), 0, 0.01, -0.42)); // core
    g.add(at(cyl(0.025, 0.025, 0.22, M.armorDark, 16), 0, 0.11, -0.02)); // scope
    g.add(at(cyl(0.028, 0.028, 0.012, glowMat(accent, 3), 16), 0, 0.11, -0.13));
    g.add(at(rbox(0.02, 0.05, 0.03, 0.004, M.gunmetal), 0, 0.075, -0.02));
    sidePlates(g, accent, 0.24, 0.04, 0.03, 0.01, 0.035);
    return { group: g, muzzle: new THREE.Vector3(0, 0.01, -0.74), parts: { coils } };
  },
];

export function buildWeapon(id) {
  const w = WEAPON_BUILDERS[id](WEAPONS[id].color);
  w.group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return w;
}

// ============================================================ player model (original "Vanguard" frame)
export function buildAvatar(color) {
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.38 });
  const glow = glowMat(color, 3);
  const root = new THREE.Group();

  // hips & legs (pivot at hips)
  const hips = new THREE.Group(); hips.position.y = -0.05; root.add(hips);
  hips.add(at(rbox(0.42, 0.16, 0.26, 0.05, M.armorDark), 0, 0, 0));
  const legs = [];
  for (const side of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(side * 0.13, -0.06, 0); hips.add(thigh);
    thigh.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), M.joint), 0, -0.19, 0));
    thigh.add(at(rbox(0.16, 0.24, 0.17, 0.04, paint), 0, -0.16, -0.02));
    const shin = new THREE.Group(); shin.position.y = -0.4; thigh.add(shin);
    shin.add(at(rbox(0.11, 0.14, 0.14, 0.04, M.armorDark), 0, 0, -0.04)); // knee
    shin.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 10), M.joint), 0, -0.18, 0));
    shin.add(at(rbox(0.13, 0.24, 0.12, 0.035, paint), 0, -0.17, -0.03));
    shin.add(at(rbox(0.15, 0.09, 0.27, 0.035, M.armorDark), 0, -0.38, -0.04)); // boot
    legs.push({ thigh, shin });
  }

  // torso (pivots for aim pitch)
  const torso = new THREE.Group(); torso.position.y = 0.05; root.add(torso);
  torso.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.12, 4, 12), M.joint), 0, 0.08, 0)); // abdomen
  torso.add(at(rbox(0.5, 0.36, 0.3, 0.07, paint), 0, 0.36, -0.01)); // chest
  torso.add(at(rbox(0.3, 0.16, 0.06, 0.03, M.armorDark), 0, 0.35, -0.16)); // chest plate
  torso.add(at(rbox(0.16, 0.025, 0.02, 0.008, glow), 0, 0.4, -0.195)); // chest light
  const pack = at(rbox(0.38, 0.4, 0.16, 0.05, M.armorDark), 0, 0.35, 0.21); torso.add(pack);
  for (const x of [-0.1, 0.1]) torso.add(at(cyl(0.035, 0.035, 0.06, glow, 10), x, 0.24, 0.3)); // thrusters
  for (const side of [-1, 1]) torso.add(at(rbox(0.2, 0.12, 0.26, 0.05, paint), side * 0.32, 0.5, 0)); // shoulder pads

  const head = new THREE.Group(); head.position.y = 0.62; torso.add(head);
  head.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 10), M.joint), 0, -0.05, 0)); // neck
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), paint); helm.scale.set(1, 1.08, 1.12); helm.position.y = 0.08;
  head.add(helm);
  head.add(at(rbox(0.04, 0.08, 0.22, 0.015, M.armorDark), 0, 0.2, 0.02)); // crest
  const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.06, 20, 1, true, -1.1, 2.2), glow);
  visor.rotation.y = Math.PI; visor.position.set(0, 0.09, 0); visor.scale.set(1, 1, 1.12);
  head.add(visor);

  // arms holding the weapon
  const arms = new THREE.Group(); arms.position.set(0, 0.42, 0); torso.add(arms);
  for (const side of [-1, 1]) {
    const upper = new THREE.Group(); upper.position.set(side * 0.32, 0.02, 0); arms.add(upper);
    upper.rotation.x = 0.55; upper.rotation.z = side * 0.12;
    upper.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 10), M.joint), 0, -0.15, 0));
    const fore = new THREE.Group(); fore.position.y = -0.3; fore.rotation.x = 1.0; fore.rotation.z = side * -0.35; upper.add(fore);
    fore.add(at(rbox(0.11, 0.24, 0.11, 0.03, paint), 0, -0.12, 0));
    fore.add(at(rbox(0.09, 0.08, 0.1, 0.025, M.armorDark), 0, -0.27, 0)); // hand
  }
  const gunMount = new THREE.Group(); gunMount.position.set(0.1, -0.12, -0.42); arms.add(gunMount);

  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.userData = { legs, torso, head, arms, gunMount, gunId: -1, phase: 0 };
  return root;
}

export function setAvatarWeapon(avatar, id) {
  const ud = avatar.userData;
  if (ud.gunId === id) return;
  ud.gunMount.clear();
  const w = buildWeapon(id);
  w.group.scale.setScalar(1.25);
  ud.gunMount.add(w.group);
  ud.gunId = id;
}

// Animate run cycle and aim. speed in m/s, airborne flag, pitch in radians.
export function animateAvatar(avatar, dt, speed, airborne, pitch) {
  const ud = avatar.userData;
  ud.phase += dt * Math.min(speed, 14) * 0.9;
  const amt = Math.min(1, speed / 8);
  const s = Math.sin(ud.phase);
  ud.legs.forEach(({ thigh, shin }, i) => {
    const ph = i === 0 ? s : -s;
    if (airborne) {
      thigh.rotation.x += ((i ? -0.5 : 0.3) - thigh.rotation.x) * Math.min(1, dt * 10);
      shin.rotation.x += (0.9 - shin.rotation.x) * Math.min(1, dt * 10);
    } else {
      thigh.rotation.x = ph * 0.8 * amt;
      shin.rotation.x = Math.max(0, -Math.cos(ud.phase + (i ? Math.PI : 0))) * 1.1 * amt;
    }
  });
  ud.torso.position.y = 0.05 + Math.abs(Math.cos(ud.phase)) * 0.04 * amt;
  ud.torso.rotation.x = pitch * 0.35;
  ud.head.rotation.x = pitch * 0.4;
  ud.arms.rotation.x = pitch * 0.45;
}

// ============================================================ pickups
export function buildPickup(t) {
  const info = PICKUP_INFO[t];
  const col = info.color;
  const g = new THREE.Group();
  const item = new THREE.Group(); g.add(item);
  const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, metalness: 0.5, roughness: 0.3 });
  if (t === 'health') {
    item.add(at(cyl(0.2, 0.2, 0.45, new THREE.MeshStandardMaterial({ color: 0xe8eef5, metalness: 0.3, roughness: 0.3 }), 20, 'y'), 0, 0, 0));
    item.add(at(cyl(0.21, 0.21, 0.05, M.gunmetal, 20, 'y'), 0, 0.2, 0));
    item.add(at(cyl(0.21, 0.21, 0.05, M.gunmetal, 20, 'y'), 0, -0.2, 0));
    for (const r of [0, Math.PI / 2]) {
      const a = rbox(0.24, 0.07, 0.07, 0.01, glowMat(col, 2)); a.rotation.y = r; a.position.y = 0.0; item.add(a);
    }
    const v = rbox(0.07, 0.24, 0.42, 0.01, glowMat(col, 2)); item.add(v);
  } else if (t === 'mega') {
    item.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 2), glowMat(col, 2)));
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 8, 40), M.steel);
      ring.rotation.set(i ? 1.1 : -0.6, i * 0.8, 0);
      item.add(ring);
    }
  } else if (t === 'armor') {
    item.add(at(rbox(0.6, 0.52, 0.22, 0.08, mat), 0, 0, 0));
    item.add(at(rbox(0.3, 0.2, 0.06, 0.02, M.armorDark), 0, 0.02, -0.12));
    for (const x of [-0.36, 0.36]) item.add(at(rbox(0.18, 0.12, 0.26, 0.04, mat), x, 0.2, 0));
  } else if (t === 'shard') {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), mat); c.scale.y = 1.8; item.add(c);
  } else if (t[0] === 'w') {
    const w = buildWeapon(+t[1]);
    w.group.scale.setScalar(1.6);
    w.group.rotation.y = Math.PI / 2;
    item.add(w.group);
  } else {
    item.add(at(rbox(0.42, 0.3, 0.32, 0.03, M.armorDark), 0, 0, 0));
    item.add(at(rbox(0.43, 0.06, 0.33, 0.01, glowMat(col, 2.5)), 0, 0.04, 0));
  }
  // base pad
  const base = at(cyl(0.55, 0.62, 0.08, M.gunmetal, 24, 'y'), 0, -0.76, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 32), glowMat(col, 2));
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.71;
  g.add(base, ring);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.item = item;
  g.userData.base = [base, ring];
  return g;
}

// ============================================================ name tags
export function nameSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 32px Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(text, 128, 44);
  g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillText(text, 128, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, toneMapped: false }));
  s.scale.set(1.5, 0.375, 1);
  return s;
}

// ============================================================ particles (pooled, one draw call per blend mode)
export class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.s0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float alpha; attribute float size; varying vec3 vCol; varying float vA; uniform float scale;
        void main(){ vCol = color; vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*scale/-mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main(){ vec2 d = gl_PointCoord-0.5; float r = length(d)*2.; if(r>1.) discard; float f = pow(1.-r, ${additive ? '1.6' : '1.0'});
          gl_FragColor = vec4(vCol, vA*f); }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }
  emit(p, v, color, size, life, { alpha = 1, grow = 0, grav = 0, drag = 0 } = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set(p, i * 3); this.vel.set(v, i * 3);
    const c = new THREE.Color(color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.a0[i] = alpha; this.s0[i] = size; this.life[i] = life; this.age[i] = 0;
    this.grow[i] = grow; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const k = this.age[i] / this.life[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      for (let a = 0; a < 3; a++) { this.vel[i * 3 + a] *= dr; this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt; }
      this.alpha[i] = this.a0[i] * (1 - k);
      this.size[i] = this.s0[i] * (1 + this.grow[i] * k);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const name of ['position', 'color', 'alpha', 'size']) this.geo.attributes[name].needsUpdate = true;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const arr of [this.pos, this.vel, this.col]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
    for (const arr of [this.alpha, this.size, this.life, this.age, this.grow, this.grav, this.drag, this.a0, this.s0]) arr[i] = arr[j];
  }
}

// ============================================================ beams / tracers (pooled meshes)
export class Beams {
  constructor(scene, max = 48) {
    this.geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.geo.translate(0, 0.5, 0);
    this.geo.rotateX(Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false;
      m.userData = { age: 0, life: 1, width: 1 };
      scene.add(m);
      this.pool.push(m);
    }
    this.next = 0;
  }
  fire(a, b, color, width, life) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (len < 0.05) return;
    const m = this.pool[this.next]; this.next = (this.next + 1) % this.pool.length;
    m.position.set(a[0], a[1], a[2]);
    m.lookAt(b[0], b[1], b[2]);
    m.scale.set(width, width, len);
    m.material.color.set(color).multiplyScalar(2.5);
    m.material.opacity = 1;
    m.userData.age = 0; m.userData.life = life; m.userData.width = width;
    m.visible = true;
  }
  update(dt) {
    for (const m of this.pool) {
      if (!m.visible) continue;
      const u = m.userData;
      u.age += dt;
      const k = u.age / u.life;
      if (k >= 1) { m.visible = false; continue; }
      m.material.opacity = 1 - k;
      const w = u.width * (1 + k * 1.5);
      m.scale.x = m.scale.y = w;
    }
  }
}

// ============================================================ bullet-hole decals (pooled)
export class Decals {
  constructor(scene, max = 120) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.35, 'rgba(20,15,10,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const geo = new THREE.PlaneGeometry(1, 1);
    this.pool = [];
    for (let i = 0; i < max; i++) { const m = new THREE.Mesh(geo, mat); m.visible = false; scene.add(m); this.pool.push(m); }
    this.next = 0;
  }
  add(p, n, size = 0.18) {
    const m = this.pool[this.next]; this.next = (this.next + 1) % this.pool.length;
    m.position.set(p[0] + n[0] * 0.01, p[1] + n[1] * 0.01, p[2] + n[2] * 0.01);
    m.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]);
    m.rotateZ(Math.random() * 6.28);
    m.scale.setScalar(size * (0.7 + Math.random() * 0.6));
    m.visible = true;
  }
}

// ============================================================ dynamic light pool
// A fixed number of point lights that are re-used. Adding/removing lights at runtime forces
// every shader to recompile (a big stutter), so we never do that.
export class LightPool {
  constructor(scene, n = 6) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.userData = { age: 0, life: 0, i0: 0 };
      scene.add(l);
      this.lights.push(l);
    }
    this.next = 0;
  }
  flash(p, color, intensity, range, life) {
    const l = this.lights[this.next]; this.next = (this.next + 1) % this.lights.length;
    l.position.set(p[0], p[1], p[2]);
    l.color.set(color);
    l.distance = range;
    l.intensity = intensity;
    l.userData = { age: 0, life, i0: intensity };
  }
  update(dt) {
    for (const l of this.lights) {
      const u = l.userData;
      if (l.intensity <= 0) continue;
      u.age += dt;
      l.intensity = u.age >= u.life ? 0 : u.i0 * (1 - u.age / u.life) ** 2;
    }
  }
}
