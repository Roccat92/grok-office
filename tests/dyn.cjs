// Test: editing status.json is picked up within ~10s and animates (run with tests/serve.cjs on :8123)
const { chromium } = require('/workspace/pw/node_modules/playwright-core'); const fs = require('fs');
const F = '/workspace/grok-office/status.json', orig = fs.readFileSync(F, 'utf8');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); const errs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  let fail = 0; const ok = (n, c, i) => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(i)); if (!c) fail++; };
  try {
    await p.goto('http://localhost:8123/index.html'); await p.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 });
    await p.waitForTimeout(1500);
    const b0 = await p.evaluate(() => window.__OFFICE.bots);
    ok('initial states', b0.nexa.state === 'working' && b0.devhub.state === 'idle', b0);
    ok('devhub at desk, not moving', !b0.devhub.moving && b0.devhub.at[0] === 'S', b0.devhub);
    // edit: devhub -> meeting, nexa -> blocked
    const d = JSON.parse(orig); const t0 = Date.now();
    d.bots.find(x => x.id === 'devhub').state = 'meeting'; d.bots.find(x => x.id === 'devhub').room = 'meeting'; d.bots.find(x => x.id === 'devhub').task = 'Họp nhóm game casual pixel';
    d.bots.find(x => x.id === 'nexa').state = 'blocked'; d.bots.find(x => x.id === 'nexa').task = 'Chờ bạn xác nhận cảm giác di chuyển'; d.updatedAt = new Date().toISOString();
    fs.writeFileSync(F, JSON.stringify(d, null, 2));
    await p.waitForFunction(() => window.__OFFICE.bots.devhub.state === 'meeting', { timeout: 15000, polling: 200 });
    const dt = (Date.now() - t0) / 1000; ok('change picked up within 12s (took ' + dt.toFixed(1) + 's)', dt <= 12.5, dt);
    const bl = await p.evaluate(() => ({ b: window.__OFFICE.bots, toast: [...document.querySelectorAll('.toast')].map(e => e.textContent), blocked: document.querySelector('.bub.blocked b')?.textContent, ev: window.__lastEvents }));
    ok('nexa blocked + bubble flagged', bl.b.nexa.state === 'blocked' && (bl.blocked || '').startsWith('NEXA'), bl);
    ok('toast shown', bl.toast.length >= 1, bl.toast);
    await p.waitForTimeout(2500);
    const b1 = await p.evaluate(() => window.__OFFICE.bots);
    const moved = Math.hypot(b1.devhub.x - b0.devhub.x, b1.devhub.z - b0.devhub.z);
    ok('devhub is walking toward meeting room (moved ' + moved.toFixed(2) + ')', moved > 0.8 && (b1.devhub.moving || b1.devhub.dest === 'meeting'), b1.devhub);
    await p.screenshot({ path: '/workspace/grok-office/shots/walking.png' });
    await p.waitForFunction(() => { const x = window.__OFFICE.bots.devhub; return !x.moving && x.at[0] === 'M'; }, { timeout: 40000, polling: 300 });
    ok('devhub seated in meeting room', true);
    await p.waitForTimeout(1200); await p.screenshot({ path: '/workspace/grok-office/shots/meeting.png' });
    // connection dot: break server response by pointing to bad status (remove file)
    fs.writeFileSync(F, '{bad json'); await p.evaluate(() => window.__OFFICE.poll()); await p.waitForTimeout(500);
    const dot = await p.evaluate(() => document.querySelector('#dot').className); ok('dot red on error', dot === 'err', dot);
    fs.writeFileSync(F, orig); await p.evaluate(() => window.__OFFICE.poll()); await p.waitForTimeout(500);
    const dot2 = await p.evaluate(() => document.querySelector('#dot').className); ok('dot green on recover', dot2 === '', dot2);
    ok('no console errors', errs.length === 0, errs);
  } catch (e) { console.log('ERR', e.message); fail++; }
  fs.writeFileSync(F, orig); await b.close(); process.exit(fail ? 1 : 0);
})();
