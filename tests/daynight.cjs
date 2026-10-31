// Day/night test: ?time=day|night|cycle|18.3, default = real Bangkok time. Needs tests/serve.cjs on :8123.
const { chromium } = require('/workspace/pw/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let fail = 0; const ok = (n, c, i) => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(i)); if (!c) fail++; };
  const run = async (qs, fn, wait = 2500) => {
    const p = await b.newPage({ viewport: { width: 1000, height: 640 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/index.html' + qs); await p.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 }); await p.waitForTimeout(wait);
    const r = await fn(p); ok('no errors ' + qs, !errs.length, errs); await p.close(); return r;
  };
  const env = (p) => p.evaluate(() => window.__OFFICE.env());
  const d = await run('?time=day', env), n = await run('?time=night', env), r = await run('', env);
  ok('time=day is bright, lights off', d.lamp < 0.05 && d.hour === 13, d); ok('time=night lights on', n.lamp > 0.95, n);
  const bk = (new Date(Date.now() + 7 * 3600e3)).getUTCHours() + (new Date().getUTCMinutes()) / 60; const dd = Math.abs(((r.hour - bk + 36) % 24) - 12); ok('default follows Asia/Bangkok hour', dd < 0.3, { r, bk });
  const e1 = await run('?time=cycle&speed=30', async (p) => { const a = await env(p); await p.waitForTimeout(6000); return [a, await env(p)]; }, 500);
  ok('cycle advances the clock', Math.abs(e1[1].hour - e1[0].hour) > 1.5, e1);
  const cars = await run('?time=day', async (p) => { const a = await p.evaluate(() => window.__OFFICE.app.city.cars.map(c => c.s)); await p.waitForTimeout(3000); const c = await p.evaluate(() => window.__OFFICE.app.city.cars.map(c => c.s)); return { n: a.length, moved: a.filter((s, i) => Math.abs(s - c[i]) > 0.3).length, stopped: await p.evaluate(() => window.__OFFICE.env().moving) }; });
  ok('cars exist and most are moving', cars.n > 40 && cars.moved > cars.n * 0.4, cars);
  const mob = await b.newPage({ viewport: { width: 390, height: 844 } }); await mob.goto('http://localhost:8123/index.html?time=night'); await mob.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 });
  const mc = await mob.evaluate(() => window.__OFFICE.env().cars); ok('mobile uses fewer cars', mc < cars.n * 0.75, { mc, desktop: cars.n }); await mob.close();
  await b.close(); process.exit(fail ? 1 : 0);
})();
