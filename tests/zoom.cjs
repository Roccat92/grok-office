// Zoom test: wheel zoom toward the cursor (anchor stays put), clamps, easing, buttons, double-click reset, drag pan, pinch. Needs tests/serve.cjs on :8123.
const { chromium } = require('/workspace/pw/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 700 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let fail = 0; const ok = (n, c, i) => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(i)); if (!c) fail++; };
  await p.goto('http://localhost:8123/index.html?time=day'); await p.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 }); await p.waitForTimeout(1500);
  const st = () => p.evaluate(() => { const r = window.__OFFICE.app.rig; return { z: r.zoom, zt: r.zoomT, T: r.T.toArray(), TT: r.TT.toArray() }; });
  // world point on the floor plane under a screen position
  const under = (x, y) => p.evaluate(([x, y]) => { const a = window.__OFFICE.app, rc = a.canvas.getBoundingClientRect(), v = { x: ((x - rc.left) / rc.width) * 2 - 1, y: -(((y - rc.top) / rc.height) * 2 - 1) };
    const o = new a.tmp.constructor(v.x, v.y, -1).unproject(a.rig.cam), d = new a.tmp.constructor(v.x, v.y, 1).unproject(a.rig.cam).sub(o).normalize(), t = -o.y / d.y; return [o.x + d.x * t, o.z + d.z * t]; }, [x, y]);
  const settle = () => p.waitForTimeout(2500);
  const s0 = await st(); ok('starts at overview zoom 1', Math.abs(s0.zt - 1) < 1e-6, s0);
  const cx = 300, cy = 330; const w0 = await under(cx, cy);
  await p.mouse.move(cx, cy); await p.mouse.wheel(0, -500);
  await p.waitForTimeout(120); const mid = await st(); ok('easing: zoom target jumps but zoom lags behind', mid.zt < 0.7 && mid.z > mid.zt + 0.02, mid);
  await settle(); const s1 = await st(); const w1 = await under(cx, cy);
  ok('wheel up zooms in', s1.z < 0.7, s1); ok('zoom is toward the cursor (point under it stays)', Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) < 0.6, { w0, w1 });
  for (let i = 0; i < 15; i++) await p.mouse.wheel(0, -400); await settle(); const s2 = await st(); ok('clamped at max zoom-in', Math.abs(s2.zt - 0.16) < 1e-6 && Math.abs(s2.z - 0.16) < 0.01, s2);
  for (let i = 0; i < 25; i++) await p.mouse.wheel(0, 400); await settle(); const s3 = await st(); ok('clamped at max zoom-out', Math.abs(s3.zt - 1.25) < 1e-6, s3);
  await p.dblclick('#gl', { position: { x: 400, y: 300 } }); await settle(); const s4 = await st(); ok('double-click resets', Math.abs(s4.z - 1) < 0.01 && Math.hypot(s4.T[0] - s0.T[0], s4.T[2] - s0.T[2]) < 0.2, { s0, s4 });
  await p.click('#zin'); await settle(); const s5 = await st(); ok('+ button zooms in', s5.z < 0.8, s5);
  await p.click('#zout'); await p.click('#zout'); await settle(); ok('- button zooms out', (await st()).z > 1.2, await st());
  await p.click('#overview'); await settle(); ok('overview button resets', Math.abs((await st()).z - 1) < 0.01, await st());
  // drag pan (only possible while zoomed in)
  await p.mouse.move(cx, cy); await p.mouse.wheel(0, -700); await settle(); const a0 = await st();
  await p.mouse.move(500, 300); await p.mouse.down(); await p.mouse.move(380, 260, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300); const a1 = await st();
  ok('drag pans the view', Math.hypot(a1.T[0] - a0.T[0], a1.T[2] - a0.T[2]) > 0.5, { a0, a1 }); ok('drag did not select a bot', await p.evaluate(() => window.__OFFICE.app.selected === null), null);
  // pinch via synthetic touch pointer events
  await p.click('#overview'); await settle();
  await p.evaluate(() => { const c = document.querySelector('#gl'), mk = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
    mk('pointerdown', 1, 380, 300); mk('pointerdown', 2, 520, 300); for (let i = 1; i <= 8; i++) { mk('pointermove', 1, 380 - i * 14, 300); mk('pointermove', 2, 520 + i * 14, 300); } mk('pointerup', 1, 268, 300); mk('pointerup', 2, 632, 300); });
  await settle(); const pz = await st(); ok('pinch out zooms in', pz.z < 0.7, pz);
  ok('no page errors', !errs.length, errs);
  await b.close(); process.exit(fail ? 1 : 0);
})();
