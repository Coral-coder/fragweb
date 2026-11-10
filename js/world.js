// Builds the visual world for the current map: textured geometry, sky, lights, lava, pads,
// pickups and CTF flag bases. Returns a handle with update() and dispose().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, PICKUP_INFO } from './game.js';
import { worldBox, placed, glowMat, buildPickup, proceduralTexture } from './gfx.js';

const loader = new THREE.TextureLoader();
const texCache = new Map();
function tex(slug, kind, srgb) {
  const key = slug + '_' + kind;
  if (!texCache.has(key)) {
    const t = loader.load(`assets/textures/${key}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(key, t);
  }
  return texCache.get(key);
}

// Wait until every texture requested so far has loaded (or failed).
export function texturesReady() {
  const all = [...texCache.values()];
  return Promise.all(all.map(t => t.image ? Promise.resolve() : new Promise(res => {
    const check = () => (t.image ? res() : setTimeout(check, 50));
    check();
    setTimeout(res, 15000);
  })));
}

const matCache = new Map();
function themeMaterial(spec) {
  const key = JSON.stringify(spec);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    map: tex(spec.tex, 'd', true),
    normalMap: tex(spec.tex, 'n', false),
    roughnessMap: tex(spec.tex, 'r', false),
    color: spec.tint ?? 0xffffff,
    metalness: spec.metal ?? 0.05,
    roughness: 1,
  });
  m.normalScale.set(1.2, 1.2);
  matCache.set(key, m);
  return m;
}

export function preloadTheme(theme) {
  for (const spec of Object.values(theme.mats)) themeMaterial(spec);
  return texturesReady();
}

// ------------------------------------------------------------------ sky
function makeSky(theme) {
  const sk = theme.sky;
  const v3 = (a) => new THREE.Vector3(...a);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      time: { value: 0 }, top: { value: v3(sk.top) }, horizon: { value: v3(sk.horizon) }, nebula: { value: v3(sk.nebula) },
      stars: { value: sk.stars ? 1 : 0 }, planet: { value: sk.planet ? 1 : 0 }, day: { value: sk.day ? 1 : 0 },
      clouds: { value: sk.clouds || sk.day ? 1 : 0 }, smog: { value: sk.smog ? 1 : 0 },
      sunDir: { value: new THREE.Vector3(...theme.sun.dir).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 vDir; uniform float time, stars, planet, day, clouds, smog;
      uniform vec3 top, horizon, nebula, sunDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=0.5, s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        float h = vDir.y;
        vec3 col = mix(horizon, top, smoothstep(-0.05, 0.55, h));
        col = mix(col, horizon*0.6, smoothstep(0.0, -0.4, h));
        // sun
        float sd = max(0., dot(vDir, sunDir));
        col += vec3(1.0,0.85,0.6) * pow(sd, 400.) * (day > 0.5 ? 6. : 2.);
        col += vec3(1.0,0.6,0.3) * pow(sd, 8.) * (day > 0.5 ? 0.25 : 0.12);
        float n = fbm(vDir*3.0+vec3(time*0.005,0,0));
        col += nebula * smoothstep(0.45,0.9,n) * smoothstep(0.0,0.4,h) * 0.7;
        if (stars > 0.5) { float s = hash(floor(vDir*320.)); col += vec3(1.) * step(0.9975, s) * smoothstep(0.05,0.3,h); }
        if (planet > 0.5) {
          vec3 pd = normalize(vec3(-0.5,0.35,-0.8));
          float d = distance(vDir, pd);
          vec3 pc = day > 0.5 ? vec3(0.85,0.88,0.95) : vec3(0.9,0.55,0.4);
          float pa = day > 0.5 ? 0.35 : 1.0;
          col = mix(col, pc*(0.6+0.4*noise(vDir*20.)), smoothstep(0.125,0.12,d)*pa);
          col += vec3(1.0,0.5,0.3)*0.15*smoothstep(0.25,0.12,d)*(1.-day);
        }
        if (clouds > 0.5) {
          vec2 uv = vDir.xz / max(0.08, vDir.y + 0.15);
          float c = fbm(vec3(uv*0.6 + vec2(time*0.01, 0.), 1.0));
          float cov = smoothstep(0.5, 0.75, c) * smoothstep(0.0, 0.25, h);
          col = mix(col, vec3(1.0,0.97,0.95)*(0.75+0.25*sd), cov*0.85);
          // cloud sea below the horizon
          float below = smoothstep(-0.02, -0.25, h);
          float c2 = fbm(vec3(vDir.xz/max(0.05,-vDir.y)*0.5 + vec2(time*0.004,0.), 3.0));
          col = mix(col, mix(vec3(0.85,0.88,0.95), vec3(1.0), c2), below*0.9);
        }
        if (smog > 0.5) {
          float s = fbm(vDir*5.0 + vec3(0., time*0.02, 0.));
          col = mix(col, vec3(0.35,0.18,0.08), smoothstep(0.4,0.8,s)*0.5*smoothstep(0.6,0.0,h));
        }
        gl_FragColor = vec4(col,1.);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
  sky.renderOrder = -1;
  return sky;
}

// distant silhouettes for industrial maps
function makeSkyline(theme) {
  const geos = [], winGeos = [];
  let s = 99;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const [bx0, bx1, bz0, bz1] = WORLD.bounds;
  const R0 = Math.max(bx1 - bx0, bz1 - bz0) / 2 + 40;
  for (let i = 0; i < 54; i++) {
    const a = (i / 54) * Math.PI * 2 + r() * 0.1;
    const d = R0 + 30 + r() * 140;
    const w = 8 + r() * 16, h = 30 + r() * 100;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    geos.push(placed(new THREE.BoxGeometry(w, h, w), x, h / 2 - 8, z));
    if (r() < 0.4) geos.push(placed(new THREE.CylinderGeometry(2, 3, 40, 8), x + w, 20 + h * 0.4, z));
    for (let k = 0; k < 6; k++) winGeos.push(placed(new THREE.BoxGeometry(w + 0.2, 0.7, w + 0.2), x, 8 + r() * (h - 10), z));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 1 })));
  g.add(new THREE.Mesh(mergeGeometries(winGeos), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glowB).multiplyScalar(1.3) })));
  return g;
}

// rocky cliffs that frame canyon maps
function makeCliffs(mats) {
  const geos = [];
  let s = 7;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const [bx0, bx1, bz0, bz1] = WORLD.bounds;
  for (const side of [-1, 1]) {
    for (let z = bz0 - 20; z < bz1 + 20; z += 14) {
      const w = 12 + r() * 14, h = 30 + r() * 25, d = 14 + r() * 8;
      const x = (side < 0 ? bx0 - 2 - w / 2 - r() * 6 : bx1 + 2 + w / 2 + r() * 6);
      geos.push(placed(worldBox(w, h, d, 8), x, h / 2 - 25, z));
    }
  }
  // canyon floor far below (mist hides it)
  const m = new THREE.Mesh(mergeGeometries(geos), mats.rock || mats.wall);
  m.receiveShadow = true;
  return m;
}

// animated lava surface
function makeLava(h) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vW; uniform float time;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vW.xz*0.25;
        float n = noise(p + vec2(time*0.15, time*0.07))*0.6 + noise(p*2.3 - vec2(time*0.1, -time*0.12))*0.4;
        float crust = smoothstep(0.45, 0.62, n);
        vec3 hot = vec3(4.0, 1.2, 0.15), cool = vec3(0.18, 0.04, 0.02);
        vec3 col = mix(hot, cool, crust);
        col += vec3(3.,1.,0.1) * pow(1.-abs(n-0.5)*2., 12.) * 0.6;
        gl_FragColor = vec4(col, 1.);
      }`,
    toneMapped: false,
  });
  const w = h.max[0] - h.min[0], d = h.max[2] - h.min[2];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((h.min[0] + h.max[0]) / 2, h.max[1] - 0.3, (h.min[2] + h.max[2]) / 2);
  return m;
}

// CTF flag: pole, waving cloth, glowing base
export function makeFlag(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.9, roughness: 0.2 }));
  pole.position.y = 1.3;
  const geo = new THREE.PlaneGeometry(1.3, 0.85, 14, 6);
  geo.translate(0.65, 0, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, side: THREE.DoubleSide, roughness: 0.85 }));
  cloth.position.y = 2.1;
  const glow = new THREE.PointLight(color, 15, 9, 2);
  glow.position.y = 1.5;
  g.add(pole, cloth, glow);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { cloth, base: geo.attributes.position.array.slice() };
  return g;
}
export function waveFlag(flag, t) {
  const { cloth, base } = flag.userData;
  const pos = cloth.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    pos.setZ(i, Math.sin(x * 4 - t * 6) * 0.12 * x + Math.sin(y * 3 + t * 4) * 0.03 * x);
  }
  pos.needsUpdate = true;
  cloth.geometry.computeVertexNormals();
}
function makeFlagBase(color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.8, roughness: 0.3 }));
  base.position.y = 0.1;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.05, 8, 48), glowMat(color, 3));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.22;
  g.add(base, ring);
  return g;
}

// ------------------------------------------------------------------ main
export function buildWorld(scene, def, quality) {
  const theme = def.theme;
  const root = new THREE.Group();
  scene.add(root);
  const mats = {};
  for (const [k, spec] of Object.entries(theme.mats)) mats[k] = themeMaterial(spec);
  const glowA = glowMat(theme.glowA, 3), glowB = glowMat(theme.glowB, 3);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8a94a8, roughness: 0.3, metalness: 0.9 });
  const trim = proceduralTexture('trim');
  const trimMat = new THREE.MeshStandardMaterial({ map: trim.map, normalMap: trim.normalMap, roughness: 0.55, metalness: 0.3 });

  // atmosphere
  scene.fog = new THREE.Fog(theme.fog[0], theme.fog[1], theme.fog[2]);
  const sky = makeSky(theme);
  root.add(sky);
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.i);
  const sd = new THREE.Vector3(...theme.sun.dir).normalize();
  const [bx0, bx1, bz0, bz1] = WORLD.bounds;
  const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
  const ext = Math.max(bx1 - bx0, bz1 - bz0) / 2 + 6;
  sun.position.set(cx + sd.x * 150, sd.y * 150, cz + sd.z * 150);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 10, far: 320 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);
  for (const [x, y, z, c, i = 45, r = 32] of theme.lights) {
    const l = new THREE.PointLight(c, i, r, 1.6);
    l.position.set(x, y, z);
    root.add(l);
  }

  // level geometry merged per material
  const groups = {};
  const add = (k, geo) => { (groups[k] ||= []).push(geo); };
  for (const b of WORLD.boxes) {
    const s = [0, 1, 2].map(i => b.max[i] - b.min[i]);
    const c = [0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2);
    const spec = theme.mats[b.k] || theme.mats.wall;
    add(b.k in theme.mats ? b.k : 'wall', placed(worldBox(s[0], s[1], s[2], spec.tile || 4), ...c));
    // metal caps along the top edges of raised platforms
    if (['metal', 'metal2', 'stone', 'stone2', 'concrete', 'pillar'].includes(b.k) && s[1] > 1 && s[0] > 1.2 && s[2] > 1.2) {
      const t = 0.12, top = b.max[1];
      add('_cap', placed(new THREE.BoxGeometry(s[0] + 0.06, t, t), c[0], top - t / 2 + 0.02, b.min[2]));
      add('_cap', placed(new THREE.BoxGeometry(s[0] + 0.06, t, t), c[0], top - t / 2 + 0.02, b.max[2]));
      add('_cap', placed(new THREE.BoxGeometry(t, t, s[2] + 0.06), b.min[0], top - t / 2 + 0.02, c[2]));
      add('_cap', placed(new THREE.BoxGeometry(t, t, s[2] + 0.06), b.max[0], top - t / 2 + 0.02, c[2]));
    }
    if (b.k === 'step' && s[1] > 0.3) add('_trim', placed(worldBox(s[0] + 0.01, 0.07, s[2] + 0.01, 1), c[0], b.max[1] - 0.03, c[2]));
  }
  for (const d of WORLD.deco) {
    const s = [0, 1, 2].map(i => Math.max(0.03, d.max[i] - d.min[i]));
    const c = [0, 1, 2].map(i => (d.min[i] + d.max[i]) / 2);
    add('_' + d.k, placed(new THREE.BoxGeometry(...s), ...c));
  }
  const special = { _cap: capMat, _trim: trimMat, _glowA: glowA, _glowB: glowB };
  for (const [k, geos] of Object.entries(groups)) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), special[k] || mats[k]);
    const glow = k.startsWith('_glow');
    mesh.castShadow = !glow;
    mesh.receiveShadow = !glow;
    root.add(mesh);
    geos.forEach(g => g.dispose());
  }

  // backdrop
  if (theme.skyline) root.add(makeSkyline(theme));
  if (theme.cliffs) root.add(makeCliffs(mats));

  // hazards
  const lavas = [];
  for (const h of WORLD.hazards) if (h.kind === 'lava') { const l = makeLava(h); lavas.push(l); root.add(l); }

  // jump pads
  const pads = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.glowB).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const pad of WORLD.pads) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(pad.r + 0.35, pad.r + 0.45, 0.16, 40), capMat);
    housing.receiveShadow = true;
    const hazard = new THREE.Mesh(new THREE.RingGeometry(pad.r + 0.45, pad.r + 0.9, 40), trimMat);
    hazard.rotation.x = -Math.PI / 2; hazard.position.y = -0.07;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(pad.r, pad.r, 0.18, 40), new THREE.MeshStandardMaterial({ color: 0x0a2030, emissive: theme.glowB, emissiveIntensity: 1.6, metalness: 0.5, roughness: 0.3 }));
    g.add(housing, hazard, disc);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(pad.r * 0.85, 0.035, 6, 40), ringMat.clone());
      ring.rotation.x = Math.PI / 2;
      ring.userData.phase = i / 3;
      g.add(ring);
    }
    g.position.set(pad.p[0], pad.p[1] + 0.08, pad.p[2]);
    root.add(g);
    pads.push(g);
  }

  // pickups
  const pickups = WORLD.pickups.map(pk => {
    const m = buildPickup(pk.t);
    m.position.set(pk.p[0], pk.p[1] + 0.85, pk.p[2]);
    if (PICKUP_INFO[pk.t].power) {
      const l = new THREE.PointLight(PICKUP_INFO[pk.t].color, 12, 8, 2);
      l.position.y = 0.2;
      m.add(l);
    }
    root.add(m);
    return m;
  });

  // CTF flags
  let flags = null;
  if (WORLD.flags) {
    flags = WORLD.flags.map((p, team) => {
      const color = team ? 0x3d9bff : 0xff4d4d;
      const base = makeFlagBase(color);
      base.position.set(p[0], p[1], p[2]);
      root.add(base);
      const flag = makeFlag(color);
      flag.position.set(p[0], p[1] + 0.2, p[2]);
      root.add(flag);
      return flag;
    });
  }

  return {
    root, sky, pads, pickups, flags, lavas, mats,
    update(t) {
      sky.material.uniforms.time.value = t;
      for (const l of lavas) l.material.uniforms.time.value = t;
      pickups.forEach((m, i) => {
        const item = m.userData.item;
        item.rotation.y = t * 1.5 + i;
        item.position.y = Math.sin(t * 2 + i) * 0.1;
      });
      for (const g of pads) for (const c of g.children) if (c.userData.phase != null) {
        const k = (t * 0.9 + c.userData.phase) % 1;
        c.position.y = k * 3; c.material.opacity = 1 - k; c.scale.setScalar(1 - k * 0.35);
      }
      if (flags) for (const f of flags) if (f.visible) waveFlag(f, t);
    },
    setShadows(on, size) {
      sun.castShadow = on;
      if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    },
    dispose() {
      scene.remove(root);
      root.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !Object.values(mats).includes(o.material) && !o.material.map?.isCanvasTexture) o.material.dispose?.();
      });
    },
  };
}
