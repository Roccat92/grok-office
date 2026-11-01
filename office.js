import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// ================================================================ CONFIG
const CONFIG = {
  pollMs: 10000, staleMs: 60000, fetchTimeoutMs: 8000, maxPixelRatio: 2, shadowMap: 2048,
  walkSpeed: 3.0,
  office: { x0: -9, x1: 10, z0: -6, z1: 7, wallH: 3.4 },
  cam: { yawDeg: 45, pitchDeg: 35, focusZoom: 0.36 },
  desk: { cols: [-7.3, -5.0, -2.7, -0.4, 1.9], rows: [-3.4, 0.9], laneA: -0.85, laneB: 3.2, laneX: 3.5 },
  wander: { first: [5, 11], every: [16, 32], coffee: [6, 10] },
  sep: { radius: 1.0, max: 0.75, spawnGap: 1.4 } // min distance between avatars, max sidestep, delay between entrances
};
const STATE = {
  working: { label: 'Đang làm', color: '#5ad07a' }, idle: { label: 'Rảnh', color: '#a7b2ac' }, meeting: { label: 'Họp', color: '#5aa9ff' },
  blocked: { label: 'Bị chặn', color: '#ff5a4d' }, done: { label: 'Xong', color: '#e8ff5a' }
};
const QS = new URLSearchParams(location.search), HORIZON = isFinite(parseFloat(QS.get('horizon'))) ? parseFloat(QS.get('horizon')) : 0.12;   // screen height of the city horizon (-1 bottom .. 1 top)
const MOBILE = QS.get('quality') === 'low' || innerWidth <= 760 || (matchMedia && matchMedia('(pointer: coarse)').matches);
const UI_COL = { working: '#43c59e', idle: '#a3a3a3', meeting: '#7cb7ff', blocked: '#f17b82', done: '#ffc629' };   // HUD/panel status colours (DevHub tokens); the 3D screens keep STATE colours
const ZMIN = 0.16, ZMAX = 1.25;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rr = (a, b) => a + Math.random() * (b - a);
const $ = (s) => document.querySelector(s);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

import { Batch } from './batch.js';
import { City, Clock, envAt, GROUND_Y } from './city.js';

const MAT_V = new THREE.MeshLambertMaterial({ vertexColors: true });
const MAT_GLASS = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false });
const BOX = new THREE.BoxGeometry(1, 1, 1); const MATS = new Map();
const mat = (color) => { let m = MATS.get(color); if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true }); MATS.set(color, m); } return m; };
function part(parent, w, h, d, color, x, y, z) { const m = new THREE.Mesh(BOX, mat(color)); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; }
function canvasTex(w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return { cv, ctx, tex };
}
function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l.length && ctx.measureText(l + '...').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '...'; }
  return lines;
}

// ================================================================ VENUE (island + office diorama)
const O = CONFIG.office, D = CONFIG.desk;
const COFFEE_Z = [4.3, 5.1, 5.9];
const SLOTS = CONFIG.desk.cols.length * 2;   // 10 desks: 5 Grok bots + 5 DevHub agents
const slotPos = (i) => { const col = i >> 1, row = i & 1; return { x: D.cols[col], z: D.rows[row], row }; };
const MEET = { x: 7.6, z: -3.05 };
const MEET_SEATS = (() => {
  const xs = [6.1, 7.1, 8.1, 9.1], s = [];
  for (const x of xs) s.push({ x, z: -4.25, yaw: 0, exit: 'N' });
  for (const x of xs) s.push({ x, z: -1.85, yaw: Math.PI, exit: 'S' });
  return s;
})();

class Venue {
  constructor(scene) {
    this.scene = scene; this.slots = [];
    const B = new Batch(), F = new Batch();
    this.slab(B, F); this.floor(B); this.walls(B, F); this.meeting(B, F); this.coffee(B); this.props(B); this.ceiling(B);
    scene.add(B.build(MAT_V));
    const glass = F.build(MAT_GLASS, false, false); glass.renderOrder = 3; scene.add(glass);
    for (let i = 0; i < SLOTS; i++) this.slots.push(this.makeDesk(i));
    this.makeBoards(); this.makeGraph();
  }
  // floor plate of the tower: office + lobby terrace with glass railing and the lift
  slab(B, F) {
    const x0 = O.x0 - 1.4, x1 = O.x1 + 1.4, z0 = O.z0 - 1.4, z1 = O.z1 + 4.4, pv = 0xcfcdc6;
    B.span(x0, x1, -0.45, -0.02, z0, z1, 0x8d9199); B.span(x0 - 0.05, x1 + 0.05, -0.12, -0.02, z0 - 0.05, z1 + 0.05, 0x5f646c);   // slab + dark edge band
    B.span(x0, x1, -0.03, 0, z0, z1, pv); B.span(2.5, 4.5, -0.01, 0.005, O.z1, z1, 0xb9b6ac);
    // glass railing on all four slab edges (south + east are the ones the camera looks over)
    const gl = (a, b, c, d) => F.span(a, b, 0.05, 1.05, c, d, 0xbfe3f5), fr = 0x2c3138;
    gl(x0, x1, z1 - 0.05, z1); gl(x1 - 0.05, x1, z0, z1); gl(x0, x1, z0, z0 + 0.05); gl(x0, x0 + 0.05, z0, z1);
    B.span(x0, x1, 1.05, 1.11, z1 - 0.07, z1, fr); B.span(x1 - 0.07, x1, 1.05, 1.11, z0, z1, fr); B.span(x0, x1, 1.05, 1.11, z0, z0 + 0.07, fr); B.span(x0, x0 + 0.07, 1.05, 1.11, z0, z1, fr);
    for (let x = x0; x <= x1 + 0.01; x += 2.2) B.span(x - 0.04, x + 0.04, 0, 1.05, z1 - 0.07, z1, fr);
    for (let z = z0; z <= z1 + 0.01; z += 2.2) B.span(x1 - 0.07, x1, 0, 1.05, z - 0.04, z + 0.04, fr);
    // lift lobby: steel shaft on the west end of the terrace, doors on its east face (bots arrive here)
    const lx0 = -5.4, lx1 = -3.6, lz0 = O.z1 + 2.4, lz1 = O.z1 + 4.3;
    B.span(lx0, lx1, 0, 3.2, lz0, lz1, 0x9aa3ad); B.span(lx0 - 0.08, lx1 + 0.08, 3.2, 3.35, lz0 - 0.08, lz1 + 0.08, 0x5f646c);
    B.span(lx1, lx1 + 0.04, 0, 2.5, lz0 + 0.25, lz1 - 0.25, 0x3b4048); B.span(lx1, lx1 + 0.06, 0, 2.45, (lz0 + lz1) / 2 - 0.02, (lz0 + lz1) / 2 + 0.02, 0x1d2025); B.span(lx1, lx1 + 0.05, 2.6, 2.75, (lz0 + lz1) / 2 - 0.2, (lz0 + lz1) / 2 + 0.2, 0xe8ff5a);
  }
  floor(B) {
    B.span(O.x0, O.x1, -0.2, 0, O.z0, O.z1, 0xd9c9a6);           // wooden floor
    B.span(O.x0 + 0.2, 4.2, 0, 0.02, O.z0 + 0.4, O.z1 - 0.3, 0xb8c9bd);       // open-plan carpet
    B.span(4.5, O.x1, 0, 0.02, O.z0, 0.2, 0x8fa3bd);             // meeting room carpet
    for (let i = 0; i < 7; i++) B.span(O.x0, O.x1, 0.0, 0.003, O.z0 + 1.9 * i, O.z0 + 1.9 * i + 0.03, 0xc9b88f);
  }
  walls(B, F) {
    const H = O.wallH, cream = 0xf3ead7, trim = 0xcdbfa4, frame = 0x2c3138, glass = 0xbfe3f5;
    // north wall (z0) with windows
    const nz0 = O.z0, nz1 = O.z0 + 0.3;
    B.span(O.x0, O.x1, 0, 1.0, nz0, nz1, cream); B.span(O.x0, O.x1, 2.7, H, nz0, nz1, cream); B.span(O.x0, O.x1, 0, 0.12, nz0, nz1 + 0.04, trim);
    const wins = [[-8.2, -5.4], [-4.6, -1.8], [-1.0, 1.8]]; let px = O.x0;
    for (const [a, b] of wins) {
      B.span(px, a, 1.0, 2.7, nz0, nz1, cream); px = b;
      F.span(a, b, 1.0, 2.7, nz0 + 0.1, nz1 - 0.1, glass);
      B.span(a - 0.05, b + 0.05, 2.62, 2.7, nz0 - 0.02, nz1 + 0.04, frame); B.span(a - 0.05, b + 0.05, 0.96, 1.04, nz0 - 0.02, nz1 + 0.06, 0xe9e2d3);
      B.span((a + b) / 2 - 0.03, (a + b) / 2 + 0.03, 1.0, 2.7, nz0, nz1 + 0.03, frame);
    }
    B.span(px, O.x1, 1.0, 2.7, nz0, nz1, cream);
    // west wall (x0): whiteboard zone + coffee window
    const wx0 = O.x0, wx1 = O.x0 + 0.3;
    B.span(wx0, wx1, 0, 1.0, O.z0, O.z1, cream); B.span(wx0, wx1, 2.7, H, O.z0, O.z1, cream); B.span(wx0, wx1 + 0.04, 0, 0.12, O.z0, O.z1, trim);
    B.span(wx0, wx1, 1.0, 2.7, O.z0, 3.9, cream); B.span(wx0, wx1, 1.0, 2.7, 6.3, O.z1, cream);
    F.span(wx0 + 0.1, wx1 - 0.1, 1.0, 2.7, 3.9, 6.3, glass);
    B.span(wx0 - 0.02, wx1 + 0.03, 2.62, 2.7, 3.9, 6.3, frame); B.span(wx0 - 0.02, wx1 + 0.06, 0.96, 1.04, 3.9, 6.3, 0xe9e2d3);
    B.span(wx0, wx1 + 0.03, 1.0, 2.7, 5.07, 5.13, frame);
    // corner post
    B.span(wx0, wx0 + 0.34, 0, H + 0.1, O.z0, O.z0 + 0.34, trim);
    // low cutaway walls on the camera side (south z1, east x1) with an entrance gap at x 2.7..4.3
    const lw = 0.55;
    B.span(O.x0, 2.7, 0, lw, O.z1 - 0.25, O.z1, cream); B.span(4.3, O.x1, 0, lw, O.z1 - 0.25, O.z1, cream);
    B.span(O.x0, 2.7, lw, lw + 0.05, O.z1 - 0.27, O.z1 + 0.02, trim); B.span(4.3, O.x1, lw, lw + 0.05, O.z1 - 0.27, O.z1 + 0.02, trim);
    B.span(O.x1 - 0.25, O.x1, 0, lw, 0.2, O.z1, cream); B.span(O.x1 - 0.27, O.x1 + 0.02, lw, lw + 0.05, 0.2, O.z1, trim);
    // red awning over the entrance (red roof touch)
    for (const px2 of [2.55, 4.45]) B.span(px2 - 0.06, px2 + 0.06, 0, 2.5, O.z1 + 1.15, O.z1 + 1.27, 0x5a3a28);
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      const xa = 2.4 + i * (2.2 / stripes), xb = xa + 2.2 / stripes;
      const slope = 0.28; // roof slopes down toward the camera
      B.box((xa + xb) / 2, 2.78, O.z1 + 0.58, xb - xa, 0.1, 1.5, i % 2 ? 0xf2f2f2 : 0xc23a2e, 0, slope, 0);
    }
    B.span(2.4, 4.6, 2.5, 3.0, O.z1 - 0.12, O.z1 - 0.02, 0xc23a2e);
  }
  meeting(B, F) {
    const H = O.wallH, frame = 0x2c3138, glass = 0xbfe3f5;
    // glass walls: west (x=4.5) and front (z=0.2, door gap x 5.2..6.2), east (x=10)
    const gw = (x0, x1, z0, z1) => F.span(x0, x1, 0.05, H - 0.3, z0, z1, glass);
    gw(4.46, 4.54, O.z0 + 0.3, 0.24); gw(4.5, 5.2, 0.16, 0.24); gw(6.2, O.x1 - 0.25, 0.16, 0.24); gw(O.x1 - 0.12, O.x1 - 0.04, O.z0 + 0.3, 0.24);
    B.span(4.42, 4.58, 0, H, O.z0 + 0.3, O.z0 + 0.5, frame); B.span(4.42, 4.58, H - 0.3, H, O.z0 + 0.3, 0.26, frame); B.span(4.42, 4.58, 0, 0.1, O.z0 + 0.3, 0.26, frame);
    B.span(4.42, 5.2, H - 0.3, H, 0.14, 0.26, frame); B.span(6.2, O.x1, H - 0.3, H, 0.14, 0.26, frame);
    B.span(5.14, 5.26, 0, H, 0.14, 0.26, frame); B.span(6.14, 6.26, 0, H, 0.14, 0.26, frame); B.span(5.14, 6.26, 2.5, 2.6, 0.14, 0.26, frame);
    B.span(O.x1 - 0.14, O.x1, 0, H, 0.14, 0.26, frame); B.span(O.x1 - 0.14, O.x1, H - 0.3, H, O.z0 + 0.3, 0.26, frame);
    // table
    B.span(MEET.x - 2.1, MEET.x + 2.1, 0.72, 0.82, MEET.z - 0.8, MEET.z + 0.8, 0xcfae7d);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.span(MEET.x + sx * 1.9 - 0.05, MEET.x + sx * 1.9 + 0.05, 0, 0.72, MEET.z + sz * 0.62 - 0.05, MEET.z + sz * 0.62 + 0.05, 0x7a6a55);
    // laptops
    for (const [lx, lz, ry] of [[6.3, -3.6, 0], [8.9, -3.6, 0], [7.2, -2.5, Math.PI], [8.1, -2.5, Math.PI]]) {
      B.box(lx, 0.84, lz, 0.45, 0.02, 0.3, 0x30363f, ry); B.box(lx, 0.97, lz + (ry ? 0.14 : -0.14), 0.45, 0.28, 0.02, 0x20242b, ry, ry ? -0.2 : 0.2);
    }
    B.span(MEET.x - 0.15, MEET.x + 0.15, 0.82, 0.86, MEET.z - 0.1, MEET.z + 0.1, 0x30363f);
    // chairs
    for (const s of MEET_SEATS) {
      const back = s.yaw === 0 ? -1 : 1;
      B.box(s.x, 0.5, s.z, 0.55, 0.09, 0.5, 0x3b4a63); B.box(s.x, 0.25, s.z, 0.08, 0.4, 0.08, 0x2c3138); B.box(s.x, 0.04, s.z, 0.45, 0.05, 0.45, 0x2c3138);
      B.box(s.x, 0.78, s.z + back * 0.28, 0.52, 0.32, 0.06, 0x3b4a63);
    }
    // corner plant
    B.span(9.35, 9.8, 0, 0.45, -5.4, -4.95, 0xb5523b); B.addGeo(Batch.flat(new THREE.IcosahedronGeometry(1, 0)), 0x3f9e4a, 9.57, 0.95, -5.17, 0.45, 0.6, 0.45);
  }
  coffee(B) {
    const x = O.x0 + 0.3; // counter against the west wall, z 3.9..6.3 under the window
    B.span(x, x + 0.95, 0, 0.9, 3.9, 6.3, 0x6b4630); B.span(x, x + 1.0, 0.9, 0.97, 3.88, 6.32, 0xe9e2d3);
    B.span(x + 0.78, x + 0.9, 0.1, 0.85, 4.05, 4.12, 0x55361f);
    B.span(x + 0.15, x + 0.55, 0.97, 1.42, 4.2, 4.65, 0xb83a2f); B.span(x + 0.2, x + 0.5, 1.2, 1.3, 4.65, 4.7, 0x2c3138); B.span(x + 0.1, x + 0.6, 1.38, 1.5, 4.15, 4.7, 0x7a1f19);
    for (const [mz, c] of [[5.2, 0xf2f2f2], [5.45, 0x3e8ce6], [5.7, 0xf2b134]]) B.span(x + 0.3, x + 0.42, 0.97, 1.09, mz, mz + 0.12, c);
    B.span(x + 0.15, x + 0.45, 0.97, 1.07, 5.9, 6.2, 0xe9c46a);
    B.span(x, x + 0.5, 1.9, 2.5, 3.9, 4.9, 0x8b7a63); // wall cabinet
    B.span(x + 1.2, x + 1.4, 0, 0.02, 3.6, 6.1, 0xa0b0a8);
  }
  props(B) {
    // entrance sign board on two posts
    for (const px of [-0.9, 1.7]) B.span(px - 0.07, px + 0.07, 0, 1.3, O.z1 + 3.0, O.z1 + 3.14, 0x2c3138);
    B.span(-1.1, 1.9, 0.8, 1.6, O.z1 + 2.96, O.z1 + 3.0, 0x1f5a3a); // texture added in makeBoards
    // benches near the entrance
    for (const bx of [-8.0, 8.5]) { B.span(bx - 0.9, bx + 0.9, 0.42, 0.5, O.z1 + 2.0, O.z1 + 2.45, 0x9a6b43); B.span(bx - 0.9, bx + 0.9, 0.6, 0.95, O.z1 + 2.42, O.z1 + 2.5, 0x9a6b43); for (const l of [-0.75, 0.75]) B.span(bx + l - 0.05, bx + l + 0.05, 0, 0.42, O.z1 + 2.1, O.z1 + 2.35, 0x2c3138); }
    // bins + terrace planters
    for (const [x, z] of [[5.2, O.z1 + 1.4], [-2.8, O.z1 + 1.4]]) B.span(x - 0.2, x + 0.2, 0, 0.7, z - 0.2, z + 0.2, 0x4a5568);
    const ico = Batch.flat(new THREE.IcosahedronGeometry(1, 0));
    for (const [x, z] of [[-9.4, O.z1 + 3.4], [10.2, O.z1 + 3.4], [10.2, -6.2], [-9.4, -6.3]]) { B.span(x - 0.4, x + 0.4, 0, 0.5, z - 0.4, z + 0.4, 0x6b6e75); B.addGeo(ico, 0x3f9e4a, x, 1.0, z, 0.55, 0.6, 0.55); B.addGeo(ico, 0x57b45a, x + 0.2, 1.35, z - 0.1, 0.35, 0.4, 0.35); }
  }
  // ---- ceiling track lights (hung from beams just under the wall tops); the panels glow at night
  ceiling(B) {
    const H = O.wallH;
    this.panelMat = new THREE.MeshBasicMaterial({ color: 0x8b8f96 });
    const panels = [];
    for (const col of D.cols) for (const rz of D.rows) panels.push([col, rz + 0.3, 1.7, 0.5]);
    panels.push([6.6, -3.05, 1.5, 0.5], [8.6, -3.05, 1.5, 0.5], [-7.0, 5.1, 0.9, 0.5], [2.6, 5.4, 1.7, 0.5]);
    this.lampPoints = []; const beams = new Set();
    for (const [x, z, w, d] of panels) {
      B.span(x - 0.03, x + 0.03, H - 0.26, H, z - 0.03, z + 0.03, 0x2c3138); B.span(x - w / 2, x + w / 2, H - 0.34, H - 0.26, z - d / 2, z + d / 2, 0xe6e6e6);
      const m = new THREE.Mesh(BOX, this.panelMat); m.scale.set(w - 0.1, 0.03, d - 0.1); m.position.set(x, H - 0.35, z); this.scene.add(m);
      beams.add(z.toFixed(2));
    }
    for (const zz of beams) B.span(O.x0 + 0.3, O.x1 - 0.25, H - 0.04, H, +zz - 0.04, +zz + 0.04, 0x2c3138);
    this.glowMat = new THREE.MeshBasicMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,236,190,.9)'); g.addColorStop(1, 'rgba(255,236,190,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const [x, z, w] of panels) { const g = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.6, 2.6).rotateX(-Math.PI / 2), this.glowMat); g.position.set(x, 0.035, z + 0.6); g.renderOrder = 4; this.scene.add(g); }
    for (const [x, y, z] of [[-5.2, 2.7, 0.3], [0.6, 2.7, 0.3], [7.6, 2.7, -3.0], [-5.4, 2.7, 4.7]]) { const pl = new THREE.PointLight(0xffe2b0, 0, 11, 1.6); pl.position.set(x, y, z); this.scene.add(pl); this.lampPoints.push(pl); }
  }
  setLamp(v) { const k = Math.min(1, v * 1.15); this.panelMat.color.set(0x8b8f96).lerp(new THREE.Color(0xfff1c8), k); this.glowMat.opacity = k * 0.55; for (const p of this.lampPoints) p.intensity = k * 30; }
  // ---- per-slot desk (monitor, chair, plant) --------------------------------------------------
  makeDesk(i) {
    const { x, z } = slotPos(i), B = new Batch(), g = new THREE.Group(); g.position.set(x, 0, z);
    B.box(0, 0.76, 0, 2.0, 0.08, 0.95, 0xe4d3b0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * 0.93, 0.36, sz * 0.4, 0.07, 0.72, 0.07, 0x7a6a55);
    B.box(0.62, 0.4, 0, 0.7, 0.64, 0.8, 0x8b7a63);
    B.box(0, 0.9, -0.2, 0.08, 0.2, 0.08, 0x20242b); B.box(0, 0.815, -0.2, 0.3, 0.03, 0.2, 0x20242b);
    B.box(0, 1.3, -0.2, 1.0, 0.64, 0.06, 0x20242b);
    B.box(0, 0.815, 0.22, 0.6, 0.03, 0.2, 0x2c3138); B.box(0.5, 0.815, 0.24, 0.1, 0.03, 0.14, 0x2c3138);
    B.box(-0.7, 0.86, 0.1, 0.1, 0.12, 0.1, 0xf2f2f2);
    B.box(0.82, 0.9, -0.25, 0.22, 0.2, 0.22, 0xb5523b); B.addGeo(Batch.flat(new THREE.IcosahedronGeometry(1, 0)), 0x3f9e4a, 0.82, 1.15, -0.25, 0.22, 0.26, 0.22);
    // chair
    B.box(0, 0.5, 1.0, 0.6, 0.1, 0.55, 0x30363f); B.box(0, 0.25, 1.0, 0.08, 0.4, 0.08, 0x20242b); B.box(0, 0.04, 1.0, 0.5, 0.05, 0.5, 0x20242b); B.box(0, 0.8, 1.3, 0.55, 0.3, 0.07, 0x30363f);
    const base = B.build(MAT_V); g.add(base);
    const accentMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
    const pad = new THREE.Mesh(BOX, accentMat); pad.scale.set(0.7, 0.012, 0.3); pad.position.set(0, 0.825, 0.22); g.add(pad);
    const plate = new THREE.Mesh(BOX, accentMat); plate.scale.set(0.34, 0.1, 0.05); plate.position.set(-0.62, 0.86, -0.12); plate.castShadow = true; g.add(plate);
    const tex = canvasTex(256, 160);
    const screenMat = new THREE.MeshBasicMaterial({ map: tex.tex, color: 0xffffff });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.54), screenMat); screen.position.set(0, 1.3, -0.165); g.add(screen);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x5ad07a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75).rotateX(-Math.PI / 2), glowMat); glow.position.set(0, 0.83, 0.3); glow.renderOrder = 4; g.add(glow);
    this.scene.add(g);
    return { i, x, z, row: slotPos(i).row, g, tex, accentMat, screenMat, glowMat, bot: null, drawnKey: '' };
  }
  drawScreen(slot, bot) {
    const { ctx, cv, tex } = slot.tex, key = bot ? [bot.state, bot.task, bot.progress, bot.name, bot.project].join('|') : '';
    if (key === slot.drawnKey) return; slot.drawnKey = key;
    ctx.fillStyle = '#0d1914'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!bot) { ctx.fillStyle = '#1f3a2c'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('trống', 128, 88); ctx.textAlign = 'left'; tex.needsUpdate = true; return; }
    const st = STATE[bot.state] || STATE.idle;
    ctx.fillStyle = bot.color; ctx.fillRect(0, 0, 256, 30);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 19px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(bot.name.slice(0, 18), 8, 16);
    ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(238, 15, 7, 0, 7); ctx.fill();
    ctx.fillStyle = bot.state === 'blocked' ? '#ff9a90' : '#cfe9d8'; ctx.font = '19px sans-serif'; ctx.textBaseline = 'top';
    const lines = wrapText(ctx, bot.task, 238, bot.progress != null ? 3 : 4);
    lines.forEach((l, k) => ctx.fillText(l, 9, 40 + k * 23));
    if (bot.project) { ctx.fillStyle = '#7fb896'; ctx.font = 'bold 14px sans-serif'; ctx.fillText('#' + bot.project.slice(0, 22), 9, 136); }
    if (bot.progress != null) {
      ctx.fillStyle = '#26402f'; ctx.fillRect(9, 112, 238, 12); ctx.fillStyle = '#e8ff5a'; ctx.fillRect(9, 112, 238 * clamp(bot.progress, 0, 100) / 100, 12);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(bot.progress + '%', 215, 96);
    }
    tex.needsUpdate = true;
  }
  // ---- boards ------------------------------------------------------------------------------
  makeBoards() {
    // kanban whiteboard on the west wall
    this.kan = canvasTex(1024, 512);
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), new THREE.MeshBasicMaterial({ map: this.kan.tex }));
    kb.rotation.y = Math.PI / 2; kb.position.set(O.x0 + 0.38, 2.0, -2.5); this.scene.add(kb);
    const fr = new Batch(); fr.span(O.x0 + 0.3, O.x0 + 0.36, 0.55, 3.45, -5.4, 0.4, 0x8b8f94); this.scene.add(fr.build(MAT_V, false, false));
    // group board in the meeting room (north wall)
    this.grp = canvasTex(768, 384);
    const gb = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({ map: this.grp.tex }));
    gb.position.set(7.6, 2.05, O.z0 + 0.38); this.scene.add(gb);
    const fr2 = new Batch(); fr2.span(5.8, 9.4, 1.15, 2.95, O.z0 + 0.3, O.z0 + 0.36, 0x2c3138); this.scene.add(fr2.build(MAT_V, false, false));
    // entrance sign
    const sg = canvasTex(512, 160), c = sg.ctx; c.fillStyle = '#1f5a3a'; c.fillRect(0, 0, 512, 160);
    c.strokeStyle = '#e8ff5a'; c.lineWidth = 6; c.strokeRect(10, 10, 492, 140);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'italic bold 66px Georgia, serif'; c.fillText('Grok Office', 256, 74);
    c.font = '22px sans-serif'; c.fillStyle = '#cfe9d8'; c.fillText('V Ă N   P H Ò N G   B O T', 256, 126); sg.tex.needsUpdate = true;
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.8), new THREE.MeshBasicMaterial({ map: sg.tex })); sm.position.set(0.4, 1.2, O.z1 + 3.02); this.scene.add(sm);
  }
  drawKanban(bots) {
    const { ctx: c, cv, tex } = this.kan, W = cv.width, Hh = cv.height;
    c.fillStyle = '#f7f6f1'; c.fillRect(0, 0, W, Hh); c.fillStyle = '#17402a'; c.fillRect(0, 0, W, 54);
    c.fillStyle = '#fff'; c.font = 'italic bold 32px Georgia, serif'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText('Bảng công việc theo dự án', 20, 28);
    const cols = []; const idle = [];
    for (const b of bots) { if (b.project) { let col = cols.find((x) => x.name === b.project); if (!col) cols.push(col = { name: b.project, items: [] }); col.items.push(b); } else idle.push(b); }
    if (idle.length || !cols.length) cols.push({ name: 'Chờ việc', items: idle, idle: true });
    const n = Math.min(cols.length, 4), cw = (W - 20 * (n + 1)) / n;
    cols.slice(0, n).forEach((col, ci) => {
      const x = 20 + ci * (cw + 20);
      c.fillStyle = '#e6e3d8'; c.fillRect(x, 70, cw, Hh - 90);
      c.fillStyle = col.idle ? '#7d8a83' : '#1f5a3a'; c.fillRect(x, 70, cw, 40);
      c.fillStyle = '#fff'; c.font = 'bold 22px sans-serif'; c.textBaseline = 'middle'; c.fillText('#' + col.name.slice(0, 18) + '  (' + col.items.length + ')', x + 12, 91);
      col.items.slice(0, 4).forEach((b, k) => {
        const y = 122 + k * 92, st = STATE[b.state] || STATE.idle;
        c.fillStyle = '#fff'; c.fillRect(x + 10, y, cw - 20, 82); c.fillStyle = b.color; c.fillRect(x + 10, y, 8, 82);
        c.fillStyle = st.color; c.beginPath(); c.arc(x + cw - 28, y + 20, 8, 0, 7); c.fill();
        c.fillStyle = '#17402a'; c.font = 'bold 20px sans-serif'; c.textBaseline = 'top'; c.fillText(b.name.slice(0, 20), x + 28, y + 8);
        c.fillStyle = '#4a5a52'; c.font = '17px sans-serif';
        wrapText(c, b.task, cw - 48, 2).forEach((l, li) => c.fillText(l, x + 28, y + 34 + li * 21));
      });
    });
    tex.needsUpdate = true;
  }
  drawGroups(groups, bots, activeIds) {
    const { ctx: c, cv, tex } = this.grp;
    c.fillStyle = '#1b2b3a'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#e8ff5a'; c.fillRect(0, 0, cv.width, 8);
    c.fillStyle = '#fff'; c.font = 'italic bold 30px Georgia, serif'; c.textBaseline = 'top'; c.fillText('Phòng họp - nhóm chat', 22, 24);
    if (!groups.length) { c.fillStyle = '#7f94a8'; c.font = '24px sans-serif'; c.fillText('Chưa có nhóm nào', 22, 90); }
    groups.slice(0, 3).forEach((g, k) => {
      const y = 78 + k * 100; c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(16, y, cv.width - 32, 90);
      c.fillStyle = activeIds.has(g.id) ? '#5ad07a' : '#7f94a8'; c.beginPath(); c.arc(40, y + 24, 9, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.fillText(g.name.slice(0, 26), 60, y + 8);
      c.fillStyle = '#9fb4c8'; c.font = '20px sans-serif'; c.fillText('Chủ đề: ' + (g.topic || '-').slice(0, 34), 60, y + 40);
      const names = g.members.map((m) => (bots.find((b) => b.id === m) || { name: m }).name).join(', ');
      c.fillText('Thành viên: ' + names.slice(0, 36), 60, y + 62);
    });
    tex.needsUpdate = true;
  }
  // ---- navigation graph --------------------------------------------------------------------
  makeGraph() {
    const N = this.nodes = {}, E = this.edges = {};
    const node = (n, x, z) => { N[n] = { x, z }; E[n] = E[n] || []; };
    const edge = (a, b) => { E[a].push(b); E[b].push(a); };
    const chain = (names) => { for (let k = 0; k < names.length - 1; k++) edge(names[k], names[k + 1]); };
    // lanes
    const laneA = [], laneB = [];
    for (let c = 0; c < D.cols.length; c++) { node('XA' + c, D.cols[c], D.laneA); node('XB' + c, D.cols[c], D.laneB); laneA.push('XA' + c); laneB.push('XB' + c); }
    node('LA', D.laneX, D.laneA); node('LM', D.laneX, 1.4); node('LB', D.laneX, D.laneB); node('EN', D.laneX, O.z1 + 0.2); node('EP', D.laneX, O.z1 + 2.2); node('EO', -2.3, O.z1 + 3.3);
    chain([...laneA, 'LA']); chain([...laneB, 'LB']); chain(['LA', 'LM', 'LB', 'EN', 'EP', 'EO']);
    // desks
    for (let i = 0; i < SLOTS; i++) { const p = slotPos(i); node('S' + i, p.x, p.z + 1.0); edge('S' + i, (p.row ? 'XB' : 'XA') + (i >> 1)); }
    // coffee
    // three distinct standing spots at the counter (CS0..2), each reached from its own approach node (CA0..2)
    this.coffeeSpots = [];
    COFFEE_Z.forEach((cz, k) => { node('CS' + k, O.x0 + 1.9, cz); node('CA' + k, O.x0 + 3.1, cz); edge('CS' + k, 'CA' + k); if (k) edge('CA' + k, 'CA' + (k - 1)); this.coffeeSpots.push({ node: 'CS' + k, owner: null }); });
    edge('CA0', 'XB0');
    // meeting room
    node('DO', 5.7, 1.4); node('DI', 5.7, -0.85); edge('LM', 'DO'); edge('DO', 'DI');
    const south = ['DI'];
    MEET_SEATS.forEach((s, k) => { node('M' + k, s.x, s.z); });
    for (let k = 4; k < 8; k++) { node('MS' + k, MEET_SEATS[k].x, -0.85); south.push('MS' + k); edge('MS' + k, 'M' + k); }
    chain(south);
    node('NW', 4.95, -5.0); node('NW2', 4.95, -0.85); edge('NW2', 'DI'); edge('NW', 'NW2');
    const north = [];
    for (let k = 0; k < 4; k++) { node('MN' + k, MEET_SEATS[k].x, -5.0); edge('MN' + k, 'M' + k); north.push('MN' + k); }
    chain(['NW', ...north]);
    // spawn point just outside the entrance
    this.spawn = 'EO';
  }
  route(from, to) {
    if (from === to) return [from];
    const dist = { [from]: 0 }, prev = {}, open = new Set([from]);
    while (open.size) {
      let u = null; for (const n of open) if (u === null || dist[n] < dist[u]) u = n;
      open.delete(u); if (u === to) break;
      for (const v of this.edges[u]) {
        const d = dist[u] + Math.hypot(this.nodes[u].x - this.nodes[v].x, this.nodes[u].z - this.nodes[v].z);
        if (dist[v] === undefined || d < dist[v]) { dist[v] = d; prev[v] = u; open.add(v); }
      }
    }
    const path = []; for (let n = to; n !== undefined; n = prev[n]) path.unshift(n);
    return path[0] === from ? path : [from, to];
  }
}

// ================================================================ CHARACTER (chunky low-poly, procedural animation)
const SKINS = [0xf0c6a0, 0xc98d62, 0x8d5a3b, 0xe8b88a], HAIRS = [0x4a2f1e, 0x20150e, 0xc9a24a, 0x7a3b22, 0x2a2a35];
const SIT_DROP = 0.35, SIT_Y = 0.55;

const ZV = new THREE.Vector3(), zCache = {};
function zTex(ch) {
  if (zCache[ch]) return zCache[ch];
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.font = 'italic 900 52px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.lineWidth = 8; x.strokeStyle = '#2b4f8c'; x.strokeText(ch, 32, 36); x.fillStyle = '#ffffff'; x.fillText(ch, 32, 36);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (zCache[ch] = t);
}

class Actor {
  constructor(data, venue, scene, slot, spawn, opts = {}) {
    this.venue = venue; this.scene = scene; this.slot = slot; this.id = data.id; this.d = data;
    const h = hash(data.id), skin = SKINS[h % SKINS.length], hair = HAIRS[(h >>> 3) % HAIRS.length];
    this.root = new THREE.Group(); this.root.scale.setScalar(1.15);
    this.body = new THREE.Group(); this.body.position.y = 0.94; this.root.add(this.body);
    const shirt = new THREE.Color(data.color), shorts = 0x2b2f3a;
    this.legs = [];
    for (const sx of [1, -1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.13, 0, 0); this.body.add(hip);
      part(hip, 0.2, 0.44, 0.22, shorts, 0, -0.22, 0);
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      part(knee, 0.17, 0.4, 0.19, skin, 0, -0.2, 0); part(knee, 0.2, 0.1, 0.3, 0xf5f5f5, 0, -0.43, 0.06);
      this.legs.push({ hip, knee });
    }
    this.upper = new THREE.Group(); this.body.add(this.upper);
    this.shirtMat = part(this.upper, 0.54, 0.62, 0.3, shirt.getHex(), 0, 0.31, 0).material;
    part(this.upper, 0.56, 0.1, 0.32, shorts, 0, 0.03, 0);
    this.head = new THREE.Group(); this.head.position.set(0, 0.84, 0); this.upper.add(this.head);
    part(this.head, 0.3, 0.3, 0.3, skin, 0, 0, 0); part(this.head, 0.33, 0.12, 0.33, hair, 0, 0.17, -0.01); part(this.head, 0.33, 0.2, 0.1, hair, 0, 0.04, -0.12);
    part(this.head, 0.05, 0.05, 0.02, 0x222222, 0.07, 0.03, 0.155); part(this.head, 0.05, 0.05, 0.02, 0x222222, -0.07, 0.03, 0.155);
    if (data.src === 'devhub') {   // DevHub agents: dark visor, antenna with a yellow tip, chest badge
      part(this.head, 0.32, 0.09, 0.03, 0x101214, 0, 0.03, 0.16); part(this.head, 0.2, 0.02, 0.01, 0xffc629, 0, 0.03, 0.18);
      part(this.head, 0.03, 0.17, 0.03, 0x2c3138, 0, 0.31, 0); this.tip = part(this.head, 0.08, 0.08, 0.08, 0xffc629, 0, 0.43, 0);
      part(this.upper, 0.17, 0.11, 0.02, 0xffc629, 0.14, 0.46, 0.16); part(this.upper, 0.09, 0.04, 0.025, 0x101214, 0.14, 0.46, 0.165);
    }
    this.arms = [];
    for (const sx of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(sx * 0.36, 0.55, 0); this.upper.add(sh);
      part(sh, 0.15, 0.34, 0.15, shirt.getHex(), 0, -0.16, 0);
      const el = new THREE.Group(); el.position.y = -0.33; sh.add(el);
      part(el, 0.13, 0.28, 0.13, skin, 0, -0.14, 0); part(el, 0.14, 0.09, 0.14, skin, 0, -0.31, 0);
      this.arms.push({ sh, el });
    }
    this.mug = new THREE.Group(); this.mug.position.set(0, -0.34, 0.1); this.arms[1].el.add(this.mug);
    part(this.mug, 0.1, 0.12, 0.1, 0xffffff, 0, 0, 0); part(this.mug, 0.08, 0.02, 0.08, 0x5a3a28, 0, 0.06, 0); this.mug.visible = false;
    this.hit = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ visible: false })); this.hit.scale.set(0.9, 2.1, 0.9); this.hit.position.y = 1.0; this.hit.userData.botId = data.id; this.root.add(this.hit);
    scene.add(this.root);
    // state
    this.t = Math.random() * 20; this.ph = Math.random() * 6; this.phase = 0; this.walkAmt = 0; this.yaw = Math.PI; this.targetYaw = Math.PI;
    this.P = { sit: 0, hip: 0, knee: 0, lean: 0, as: [0, 0], ae: [-0.1, -0.1], headX: 0, headY: 0 };
    this.queue = []; this.dest = null; this.at = null; this.celebrate = 0; this.seat = opts.seat ?? -1;
    this.coffee = false; this.coffeeT = 0; this.wanderT = rr(...CONFIG.wander.first);
    this.wantMeeting = !!opts.meeting; this.moving = false; this.coffeeNode = null; this.off = { x: 0, z: 0 }; this.hold = opts.hold || 0; this.zA = 0; this.lx = 0; this.lz = 0;
    this.makeZz();
    const first = this.targetNode(this.wantDestination());
    if (spawn) { this.at = venue.spawn; this.place(venue.spawn); this.dest = null; this.setDest(this.wantDestination()); }
    else { this.at = first; this.place(first); this.dest = this.wantDestination(); this.snapYaw(); }
    this.applyColor(data);
  }
  place(nodeName) { const n = this.venue.nodes[nodeName]; this.lx = n.x; this.lz = n.z; this.root.position.set(n.x, 0, n.z); }
  applyColor() { this.slot.accentMat.color.set(this.d.color); this.slot.glowMat.color.set(this.d.color); }
  wantDestination() { return this.coffee ? 'coffee' : (this.wantMeeting && this.seat >= 0 ? 'meeting' : 'desk'); }
  targetNode(dest) { return dest === 'coffee' && this.coffeeNode ? this.coffeeNode : dest === 'meeting' ? 'M' + this.seat : 'S' + this.slot.i; }
  seatYaw(node) { if (node.startsWith('CS')) return -Math.PI / 2; if (node[0] === 'M') return MEET_SEATS[+node.slice(1)].yaw; return Math.PI; }
  snapYaw() { this.yaw = this.targetYaw = this.seatYaw(this.at); this.root.rotation.y = this.yaw; }
  setDest(dest) {
    this.dest = dest; const target = this.targetNode(dest);
    let start = this.at, keep = [];
    if (this.queue.length) { start = this.queue[0]; keep = [this.queue[0]]; }
    const path = this.venue.route(start, target);
    this.queue = keep.concat(path.slice(1));
    if (!keep.length && this.queue.length === 0) this.arrive();
  }
  arrive() { this.targetYaw = this.seatYaw(this.at); }
  get sitting() { return !this.queue.length && (this.at[0] === 'S' || this.at[0] === 'M'); }
  get standingCoffee() { return !this.queue.length && this.at.startsWith('CS'); }
  get free() { return !this.sitting; }   // walking or standing around (not parked on a chair)
  get sleeping() { return this.d.state === 'idle' && !this.wantMeeting && this.sitting && this.at[0] === 'S' && this.celebrate <= 0; }
  claimCoffee() { const sp = this.venue.coffeeSpots.find((q) => !q.owner); if (!sp) return false; sp.owner = this.id; this.coffeeNode = sp.node; return true; }
  releaseCoffee() { const sp = this.venue.coffeeSpots.find((q) => q.owner === this.id); if (sp) sp.owner = null; this.coffeeNode = null; }
  restState() { return this.d.state === 'done'; }   // idle bots sleep at their own desk; only 'done' bots wander off for coffee

  update(dt, ctx) {
    if (this.hold > 0) { this.hold -= dt; this.root.visible = false; this.zUpdate(dt); return; }   // staggered entrance
    this.root.visible = true;
    this.t += dt; const d = this.d;
    // wander logic (coffee runs): only 'done' bots, and only if a coffee spot of their own is free
    if (!this.restState() && this.coffee) { this.coffee = false; this.releaseCoffee(); }
    if (this.restState() && !this.wantMeeting) {
      if (!this.coffee && this.sitting && this.dest === 'desk') { this.wanderT -= dt; if (this.wanderT <= 0) { if (this.claimCoffee()) { this.coffee = true; this.coffeeT = rr(...CONFIG.wander.coffee); } else this.wanderT = rr(3, 6); } }
      if (this.coffee && this.standingCoffee) { this.coffeeT -= dt; if (this.coffeeT <= 0) { this.coffee = false; this.releaseCoffee(); this.wanderT = rr(...CONFIG.wander.every); } }
    }
    if (this.wantMeeting && this.coffee) { this.coffee = false; this.releaseCoffee(); }
    const want = this.wantDestination(); if (want !== this.dest || (want === 'meeting' && this.dest === 'meeting' && this.targetNode('meeting') !== this.lastTarget)) { this.setDest(want); }
    this.lastTarget = this.targetNode(this.dest);
    // movement (logical position follows the node graph; render position adds the avoidance sidestep)
    this.moving = this.queue.length > 0;
    if (this.moving) {
      const n = this.venue.nodes[this.queue[0]], dx = n.x - this.lx, dz = n.z - this.lz, dist = Math.hypot(dx, dz), step = CONFIG.walkSpeed * dt;
      if (dist <= step) { this.lx = n.x; this.lz = n.z; this.at = this.queue.shift(); if (!this.queue.length) { this.arrive(); if (this.at.startsWith('CS')) this.mug.visible = true; if (this.at[0] === 'S') this.mug.visible = false; } }
      else { this.lx += dx / dist * step; this.lz += dz / dist * step; this.targetYaw = Math.atan2(dx, dz); this.phase += dt * 9.5; }
    }
    if (this.sitting) { const k = Math.min(1, dt * 8); this.off.x -= this.off.x * k; this.off.z -= this.off.z * k; }
    this.root.position.set(this.lx + this.off.x, 0, this.lz + this.off.z);
    this.walkAmt += ((this.moving ? 1 : 0) - this.walkAmt) * Math.min(1, dt * 8);
    let dy = this.targetYaw - this.yaw; dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.yaw += dy * Math.min(1, dt * (this.moving ? 10 : 6)); this.root.rotation.y = this.yaw;
    this.pose(dt); this.zUpdate(dt);
  }
  // ---- sleeping "Z z z" particles (looping sprites rising from the head)
  makeZz() {
    this.zz = [0, 1, 2].map((i) => {
      const m = new THREE.SpriteMaterial({ map: zTex(i === 1 ? 'z' : 'Z'), transparent: true, opacity: 0, depthWrite: false, depthTest: false });
      const sp = new THREE.Sprite(m); sp.visible = false; sp.renderOrder = 20; this.scene.add(sp); return sp;
    });
  }
  zUpdate(dt) {
    const on = this.hold <= 0 && this.sleeping ? 1 : 0; this.zA += (on - this.zA) * Math.min(1, dt * 4);
    const show = this.zA > 0.02; this.head.getWorldPosition(ZV); const R = CONFIG.cam.yawDeg * Math.PI / 180, rx = Math.cos(R), rz = -Math.sin(R);
    this.zz.forEach((sp, i) => {
      sp.visible = show; if (!show) return;
      const p = (this.t * 0.4 + i / 3 + this.ph * 0.1) % 1, side = 0.55 + p * 0.95 + Math.sin(p * 7 + i * 2) * 0.08;
      sp.position.set(ZV.x + rx * side, ZV.y + 0.2 + p * 1.0, ZV.z + rz * side);
      const sc = 0.22 + p * 0.3; sp.scale.set(sc, sc, 1); sp.material.opacity = Math.sin(Math.PI * Math.min(1, p * 1.05)) * 0.95 * this.zA; sp.material.rotation = Math.sin(p * 5 + i) * 0.25;
    });
  }
  pose(dt) {
    const d = this.d, t = this.t, ph = this.ph, P = this.P;
    const T = { sit: 0, hip: 0, knee: 0, lean: 0, as: [0, 0], ae: [-0.12, -0.12], headX: 0, headY: 0 };
    let osc = null, jump = 0;
    const seated = this.sitting;
    if (seated) {
      T.sit = SIT_DROP; T.hip = -Math.PI / 2; T.knee = Math.PI / 2 - 0.05;
      if (this.at[0] === 'M') {
        T.lean = 0.06; T.as = [-0.6, -0.5]; T.ae = [-0.8, -0.7];
        const talk = Math.sin(t * 0.55 + ph) > 0.2;
        if (talk) { T.as[1] = -1.0; osc = { as1: Math.sin(t * 5 + ph) * 0.25, ae1: Math.sin(t * 4.1) * 0.3 }; }
        T.headY = Math.sin(t * 0.45 + ph) * 0.55; T.headX = Math.sin(t * 0.8 + ph) * 0.06;
      } else if (this.celebrate > 0) {
        T.sit = 0; T.hip = 0; T.knee = 0; T.as = [-3.0, -3.0]; T.ae = [-0.2, -0.2]; jump = Math.abs(Math.sin(t * 9)) * 0.28;
        osc = { as0: Math.sin(t * 12) * 0.25, as1: -Math.sin(t * 12) * 0.25 };
      } else if (d.state === 'working') {
        T.lean = 0.2; T.as = [-0.8, -0.8]; T.ae = [-0.85, -0.85]; T.headX = 0.12;
        osc = { ae0: Math.sin(t * 22 + ph) * 0.13, ae1: Math.sin(t * 22 + ph + 1.9) * 0.13, as0: Math.sin(t * 11 + ph) * 0.05, as1: Math.sin(t * 13 + ph) * 0.05 };
        const nod = Math.max(0, Math.sin(t * 0.9 + ph * 2) - 0.6) * 0.5; T.headX += nod * 0.5; T.headY = Math.max(0, Math.sin(t * 0.37 + ph) - 0.8) * 1.2 * Math.sign(Math.sin(t * 0.11 + ph));
      } else if (d.state === 'blocked') {
        T.lean = 0.3; T.as = [-2.1, -2.1]; T.ae = [-2.3, -2.3]; T.headX = 0.35; T.headY = Math.sin(t * 3.5) * 0.18;
      } else if (d.state === 'idle') { // asleep: slumped forward, head resting on folded arms on the desk
        const br = Math.sin(t * 1.3 + ph);
        T.lean = 0.78 + br * 0.015; T.as = [-1.55, -1.55]; T.ae = [-0.15, -0.15]; T.headX = 0.62 + br * 0.02; T.headY = 0.55; T.sit = SIT_DROP - 0.04;
      } else { // done: lean back, hands behind head
        T.lean = -0.22 + Math.sin(t * 0.7 + ph) * 0.03; T.as = [-2.6, -2.6]; T.ae = [-1.7, -1.7]; T.headX = -0.12; T.headY = Math.sin(t * 0.3 + ph) * 0.35;
      }
    } else if (this.standingCoffee) {
      T.as = [-0.1, -1.0]; T.ae = [-0.1, -1.4]; T.headX = -0.05 + Math.max(0, Math.sin(t * 1.4 + ph)) * -0.15;
      osc = { ae1: Math.sin(t * 1.4 + ph) * 0.12 };
    } else if (this.moving) {
      T.ae = [-0.5, -0.5];
      if (this.mug.visible) { T.as[1] = -0.9; T.ae[1] = -1.3; }
    }
    this.mug.visible = this.mug.visible && (this.standingCoffee || this.moving) && this.coffeeCarry();
    const k = Math.min(1, dt * 9);
    P.sit += (T.sit - P.sit) * k; P.hip += (T.hip - P.hip) * k; P.knee += (T.knee - P.knee) * k; P.lean += (T.lean - P.lean) * k; P.headX += (T.headX - P.headX) * k; P.headY += (T.headY - P.headY) * k;
    for (let i = 0; i < 2; i++) { P.as[i] += (T.as[i] - P.as[i]) * k; P.ae[i] += (T.ae[i] - P.ae[i]) * k; }
    const w = this.walkAmt, sw = Math.sin(this.phase);
    this.body.position.y = 0.94 - P.sit + Math.abs(sw) * 0.05 * w + jump;
    this.legs.forEach((lg, i) => {
      const s = i === 0 ? sw : -sw;
      lg.hip.rotation.x = P.hip + s * 0.75 * w; lg.knee.rotation.x = P.knee + Math.max(0, -Math.cos(this.phase + (i ? Math.PI : 0))) * 0.95 * w;
    });
    this.upper.rotation.x = P.lean; this.head.rotation.x = P.headX; this.head.rotation.y = P.headY;
    this.arms.forEach((a, i) => {
      const s = i === 0 ? sw : -sw, hold = i === 1 && this.mug.visible ? 0 : 1;
      a.sh.rotation.x = P.as[i] + (osc ? (osc['as' + i] || 0) : 0) - s * 0.65 * w * hold; a.el.rotation.x = P.ae[i] + (osc ? (osc['ae' + i] || 0) : 0);
      a.sh.rotation.z = (i === 0 ? -1 : 1) * (P.as[i] < -1.8 ? 0.35 : 0.04);
    });
  }
  coffeeCarry() { return true; }
  headWorld(out) { this.head.getWorldPosition(out); return out; }
  dispose() { this.releaseCoffee(); this.scene.remove(this.root); this.zz.forEach((sp) => { this.scene.remove(sp); sp.material.dispose(); }); }
}

// ================================================================ CAMERA RIG (orthographic isometric, focus on a bot)
class Rig {
  constructor() {
    this.cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 400);
    this.yaw = CONFIG.cam.yawDeg * Math.PI / 180; this.pitch = CONFIG.cam.pitchDeg * Math.PI / 180;
    this.aspect = 1; this.zoom = 1; this.zoomT = 1; this.T = new THREE.Vector3(); this.TT = new THREE.Vector3(); this.follow = null; this.s0 = 10;
    this.pts = [];
    for (const x of [-13, 15.5]) for (const z of [-10, 15.5]) for (const y of [GROUND_Y, 5.0]) this.pts.push([x, y, z]);
    this.ptsOffice = []; for (const x of [-10.5, 11.5]) for (const z of [-7.5, 11.5]) for (const y of [-0.6, 4.6]) this.ptsOffice.push([x, y, z]);
    this.fit(); this.T.copy(this.TT); this.place();
  }
  fit() {
    const y = this.yaw, p = this.pitch, cp = Math.cos(p), sp = Math.sin(p);
    const R = [Math.cos(y), 0, -Math.sin(y)], U = [-sp * Math.sin(y), cp, -sp * Math.cos(y)];
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    for (const q of (this.aspect < 1 ? this.ptsOffice : this.pts)) { const r = q[0] * R[0] + q[2] * R[2], u = q[0] * U[0] + q[1] * U[1] + q[2] * U[2]; a = Math.min(a, r); b = Math.max(b, r); c = Math.min(c, u); d = Math.max(d, u); }
    if (this.aspect >= 1) d += (d - c) * 0.2;   // headroom for the sky strip
    const rc = (a + b) / 2, uc = (c + d) / 2; this.s0 = Math.max((d - c) / 2, (b - a) / 2 / this.aspect) * 1.06;
    this.home = new THREE.Vector3(R[0] * rc + U[0] * uc, R[1] * rc + U[1] * uc, R[2] * rc + U[2] * uc);
    if (!this.follow) this.TT.copy(this.home);
    this.uc = uc; this.rc = rc; if (this.onFit) this.onFit();
  }
  resize(w, h) { this.aspect = w / Math.max(1, h); this.fit(); this.place(); }
  // ---- user zoom / pan (wheel, pinch, drag). Zoom keeps the point under the cursor fixed; both zoom and target ease with the same factor in update().
  vecs() { const y = this.yaw, p = this.pitch; return { R: [Math.cos(y), 0, -Math.sin(y)], U: [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)] }; }
  zoomBy(f, nx = 0, ny = 0) {
    const zn = clamp(this.zoomT / f, ZMIN, ZMAX), sOld = this.s0 * this.zoomT, sNew = this.s0 * zn;
    if (!this.follow) { const { R, U } = this.vecs(), dx = nx * this.aspect * (sOld - sNew), dy = ny * (sOld - sNew); this.TT.x += R[0] * dx + U[0] * dy; this.TT.y += U[1] * dy; this.TT.z += R[2] * dx + U[2] * dy; }
    this.zoomT = zn; this.clampPan();
  }
  panBy(ndx, ndy) {   // NDC delta of a drag: the scene follows the finger
    this.follow = null; const { R, U } = this.vecs(), s = this.s0 * this.zoom, dx = -ndx * this.aspect * s, dy = -ndy * s, d = [R[0] * dx + U[0] * dy, U[1] * dy, R[2] * dx + U[2] * dy];
    this.TT.x += d[0]; this.TT.y += d[1]; this.TT.z += d[2]; this.T.x += d[0]; this.T.y += d[1]; this.T.z += d[2]; this.clampPan();
  }
  clampPan() {
    if (this.follow || !this.home) return; const { R, U } = this.vecs(), f = clamp((1.05 - this.zoomT) / 0.5, 0, 1), lr = this.s0 * this.aspect * 0.85 * f, lu = this.s0 * 0.85 * f;
    const dx = this.TT.x - this.home.x, dy = this.TT.y - this.home.y, dz = this.TT.z - this.home.z, r = dx * R[0] + dz * R[2], u = dx * U[0] + dy * U[1] + dz * U[2];
    const rc = clamp(r, -lr, lr), uc2 = clamp(u, -lu, lu); this.TT.x += R[0] * (rc - r) + U[0] * (uc2 - u); this.TT.y += U[1] * (uc2 - u); this.TT.z += R[2] * (rc - r) + U[2] * (uc2 - u);
  }
  focus(actor) { this.follow = actor; this.zoomT = CONFIG.cam.focusZoom; }
  overview() { this.follow = null; this.zoomT = 1; this.TT.copy(this.home); }
  update(dt, tmp) {
    if (this.follow) { this.follow.root.getWorldPosition(tmp); tmp.y += 1.0; this.TT.copy(tmp); }
    const k = Math.min(1, dt * 6); this.T.lerp(this.TT, k); this.zoom += (this.zoomT - this.zoom) * k; this.place();
  }
  place() {
    const y = this.yaw, p = this.pitch, cp = Math.cos(p), c = this.cam;
    c.position.set(this.T.x + Math.sin(y) * cp * 120, this.T.y + Math.sin(p) * 120, this.T.z + Math.cos(y) * cp * 120); c.lookAt(this.T);
    const s = this.s0 * this.zoom; c.left = -s * this.aspect; c.right = s * this.aspect; c.top = s; c.bottom = -s; c.updateProjectionMatrix();
  }
}

// ================================================================ DATA (fetch, normalise, diff)

const SRC = QS.get('src') || './status.json';
// DevHub link: ?devhub=URL (exporter --serve or any devhub-office/1 JSON), default ./devhub-status.json (exporter --push), ?devhub=off to disable
const DH_RAW = QS.get('devhub'), DEVHUB_SRC = DH_RAW === 'off' ? null : (DH_RAW || './devhub-status.json');
const DH_STALE_MS = (+QS.get('dhstale') || 300) * 1000, DH_DONE_MS = 180000;
const DH_BRAND = { claude: '#d97757', codex: '#19b38a', 'grok-build': '#d9d9d9', grok: '#9aa3ad', openrouter: '#7b7ff5' };
const DH_ROLE = { local_cli: 'Agent CLI', local_sdk: 'Agent SDK', model_api: 'Model API (tư vấn)', external_workflow: 'Workflow ngoài' };
const POLL_MS = Math.max(2000, (+QS.get('interval') || 0) * 1000 || CONFIG.pollMs);
const fmtTime = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtHM = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
function rel(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000; if (!isFinite(s)) return '-'; if (s < 15) return 'vừa xong';
  if (s < 60) return Math.floor(s) + ' giây trước'; const m = Math.floor(s / 60); if (m < 60) return m + ' phút trước';
  const h = Math.floor(m / 60); if (h < 24) return h + ' giờ trước'; const d = Math.floor(h / 24); return d === 1 ? 'hôm qua' : d + ' ngày trước';
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bots)) throw new Error('status.json sai định dạng (thiếu bots)');
  const seen = new Set(), bots = [];
  for (const b of raw.bots) {
    if (!b || typeof b.id !== 'string' || seen.has(b.id)) continue; seen.add(b.id);
    const state = STATE[b.state] ? b.state : 'idle';
    bots.push({
      id: b.id, name: String(b.name || b.id), role: String(b.role || ''), color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#' + (hash(b.id) & 0xffffff).toString(16).padStart(6, '0'),
      src: b.src === 'devhub' || /^dh-/.test(b.id) ? 'devhub' : '', note: b.note ? String(b.note) : '', state, task: String(b.task || ''), project: String(b.project || ''), room: b.room === 'meeting' ? 'meeting' : 'desk',
      progress: Number.isFinite(b.progress) ? clamp(Math.round(b.progress), 0, 100) : null, since: b.since || raw.updatedAt || '',
      log: (Array.isArray(b.log) ? b.log : []).filter((l) => l && l.msg).slice(-5).map((l) => ({ t: l.t || '', msg: String(l.msg) }))
    });
  }
  const groups = (Array.isArray(raw.groups) ? raw.groups : []).filter((g) => g && g.id).map((g) => ({ id: String(g.id), name: String(g.name || g.id), members: Array.isArray(g.members) ? g.members.map(String) : [], topic: String(g.topic || ''), active: g.active === true }));
  return { version: raw.version || 1, updatedAt: raw.updatedAt || '', bots, groups };
}

// DevHub (schema devhub-office/1, written by nexa-devhub/scripts/export-office-status.mjs) -> status.json style bots.
// mode: 'live' = fresh data, 'stale' = generatedAt too old, 'down' = source unreachable (last roster kept, everyone sleeps).
function devhubBots(raw, mode, now = Date.now()) {
  if (!raw || raw.schema !== 'devhub-office/1' || !Array.isArray(raw.agents)) throw new Error('devhub-status.json sai định dạng (cần schema devhub-office/1)');
  const gen = Date.parse(raw.generatedAt);
  return raw.agents.filter((a) => a && typeof a.id === 'string').map((a) => {
    const bot = { id: 'dh-' + a.id, src: 'devhub', name: String(a.name || a.id), color: DH_BRAND[a.id] || '#' + (hash(a.id) & 0xffffff).toString(16).padStart(6, '0'),
      role: 'DevHub · ' + (DH_ROLE[a.kind] || 'Agent') + (a.model ? ' · ' + a.model : ''), state: 'idle', task: '', project: '', room: 'desk', since: a.lastActivityAt || raw.generatedAt || '', log: [], note: '' };
    const cur = a.current, last = a.last, fin = last && last.at ? now - Date.parse(last.at) : Infinity;
    if (last) bot.log.push({ t: last.at, msg: (last.status === 'completed' ? 'Xong: ' : 'Kết thúc (' + last.status + '): ') + (last.title || 'task') });
    if (mode !== 'live') { bot.note = mode === 'stale' ? 'DevHub chưa gửi dữ liệu mới' : 'Mất kết nối DevHub'; bot.task = bot.note; return bot; }
    if (a.state === 'unknown') { bot.note = 'Chưa có dữ liệu từ DevHub'; bot.task = bot.note; return bot; }
    if (a.enabled === false || a.state === 'disabled') { bot.note = 'Đã tắt trong DevHub'; bot.task = bot.note; }
    else if (a.state === 'unavailable' || a.state === 'failed') { bot.note = a.detail || (a.authenticated === false ? 'Chưa đăng nhập' : 'Chưa sẵn sàng'); bot.task = bot.note; }
    else if (a.state === 'waiting' || (cur && cur.status === 'waiting_approval')) { bot.state = 'blocked'; bot.task = 'Chờ duyệt: ' + ((cur && cur.title) || 'một thao tác'); }
    else if (a.state === 'running' || cur) { bot.state = 'working'; bot.task = (cur && cur.title) || 'Đang chạy task'; if (cur) { bot.project = cur.project || ''; bot.since = cur.since || bot.since; } }
    else if (last && fin < DH_DONE_MS && last.status === 'completed') { bot.state = 'done'; bot.task = 'Xong: ' + (last.title || 'task'); bot.project = last.project || ''; bot.since = last.at; }
    else if (last && fin < DH_DONE_MS && last.status !== 'cancelled') { bot.state = 'blocked'; bot.task = 'Lỗi: ' + (last.title || last.status); bot.project = last.project || ''; bot.since = last.at; }
    if (a.queued > 0 && bot.state === 'idle' && !bot.note) bot.note = a.queued + ' task đang chờ';
    return bot;
  });
}

// ================================================================ APP
class App {
  constructor() {
    this.canvas = $('#gl'); this.stage = $('#stage');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !MOBILE, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : CONFIG.maxPixelRatio)); r.setClearColor(0x000000, 0); r.localClippingEnabled = true; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xcde7f6, 150, 300);   // the sky is CSS behind the transparent canvas
    this.hemi = new THREE.HemisphereLight(0xfff6e6, 0x9a8f78, 1.5); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe2b8, 2.5); sun.position.set(-14, 28, 7); sun.castShadow = true; const sm = MOBILE ? 1024 : CONFIG.shadowMap; sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 130; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; this.scene.add(sun);
    this.rig = new Rig(); this.venue = new Venue(this.scene);
    this.city = new City(this.scene, { mobile: MOBILE, maxAniso: r.capabilities.getMaxAnisotropy() });
    this.rig.onFit = () => this.city.setHorizon(this.rig.uc + this.rig.s0 * HORIZON, this.rig); this.rig.onFit();
    this.clock = new Clock(QS); this.skyT = 0; this.makeSky();
    this.actors = new Map(); this.data = null; this.selected = null; this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.meetSeats = new Array(8).fill(null); this.labels = new Map();
    this.conn = { lastOk: 0, err: null, lastFetch: 0 };
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.bindUI(); this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.venue.drawKanban([]); this.venue.drawGroups([], [], new Set());
    this.last = performance.now(); this.poll(); setInterval(() => this.poll(), POLL_MS); setInterval(() => this.tickUI(), 500); this.tickUI();
    requestAnimationFrame((t) => this.frame(t));
  }
  makeSky() {
    this.elSky = $('#sky'); this.elSun = $('#sun'); this.elMoon = $('#moon'); this.elStars = $('#stars');
    const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); let sd = 7; const rn = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,255,${230 + Math.floor(rn() * 25)},${0.35 + rn() * 0.6})`; const r = rn() < 0.1 ? 1.8 : 1; x.fillRect(rn() * 512, rn() * 512, r, r); }
    this.elStars.style.backgroundImage = `url(${c.toDataURL()})`;
    // distant skyline beyond the horizon haze: silhouette mask (tinted by the sky) + window dots (night only)
    const W = 1400, Hh = 260, sk = document.createElement('canvas'), wn = document.createElement('canvas'); sk.width = wn.width = W; sk.height = wn.height = Hh;
    const a = sk.getContext('2d'), w = wn.getContext('2d'); a.fillStyle = '#000'; w.fillStyle = '#ffe2a0';
    for (let x = 0; x < W;) {
      const bw = 34 + rn() * 70, bh = 40 + Math.pow(rn(), 1.7) * 190; a.fillRect(x, Hh - bh, bw, bh);
      if (rn() < 0.25) a.fillRect(x + bw / 2 - 1, Hh - bh - 26, 2, 26);
      for (let yy = Hh - bh + 8; yy < Hh - 6; yy += 9) for (let xx = x + 5; xx < x + bw - 6; xx += 8) if (rn() < 0.42) { w.globalAlpha = 0.5 + rn() * 0.5; w.fillRect(xx, yy, 3, 4); }
      x += bw + 2 + rn() * 8;
    }
    const m = `url(${sk.toDataURL()})`; this.elSkyline = $('#skyline'); this.elSkyWin = $('#skywin');
    for (const [el, img] of [[this.elSkyline, m], [this.elSkyWin, `url(${wn.toDataURL()})`]]) { el.style.backgroundImage = img; }
    this.elSkyline.style.webkitMaskImage = this.elSkyline.style.maskImage = m; this.elSkyline.style.backgroundImage = 'none'; this.elHz = new THREE.Vector3();
  }
  placeSkyline() {   // keep the skyline sitting on the horizon edge of the ground, also while the camera moves/zooms
    const rig = this.rig, y = rig.yaw, p = rig.pitch, R = [Math.cos(y), 0, -Math.sin(y)], U = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)], upH = rig.uc + rig.s0 * HORIZON;
    this.elHz.set(R[0] * rig.rc + U[0] * upH, R[1] * rig.rc + U[1] * upH, R[2] * rig.rc + U[2] * upH).project(rig.cam);
    const sy = (-this.elHz.y * 0.5 + 0.5) * this.H, h = Math.min(this.H * 0.3, 190);
    for (const el of [this.elSkyline, this.elSkyWin]) { el.style.height = h + 'px'; el.style.transform = `translateY(${(sy - h + 1).toFixed(1)}px)`; el.style.display = sy < -10 || sy > this.H + h ? 'none' : 'block'; }
  }
  applyEnv(dt) {
    const hour = this.clock.hour(), env = envAt(hour); this.env = env;
    this.hemi.color.copy(env.hs); this.hemi.groundColor.copy(env.hg); this.hemi.intensity = env.hemi;
    this.sun.color.copy(env.keyCol); this.sun.intensity = env.key; this.sun.position.copy(env.sunPos).multiplyScalar(60); this.sun.castShadow = env.sunUp && env.key > 0.3;
    this.venue.setLamp(env.lamp); this.city.update(dt, env, this.scene);
    this.placeSkyline();
    this.skyT -= dt; if (this.skyT > 0) return; this.skyT = 0.2;
    const top = '#' + env.top.getHexString(), bot = '#' + env.bot.getHexString();
    this.elSky.style.background = `linear-gradient(to bottom, ${top} 0%, ${bot} 30%, ${bot} 100%)`;
    const night = env.lamp, ph = env.phase, el = env.sunUp ? this.elSun : this.elMoon, other = env.sunUp ? this.elMoon : this.elSun;
    other.style.display = 'none'; el.style.display = 'block'; el.style.left = (10 + 80 * ph).toFixed(1) + '%'; el.style.top = (23 - 19 * Math.sin(Math.PI * ph)).toFixed(1) + '%';
    const sil = env.bot.clone().lerp(new THREE.Color(0x6f86a6), 0.5 * (1 - night)).lerp(new THREE.Color(0x0a1028), 0.65 * night);
    this.elSkyline.style.backgroundColor = '#' + sil.getHexString(); this.elSkyWin.style.opacity = clamp((night - 0.35) * 1.6, 0, 1).toFixed(2);
    this.elStars.style.opacity = clamp((night - 0.5) * 2.2, 0, 1).toFixed(2);
    document.body.classList.toggle('dark', night > 0.5);
  }
  resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.rig.resize(w, h); this.W = w; this.H = h;
  }
  // ---------------------------------------------------------------- polling
  async fetchJSON(src) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), CONFIG.fetchTimeoutMs);
    try {
      const url = new URL(src, location.href); url.searchParams.set('_', Date.now());
      const res = await fetch(url, { cache: 'no-store', signal: ac.signal }); if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { throw e.name === 'AbortError' ? new Error('hết thời gian chờ') : e; } finally { clearTimeout(to); }
  }
  // DevHub half of a poll: live > stale > down (last roster) > bots with src "devhub" already in status.json (manual fallback)
  async pollDevhub() {
    const dh = this.dh = this.dh || { state: DEVHUB_SRC ? 'none' : 'off', at: 0, err: null, roster: null, gen: '' };
    if (!DEVHUB_SRC) return [];
    try {
      const raw = await this.fetchJSON(DEVHUB_SRC); devhubBots(raw, 'live');   // validates the schema
      const age = Date.now() - Date.parse(raw.generatedAt), known = raw.agents.some((a) => a.state !== 'unknown');
      dh.roster = raw; dh.err = null; dh.at = Date.now(); dh.gen = raw.generatedAt || '';
      const live = known && isFinite(age) && age <= DH_STALE_MS; dh.state = live ? 'live' : known ? 'stale' : 'waiting';
      return devhubBots(raw, live || !known ? 'live' : 'stale');
    } catch (e) {
      dh.err = e.message;
      if (dh.roster) { dh.state = 'down'; return devhubBots(dh.roster, 'down'); }
      dh.state = 'none'; return [];
    }
  }
  async poll() {
    try {
      const [raw, dhBots] = await Promise.all([this.fetchJSON(SRC), this.pollDevhub()]);
      const data = normalize(raw);
      if (dhBots.length) { const ids = new Set(dhBots.map((b) => b.id)); data.bots = data.bots.filter((b) => !ids.has(b.id)).concat(normalize({ bots: dhBots }).bots); }
      if (this.dh.state === 'none' && data.bots.some((b) => b.src === 'devhub')) this.dh.state = 'fallback';   // DevHub unreachable: showing the dh-* bots stored in status.json
      this.conn.lastOk = Date.now(); this.conn.err = null; this.conn.lastFetch = Date.now();
      this.apply(data);
    } catch (e) {
      this.conn.err = e.message; this.conn.lastFetch = Date.now();
      if (!this.data) this.toast('Không tải được dữ liệu: ' + this.conn.err);
    } finally { this.tickUI(); }
  }
  apply(data) {
    const prev = this.data, first = !prev, pm = new Map((prev ? prev.bots : []).map((b) => [b.id, b])), events = [];
    this.data = data;
    // removed bots
    for (const [id, a] of [...this.actors]) if (!data.bots.some((b) => b.id === id)) { events.push({ id, kind: 'left', name: a.d.name }); this.removeActor(id); }
    const activeGroups = new Set(data.groups.filter((g) => g.active).map((g) => g.id)), inActive = new Set();
    for (const g of data.groups) if (g.active) g.members.forEach((m) => inActive.add(m));
    this.activeGroups = activeGroups;
    this.spawnN = 0;
    for (const b of data.bots) {
      const old = pm.get(b.id); let a = this.actors.get(b.id);
      const wantM = (b.state === 'meeting' || b.room === 'meeting' || inActive.has(b.id)) && b.state !== 'blocked';
      if (!a) {
        const si = this.venue.slots.findIndex((s) => !s.bot); if (si < 0) continue;
        const slot = this.venue.slots[si]; slot.bot = b.id;
        let seat = -1; if (wantM) { seat = this.meetSeats.indexOf(null); if (seat >= 0) this.meetSeats[seat] = b.id; }
        const hold = first ? 0 : (this.spawnN = (this.spawnN || 0) + 1) * CONFIG.sep.spawnGap;
        a = new Actor(b, this.venue, this.scene, slot, !first, { meeting: wantM && seat >= 0, seat, hold });
        this.actors.set(b.id, a); this.makeLabel(b); if (!first) events.push({ id: b.id, kind: 'new', name: b.name });
      } else {
        if (old && old.state !== b.state) { events.push({ id: b.id, kind: 'state', name: b.name, from: old.state, to: b.state }); if (b.state === 'done') a.celebrate = 3.2; }
        else if (old && old.task !== b.task) events.push({ id: b.id, kind: 'task', name: b.name, task: b.task });
        else if (old && (old.project !== b.project || old.progress !== b.progress)) events.push({ id: b.id, kind: 'minor', name: b.name });
        if (old && old.color !== b.color) a.applyColor();
        a.d = b;
      }
      a.d = b; a.wantMeeting = wantM;
      if (wantM && a.seat < 0) { const s = this.meetSeats.indexOf(null); if (s >= 0) { this.meetSeats[s] = b.id; a.seat = s; } }
      if (!wantM && a.seat >= 0) { this.meetSeats[a.seat] = null; a.seat = -1; }
    }
    this.venue.slots.forEach((s) => { const a = s.bot && this.actors.get(s.bot); this.venue.drawScreen(s, a ? a.d : null); });
    this.venue.drawKanban(data.bots); this.venue.drawGroups(data.groups, data.bots, activeGroups);
    this.renderPanel(first ? [] : events.map((e) => e.id));
    for (const e of events) { this.toastEvent(e); const l = this.labels.get(e.id); if (l) { l.el.classList.remove('pop'); void l.el.offsetWidth; l.el.classList.add('pop'); } }
    for (const [id] of this.labels) this.updateLabelText(id);
    if (this.selected && !this.actors.has(this.selected)) this.select(null);
    if (this.selected) this.renderDetail();
    window.__lastEvents = events;
  }
  removeActor(id) {
    const a = this.actors.get(id); if (!a) return; a.slot.bot = null; a.slot.drawnKey = ''; a.slot.glowMat.opacity = 0; this.venue.drawScreen(a.slot, null);
    const si = this.meetSeats.indexOf(id); if (si >= 0) this.meetSeats[si] = null;
    a.dispose(); this.actors.delete(id); const l = this.labels.get(id); if (l) { l.el.remove(); if (l.ld) l.ld.remove(); this.labels.delete(id); } if (this.selected === id) this.select(null);
  }
  // ---------------------------------------------------------------- DOM: labels, panel, detail
  makeLabel(b) {
    const el = document.createElement('div'); el.className = 'bub'; el.innerHTML = '<b></b><span></span><div class="ico"></div>';
    el.addEventListener('click', (e) => { e.stopPropagation(); this.select(this.selected === b.id ? null : b.id); }); el.style.pointerEvents = 'auto';
    $('#labels').appendChild(el); const ld = document.createElementNS('http://www.w3.org/2000/svg', 'line'); $('#leaders').appendChild(ld); this.labels.set(b.id, { el, ld, w: 120, h: 40, x: 0, y: 0 }); this.updateLabelText(b.id);
  }
  updateLabelText(id) {
    const l = this.labels.get(id), a = this.actors.get(id); if (!l || !a) return; const b = a.d, el = l.el;
    el.style.setProperty('--bc', b.color); el.querySelector('b').textContent = b.name; el.querySelector('span').textContent = b.state === 'idle' ? 'zzz' + (b.note ? ' · ' + b.note : ' · đang ngủ') : (b.task || STATE[b.state].label);
    el.querySelector('.ico').textContent = b.state === 'blocked' ? '!' : b.state === 'done' ? '\u2713' : '';
    el.classList.toggle('blocked', b.state === 'blocked'); el.classList.toggle('done', b.state === 'done');
    l.w = el.offsetWidth; l.h = el.offsetHeight;
  }
  renderPanel(flash = []) {
    const d = this.data; $('#count').textContent = '(' + d.bots.length + ')';
    $('#list').innerHTML = d.bots.map((b) => {
      const st = STATE[b.state];
      const logs = b.log.slice(-2).reverse().map((l) => `<div class="lg">${l.t ? fmtHM.format(new Date(l.t)) + ' ' : ''}${esc(l.msg)}</div>`).join('');
      return `<div class="row${this.selected === b.id ? ' sel' : ''}${flash.includes(b.id) ? ' flash' : ''}" data-id="${esc(b.id)}" style="--bc:${b.color}">
        <div class="top"><span class="nm">${b.src === 'devhub' ? '<span class="chip dh">DevHub</span> ' : ''}${esc(b.name)}</span><span class="badge" style="color:${UI_COL[b.state]}"><i style="background:${UI_COL[b.state]}"></i>${st.label}</span></div>
        <div class="role">${esc(b.role)}</div><div class="task">${esc(b.task || '-')}</div>
        ${b.progress != null ? `<div class="bar"><i style="width:${b.progress}%"></i></div>` : ''}
        <div class="meta">${b.project ? `<span class="chip">#${esc(b.project)}</span>` : ''}<span>${b.room === 'meeting' ? 'phòng họp' : 'bàn làm việc'}</span><span data-since="${esc(b.since)}">${rel(b.since)}</span></div>${logs}</div>`;
    }).join('');
    $('#groups').innerHTML = d.groups.length ? '<h3>Nhóm chat</h3>' + d.groups.map((g) => `<div class="grp"><b>${esc(g.name)}</b>${this.activeGroups.has(g.id) ? ' <span class="chip" style="background:#5ad07a;color:#102">đang họp</span>' : ''}
      <div style="opacity:.75;margin-top:2px">${esc(g.topic)}</div><div class="mem">${g.members.map((m) => { const bb = d.bots.find((x) => x.id === m); return `<span style="background:${bb ? bb.color : '#999'}">${esc(bb ? bb.name : m)}</span>`; }).join('')}</div></div>`).join('') : '';
  }
  renderDetail() {
    const a = this.actors.get(this.selected), el = $('#detail'); if (!a) { el.classList.remove('on'); return; }
    const b = a.d, st = STATE[b.state];
    el.innerHTML = `<h3><span style="border-left:6px solid ${b.color};padding-left:8px">${esc(b.name)}</span><span class="x" id="dx">&#10005;</span></h3>
      <div style="font-size:12px;opacity:.7;margin-top:2px">${esc(b.role)}</div>
      <div class="task">${esc(b.task || '-')}</div>${b.progress != null ? `<div class="bar"><i style="width:${b.progress}%"></i></div>` : ''}
      <div class="kv"><span>Trạng thái</span><span style="color:${UI_COL[b.state]};font-weight:700">${st.label}</span><span>Dự án</span><span>${esc(b.project || '-')}</span>
      <span>Vị trí</span><span>${b.room === 'meeting' || a.wantMeeting ? 'phòng họp' : 'bàn làm việc'}</span><span>Từ</span><span data-since="${esc(b.since)}">${rel(b.since)}</span></div>
      <div class="lgs">${b.log.length ? b.log.slice().reverse().map((l) => `<div><em>${l.t ? fmtHM.format(new Date(l.t)) : ''}</em> ${esc(l.msg)}</div>`).join('') : '<em>Chưa có nhật ký</em>'}</div>`;
    el.classList.add('on'); $('#dx').onclick = () => this.select(null);
  }
  select(id) {
    this.selected = id;
    document.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
    for (const [k, l] of this.labels) l.el.classList.toggle('sel', k === id);
    if (id && this.actors.has(id)) { this.rig.focus(this.actors.get(id)); this.renderDetail(); } else { this.selected = null; this.rig.overview(); $('#detail').classList.remove('on'); }
  }
  toast(msg) {
    const t = document.createElement('div'); t.className = 'toast panel'; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 6100);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  }
  toastEvent(e) {
    if (e.kind === 'state') this.toast(`${e.name}: ${STATE[e.from].label} -> ${STATE[e.to].label}`);
    else if (e.kind === 'task') this.toast(`${e.name}: việc mới - ${e.task.slice(0, 70)}`);
    else if (e.kind === 'new') this.toast(`${e.name} vừa vào văn phòng`); else if (e.kind === 'left') this.toast(`${e.name} đã rời văn phòng`);
  }
  tickUI() {
    const now = new Date(); const cm = this.clock;
    if (cm.mode === 'real') $('#clock').textContent = fmtTime.format(now); else { const h = cm.hour(); $('#clock').textContent = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0') + cm.label; }
    const c = this.conn, dot = $('#dot'); let cls = '', tip = 'Kết nối tốt';
    if (c.err) { cls = 'err'; tip = 'Lỗi tải: ' + c.err; } else if (c.lastOk && Date.now() - c.lastOk > CONFIG.staleMs) { cls = 'stale'; tip = 'Dữ liệu cũ hơn 60 giây'; } else if (!c.lastOk) { cls = 'stale'; tip = 'Đang kết nối...'; }
    dot.className = cls; dot.title = tip;
    $('#upd').textContent = c.err ? 'Lỗi kết nối' + (c.lastOk ? ' (lần cuối ' + fmtTime.format(new Date(c.lastOk)) + ')' : '') : 'Cập nhật lúc ' + (c.lastOk ? fmtTime.format(new Date(c.lastOk)) : '--:--:--');
    const dh = this.dh, el = $('#dhstat');
    if (dh && dh.state !== 'off') {
      const m = { live: ['ok', 'DevHub: trực tiếp (' + rel(dh.gen) + ')'], waiting: ['warn', 'DevHub: chưa có dữ liệu'], stale: ['warn', 'DevHub: dữ liệu cũ (' + rel(dh.gen) + ')'], down: ['err', 'DevHub: mất kết nối'], fallback: ['warn', 'DevHub: dùng status.json'], none: ['warn', 'DevHub: chưa nối'] }[dh.state] || ['warn', 'DevHub'];
      el.className = 'hide-m ' + m[0]; el.textContent = m[1]; el.title = (dh.err ? 'Lỗi: ' + dh.err + '. ' : '') + 'Nguồn: ' + (DEVHUB_SRC || '-'); el.previousElementSibling.style.display = '';
    } else { el.textContent = ''; el.previousElementSibling.style.display = 'none'; }
    if (this.data && this.data.updatedAt) $('#dataAge').textContent = 'Dữ liệu: ' + rel(this.data.updatedAt);
    document.querySelectorAll('[data-since]').forEach((e) => { const v = rel(e.dataset.since); if (e.textContent !== v) e.textContent = v; });
  }
  bindUI() {
    $('#list').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) this.select(this.selected === r.dataset.id ? null : r.dataset.id); });
    $('#overview').addEventListener('click', () => this.select(null));
    $('#sheetToggle').addEventListener('click', () => { document.body.classList.toggle('collapsed'); setTimeout(() => this.resize(), 30); });
    const cv = this.canvas, ptrs = new Map(); let g = null;
    const ndc = (x, y) => { const rc = cv.getBoundingClientRect(); return [((x - rc.left) / rc.width) * 2 - 1, -(((y - rc.top) / rc.height) * 2 - 1)]; };
    const pick = (x, y) => { const [nx, ny] = ndc(x, y); this.ndc.set(nx, ny); this.ray.setFromCamera(this.ndc, this.rig.cam); const hits = this.ray.intersectObjects([...this.actors.values()].map((a) => a.hit), false); this.select(hits.length ? hits[0].object.userData.botId : null); };
    const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (_) {} ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) g = { x0: e.clientX, y0: e.clientY, t: performance.now(), moved: false }; else if (ptrs.size === 2) { g = { moved: true, ...two() }; }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p || !g) return; const px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {   // pinch zoom around the midpoint + two-finger pan
        const c = two(), [nx, ny] = ndc(c.x, c.y); if (g.d > 0) this.rig.zoomBy(c.d / g.d, nx, ny);
        const rc = cv.getBoundingClientRect(); this.rig.panBy((c.x - g.x) / rc.width * 2, -(c.y - g.y) / rc.height * 2); g.d = c.d; g.x = c.x; g.y = c.y; return;
      }
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8) g.moved = true;
      if (g.moved && ptrs.size === 1) { const rc = cv.getBoundingClientRect(); this.rig.panBy((e.clientX - px) / rc.width * 2, -(e.clientY - py) / rc.height * 2); }
    });
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return; const wasClick = ptrs.size === 1 && g && !g.moved && performance.now() - g.t < 600 && e.type === 'pointerup';
      ptrs.delete(e.pointerId); if (wasClick) pick(e.clientX, e.clientY); if (ptrs.size === 1) g = { moved: true }; else if (!ptrs.size) g = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), [nx, ny] = ndc(e.clientX, e.clientY);
      this.rig.zoomBy(clamp(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)), 0.6, 1.6), nx, ny);
    }, { passive: false });
    cv.addEventListener('dblclick', () => this.select(null));   // reset view
    $('#zin').addEventListener('click', () => this.rig.zoomBy(1.35)); $('#zout').addEventListener('click', () => this.rig.zoomBy(1 / 1.35));
  }
  // ---------------------------------------------------------------- frame
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.applyEnv(dt);
    for (const a of this.actors.values()) { if (a.celebrate > 0) a.celebrate -= dt; a.update(dt); }
    this.separate(dt);
    for (const s of this.venue.slots) {
      const a = s.bot && this.actors.get(s.bot), t = now / 1000; let op = 0, br = 0.35;
      if (a) { const st = a.d.state; br = st === 'working' ? 0.92 + Math.sin(t * 3) * 0.08 : st === 'blocked' ? 0.7 + Math.sin(t * 9) * 0.3 : 0.5;
        op = st === 'working' ? 0.2 + Math.sin(t * 3 + a.ph) * 0.07 : st === 'blocked' ? 0.14 + Math.sin(t * 9) * 0.1 : 0.04; if (st === 'blocked') s.glowMat.color.set('#ff3b2e'); else s.glowMat.color.set(a.d.color); }
      s.glowMat.opacity = op; s.screenMat.color.setScalar(br);
    }
    this.rig.update(dt, this.tmp); this.renderer.render(this.scene, this.rig.cam); this.updateLabels();
    requestAnimationFrame((t) => this.frame(t));
  }
  // keep avatars from standing on top of each other while walking or hanging around: push free actors apart (seated ones act as fixed obstacles)
  separate(dt) {
    const R = CONFIG.sep.radius, list = [...this.actors.values()].filter((a) => a.hold <= 0);
    for (const a of list) {
      if (!a.free) continue;
      let fx = 0, fz = 0;
      for (const o of list) {
        if (o === a) continue;
        let dx = a.root.position.x - o.root.position.x, dz = a.root.position.z - o.root.position.z, dist = Math.hypot(dx, dz);
        if (dist >= R) continue;
        if (dist < 0.02) { const ang = (hash(a.id) % 628) / 100; dx = Math.cos(ang); dz = Math.sin(ang); dist = 1e-3; } else { dx /= dist; dz /= dist; }
        const w = (R - dist) * (o.free ? 0.5 : 1);   // two walkers share the correction, a seated one does not move
        fx += dx * w; fz += dz * w;
      }
      const k = Math.min(1, dt * 7), M = CONFIG.sep.max;
      if (fx || fz) { a.off.x += fx * k * 2.2; a.off.z += fz * k * 2.2; } else { const d = Math.min(1, dt * 1.5); a.off.x -= a.off.x * d; a.off.z -= a.off.z * d; }
      const m = Math.hypot(a.off.x, a.off.z); if (m > M) { a.off.x *= M / m; a.off.z *= M / m; }
    }
  }
  labelOverlap() { const r = [...this.labels.values()].filter((l) => l.el.style.display !== 'none' && !l.el.classList.contains('pop')).map((l) => l.el.getBoundingClientRect()); let n = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 1 && r[i].right > r[j].left + 1 && r[i].top < r[j].bottom - 1 && r[i].bottom > r[j].top + 1) n++; return n; }
  minGap() { const l = [...this.actors.values()].filter((a) => a.hold <= 0); let m = 1e9; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) m = Math.min(m, Math.hypot(l[i].root.position.x - l[j].root.position.x, l[i].root.position.z - l[j].root.position.z)); return m; }
  updateLabels() {
    const items = [], meetCount = [...this.actors.values()].filter((a) => a.at && a.at[0] === 'M' && !a.queue.length).length;
    for (const [id, l] of this.labels) {
      const a = this.actors.get(id); if (!a) continue; const vis = a.hold <= 0; l.el.style.display = vis ? '' : 'none'; if (l.ld) l.ld.style.display = vis ? '' : 'none'; if (!vis) continue;
      a.headWorld(this.tmp2); this.tmp2.y += 0.55 + 0.35 * a.zA; this.tmp2.project(this.rig.cam);   // sleepers: bubble a bit higher, Zzz drift off to its right
      const x = (this.tmp2.x * 0.5 + 0.5) * this.W, y = (-this.tmp2.y * 0.5 + 0.5) * this.H;
      const compact = meetCount > 2 && a.at[0] === 'M' && this.selected !== id; l.el.classList.toggle('compact', compact);
      if (compact) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
      items.push({ id, l, x, y: y - 8 });
    }
    // greedy placement: nearest free slot (sideways or stacked upwards) around each bot's head, front-most bot first
    items.sort((p, q) => q.y - p.y); const placed = [], G = 4;
    const hit = (L, T, w, h) => placed.some((p) => L < p.x + p.w + 2 && L + w > p.x - 2 && T < p.y + p.h + 2 && T + h > p.y - 2);
    const spot = (it, dxk, dy) => ({ dxk, dy, L: clamp(it.x - it.l.w / 2 + dxk * (it.l.w + G), 4, this.W - it.l.w - 4), T: Math.max(4, it.y - it.l.h - dy * (it.l.h + G)) });
    for (const it of items) {
      const w = it.l.w, h = it.l.h, l = it.l; let best = null;
      const prev = l.slot && spot(it, l.slot.dxk, l.slot.dy);                       // hysteresis: keep last slot while it stays free (no flicker, no jumping)
      if (prev && !hit(prev.L, prev.T, w, h)) best = prev;
      else for (const dy of [0, 1, 2, 3, 4, 5, 6]) for (const dxk of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        const c = spot(it, dxk, dy), cost = Math.abs(dxk) * 0.7 + dy + (hit(c.L, c.T, w, h) ? 100 : 0); if (!best || cost < best.cost) best = { ...c, cost };
      }
      l.slot = { dxk: best.dxk, dy: best.dy }; placed.push({ x: best.L, y: best.T, w, h });
      l.px = best.L; l.py = best.T;
      l.el.style.transform = `translate(${l.px.toFixed(1)}px,${l.py.toFixed(1)}px)`;
      const tx = clamp(it.x - l.px, 12, w - 12); l.el.style.setProperty('--tx', tx.toFixed(1) + 'px');
      if (l.ld) { const displaced = Math.abs(it.x - (l.px + w / 2)) > w * 0.3 || l.py + h < it.y - 14; l.ld.setAttribute('x1', (l.px + tx).toFixed(1)); l.ld.setAttribute('y1', (l.py + h + 5).toFixed(1)); l.ld.setAttribute('x2', it.x.toFixed(1)); l.ld.setAttribute('y2', (it.y + 6).toFixed(1)); l.ld.style.opacity = displaced ? 1 : 0; }
    }
  }
}
const app = new App(); window.__OFFICE = { app, get bots() { return Object.fromEntries([...app.actors].map(([id, a]) => [id, { state: a.d.state, task: a.d.task, x: a.root.position.x, z: a.root.position.z, at: a.at, dest: a.dest, moving: a.moving, seat: a.seat, queue: a.queue.length }])); }, poll: () => app.poll(), env: () => ({ hour: app.env.hour, lamp: app.env.lamp, cars: app.city.cars.length, moving: app.city.cars.filter((c) => c.v > 0.5).length }), minGap: () => app.minGap(), labelOverlap: () => app.labelOverlap() };
