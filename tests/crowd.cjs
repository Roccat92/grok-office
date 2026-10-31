// 8-bot stress test: bots enter one by one, 'done' bots wander to coffee; asserts avatars never stack and bubbles never overlap.
const { chromium } = require('/workspace/pw/node_modules/playwright-core');
const mk = (id, state, extra = {}) => ({ id, name: id.toUpperCase(), role: 'x', color: '#' + ((id.length * 2654435) & 0xffffff).toString(16).padStart(6, '0'), state, task: state === 'working' ? 'Đang làm việc gì đó khá dài để thử bong bóng' : 'Chờ việc', project: state === 'working' ? 'p' : '', room: 'desk', since: new Date().toISOString(), log: [], ...extra });
(async () => {
  const shot = process.argv[2] || 'crowd', dur = +process.argv[3] || 45000;
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); let phase = 1; const errs = []; p.on('pageerror', e => errs.push(e.message));
  const one = [mk('nexa', 'working')];
  const all = [mk('nexa', 'working'), mk('devhub', 'idle'), mk('grokbot', 'idle'), mk('email-startee', 'idle'), mk('docs-writer', 'idle'), mk('d1', 'done'), mk('d2', 'done'), mk('d3', 'working')];
  await p.route('**/status.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), bots: phase === 1 ? one : all, groups: [] }) }));
  await p.goto('http://localhost:8123/index.html?interval=2'); await p.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 });
  await p.waitForTimeout(1500); phase = 2; const t0 = Date.now(); let minGap = 1e9, maxOv = 0, samples = 0, shotDone = false;
  while (Date.now() - t0 < dur) {
    await p.waitForTimeout(400); const r = await p.evaluate(() => ({ g: window.__OFFICE.minGap(), o: window.__OFFICE.labelOverlap(), n: Object.keys(window.__OFFICE.bots).length }));
    if (process.env.DBG && r.o) console.log(Math.round((Date.now()-t0)/1000), r.o, r.g.toFixed(2)); if (r.n === 8) { samples++; minGap = Math.min(minGap, r.g); maxOv = Math.max(maxOv, r.o); }
    if (!shotDone && Date.now() - t0 > dur * 0.6) { await p.screenshot({ path: `/workspace/grok-office/shots/${shot}.png` }); shotDone = true; }
  }
  console.log(JSON.stringify({ samples, minGap: +minGap.toFixed(2), maxLabelOverlaps: maxOv, errs }));
  await b.close(); process.exit(minGap > 0.5 && maxOv === 0 && !errs.length ? 0 : 1);
})();
