const { chromium } = require('/workspace/pw/node_modules/playwright-core');
(async () => {
  const out = process.argv[2] || 'office', w = +process.argv[3] || 1280, h = +process.argv[4] || 760, focus = process.argv[5], wait = +process.argv[6] || 4000;
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: w, height: h } }); const errs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errs.push('pageerror: ' + e.message + e.stack));
  await p.goto('http://localhost:8123/index.html' + (process.env.QS || '')); await p.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 });
  if (focus) await p.evaluate(id => window.__OFFICE.app.select(id), focus);
  await p.waitForTimeout(wait); await p.screenshot({ path: out.startsWith("/") ? out + ".png" : `/workspace/grok-office/shots/${out}.png` });
  console.log('errors', errs); await b.close();
})();
