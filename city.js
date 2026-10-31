// Grok Office - the city around the tower, the day/night cycle, traffic, pedestrians and street lighting.
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { Batch } from './batch.js';

export const GROUND_Y = -13.6;          // street level (4 floors of 3.4 below the office floor)
const FLOOR_H = 3.4, TILE_W = 14.4, TILE_H = 27.2;   // facade texture tile = 8 columns x 8 floors
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rngOf = (seed) => { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

// ================================================================ TIME OF DAY
const KEY = (h, top, bot, key, keyCol, hemi, hs, hg, lamp) => ({ h, top: new THREE.Color(top), bot: new THREE.Color(bot), key, keyCol: new THREE.Color(keyCol), hemi, hs: new THREE.Color(hs), hg: new THREE.Color(hg), lamp });
const DAY = ['#4a9be8', '#cde7f6', 2.5, '#fff0d8', 1.5, '#fff6e6', '#9a8f78', 0], NIGHT = ['#070d24', '#1d2b58', 0.55, '#8fa8ff', 0.5, '#34447f', '#15152a', 1];
const KEYS = [
  KEY(0, ...NIGHT), KEY(5, '#0b1332', '#26346a', 0.5, '#8fa8ff', 0.5, '#34447f', '#15152a', 1),
  KEY(6.0, '#3a5599', '#f4a371', 0.2, '#ffa070', 0.8, '#9aa6d8', '#6b5a5a', 0.7), KEY(6.7, '#5b9de0', '#ffd9a8', 1.4, '#ffd8b0', 1.1, '#d8dff0', '#9a8872', 0.15),
  KEY(8, ...DAY), KEY(16.4, ...DAY),
  KEY(17.4, '#5a92d8', '#ffd49c', 1.8, '#ffcf9a', 1.2, '#f6e6d0', '#8f8270', 0.1), KEY(18.0, '#464a96', '#ff8f5a', 0.2, '#ff9a6a', 0.8, '#b6a0c0', '#5a4a52', 0.65),
  KEY(19.0, '#1b2556', '#8a4f78', 0.45, '#8fa8ff', 0.55, '#4a5590', '#22202e', 1), KEY(20, '#0b1332', '#26346a', 0.5, '#8fa8ff', 0.5, '#34447f', '#15152a', 1), KEY(24, ...NIGHT)
];
const E = { top: new THREE.Color(), bot: new THREE.Color(), key: 0, keyCol: new THREE.Color(), hemi: 0, hs: new THREE.Color(), hg: new THREE.Color(), lamp: 0, hour: 0, sunPos: new THREE.Vector3(), sunUp: true, phase: 0 };
export function envAt(hour) {
  const h = ((hour % 24) + 24) % 24; let i = 0; while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = smooth(0, 1, (h - a.h) / (b.h - a.h));
  E.top.copy(a.top).lerp(b.top, t); E.bot.copy(a.bot).lerp(b.bot, t); E.keyCol.copy(a.keyCol).lerp(b.keyCol, t); E.hs.copy(a.hs).lerp(b.hs, t); E.hg.copy(a.hg).lerp(b.hg, t);
  E.key = a.key + (b.key - a.key) * t; E.hemi = a.hemi + (b.hemi - a.hemi) * t; E.lamp = a.lamp + (b.lamp - a.lamp) * t; E.hour = h;
  // sun by day (06-18), moon by night, same arc; light direction follows whichever is up
  const sunUp = h >= 6 && h < 18, ph = (sunUp ? (h - 6) : ((h + 6) % 24)) / 12 * Math.PI; E.sunUp = sunUp; E.phase = ph / Math.PI;
  E.sunPos.set(-Math.cos(ph) * 0.9, Math.max(Math.sin(ph) * 0.85, 0.12), 0.38).normalize();
  return E;
}
const BKK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const realHour = () => { const p = Object.fromEntries(BKK.formatToParts(new Date()).map((x) => [x.type, x.value])); return (+p.hour % 24) + (+p.minute) / 60 + (+p.second) / 3600; };
// ?time=day|night|cycle (default: real Asia/Bangkok time); ?time=18.5 or ?hour=18.5 pins an hour; ?speed=<seconds per day> for cycle (default 72)
export class Clock {
  constructor(qs) {
    const t = (qs.get('time') || '').toLowerCase(), hp = parseFloat(qs.get('hour')); this.speed = Math.max(10, +qs.get('speed') || 72);
    this.mode = t === 'day' || t === 'night' || t === 'cycle' ? t : 'real'; this.fixed = null; this.t0 = performance.now();
    if (isFinite(hp)) { this.mode = 'fixed'; this.fixed = hp; } else if (t !== '' && isFinite(parseFloat(t))) { this.mode = 'fixed'; this.fixed = parseFloat(t); }
    this.start = this.mode === 'cycle' ? 5.2 : 0;
  }
  hour() {
    if (this.mode === 'real') return realHour();
    if (this.mode === 'day') return 13;
    if (this.mode === 'night') return 23.5;
    if (this.mode === 'fixed') return this.fixed;
    return (this.start + (performance.now() - this.t0) / 1000 / this.speed * 24) % 24;
  }
  get label() { return { real: '', day: ' (demo ngày)', night: ' (demo đêm)', cycle: ' (demo chu kỳ)', fixed: ' (demo)' }[this.mode]; }
}

// ================================================================ FACADE TEXTURES (day colour map + night emissive map, 8 columns x 8 floors per tile)
function facadeTextures(maxAniso) {
  const W = 512, H = 1024, cw = 64, ch = 128, rnd = rngOf(77);
  const day = document.createElement('canvas'), nit = document.createElement('canvas'); day.width = nit.width = W; day.height = nit.height = H;
  const d = day.getContext('2d'), n = nit.getContext('2d'); d.fillStyle = '#c4c9d1'; d.fillRect(0, 0, W, H); n.fillStyle = '#000'; n.fillRect(0, 0, W, H);
  const lit = ['#ffd98a', '#ffe6b0', '#fff3d2', '#ffcf80', '#cfe6ff', '#ffe9c4'];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const x = c * cw + 9, y = r * ch + 20, w = cw - 18, h = ch - 46;
    const g = d.createLinearGradient(0, y, 0, y + h); const j = Math.floor(rnd() * 22);
    g.addColorStop(0, `rgb(${150 + j},${196 + j},${226 + j / 2})`); g.addColorStop(1, `rgb(${84 + j},${132 + j},${178 + j / 2})`);
    d.fillStyle = g; d.fillRect(x, y, w, h);
    if (rnd() < 0.22) { d.fillStyle = 'rgba(235,240,245,.55)'; d.fillRect(x, y, w, h * (0.25 + rnd() * 0.45)); }   // blinds
    d.fillStyle = 'rgba(255,255,255,.16)'; d.fillRect(x + w / 2 - 1, y, 2, h);
    if (rnd() < 0.55) { n.fillStyle = lit[Math.floor(rnd() * lit.length)]; n.globalAlpha = 0.75 + rnd() * 0.25; n.fillRect(x, y, w, h); n.globalAlpha = 1; }
  }
  const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(4, maxAniso || 1); return t; };
  return { map: mk(day), emissiveMap: mk(nit) };
}

// ================================================================ CITY
const BW = 26.2, BD = 22.4, PX = 31.2, PZ = 27.4, CXB = 0.5, CZB = 2.0, SIDE = 1.7;   // block (incl. sidewalk) size, street pitch, tower block centre
const xs = (i) => CXB + (i - 0.5) * PX, zs = (j) => CZB + (j - 0.5) * PZ;            // street centre between block i-1/i and j-1/j
const BI = [-3, 3], BJ = [-5, 3];
const LANE = 1.15, HALF_ST = 2.5, STOP = 3.5, CAR_L = 2.6;
export function lightState(axis, i, j, T) {   // axis 'x' = east-west traffic
  const t = (T + ((i * 7 + j * 5) % 4 + 4) % 4 * 3) % 24, ew = t < 10 ? 'g' : t < 12 ? 'y' : 'r', ns = t < 12 ? 'r' : t < 22 ? 'g' : 'y';
  return axis === 'x' ? ew : ns;
}
const radial = (() => { let t; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,240,190,1)'); g.addColorStop(0.35, 'rgba(255,225,150,.45)'); g.addColorStop(1, 'rgba(255,220,140,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (t = new THREE.CanvasTexture(c)); }; })();

export class City {
  constructor(scene, { mobile = false, maxAniso = 1 } = {}) {
    this.scene = scene; this.mobile = mobile; this.T = 0;
    const tx = facadeTextures(maxAniso);
    this.facadeMat = new THREE.MeshLambertMaterial({ map: tx.map, emissiveMap: tx.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
    this.cityMeshes = []; this.sig = ''; this.clip = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e4);
    this.makeGround(); this.makeLamps(); this.makeLights(); this.makeTraffic(); this.makePeds();
  }
  add(...ms) { for (const m of ms) { m.material.clippingPlanes = [this.clip]; this.scene.add(m); } }
  // buildings are (re)generated for the current view: nothing taller than the sky strip allows, nothing beyond the horizon edge
  rebuild(view) {
    for (const m of this.cityMeshes) { this.scene.remove(m); m.geometry.dispose(); } this.cityMeshes = [];
    this.fb = { pos: [], nor: [], uv: [], col: [], idx: [] }; this.view = view; this.makeCity(view);
    const g = new THREE.BufferGeometry(), f = this.fb;
    g.setAttribute('position', new THREE.Float32BufferAttribute(f.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(f.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(f.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(f.col, 3)); g.setIndex(f.idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.facadeMat); this.add(m); this.cityMeshes.push(m);
  }
  // ---- facade box: windows on the 4 sides, plain roof. uv is scaled to world size so every building has aligned floors
  box(x0, x1, y0, y1, z0, z1, tint, seed = 0) {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0, g = new THREE.BoxGeometry(w, h, d), rnd = rngOf(seed + 1);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); const f = this.fb, base = f.pos.length / 3, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const ou = rnd(), ov = (y0 - GROUND_Y) / TILE_H, widths = [d, d, 0, 0, w, w], c = new THREE.Color(tint);
    for (let i = 0; i < P.count; i++) {
      const face = Math.floor(i / 4), roof = face === 2 || face === 3; f.pos.push(P.getX(i), P.getY(i), P.getZ(i)); f.nor.push(N.getX(i), N.getY(i), N.getZ(i));
      if (roof) f.uv.push(0.02, 0.02); else f.uv.push(U.getX(i) * widths[face] / TILE_W + ou + face * 0.17, U.getY(i) * h / TILE_H + ov);
      const k = face === 2 ? 0.8 : face === 3 ? 0.5 : 1; f.col.push(c.r * k, c.g * k, c.b * k);
    }
    for (const ix of g.index.array) f.idx.push(base + ix); g.dispose();
  }
  makeGround() {
    const B = new Batch(), GY = GROUND_Y;
    for (let i = BI[0]; i <= BI[1]; i++) for (let j = BJ[0]; j <= BJ[1]; j++) {      // sidewalk plates per block
      const cx = CXB + i * PX, cz = CZB + j * PZ; B.span(cx - BW / 2, cx + BW / 2, GY, GY + 0.16, cz - BD / 2, cz + BD / 2, 0xb7b4ac);
      B.span(cx - BW / 2 + 0.12, cx + BW / 2 - 0.12, GY + 0.16, GY + 0.18, cz - BD / 2 + 0.12, cz + BD / 2 - 0.12, 0xc9c6bd);
    }
    // lane markings + crosswalks
    const dash = 0xe9e6da;
    for (let j = BJ[0]; j <= BJ[1] + 1; j++) { const z = zs(j); for (let x = xs(BI[0]) - 4; x < xs(BI[1] + 1); x += 4) { if (Math.abs(((x - xs(0)) % PX + PX) % PX) > HALF_ST + 2 && Math.abs(((x - xs(0)) % PX + PX) % PX - PX) > HALF_ST + 2) B.span(x, x + 1.8, GY + 0.01, GY + 0.03, z - 0.07, z + 0.07, dash); } }
    for (let i = BI[0]; i <= BI[1] + 1; i++) { const x = xs(i); for (let z = zs(BJ[0]) - 4; z < zs(BJ[1] + 1); z += 4) { const m = ((z - zs(0)) % PZ + PZ) % PZ; if (m > HALF_ST + 2 && PZ - m > HALF_ST + 2) B.span(x - 0.07, x + 0.07, GY + 0.01, GY + 0.03, z, z + 1.8, dash); } }
    for (let i = -2; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const x = xs(i), z = zs(j);
      for (let k = -2; k <= 2; k++) { for (const s of [-1, 1]) { B.span(x + k * 0.9 - 0.25, x + k * 0.9 + 0.25, GY + 0.01, GY + 0.03, z + s * (HALF_ST + 0.15) - 0.55, z + s * (HALF_ST + 0.15) + 0.55, dash); B.span(x + s * (HALF_ST + 0.15) - 0.55, x + s * (HALF_ST + 0.15) + 0.55, GY + 0.01, GY + 0.03, z + k * 0.9 - 0.25, z + k * 0.9 + 0.25, dash); } }
    }
    const m = B.build(new THREE.MeshLambertMaterial({ vertexColors: true }), false, false); this.add(m);
    // asphalt: a huge box whose far edge is the horizon (placed by setHorizon)
    this.ground = new THREE.Mesh(new THREE.BoxGeometry(600, 1, 600), new THREE.MeshLambertMaterial({ color: 0x4a4d54 }));
    this.ground.position.y = GY - 0.5; this.add(this.ground);
  }
  makeCity(view) {
    const rnd = rngOf(2024), tints = [0xffffff, 0xe8f0ff, 0xf6efe2, 0xdfe6ef, 0xd4dce8, 0xf0e6dc, 0xc9d6e6];
    const roofB = new Batch(), roofCol = [0x8f949c, 0x7d838b, 0xa6a9ae], { sinY, cosY, sp, cp } = view, capUp = view.upH + 0.5 * (view.upTop - view.upH);
    for (let i = BI[0]; i <= BI[1]; i++) for (let j = BJ[0]; j <= BJ[1]; j++) {
      if (i === 0 && j === 0) continue;                                              // our tower is built below
      const cx = CXB + i * PX, cz = CZB + j * PZ, x0 = cx - BW / 2 + SIDE, x1 = cx + BW / 2 - SIDE, z0 = cz - BD / 2 + SIDE, z1 = cz + BD / 2 - SIDE;
      const front = (i >= 1 && j >= 0) || j >= 1;                                    // between us and the camera: low, so streets stay visible
      const pat = rnd(), lots = [];
      if (pat < 0.35) lots.push([x0, x1, z0, z1]);
      else if (pat < 0.7) { const m = x0 + (x1 - x0) * (0.4 + rnd() * 0.2); lots.push([x0, m - 0.6, z0, z1], [m + 0.6, x1, z0, z1]); }
      else { const mx = x0 + (x1 - x0) * (0.4 + rnd() * 0.2), mz = z0 + (z1 - z0) * (0.4 + rnd() * 0.2); lots.push([x0, mx - 0.5, z0, mz - 0.5], [mx + 0.5, x1, z0, mz - 0.5], [x0, mx - 0.5, mz + 0.5, z1], [mx + 0.5, x1, mz + 0.5, z1]); }
      lots.forEach(([a, b, c, d], k) => {
        const ia = a + rnd() * 0.8, ib = b - rnd() * 0.8, ic = c + rnd() * 0.8, id = d - rnd() * 0.8, mx = (ia + ib) / 2, mz = (ic + id) / 2;
        const q = -(mx * sinY + mz * cosY), r = mx * cosY - mz * sinY;
        if (q - Math.max(ib - ia, id - ic) / 2 > view.qE - 1) { rnd(); rnd(); return; }       // beyond the horizon edge
        let h = front ? 3.4 + rnd() * 3.6 : 8 + rnd() * 52;
        if (!front && Math.abs(r - view.rc) < view.hw * 0.9) h = Math.min(h, (capUp - sp * q) / cp - GROUND_Y);   // keep the sky strip open behind the office
        h = Math.max(FLOOR_H, Math.round(h / FLOOR_H) * FLOOR_H);
        this.box(ia, ib, GROUND_Y + 0.17, GROUND_Y + h, ic, id, tints[Math.floor(rnd() * tints.length)], hash(i + ',' + j + ',' + k));
        const top = GROUND_Y + h;                                                    // rooftop plant + antenna
        roofB.span(mx - 0.9, mx + 0.9, top, top + 0.7, mz - 0.7, mz + 0.7, roofCol[Math.floor(rnd() * 3)]);
        if (h > 18 && rnd() < 0.6) roofB.span(mx + 1.4, mx + 1.5, top, top + 3.2 + rnd() * 3, mz, mz + 0.1, 0x555a62);
      });
    }
    const rm = roofB.build(new THREE.MeshLambertMaterial({ vertexColors: true }), false, false); this.add(rm); this.cityMeshes.push(rm);
    // our tower: facade under the office floor, from street to floor plate
    this.box(-10.4, 11.4, GROUND_Y + 0.17, -0.02, -7.4, 11.4, 0xffffff, 5);
    const p = new Batch();   // tower plaza + ground-floor canopy
    p.span(-10.4, 11.4, GROUND_Y + 0.18, GROUND_Y + 0.26, -7.4, 11.4, 0x9a9890); p.span(2.2, 4.8, GROUND_Y + 2.6, GROUND_Y + 2.75, 11.4, 12.7, 0xc23a2e);
    const pm = p.build(new THREE.MeshLambertMaterial({ vertexColors: true }), false, false); this.add(pm); this.cityMeshes.push(pm);
  }
  // ---- street lamps (static posts + instanced emissive heads + additive ground glow)
  makeLamps() {
    const B = new Batch(), spots = [], step = this.mobile ? 16 : 10;
    for (let i = -2; i <= 2; i++) for (let j = -3; j <= 2; j++) {
      const cx = CXB + i * PX, cz = CZB + j * PZ, hx = BW / 2 - 0.5, hz = BD / 2 - 0.5;
      for (let t = -hx + 2; t <= hx - 2; t += step) { spots.push([cx + t, cz + hz]); spots.push([cx + t, cz - hz]); }
      for (let t = -hz + 2; t <= hz - 2; t += step) { spots.push([cx + hx, cz + t]); spots.push([cx - hx, cz + t]); }
    }
    const GY = GROUND_Y + 0.18; for (const [x, z] of spots) B.span(x - 0.07, x + 0.07, GY, GY + 2.6, z - 0.07, z + 0.07, 0x2c3138);
    this.add(B.build(new THREE.MeshLambertMaterial({ vertexColors: true }), false, false));
    const n = spots.length, dm = new THREE.Object3D();
    this.lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), this.lampMat = new THREE.MeshBasicMaterial({ color: 0x777c84 }), n);
    this.lampGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2), this.lampGlowMat = new THREE.MeshBasicMaterial({ map: radial(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), n);
    spots.forEach(([x, z], k) => { dm.position.set(x, GY + 2.65, z); dm.updateMatrix(); this.lampHeads.setMatrixAt(k, dm.matrix); dm.position.set(x, GY + 0.1, z); dm.updateMatrix(); this.lampGlow.setMatrixAt(k, dm.matrix); });
    this.lampGlow.renderOrder = 6; this.add(this.lampHeads, this.lampGlow);
  }
  // ---- traffic light poles (static) + instanced bulbs
  makeLights() {
    const B = new Batch(), GY = GROUND_Y + 0.18; this.inter = [];
    for (let i = -2; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const x = xs(i), z = zs(j), poles = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = x + sx * (HALF_ST + 0.55), pz = z + sz * (HALF_ST + 0.55);
        B.span(px - 0.07, px + 0.07, GY, GY + 3.1, pz - 0.07, pz + 0.07, 0x2c3138); B.span(px - 0.17, px + 0.17, GY + 3.1, GY + 4.0, pz - 0.14, pz + 0.14, 0x1d2025);
        poles.push({ px, pz, axis: sx * sz > 0 ? 'x' : 'z' });
      }
      this.inter.push({ i, j, x, z, poles, key: '' });
    }
    this.add(B.build(new THREE.MeshLambertMaterial({ vertexColors: true }), false, false));
    const n = this.inter.length * 12; this.bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 0.28), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.bulbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); const dm = new THREE.Object3D(); let k = 0;
    for (const it of this.inter) for (const p of it.poles) for (let b = 0; b < 3; b++) { dm.position.set(p.px, GY + 3.78 - b * 0.3, p.pz); dm.updateMatrix(); this.bulbs.setMatrixAt(k++, dm.matrix); }
    this.add(this.bulbs);
  }
  updateLights() {
    const C = { r: new THREE.Color(0xff3a2a), y: new THREE.Color(0xffc23a), g: new THREE.Color(0x3aff6a) }, D = { r: new THREE.Color(0x3a0e0c), y: new THREE.Color(0x3a2c0c), g: new THREE.Color(0x0c3a1a) };
    let k = 0;
    for (const it of this.inter) {
      const sx = lightState('x', it.i, it.j, this.T), sz = lightState('z', it.i, it.j, this.T), key = sx + sz; if (key === it.key) { k += 12; continue; } it.key = key;
      for (const p of it.poles) { const s = p.axis === 'x' ? sx : sz; for (const [b, c] of [['r', 0], ['y', 1], ['g', 2]]) this.bulbs.setColorAt(k++, s === b ? C[b] : D[b]); }
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
  }
  // ---- cars
  makeTraffic() {
    const rnd = rngOf(99), spacing = this.mobile ? 44 : 20; this.lanes = [];
    const xr = [xs(-2) - 6, xs(3) + 6], zr = [zs(-3) - 6, zs(3) + 6];
    const cross = (list) => list.map((c, idx) => ({ c, idx }));
    for (let j = -3; j <= 3; j++) for (const dir of [1, -1]) this.lanes.push({ axis: 'x', c: zs(j) + dir * LANE, j, dir, min: xr[0], max: xr[1], cross: cross([-2, -1, 0, 1, 2, 3].map(xs)), crossIdx: [-2, -1, 0, 1, 2, 3], cars: [] });
    for (let i = -2; i <= 3; i++) for (const dir of [1, -1]) this.lanes.push({ axis: 'z', c: xs(i) - dir * LANE, i, dir, min: zr[0], max: zr[1], cross: cross([-3, -2, -1, 0, 1, 2, 3].map(zs)), crossIdx: [-3, -2, -1, 0, 1, 2, 3], cars: [] });
    const palette = [0xf4f4f0, 0x1c1f24, 0xc92f2f, 0xf2c230, 0x2f6fd0, 0x8a8f98, 0x2c8f5a, 0xf08a2a]; this.cars = [];
    for (const ln of this.lanes) { const L = ln.max - ln.min, n = Math.max(2, Math.floor(L / spacing)); for (let k = 0; k < n; k++) { const car = { ln, s: ln.min + (k + rnd() * 0.6) * (L / n), v: 0, vmax: 4 + rnd() * 1.6, col: palette[Math.floor(rnd() * palette.length)], taxi: rnd() < 0.12 }; if (car.taxi) car.col = 0xf2c230; ln.cars.push(car); this.cars.push(car); } }
    const n = this.cars.length; this.carBody = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 0.5, CAR_L), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    this.carTop = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.4, 1.3), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xd8d6c8 }); this.tailMat = new THREE.MeshBasicMaterial({ color: 0x7a2a2a });
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.16, 0.08), this.headMat, n * 2); this.tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.14, 0.08), this.tailMat, n * 2);
    this.beam = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 4.8).rotateX(-Math.PI / 2).translate(0, 0, 3.6), this.beamMat = new THREE.MeshBasicMaterial({ map: radial(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0xfff0c0 }), n);
    this.beam.renderOrder = 6;
    this.cars.forEach((c, k) => { const col = new THREE.Color(c.col); this.carBody.setColorAt(k, col); this.carTop.setColorAt(k, c.taxi ? col : col.clone().multiplyScalar(0.8)); });
    this.carGroup = [this.carBody, this.carTop, this.heads, this.tails, this.beam]; this.carGroup.forEach((m) => { m.frustumCulled = false; this.add(m); });
    this.dm = new THREE.Object3D();
  }
  updateCars(dt) {
    const a = 4.2, dm = this.dm, GY = GROUND_Y + 0.02;
    for (const ln of this.lanes) {
      const L = ln.max - ln.min, cars = ln.cars, d = ln.dir; cars.sort((p, q) => p.s * d - q.s * d);
      for (let k = 0; k < cars.length; k++) {
        const c = cars[k], nxt = cars[(k + 1) % cars.length], p = c.s;
        let vt = c.vmax, gap = cars.length > 1 ? ((nxt.s - c.s) * d + (k === cars.length - 1 ? L : 0)) - CAR_L - 0.5 : 99; if (gap < 0.05) gap = 0;
        vt = Math.min(vt, Math.sqrt(2 * a * gap) * 0.9);
        for (let q = 0; q < ln.cross.length; q++) {                                           // next stop line ahead
          const ds = (ln.cross[q].c - p) * d - STOP; if (ds < -0.45 || ds > 14) continue;
          const st = ln.axis === 'x' ? lightState('x', ln.crossIdx[q], ln.j, this.T) : lightState('z', ln.i, ln.crossIdx[q], this.T);
          if (st === 'g') continue; if (st === 'y' && ds < c.v * c.v / (2 * a) + 0.3) continue;
          vt = Math.min(vt, ds < 0.15 ? 0 : Math.sqrt(2 * a * ds) * 0.9); break;
        }
        c.v += clamp(vt - c.v, -a * 1.6 * dt, 2.2 * dt); c.s += c.v * d * dt; if (d > 0 && c.s > ln.max) c.s -= L; else if (d < 0 && c.s < ln.min) c.s += L;
      }
    }
    this.cars.forEach((c, k) => {
      const ln = c.ln, x = ln.axis === 'x' ? c.s : ln.c, z = ln.axis === 'x' ? ln.c : c.s, yaw = ln.axis === 'x' ? (ln.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (ln.dir > 0 ? 0 : Math.PI), s = Math.sin(yaw), co = Math.cos(yaw);
      dm.rotation.set(0, yaw, 0); dm.scale.set(1, 1, 1); dm.position.set(x, GY + 0.45, z); dm.updateMatrix(); this.carBody.setMatrixAt(k, dm.matrix);
      dm.position.set(x - s * 0.1, GY + 0.87, z - co * 0.1); dm.updateMatrix(); this.carTop.setMatrixAt(k, dm.matrix);
      dm.position.set(x, GY, z); dm.updateMatrix(); this.beam.setMatrixAt(k, dm.matrix);
      for (const sd of [-1, 1]) {
        dm.position.set(x + co * sd * 0.4 + s * (CAR_L / 2), GY + 0.5, z - s * sd * 0.4 + co * (CAR_L / 2)); dm.updateMatrix(); this.heads.setMatrixAt(k * 2 + (sd > 0 ? 1 : 0), dm.matrix);
        dm.position.set(x + co * sd * 0.4 - s * (CAR_L / 2), GY + 0.5, z - s * sd * 0.4 - co * (CAR_L / 2)); dm.updateMatrix(); this.tails.setMatrixAt(k * 2 + (sd > 0 ? 1 : 0), dm.matrix);
      }
    });
    for (const m of this.carGroup) m.instanceMatrix.needsUpdate = true;
  }
  // ---- pedestrians on the sidewalks
  makePeds() {
    const rnd = rngOf(5), n = this.mobile ? 22 : 60; this.peds = [];
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rnd() * 5) - 2, j = Math.floor(rnd() * 6) - 3, cx = CXB + i * PX, cz = CZB + j * PZ, hx = BW / 2 - 0.85, hz = BD / 2 - 0.85, edge = Math.floor(rnd() * 4);
      this.peds.push({ cx, cz, hx, hz, edge, t: (rnd() * 2 - 1) * (edge < 2 ? hx : hz), dir: rnd() < 0.5 ? 1 : -1, sp: 0.8 + rnd() * 0.7, ph: rnd() * 6, col: new THREE.Color().setHSL(rnd(), 0.55, 0.5) });
    }
    this.pBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.8, 0.3), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    this.pHead = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0xe8b88a }), n);
    this.peds.forEach((p, k) => this.pBody.setColorAt(k, p.col)); this.pBody.frustumCulled = this.pHead.frustumCulled = false; this.add(this.pBody, this.pHead);
  }
  updatePeds(dt) {
    const dm = this.dm, GY = GROUND_Y + 0.18;
    this.peds.forEach((p, k) => {
      const lim = p.edge < 2 ? p.hx : p.hz; p.t += p.dir * p.sp * dt; if (p.t > lim) { p.t = lim; p.dir = -1; } else if (p.t < -lim) { p.t = -lim; p.dir = 1; }
      const x = p.edge < 2 ? p.cx + p.t : p.cx + (p.edge === 2 ? p.hx : -p.hx), z = p.edge < 2 ? p.cz + (p.edge === 0 ? p.hz : -p.hz) : p.cz + p.t, bob = Math.abs(Math.sin(this.T * 7 * p.sp + p.ph)) * 0.07;
      dm.rotation.set(0, p.edge < 2 ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? 0 : Math.PI), 0); dm.position.set(x, GY + 0.65 + bob, z); dm.updateMatrix(); this.pBody.setMatrixAt(k, dm.matrix);
      dm.position.set(x, GY + 1.2 + bob, z); dm.updateMatrix(); this.pHead.setMatrixAt(k, dm.matrix);
    });
    this.pBody.instanceMatrix.needsUpdate = this.pHead.instanceMatrix.needsUpdate = true;
  }
  // ---- horizon: far edge of the ground sits at screen height `upH` (in camera "up" units), fog fades the city into the sky there
  setHorizon(upH, rig) {
    const Y = rig.yaw, p = rig.pitch, sp = Math.sin(p), cp = Math.cos(p), qE = (upH - cp * GROUND_Y) / sp;
    this.ground.rotation.y = Y; this.clip.normal.set(Math.sin(Y), 0, Math.cos(Y)); this.clip.constant = qE;   // everything beyond the horizon edge is clipped
    const lz = -qE + 300; this.ground.position.set(Math.sin(Y) * lz, GROUND_Y - 0.5, Math.cos(Y) * lz);
    const T = rig.home, qT = -(T.x * Math.sin(Y) + T.z * Math.cos(Y)), dep = (q, y) => 120 + cp * (q - qT) - sp * (y - T.y);
    const depthH = dep(qE, GROUND_Y), depthO = dep(0, 1.5);                  // horizon vs the office floor: haze only starts behind the office
    this.fogNear = depthO + 0.35 * (depthH - depthO); this.fogFar = depthH + 1; this.qE = qE;
    const view = { sinY: Math.sin(Y), cosY: Math.cos(Y), sp, cp, upH, upTop: rig.uc + rig.s0, rc: rig.rc, hw: rig.s0 * rig.aspect, qE };
    const sig = [qE, view.upTop, view.hw].map((v) => Math.round(v)).join(',');
    if (sig !== this.sig) { this.sig = sig; this.rebuild(view); }
  }
  update(dt, env, scene) {
    this.T += dt; this.updateCars(dt); this.updatePeds(dt); this.updateLights();
    const lamp = env.lamp, win = smooth(0.03, 0.85, lamp);
    this.facadeMat.emissiveIntensity = win * 1.5; this.lampMat.color.setScalar(0.45).lerp(new THREE.Color(0xfff0b0), win); this.lampGlowMat.opacity = win * 0.85;
    this.headMat.color.set(0xd8d6c8).lerp(new THREE.Color(0xfffbd0), win); this.tailMat.color.set(0x7a2a2a).lerp(new THREE.Color(0xff2a24), win); this.beamMat.opacity = win * 0.9;
    if (scene.fog) { scene.fog.color.copy(env.bot); scene.fog.near = this.fogNear; scene.fog.far = this.fogFar; }
  }
}
