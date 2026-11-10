// Map definitions. Every map is built from axis-aligned boxes so physics stays simple and fast.
// Coordinates are metres, y is up. Material keys are resolved to textures by each map's theme.

function builder() {
  const boxes = [], deco = [];
  const api = {
    boxes, decos: deco,
    box(x0, y0, z0, x1, y1, z1, k = 'wall') {
      const b = { min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], k };
      boxes.push(b);
      return b;
    },
    // visual-only box (no collision): glow strips, trims
    deco(x0, y0, z0, x1, y1, z1, k = 'glowA') {
      deco.push({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], k });
    },
    // Stairs filling a rectangle, rising from yLow to yHigh in direction dir ('+x', '-x', '+z', '-z').
    stairs(x0, z0, x1, z1, yLow, yHigh, dir, k = 'step', base = null) {
      const n = Math.max(1, Math.ceil((yHigh - yLow) / 0.5 - 1e-6));
      const ax = dir[1] === 'x' ? 0 : 2;
      const lo = ax === 0 ? Math.min(x0, x1) : Math.min(z0, z1);
      const hi = ax === 0 ? Math.max(x0, x1) : Math.max(z0, z1);
      const len = (hi - lo) / n;
      for (let i = 0; i < n; i++) {
        const top = yLow + (yHigh - yLow) * (i + 1) / n;
        const bottom = base ?? yLow;
        const s0 = dir[0] === '+' ? lo + i * len : hi - (i + 1) * len;
        const s1 = s0 + len;
        if (ax === 0) api.box(s0, bottom, z0, s1, top, z1, k);
        else api.box(x0, bottom, s0, x1, top, s1, k);
      }
    },
  };
  return api;
}

// Rotate a point/box helper by k*90° around the origin (for 4-way symmetric maps)
function rot(k, x, z) {
  for (let i = 0; i < k; i++) { const t = x; x = -z; z = t; }
  return [x, z];
}
function rotDir(k, dir) {
  const order = ['+x', '+z', '-x', '-z'];
  return order[(order.indexOf(dir) + k) % 4];
}
// Wrap a builder so every call is rotated by k*90°.
function rotated(b, k) {
  const r = (x0, z0, x1, z1) => { const [a, c] = rot(k, x0, z0); const [d, e] = rot(k, x1, z1); return [a, c, d, e]; };
  return {
    box: (x0, y0, z0, x1, y1, z1, kk) => { const [a, c, d, e] = r(x0, z0, x1, z1); return b.box(a, y0, c, d, y1, e, kk); },
    deco: (x0, y0, z0, x1, y1, z1, kk) => { const [a, c, d, e] = r(x0, z0, x1, z1); return b.deco(a, y0, c, d, y1, e, kk); },
    stairs: (x0, z0, x1, z1, yl, yh, dir, kk, base) => { const [a, c, d, e] = r(x0, z0, x1, z1); return b.stairs(a, c, d, e, yl, yh, rotDir(k, dir), kk, base); },
    pt: (x, y, z) => { const [a, c] = rot(k, x, z); return [a, y, c]; },
    vec: (x, y, z) => { const [a, c] = rot(k, x, z); return [a, y, c]; },
  };
}
// Mirror along z (for two-sided CTF maps). s = -1 or 1.
function mirroredZ(b, s) {
  const fz = (z) => z * s;
  const flip = (d) => (d[1] === 'z' && s < 0 ? (d[0] === '+' ? '-z' : '+z') : d);
  return {
    box: (x0, y0, z0, x1, y1, z1, k) => b.box(x0, y0, fz(z0), x1, y1, fz(z1), k),
    deco: (x0, y0, z0, x1, y1, z1, k) => b.deco(x0, y0, fz(z0), x1, y1, fz(z1), k),
    stairs: (x0, z0, x1, z1, yl, yh, dir, k, base) => b.stairs(x0, fz(z0), x1, fz(z1), yl, yh, flip(dir), k, base),
    pt: (x, y, z) => [x, y, fz(z)],
    vec: (x, y, z) => [x, y, fz(z)],
  };
}

// ======================================================================= CRUCIBLE YARD
// Compact, symmetrical yard. Great for duels and small groups.
function crucible() {
  const b = builder();
  const S = 32;
  b.box(-S, -1, -S, S, 0, S, 'floor');
  b.box(-S - 1, 0, -S - 1, S + 1, 22, -S, 'wall');
  b.box(-S - 1, 0, S, S + 1, 22, S + 1, 'wall');
  b.box(-S - 1, 0, -S, -S, 22, S, 'wall');
  b.box(S, 0, -S, S + 1, 22, S, 'wall');
  // central dais with stairs
  b.box(-5, 0, -5, 5, 4, 5, 'metal');
  b.stairs(-2.5, 5, 2.5, 11.4, 0, 4, '-z', 'step');
  b.stairs(-2.5, -11.4, 2.5, -5, 0, 4, '+z', 'step');
  for (const [x, z] of [[-5.02, 0], [5.02, 0]]) b.deco(x, 1, -4, x, 1.1, 4, 'glowB');
  // corner towers and ledges
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * S, 0, sz * S, sx * (S - 7), 7, sz * (S - 7), 'stone');
  for (const sz of [-1, 1]) b.box(-(S - 7), 6.4, sz * S, S - 7, 7, sz * (S - 4), 'metal2');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.stairs(sx * S, sz * (S - 21), sx * (S - 3.5), sz * (S - 7), 0, 7, sz > 0 ? '+z' : '-z', 'step');
  }
  for (const sx of [-1, 1]) {
    b.box(sx * 14, 0, -4, sx * 20, 2.5, 4, 'concrete');
    b.box(sx * 12.6, 0, -1, sx * 14, 1.3, 1, 'crate');
  }
  for (const [x, z] of [[-12, -14], [12, -14], [-12, 14], [12, 14], [0, -20], [0, 20]]) b.box(x - 1, 0, z - 1, x + 1, 5, z + 1, 'pillar');
  for (const [x, z] of [[-20, -12], [20, 12], [-8, 22], [8, -22], [-22, 18], [22, -18], [-7, -9], [7, 9]]) b.box(x - 0.8, 0, z - 0.8, x + 0.8, 1.4, z + 0.8, 'crate');
  // wall light bands
  for (const z of [-S + 0.02, S - 0.02]) b.deco(-28, 12, z, 28, 12.12, z, 'glowA');
  for (const x of [-S + 0.02, S - 0.02]) b.deco(x, 12, -28, x, 12.12, 28, 'glowB');
  for (let i = -24; i <= 24; i += 8) {
    for (const z of [-S + 0.02, S - 0.02]) b.deco(i - 0.06, 9, z, i + 0.06, 18, z, i % 16 ? 'glowB' : 'glowA');
    for (const x of [-S + 0.02, S - 0.02]) b.deco(x, 9, i - 0.06, x, 18, i + 0.06, i % 16 ? 'glowA' : 'glowB');
  }

  return {
    ...b,
    bounds: [-S, S, -S, S],
    pads: [
      { p: [-18, 0, -16], r: 1.3, v: [0, 18.5, -12.5] },
      { p: [18, 0, 16], r: 1.3, v: [0, 18.5, 12.5] },
      { p: [-18, 0, 16], r: 1.3, v: [0, 18.5, 12.5] },
      { p: [18, 0, -16], r: 1.3, v: [0, 18.5, -12.5] },
    ],
    spawns: [
      [-24, 1, 0], [24, 1, 0], [0, 1, -26], [0, 1, 26], [-10, 1, -24], [10, 1, 24],
      [-28.5, 8, -28.5], [28.5, 8, 28.5], [-28.5, 8, 28.5], [28.5, 8, -28.5],
      [-17, 3.5, 0], [17, 3.5, 0], [-26, 1, 20], [26, 1, -20],
    ],
    pickups: [
      { t: 'mega', p: [0, 4, 0] },
      { t: 'armor', p: [-28.5, 7, -28.5] }, { t: 'armor', p: [28.5, 7, 28.5] },
      { t: 'health', p: [-28.5, 7, 28.5] }, { t: 'health', p: [28.5, 7, -28.5] },
      { t: 'health', p: [-24, 0, 0] }, { t: 'health', p: [24, 0, 0] },
      { t: 'shard', p: [-12, 5, -14] }, { t: 'shard', p: [12, 5, 14] },
      { t: 'vial', p: [-12, 0, 0] }, { t: 'vial', p: [12, 0, 0] }, { t: 'vial', p: [-6, 0, -14] }, { t: 'vial', p: [6, 0, 14] },
      { t: 'w1', p: [-17, 2.5, 0] }, { t: 'w1', p: [17, 2.5, 0] },
      { t: 'w2', p: [0, 0, -14] }, { t: 'w2', p: [0, 0, 14] },
      { t: 'w4', p: [-20, 0, 24] }, { t: 'w5', p: [20, 0, -24] },
      { t: 'w3', p: [-24, 0, -10] }, { t: 'w3', p: [24, 0, 10] },
      { t: 'w6', p: [0, 7, -29.5] }, { t: 'w6', p: [0, 7, 29.5] },
      { t: 'a_shells', p: [-8, 0, -4] }, { t: 'a_cells', p: [8, 0, 4] },
      { t: 'a_rockets', p: [-22, 0, -24] }, { t: 'a_rockets', p: [22, 0, 24] },
      { t: 'a_shards', p: [-24, 0, 24] }, { t: 'a_arc', p: [24, 0, -24] },
      { t: 'a_slugs', p: [-14, 7, 29.5] }, { t: 'a_slugs', p: [14, 7, -29.5] },
    ],
    killY: -20,
  };
}

// ======================================================================= FOUNDRY NINE
// Large industrial complex: central smelting hall over a lava pit, balconies, container yards,
// corner offices with rooftops. 4-way rotationally symmetric.
function foundry() {
  const b = builder();
  const S = 60;   // outer half-size
  const HW = 34;  // hall wall position
  const P = 13;   // lava pit half-size

  // ground with a hole for the pit
  b.box(-S, -1, -S, S, 0, -P, 'floor');
  b.box(-S, -1, P, S, 0, S, 'floor');
  b.box(-S, -1, -P, -P, 0, P, 'floor');
  b.box(P, -1, -P, S, 0, P, 'floor');
  b.box(-P, -7, -P, P, -6, P, 'rock');                   // pit floor
  for (let k = 0; k < 4; k++) {                           // pit walls
    const r = rotated(b, k);
    r.box(-P - 0.6, -6, -P - 0.6, P + 0.6, 0, -P, 'rust');
  }
  // cross bridges over the lava and a central platform
  b.box(-P, -0.6, -2, P, 0, 2, 'grate');
  b.box(-2, -0.6, -P, 2, 0, P, 'grate');
  b.box(-4.5, -0.6, -4.5, 4.5, 0, 4.5, 'metal');
  for (let k = 0; k < 4; k++) {
    const r = rotated(b, k);
    r.deco(2, -0.2, -P, 2.06, -0.08, -4.5, 'glowA');      // bridge edge lights
    r.deco(-2.06, -0.2, -P, -2, -0.08, -4.5, 'glowA');
  }

  // outer boundary walls
  b.box(-S - 1, 0, -S - 1, S + 1, 24, -S, 'wall2');
  b.box(-S - 1, 0, S, S + 1, 24, S + 1, 'wall2');
  b.box(-S - 1, 0, -S, -S, 24, S, 'wall2');
  b.box(S, 0, -S, S + 1, 24, S, 'wall2');

  for (let k = 0; k < 4; k++) {
    const r = rotated(b, k);
    // ---- hall wall on the -z side (rotated 4x): ground door |x|<4 (h 5), upper door 3 wide at y 7..11
    r.box(-HW - 1, 0, -HW - 1, -4, 16, -HW, 'wall');
    r.box(4, 0, -HW - 1, HW + 1, 16, -HW, 'wall');
    r.box(-4, 5, -HW - 1, 4, 7, -HW, 'wall');
    r.box(-4, 11, -HW - 1, 4, 16, -HW, 'wall');
    r.box(-4, 7, -HW - 1, -1.5, 11, -HW, 'wall');
    r.box(1.5, 7, -HW - 1, 4, 11, -HW, 'wall');
    r.deco(-4, 4.9, -HW + 0.02, 4, 5.0, -HW + 0.02, 'glowA');
    // ---- inner balcony along the hall wall (top y=7)
    r.box(-HW, 6.4, -HW, HW, 7, -HW + 5, 'grate');
    r.deco(-HW + 5, 6.3, -HW + 5.02, HW - 5, 6.4, -HW + 5.04, 'glowB');
    // railings (low cover) with gaps
    r.box(-22, 7, -HW + 4.8, -6, 8.1, -HW + 5, 'metal2');
    r.box(6, 7, -HW + 4.8, 22, 8.1, -HW + 5, 'metal2');
    // stairs from floor up to balcony, in the hall corner (going along -x wall direction)
    r.stairs(-HW + 5, -HW + 5, -HW + 9, -HW + 19, 0, 6.5, '-z', 'step');
    // ---- outside walkway at y=7 along the hall wall
    r.box(-HW - 13, 6.4, -HW - 4, HW + 13, 7, -HW - 1, 'grate');
    // ---- corner office rooms (outside the hall, at the +x,-z corner of this rotation)
    const rx0 = 40, rx1 = 58, rz0 = -58, rz1 = -40;
    r.box(rx0, 0, rz1 - 1, rx1, 6, rz1, 'concrete');        // inner wall (toward centre) with door
    r.box(rx0, 0, rz0, rx0 + 1, 6, rz1 - 1, 'concrete');
    r.box(rx0 + 1, 0, rz0, rx1, 6, rz0 + 1, 'concrete');
    r.box(rx1 - 1, 0, rz0 + 1, rx1, 6, rz1 - 1, 'concrete');
    // cut doors: rebuild walls in pieces instead (door on inner z wall and inner x wall)
    b.boxes.splice(b.boxes.length - 4, 4);
    r.box(rx0, 0, rz1 - 1, 46, 6, rz1, 'concrete');
    r.box(51, 0, rz1 - 1, rx1, 6, rz1, 'concrete');
    r.box(46, 4, rz1 - 1, 51, 6, rz1, 'concrete');
    r.box(rx0, 0, rz0, rx0 + 1, 6, -52, 'concrete');
    r.box(rx0, 0, -47, rx0 + 1, 6, rz1 - 1, 'concrete');
    r.box(rx0, 4, -52, rx0 + 1, 6, -47, 'concrete');
    r.box(rx0 + 1, 0, rz0, rx1, 6, rz0 + 1, 'concrete');
    r.box(rx1 - 1, 0, rz0 + 1, rx1, 6, rz1 - 1, 'concrete');
    r.box(rx0, 6, rz0, rx1, 7, rz1, 'metal');               // roof (top y=7)
    r.deco(46, 3.9, rz1 + 0.02, 51, 4.0, rz1 + 0.02, 'glowA');
    // office interior: desk-like crates
    r.box(52, 0, -55, 56, 1.1, -53, 'crate');
    // bridge from outside walkway onto the roof
    r.box(rx0, 6.4, rz1, HW + 13, 7, -HW - 4, 'grate');
    // stairs from the ground up to the outside walkway (in the side yard)
    r.stairs(-HW - 13, -HW - 10, -HW - 9, -HW - 4, 0, 7, '+z', 'step');
    // ---- side yard (between hall and outer wall, -z side): shipping containers
    r.box(-24, 0, -54, -12, 2.8, -51, 'container');
    r.box(-24, 2.8, -54, -16, 5.6, -51, 'container');
    r.box(10, 0, -50, 13, 2.8, -38, 'container');
    r.box(-6, 0, -46, 6, 2.8, -43, 'container');
    r.box(18, 0, -56, 30, 2.8, -53, 'container');
    r.stairs(-12, -54, -9, -51, 0, 2.8, '-x', 'crate');
    // ---- hall floor cover
    r.box(-20, 0, -24, -17, 3.5, -21, 'pillar');
    r.box(17, 0, -24, 20, 3.5, -21, 'pillar');
    r.box(-8, 0, -26, 8, 1.2, -25, 'metal2');                 // low wall
    r.box(-1, 0, -20, 1, 12, -18, 'pillar');                  // tall pillar
    // pit-side rail stubs
    r.box(-P, 0, -P - 0.4, -4, 0.9, -P, 'metal2');
    r.box(4, 0, -P - 0.4, P, 0.9, -P, 'metal2');
  }
  // remove pit rails that blocked the bridges (rails only between bridge and corners — already split at |x|<4)

  const pads = [];
  const spawns = [];
  const pickups = [];
  for (let k = 0; k < 4; k++) {
    const r = rotated(b, k);
    pads.push({ p: r.pt(-23.5, 0, -12), r: 1.3, v: r.vec(0, 19, -16) });         // hall floor -> balcony
    pads.push({ p: r.pt(-50, 0, -30), r: 1.3, v: r.vec(0, 19, -15) });           // yard -> office roof
    spawns.push(r.pt(-26, 0.95, -10), r.pt(-10, 0.95, -28), r.pt(49, 0.95, -49), r.pt(-30, 7.95, -31.5), r.pt(0, 0.95, -48), r.pt(-50, 0.95, -20));
    pickups.push(
      { t: 'health', p: r.pt(54, 0, -44) },
      { t: 'vial', p: r.pt(-12, 0, -30) }, { t: 'vial', p: r.pt(12, 0, -30) },
      { t: 'shard', p: r.pt(12, 7, -31.5) },
      { t: 'a_cells', p: r.pt(-18, 0, -14) },
      { t: 'a_rockets', p: r.pt(30, 7, -37.5) },
      { t: 'a_shells', p: r.pt(0, 0, -40) },
    );
  }
  pickups.push(
    { t: 'amp', p: [0, 0, 0] },
    { t: 'mega', p: [0, 7, -31.5] },
    { t: 'armor', p: [49, 7, -49] }, { t: 'armor', p: [-49, 7, 49] },
    { t: 'aegis', p: [-49, 7, -49] }, { t: 'boots', p: [49, 7, 49] },
    { t: 'w1', p: [-23, 0, 0] }, { t: 'w1', p: [23, 0, 0] },
    { t: 'w2', p: [0, 0, 23] }, { t: 'w2', p: [0, 0, -23] },
    { t: 'w3', p: [-50, 0, 0] }, { t: 'w4', p: [50, 0, 0] },
    { t: 'w5', p: [0, 0, -48] }, { t: 'w5', p: [0, 0, 48] },
    { t: 'w6', p: [31.5, 7, 0] }, { t: 'w6', p: [-31.5, 7, 0] },
    { t: 'w7', p: [-20, 5.6, -52.5] },
    { t: 'a_shards', p: [-49, 0, 20] }, { t: 'a_arc', p: [49, 0, -20] },
    { t: 'a_slugs', p: [0, 7, 31.5] }, { t: 'a_slugs', p: [0, 7, -36] },
  );

  return {
    ...b,
    bounds: [-S, S, -S, S],
    pads, spawns, pickups,
    hazards: [{ min: [-P, -7, -P], max: [P, -2.5, P], dps: 80, kind: 'lava' }],
    killY: -12,
  };
}

// ======================================================================= TWIN SPIRES (CTF)
// Two fortresses facing each other across a canyon. Red base at -z, Blue base at +z.
function spires() {
  const b = builder();
  const W = 32;      // half-width
  const L = 100;     // half-length
  const C = 8;       // canyon half-width

  // canyon walls (map sides)
  b.box(-W - 2, -20, -L - 2, -W, 26, L + 2, 'rock');
  b.box(W, -20, -L - 2, W + 2, 26, L + 2, 'rock');
  b.box(-W, -20, -L - 2, W, 26, -L, 'rock');
  b.box(-W, -20, L, W, 26, L + 2, 'rock');

  const pads = [], spawns = [[], []], pickups = [];
  const flags = [null, null];
  for (const s of [-1, 1]) {
    const r = mirroredZ(b, s);
    const team = s < 0 ? 0 : 1;
    // ground plateau on this side
    r.box(-W, -6, C, W, 0, L, 'ground');
    // ---- midfield
    r.box(-W, 0, C, -W + 3, 3, 30, 'rock');            // canyon-edge boulders
    r.box(-6, 0, 22, -2, 2.2, 26, 'rock');
    r.box(4, 0, 34, 9, 1.6, 38, 'rock');
    r.box(-16, 0, 46, -11, 3, 50, 'rock');
    r.box(12, 0, 50, 16, 2.4, 55, 'rock');
    r.box(-4, 0, 58, 4, 1.4, 60, 'stone');            // low wall before the gate
    // mesas (top y=4) with stairs, joined to the high central bridge
    r.box(-20, 0, 30, -10, 4, 42, 'stone');
    r.stairs(-20, 42, -16, 49, 0, 4, '-z', 'step');
    r.box(10, 0, 30, 20, 4, 42, 'stone');
    r.stairs(16, 42, 20, 49, 0, 4, '-z', 'step');
    // high centre platform and bridge (top y=6)
    r.box(-4, 5.4, C, 4, 6, 18, 'metal');
    r.box(-4, 0, 16, 4, 5.4, 18, 'stone');             // support
    r.stairs(-4, 18, 4, 30, 0, 6, '-z', 'step');
    // low side bridges across the canyon (y=0), only built once below
    // ---- fortress
    const F0 = 70, F1 = 98;
    // front wall with a ground gate |x|<4 (h 5) and side gates near x=±20
    r.box(-W, 0, F0, -23, 9, F0 + 1.5, 'wall');
    r.box(-17, 0, F0, -4, 9, F0 + 1.5, 'wall');
    r.box(4, 0, F0, 17, 9, F0 + 1.5, 'wall');
    r.box(23, 0, F0, W, 9, F0 + 1.5, 'wall');
    r.box(-4, 5, F0, 4, 9, F0 + 1.5, 'wall');
    r.box(-23, 5, F0, -17, 9, F0 + 1.5, 'wall');
    r.box(17, 5, F0, 23, 9, F0 + 1.5, 'wall');
    r.deco(-4, 4.9, F0 - 0.02, 4, 5, F0 - 0.04, team ? 'glowB' : 'glowA');
    // battlements on top of the front wall (crenels give the rampart cover)
    for (let x = -W + 1; x < W - 1; x += 4) r.box(x, 9, F0, x + 2, 10.2, F0 + 0.6, 'wall');
    // rampart walkway behind the wall (y=8) with stairs at both sides
    r.box(-W, 7.4, F0 + 1.5, W, 8, F0 + 5, 'metal');
    r.stairs(-W, F0 + 5, -W + 4, F0 + 15, 0, 7.5, '-z', 'step');
    r.stairs(W - 4, F0 + 5, W, F0 + 15, 0, 7.5, '-z', 'step');
    // flag platform (top y=3) at the back, with stairs on both sides
    r.box(-8, 0, 86, 8, 3, 94, 'metal');
    r.stairs(-14, 86, -8, 94, 0, 3, '+x', 'step');
    r.stairs(8, 86, 14, 94, 0, 3, '-x', 'step');
    r.stairs(-4, 81, 4, 86, 0, 3, '+z', 'step');
    r.deco(-8, 2.9, 86 - 0.02, 8, 3.0, 86 - 0.04, team ? 'glowB' : 'glowA');
    // back wall of the base
    r.box(-W, 0, F1, W, 14, L, 'wall');
    // spire towers (top y=16) with sniper nests
    for (const x of [-22, 22]) {
      r.box(x - 3, 0, 78, x + 3, 16, 84, 'stone');
      r.box(x - 3, 16, 78, x + 3, 17, 78.4, 'metal2');      // nest railing (cover toward midfield)
      r.deco(x - 3.02, 4, 78, x - 3.02, 15, 78.1, team ? 'glowB' : 'glowA');
      r.deco(x + 3.02, 4, 78, x + 3.02, 15, 78.1, team ? 'glowB' : 'glowA');
      pads.push({ p: r.pt(x, 0, 87.5), r: 1.2, v: r.vec(0, 29, -3.6) });
    }
    // courtyard cover
    r.box(-14, 0, 76, -10, 2.2, 78, 'crate');
    r.box(10, 0, 76, 14, 2.2, 78, 'crate');
    // flag
    flags[team] = r.pt(0, 3, 90);
    // spawns
    for (const [x, z] of [[-18, 92], [18, 92], [-16, 80], [16, 80], [0, 96], [-27, 90], [27, 90], [-6, 78], [6, 78]]) spawns[team].push(r.pt(x, 0.95, z));
    // pickups (mirrored per side)
    pickups.push(
      { t: 'health', p: r.pt(-26, 0, 94) }, { t: 'health', p: r.pt(26, 0, 94) },
      { t: 'armor', p: r.pt(0, 8, F0 + 3.2) },
      { t: 'w5', p: r.pt(-15, 4, 36) }, { t: 'w1', p: r.pt(15, 4, 36) },
      { t: 'w2', p: r.pt(-8, 0, 64) }, { t: 'w3', p: r.pt(8, 0, 64) },
      { t: 'w4', p: r.pt(0, 0, 76) },
      { t: 'w6', p: r.pt(-22, 16, 81) },
      { t: 'a_slugs', p: r.pt(22, 16, 81) },
      { t: 'a_rockets', p: r.pt(-24, 0, 60) }, { t: 'a_shells', p: r.pt(24, 0, 60) },
      { t: 'a_cells', p: r.pt(-28, 0, 40) }, { t: 'a_shards', p: r.pt(28, 0, 44) },
      { t: 'a_arc', p: r.pt(0, 0, 50) },
      { t: 'vial', p: r.pt(-8, 0, 26) }, { t: 'vial', p: r.pt(8, 0, 26) }, { t: 'vial', p: r.pt(0, 0, 40) },
      { t: 'shard', p: r.pt(-15, 4, 31) }, { t: 'shard', p: r.pt(15, 4, 31) },
    );
  }
  // centre: high bridge (y=6) and two low bridges across the canyon (y=0)
  b.box(-4, 5.4, -C, 4, 6, C, 'grate');
  b.box(-22, -0.6, -C, -16, 0, C, 'grate');
  b.box(16, -0.6, -C, 22, 0, C, 'grate');
  for (const x of [-22, -16, 16, 22]) b.deco(x - 0.03, -0.25, -C, x + 0.03, -0.1, C, 'glowB');
  b.deco(-4.03, 5.6, -C, -3.97, 5.75, C, 'glowA');
  b.deco(3.97, 5.6, -C, 4.03, 5.75, C, 'glowA');
  pickups.push({ t: 'amp', p: [0, 6, 0] }, { t: 'aegis', p: [-19, 0, 0] }, { t: 'boots', p: [19, 0, 0] });

  return {
    ...b,
    bounds: [-W, W, -L, L],
    pads,
    spawns: [...spawns[0], ...spawns[1]],
    teamSpawns: spawns,
    pickups,
    flags,
    killY: -18,
  };
}

// ======================================================================= SKYREACH
// Floating sandstone islands over a bottomless sky. Fall and you're gone.
function skyreach() {
  const b = builder();
  // central temple: three tiers
  b.box(-15, -3, -15, 15, 0, 15, 'stone');
  b.box(-9, 0, -9, 9, 4, 9, 'stone2');
  b.box(-4, 4, -4, 4, 8, 4, 'stone2');
  b.box(-3, 8, -3, 3, 8.4, 3, 'metal');
  const pads = [], spawns = [], pickups = [];
  for (let k = 0; k < 4; k++) {
    const r = rotated(b, k);
    // temple stairs on each side
    r.stairs(-2, -15, 2, -9, 0, 4, '+z', 'step');
    r.stairs(-1.5, -9, 1.5, -4, 4, 8, '+z', 'step', 4);
    // columns at tier corners
    r.box(-14, 0, -14, -12, 9, -12, 'pillar');
    r.box(-14, 9, -14, -12, 9.6, -12, 'stone');
    r.deco(-12.02, 1, -13.5, -12.0, 8, -13.4, 'glowA');
    // bridge to the satellite island (y=0 -> y=2)
    r.box(-1.5, -0.6, -28, 1.5, 0, -15, 'stone');
    r.stairs(-1.5, -32, 1.5, -28, 0, 2, '-z', 'step', -1);
    r.deco(-1.53, -0.3, -28, -1.5, -0.15, -15, 'glowB');
    r.deco(1.5, -0.3, -28, 1.53, -0.15, -15, 'glowB');
    // satellite island (top y=2)
    r.box(-9, -4, -50, 9, 2, -32, 'stone');
    r.box(-6, 2, -48, -3, 4.5, -45, 'pillar');
    r.box(3, 2, -48, 6, 4.5, -45, 'pillar');
    r.box(-2, 2, -50, 2, 3.2, -49, 'stone2');
    // corner island (top y=9), reached by pad
    r.box(26, -2, -46, 44, 9, -28, 'stone');
    r.box(32, 9, -41, 38, 11.5, -38, 'stone2');
    // floating stepping stones from the corner island back down to the temple
    r.box(22.5, 7.0, -26.5, 24.5, 7.6, -24.5, 'stone');
    r.box(19.5, 5.6, -23.5, 21.5, 6.2, -21.5, 'stone');
    r.box(16.5, 4.2, -20.5, 18.5, 4.8, -18.5, 'stone');
    r.box(14.2, 2.8, -18.3, 16.2, 3.4, -16.3, 'stone');
    pads.push({ p: r.pt(6, 2, -34), r: 1.2, v: r.vec(15, 22, 0) });         // satellite -> corner island
    pads.push({ p: r.pt(-11, 0, -11), r: 1.0, v: r.vec(6.4, 20.6, 6.4) });     // temple base -> top tier
    spawns.push(r.pt(0, 2.95, -40), r.pt(35, 9.95, -33), r.pt(-12, 0.95, -6), r.pt(-6, 2.95, -36));
    pickups.push(
      { t: 'health', p: r.pt(-6, 2, -36) },
      { t: 'vial', p: r.pt(0, 0, -20) },
      { t: 'shard', p: r.pt(17.5, 4.8, -19.5) },
      { t: ['a_rockets', 'a_shards', 'a_cells', 'a_slugs'][k], p: r.pt(5, 2, -40) },
    );
  }
  pickups.push(
    { t: 'mega', p: [0, 8.4, 0] },
    { t: 'amp', p: [35, 11.5, -39.5] },
    { t: 'aegis', p: [-35, 9, 35] },
    { t: 'armor', p: [35, 9, 35] }, { t: 'armor', p: [-35, 9, -35] },
    { t: 'w5', p: [6, 4, -6] }, { t: 'w5', p: [-6, 4, 6] },
    { t: 'w4', p: [-6, 4, -6] }, { t: 'w1', p: [6, 4, 6] },
    { t: 'w6', p: [0, 2, -46] }, { t: 'w6', p: [0, 2, 46] },
    { t: 'w2', p: [46, 2, 0] }, { t: 'w3', p: [-46, 2, 0] },
    { t: 'boots', p: [10.2, 0, -12] },
  );
  return {
    ...b,
    bounds: [-50, 50, -50, 50],
    pads, spawns, pickups,
    killY: -25,
  };
}

// ======================================================================= themes
// Texture slugs live in assets/textures/<slug>_{d,n,r}.jpg (CC0, Poly Haven).
// tile = metres per texture repeat.
const INDUSTRIAL = {
  floor:     { tex: 'concrete_floor_02', tile: 6 },
  floor2:    { tex: 'metal_plate', tile: 3, metal: 0.7 },
  wall:      { tex: 'concrete_panels', tile: 6 },
  wall2:     { tex: 'corrugated_iron_02', tile: 4, metal: 0.6 },
  metal:     { tex: 'metal_plate', tile: 3, metal: 0.8 },
  metal2:    { tex: 'blue_metal_plate', tile: 3, metal: 0.6 },
  grate:     { tex: 'metal_grate_rusty', tile: 2, metal: 0.7 },
  rust:      { tex: 'rusty_metal_02', tile: 4, metal: 0.5 },
  step:      { tex: 'metal_plate_02', tile: 2, metal: 0.6 },
  stone:     { tex: 'concrete_block_wall', tile: 4 },
  stone2:    { tex: 'concrete_block_wall', tile: 4, tint: 0xd0c8c0 },
  concrete:  { tex: 'concrete_panels', tile: 4, tint: 0xc8d0d8 },
  pillar:    { tex: 'concrete_block_wall', tile: 3, tint: 0xd8c0a8 },
  crate:     { tex: 'painted_metal_shutter', tile: 2.5, metal: 0.5, tint: 0xb08850 },
  container: { tex: 'corrugated_iron_02', tile: 3, metal: 0.6, tint: 0x6b8fb0 },
  rock:      { tex: 'dark_rock', tile: 6 },
  ground:    { tex: 'rocky_gravel', tile: 5 },
};

export const MAPS = {
  crucible: {
    id: 'crucible', name: 'Crucible Yard', size: 'Small', players: '2–6',
    modes: ['dm', 'duel', 'tdm'],
    desc: 'A tight walled yard with towers, ledges and a central dais. Fast and brutal.',
    build: crucible,
    theme: {
      mats: { ...INDUSTRIAL, floor: { tex: 'metal_plate', tile: 4, metal: 0.6 }, wall: { tex: 'concrete_panels', tile: 6, tint: 0xb8c4d8 } },
      sky: { top: [0.02, 0.03, 0.08], horizon: [0.55, 0.22, 0.10], nebula: [0.25, 0.08, 0.35], planet: true, stars: true },
      fog: [0x120c18, 60, 260], sun: { dir: [-30, 50, -40], color: 0xffd2b0, i: 2.2 }, hemi: [0x9ab8ff, 0x3a2418, 0.75],
      glowA: 0xff6a36, glowB: 0x36c9ff, skyline: true,
      lights: [[-26, 9, -26, 0xff6a36], [26, 9, 26, 0xff6a36], [-26, 9, 26, 0x36c9ff], [26, 9, -26, 0x36c9ff], [0, 7, 0, 0x6ab8ff]],
    },
  },
  foundry: {
    id: 'foundry', name: 'Foundry Nine', size: 'Large', players: '4–12',
    modes: ['dm', 'tdm'],
    desc: 'A sprawling smelting complex. A lava pit under the main hall, balconies, container yards and rooftop sniping.',
    build: foundry,
    theme: {
      mats: INDUSTRIAL,
      sky: { top: [0.13, 0.08, 0.07], horizon: [0.75, 0.32, 0.1], nebula: [0.4, 0.12, 0.05], planet: false, stars: false, smog: true },
      fog: [0x2a160c, 50, 230], sun: { dir: [40, 60, 25], color: 0xffb070, i: 2.0 }, hemi: [0xffc8a0, 0x302018, 0.7],
      glowA: 0xff7a20, glowB: 0xffd060, skyline: true,
      lights: [[0, -1.5, 0, 0xff5010, 140, 30], [-30, 10, -30, 0xffa050], [30, 10, 30, 0xffa050], [-30, 10, 30, 0xffa050], [30, 10, -30, 0xffa050], [0, 12, 0, 0xffc890]],
    },
  },
  spires: {
    id: 'spires', name: 'Twin Spires', size: 'Huge', players: '4–16',
    modes: ['ctf', 'tdm'],
    desc: 'Two fortresses face off across a bottomless canyon. Built for Capture the Flag.',
    build: spires,
    theme: {
      mats: { ...INDUSTRIAL, wall: { tex: 'large_sandstone_blocks', tile: 5 }, stone: { tex: 'red_sandstone_wall', tile: 4 }, step: { tex: 'large_sandstone_blocks', tile: 2 } },
      sky: { top: [0.12, 0.22, 0.45], horizon: [0.95, 0.6, 0.38], nebula: [0, 0, 0], planet: true, stars: false, day: true },
      fog: [0x9a8a90, 90, 380], sun: { dir: [50, 70, 30], color: 0xfff0d8, i: 2.8 }, hemi: [0xbcd4ff, 0x6a5040, 1.0],
      glowA: 0xff4d4d, glowB: 0x3d9bff, skyline: false, cliffs: true,
      lights: [[0, 8, -88, 0xff4040], [0, 8, 88, 0x4080ff]],
    },
  },
  skyreach: {
    id: 'skyreach', name: 'Skyreach', size: 'Medium', players: '2–10',
    modes: ['dm', 'tdm', 'duel'], gravity: 0.85,
    desc: 'Sandstone ruins floating above the clouds. Slightly lighter gravity — and a very long fall.',
    build: skyreach,
    theme: {
      mats: { ...INDUSTRIAL, stone: { tex: 'large_sandstone_blocks', tile: 5 }, stone2: { tex: 'red_sandstone_wall', tile: 4 }, pillar: { tex: 'large_sandstone_blocks', tile: 3, tint: 0xe8d8c0 }, step: { tex: 'large_sandstone_blocks', tile: 2 } },
      sky: { top: [0.18, 0.34, 0.7], horizon: [0.9, 0.75, 0.6], nebula: [0, 0, 0], planet: true, stars: false, day: true, clouds: true },
      fog: [0xb8c8e0, 80, 320], sun: { dir: [-40, 60, 30], color: 0xfff4e0, i: 2.6 }, hemi: [0xc8dcff, 0x8a7060, 1.1],
      glowA: 0x5cffd6, glowB: 0x5cc8ff, skyline: false,
      lights: [[0, 10, 0, 0x5cffd6]],
    },
  },
};
