// Synthesised sound effects (no audio files) and a speech-synthesis announcer.
let actx = null, master = null, noiseB = null;
let listener = { x: 0, y: 0, z: 0 };
export const audioSettings = { vol: 0.6, voice: true };

export function initAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = audioSettings.vol;
    const comp = actx.createDynamicsCompressor();
    master.connect(comp).connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
export function setVolume(v) { audioSettings.vol = v; if (master) master.gain.value = v; }
export function setListener(p) { listener = p; }

function noiseBuf() {
  if (!noiseB) {
    noiseB = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseB.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseB;
}

// kind: sound name; pos: optional world position for distance attenuation
export function sfx(kind, pos, opts = {}) {
  if (!actx) return;
  const a = actx, t = a.currentTime + (opts.delay || 0);
  let vol = opts.vol ?? 1;
  if (pos) {
    const d = Math.hypot(pos[0] - listener.x, pos[1] - listener.y, pos[2] - listener.z);
    vol *= Math.max(0, 1 - d / (opts.range || 70)) ** 1.5;
    if (vol < 0.02) return;
  }
  const out = a.createGain(); out.gain.value = vol; out.connect(master);
  const noise = (dur, freq, q = 1, gain = 1, type = 'lowpass', sweepTo = null) => {
    const s = a.createBufferSource(); s.buffer = noiseBuf();
    s.playbackRate.value = 0.5 + Math.random();
    const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + dur + 0.05);
  };
  const tone = (type, f0, f1, dur, gain = 0.3, attack = 0) => {
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = a.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); }
    else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  };
  switch (kind) {
    // weapons
    case 'w0': tone('square', 1100, 220, 0.12, 0.16); noise(0.08, 3500, 1, 0.35); break;
    case 'w0alt': tone('square', 900, 200, 0.08, 0.12); noise(0.06, 3000, 1, 0.3); break;
    case 'w1': noise(0.38, 1600, 0.7, 1.2); tone('sawtooth', 150, 40, 0.28, 0.32); break;
    case 'w1alt': tone('sine', 260, 120, 0.18, 0.35); noise(0.12, 900, 1, 0.4); break;
    case 'w2': tone('sawtooth', 1500, 520, 0.06, 0.11); noise(0.05, 5200, 1, 0.22, 'bandpass'); break;
    case 'w2alt': tone('sine', 420, 90, 0.4, 0.3); tone('triangle', 840, 200, 0.3, 0.12); break;
    case 'w3': noise(0.08, 2600 + Math.random() * 2000, 6, 0.35, 'bandpass'); tone('square', 60 + Math.random() * 40, 50, 0.07, 0.08); break;
    case 'w3alt': tone('sine', 140, 30, 0.6, 0.6); noise(0.5, 800, 0.6, 0.8, 'lowpass', 120); tone('sawtooth', 2000, 100, 0.25, 0.12); break;
    case 'w4': noise(0.3, 2200, 0.8, 1.0); tone('square', 320, 90, 0.2, 0.18); noise(0.15, 7000, 4, 0.25, 'bandpass'); break;
    case 'w4alt': tone('sine', 220, 90, 0.25, 0.4); noise(0.15, 1200, 1, 0.5); break;
    case 'w5': case 'w5alt': noise(0.55, 700, 0.5, 0.7); tone('triangle', 230, 60, 0.45, 0.32); break;
    case 'w6': tone('sawtooth', 2600, 70, 0.65, 0.24); tone('sine', 110, 40, 0.55, 0.45); noise(0.32, 6500, 2, 0.32, 'highpass'); break;
    case 'w7': tone('sine', 60, 30, 1.6, 0.9); tone('sawtooth', 120, 40, 1.2, 0.25); noise(1.2, 300, 0.4, 0.6); break;
    case 'zoom': tone('sine', 900, 1400, 0.08, 0.05); break;
    case 'load': tone('square', 500 + (opts.n || 0) * 150, 500 + (opts.n || 0) * 150, 0.06, 0.08); break;
    // impacts
    case 'boom': noise(1.1, 450, 0.4, 1.7); tone('sine', 85, 28, 0.9, 0.8); break;
    case 'boomSmall': noise(0.6, 700, 0.5, 1.1); tone('sine', 120, 40, 0.5, 0.5); break;
    case 'plasma': tone('sine', 600, 80, 0.4, 0.35); noise(0.3, 2500, 2, 0.4, 'bandpass', 300); break;
    case 'nova': noise(2.8, 220, 0.3, 2.5); tone('sine', 50, 18, 2.6, 1.2); tone('sawtooth', 300, 30, 1.5, 0.3); break;
    case 'blast': tone('sine', 180, 40, 0.5, 0.7); noise(0.45, 1200, 0.5, 0.9, 'lowpass', 150); break;
    case 'zap': noise(0.05, 4000, 3, 0.25, 'bandpass'); break;
    case 'ric': tone('sine', 2400 + Math.random() * 1500, 1800, 0.12, 0.06); break;
    // movement
    case 'jump': tone('sine', 300, 520, 0.12, 0.07); break;
    case 'airjump': tone('sine', 420, 820, 0.14, 0.09); noise(0.12, 2000, 1, 0.12, 'highpass'); break;
    case 'dodge': noise(0.25, 1200, 0.8, 0.35, 'bandpass', 400); tone('sine', 200, 120, 0.15, 0.08); break;
    case 'pad': tone('sine', 200, 1300, 0.45, 0.24); noise(0.3, 900, 1, 0.3, 'bandpass', 3000); break;
    case 'land': noise(0.1, 260, 1, 0.45); tone('sine', 90, 50, 0.1, 0.2); break;
    case 'step': noise(0.05, 500 + Math.random() * 300, 2, 0.12, 'bandpass'); break;
    // feedback
    case 'pick': tone('square', 660, 660, 0.06, 0.1); tone('square', 990, 990, 0.08, 0.1, 0.07); break;
    case 'pickHealth': tone('sine', 520, 780, 0.2, 0.18); break;
    case 'pickArmor': tone('triangle', 330, 330, 0.08, 0.2); tone('triangle', 495, 495, 0.15, 0.18, 0.08); break;
    case 'pickPower': tone('sawtooth', 220, 880, 0.6, 0.18); tone('sine', 440, 1760, 0.6, 0.14); break;
    case 'hit': tone('sine', 1800, 1600, 0.05, 0.18); break;
    case 'headshot': tone('sine', 2600, 2600, 0.12, 0.22); tone('sine', 3900, 3900, 0.16, 0.14); break;
    case 'hurt': noise(0.15, 500, 1, 0.6); tone('sine', 140, 70, 0.15, 0.4); break;
    case 'frag': tone('square', 440, 440, 0.08, 0.13); tone('square', 880, 880, 0.14, 0.13, 0.09); break;
    case 'die': tone('sawtooth', 300, 40, 0.7, 0.25); break;
    case 'empty': tone('square', 200, 180, 0.04, 0.1); break;
    case 'count': tone('square', 660, 660, 0.15, 0.15); break;
    case 'fight': tone('sawtooth', 440, 880, 0.4, 0.2); tone('square', 660, 1320, 0.4, 0.12); break;
    case 'flagTake': tone('sawtooth', 300, 600, 0.3, 0.18); tone('sawtooth', 450, 900, 0.3, 0.12, 0.15); break;
    case 'flagCap': [523, 659, 784, 1046].forEach((f, i) => { const o = { delay: i * 0.12 }; sfxTone(f, o); }); break;
    case 'flagReturn': tone('sine', 880, 440, 0.4, 0.2); break;
    case 'msg': tone('sine', 1200, 1200, 0.05, 0.06); break;
  }
}
function sfxTone(f, o) {
  const a = actx, t = a.currentTime + o.delay;
  const osc = a.createOscillator(); osc.type = 'square'; osc.frequency.value = f;
  const g = a.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(g).connect(master); osc.start(t); osc.stop(t + 0.3);
}

// ---------------------------------------------------------------- announcer
let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  return vs.find(v => /en/i.test(v.lang) && /male|daniel|david|george|alex|google uk english male/i.test(v.name)) || vs.find(v => /en/i.test(v.lang)) || vs[0] || null;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
let lastSpoken = 0;
export function speak(text, priority = false) {
  if (!audioSettings.voice || !('speechSynthesis' in window)) return;
  const now = performance.now();
  if (!priority && now - lastSpoken < 700) return;
  lastSpoken = now;
  if (priority) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  voice ||= pickVoice();
  if (voice) u.voice = voice;
  u.rate = 1.05; u.pitch = 0.55; u.volume = Math.min(1, audioSettings.vol * 1.6);
  speechSynthesis.speak(u);
}
