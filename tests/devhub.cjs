// DevHub link test (run with tests/serve.cjs on :8123). Covers: live mapping, desks for 5 Grok bots + 5 DevHub agents without overlap,
// zzz when idle, ?devhub=URL, stale data, source down (roster kept, sleeping), fallback to dh-* bots in status.json, ?devhub=off.
const { chromium } = require('/workspace/pw/node_modules/playwright-core');
const NOW = () => new Date().toISOString(), ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const grok = ['nexa', 'devhub', 'grokbot', 'email-startee', 'docs-writer'].map((id, i) => ({ id, name: id.toUpperCase(), role: 'Grok', color: '#d94a3d', state: i ? 'idle' : 'working', task: i ? 'Chờ việc' : 'Làm game', project: '', room: 'desk', since: NOW(), log: [] }));
const agents = (over = {}) => ({ schema: 'devhub-office/1', generatedAt: NOW(), agents: [
  { id: 'claude', name: 'Claude Code', kind: 'local_cli', enabled: true, state: 'running', model: 'opus', current: { status: 'running', title: 'Sửa lỗi đăng nhập', project: 'nexa-devhub', since: ago(60) }, last: null, queued: 0 },
  { id: 'codex', name: 'Codex', kind: 'local_sdk', enabled: true, state: 'waiting', current: { status: 'waiting_approval', title: 'Chạy pnpm test', project: 'startee', since: ago(30) }, last: null, queued: 0 },
  { id: 'grok-build', name: 'Grok Build (CLI)', kind: 'local_cli', enabled: true, state: 'available', last: { status: 'completed', title: 'Viết README', project: 'x', at: ago(40) }, current: null, queued: 0 },
  { id: 'grok', name: 'Grok API', kind: 'model_api', enabled: true, state: 'available', current: null, last: { status: 'completed', title: 'Cũ', project: '', at: ago(7200) }, queued: 2 },
  { id: 'openrouter', name: 'OpenRouter', kind: 'model_api', enabled: true, state: 'unavailable', detail: 'Chưa có key OpenRouter', current: null, last: null, queued: 0 }], ...over });
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let fail = 0; const ok = (n, c, i) => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(i)); if (!c) fail++; };
  const open = async (qs, { dh, status }) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 760 } }); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    p.dh = dh; p.status = status || { version: 1, updatedAt: NOW(), bots: grok, groups: [] };
    await p.route('**/status.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(p.status) }));
    await p.route('**/devhub-status.json*', r => p.dh === null ? r.fulfill({ status: 503, body: 'down' }) : r.fulfill({ contentType: 'application/json', body: JSON.stringify(p.dh) }));
    await p.route('http://dh.test/**', r => p.dh === null ? r.abort() : r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(p.dh) }));
    await p.goto('http://localhost:8123/index.html?interval=2&' + qs); await p.waitForFunction(() => window.__OFFICE && window.__OFFICE.app.data, { timeout: 60000 }); await p.waitForTimeout(800); return p;
  };
  const bots = (p) => p.evaluate(() => window.__OFFICE.bots), hud = (p) => p.evaluate(() => document.querySelector('#dhstat').textContent);
  try {
    // 1. live data over ?devhub=URL
    let p = await open('devhub=http://dh.test/office-status.json', { dh: agents() });
    let s = await bots(p);
    ok('10 desks: 5 Grok + 5 DevHub', Object.keys(s).length === 10 && ['dh-claude', 'dh-codex', 'dh-grok-build', 'dh-grok', 'dh-openrouter'].every(k => s[k]), Object.keys(s));
    ok('running -> working with task', s['dh-claude'].state === 'working' && s['dh-claude'].task === 'Sửa lỗi đăng nhập', s['dh-claude']);
    ok('waiting approval -> blocked', s['dh-codex'].state === 'blocked' && /Chờ duyệt/.test(s['dh-codex'].task), s['dh-codex']);
    ok('just finished -> done', s['dh-grok-build'].state === 'done', s['dh-grok-build']);
    ok('available -> idle (sleeps)', s['dh-grok'].state === 'idle', s['dh-grok']);
    ok('unavailable -> idle with reason', s['dh-openrouter'].state === 'idle' && /key OpenRouter/.test(s['dh-openrouter'].task), s['dh-openrouter']);
    ok('HUD says live', /trực tiếp/.test(await hud(p)), await hud(p));
    const ui = await p.evaluate(() => ({ chips: document.querySelectorAll('.chip.dh').length, zz: [...document.querySelectorAll('.bub span')].filter(e => /^zzz/.test(e.textContent)).length, sleepers: [...window.__OFFICE.app.actors.values()].filter(a => a.d.state === 'idle').length }));
    ok('DevHub chips in list', ui.chips === 5, ui); ok('idle bubbles show zzz', ui.zz === ui.sleepers && ui.sleepers >= 5, ui);
    // 2. state change picked up
    p.dh = agents(); p.dh.agents[0] = { ...p.dh.agents[0], state: 'available', current: null, last: { status: 'failed', title: 'Build đỏ', project: '', at: ago(5) } };
    await p.waitForFunction(() => window.__OFFICE.bots['dh-claude'].state === 'blocked', { timeout: 12000, polling: 300 }); ok('claude finished with failure -> blocked "Lỗi"', /Lỗi/.test((await bots(p))['dh-claude'].task));
    // 3. no overlap with 10 bots
    await p.waitForTimeout(25000);
    const g = await p.evaluate(() => ({ gap: window.__OFFICE.minGap(), ov: window.__OFFICE.labelOverlap() })); ok('avatars do not overlap (min gap ' + g.gap.toFixed(2) + ')', g.gap > 0.5, g);
    ok('label bubbles do not overlap', g.ov === 0, g);
    await p.screenshot({ path: '/workspace/grok-office/shots/devhub-office.png' });
    // 4. stale data
    p.dh = agents({ generatedAt: ago(900) }); await p.evaluate(() => window.__OFFICE.poll()); await p.waitForTimeout(500);
    s = await bots(p); ok('stale: DevHub agents sleep, HUD warns', s['dh-claude'].state === 'idle' && /cũ/.test(await hud(p)), [s['dh-claude'], await hud(p)]);
    // 5. source down: roster kept, sleeping, HUD error; recovers
    p.dh = null; await p.evaluate(() => window.__OFFICE.poll()); await p.waitForTimeout(500);
    s = await bots(p); ok('down: roster kept, all asleep', Object.keys(s).length === 10 && s['dh-claude'].state === 'idle' && /mất kết nối/i.test(await hud(p)), [Object.keys(s).length, await hud(p)]);
    ok('Grok bots unaffected while DevHub is down', s.nexa.state === 'working', s.nexa);
    p.dh = agents(); await p.evaluate(() => window.__OFFICE.poll()); await p.waitForTimeout(500);
    ok('recovers to live', (await bots(p))['dh-claude'].state === 'working' && /trực tiếp/.test(await hud(p)));
    ok('no page errors', !p.errs.length, p.errs); await p.close();
    // 6. default file = roster placeholder (no real data): 5 sleeping DevHub desks, "chưa có dữ liệu"
    p = await open('', { dh: JSON.parse(require('fs').readFileSync('/workspace/grok-office/devhub-status.json', 'utf8')) }); s = await bots(p);
    ok('placeholder roster: 5 agents asleep with "Chưa có dữ liệu"', s['dh-codex'].state === 'idle' && /Chưa có dữ liệu/.test(s['dh-codex'].task), s['dh-codex']); ok('HUD: chưa có dữ liệu', /chưa có dữ liệu/.test(await hud(p)), await hud(p)); await p.close();
    // 7. fallback: DevHub down from the start, dh-* bots stored in status.json are shown
    const fb = { version: 1, updatedAt: NOW(), bots: [...grok, { id: 'dh-claude', src: 'devhub', name: 'Claude Code', role: 'DevHub', color: '#d97757', state: 'working', task: 'Từ status.json', project: '', room: 'desk', since: NOW(), log: [] }], groups: [] };
    p = await open('', { dh: null, status: fb }); s = await bots(p); ok('fallback to status.json dh-* bots', s['dh-claude'] && s['dh-claude'].task === 'Từ status.json', s); ok('HUD: dùng status.json', /status\.json/.test(await hud(p)), await hud(p)); await p.close();
    // 8. devhub=off
    p = await open('devhub=off', { dh: agents() }); s = await bots(p); ok('devhub=off: only Grok bots, no HUD chip', Object.keys(s).length === 5 && (await hud(p)) === '', [Object.keys(s), await hud(p)]); await p.close();
  } catch (e) { console.log('ERR', e.message); fail++; }
  await b.close(); process.exit(fail ? 1 : 0);
})();
