import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// ================================================================ STATIC GEOMETRY BATCH (merged, flat-shaded, vertex colours)
export class Batch {
  constructor() {
    this.pos = []; this.nor = []; this.col = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.v = new THREE.Vector3(); this.n = new THREE.Vector3(); this.nm = new THREE.Matrix3(); this.c = new THREE.Color();
    this.boxGeo = Batch.flat(new THREE.BoxGeometry(1, 1, 1));
  }
  static flat(g) { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; }
  addGeo(geo, color, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz));
    this.nm.getNormalMatrix(this.m);
    const pa = geo.attributes.position, na = geo.attributes.normal; this.c.set(color);
    for (let i = 0; i < pa.count; i++) {
      this.v.fromBufferAttribute(pa, i).applyMatrix4(this.m); this.pos.push(this.v.x, this.v.y, this.v.z);
      this.n.fromBufferAttribute(na, i).applyMatrix3(this.nm).normalize(); this.nor.push(this.n.x, this.n.y, this.n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }
  box(x, y, z, w, h, d, color, ry = 0, rx = 0, rz = 0) { this.addGeo(this.boxGeo, color, x, y, z, w, h, d, rx, ry, rz); }
  // box between x0..x1, y0..y1, z0..z1
  span(x0, x1, y0, y1, z0, z1, color) { this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color); }
  build(material, cast = true, receive = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material); m.castShadow = cast; m.receiveShadow = receive; return m;
  }
}
