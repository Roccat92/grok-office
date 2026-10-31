#!/usr/bin/env node
// Cập nhật status.json cho Grok Office (không cần cài thư viện).
// Ví dụ: node scripts/update-status.mjs --bot nexa --state working --task "..." --project kitchen-rally --push
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATES = ['working', 'idle', 'meeting', 'blocked', 'done'];
const ROOMS = ['desk', 'meeting'];
const PALETTE = ['#d94a3d', '#3e8ce6', '#f2b134', '#9a5bd6', '#2fb59a', '#e27d3a', '#5f7d8c', '#c2549a'];

const HELP = `Dùng: node scripts/update-status.mjs --bot <id> [tuỳ chọn]

Bot:
  --bot <id>            id của bot (bắt buộc, trừ khi chỉ sửa nhóm bằng --group)
  --state <${STATES.join('|')}>
  --task "<mô tả ngắn>"
  --project <tên dự án>  (rỗng "" để bỏ)
  --room <desk|meeting>
  --progress <0-100|none>
  --log "<ghi chú>"      mặc định tự ghi log khi đổi state hoặc task; --no-log để tắt
  --name --role --color  dùng khi tạo bot mới hoặc đổi thông tin
  --remove               xoá bot khỏi danh sách

Nhóm (group):
  --group <id> [--group-name "..."] [--members a,b] [--topic "..."] [--active true|false]
  --remove-group <id>

Chung:
  --file <đường dẫn>    mặc định status.json ở thư mục gốc repo
  --dry-run             chỉ in kết quả, không ghi file
  --push                git add + commit + push sau khi ghi
  --message "<msg>"     nội dung commit (mặc định tự sinh)
  --list                in danh sách bot hiện tại
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Đối số lạ: ${a}`);
    const k = a.slice(2);
    const flags = ['push', 'dry-run', 'no-log', 'remove', 'list', 'help'];
    if (flags.includes(k)) { out[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`Thiếu giá trị cho --${k}`);
    out[k] = v;
  }
  return out;
}

function fail(msg) { console.error('Lỗi: ' + msg); process.exit(1); }

let args;
try { args = parseArgs(process.argv.slice(2)); } catch (e) { fail(e.message); }
if (args.help || process.argv.length <= 2) { console.log(HELP); process.exit(0); }

const file = path.resolve(args.file || path.join(ROOT, 'status.json'));
let data = { version: 1, updatedAt: new Date().toISOString(), bots: [], groups: [] };
if (fs.existsSync(file)) {
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`status.json không đọc được: ${e.message}`); }
}
data.version = data.version || 1;
data.bots = Array.isArray(data.bots) ? data.bots : [];
data.groups = Array.isArray(data.groups) ? data.groups : [];

if (args.list) {
  for (const b of data.bots) console.log(`${b.id.padEnd(16)} ${String(b.state).padEnd(8)} ${b.project || '-'} | ${b.task}`);
  process.exit(0);
}

const now = new Date().toISOString();
const changes = [];

if (args.state && !STATES.includes(args.state)) fail(`--state phải là một trong: ${STATES.join(', ')}`);
if (args.room && !ROOMS.includes(args.room)) fail(`--room phải là một trong: ${ROOMS.join(', ')}`);
let progress;
if (args.progress !== undefined) {
  if (args.progress === 'none' || args.progress === '') progress = null;
  else {
    progress = Number(args.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) fail('--progress phải trong khoảng 0-100 hoặc "none"');
    progress = Math.round(progress);
  }
}
if (args.color && !/^#[0-9a-fA-F]{6}$/.test(args.color)) fail('--color phải có dạng #rrggbb');

if (args.bot) {
  const id = String(args.bot).trim();
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) fail('--bot chỉ gồm chữ, số, dấu gạch ngang');
  let bot = data.bots.find((b) => b.id === id);
  if (args.remove) {
    if (!bot) fail(`Không có bot "${id}"`);
    data.bots = data.bots.filter((b) => b.id !== id);
    for (const g of data.groups) g.members = (g.members || []).filter((m) => m !== id);
    changes.push(`xoá bot ${id}`);
  } else {
    if (!bot) {
      bot = { id, name: args.name || id.toUpperCase(), role: args.role || '', color: args.color || PALETTE[data.bots.length % PALETTE.length],
        state: 'idle', task: 'Chờ việc mới', project: '', room: 'desk', since: now, log: [] };
      data.bots.push(bot);
      changes.push(`tạo bot ${id}`);
    }
    const prevState = bot.state, prevTask = bot.task;
    if (args.name) bot.name = args.name;
    if (args.role !== undefined) bot.role = args.role;
    if (args.color) bot.color = args.color;
    if (args.state) bot.state = args.state;
    if (args.task !== undefined) bot.task = args.task;
    if (args.project !== undefined) bot.project = args.project;
    if (args.room) bot.room = args.room;
    else if (args.state === 'meeting') bot.room = 'meeting';
    else if (args.state && args.state !== 'meeting' && bot.room === 'meeting' && prevState === 'meeting') bot.room = 'desk';
    if (progress !== undefined) { if (progress === null) delete bot.progress; else bot.progress = progress; }
    const stateChanged = bot.state !== prevState, taskChanged = bot.task !== prevTask;
    if (stateChanged || taskChanged) {
      bot.since = now;
      if (stateChanged && args.state !== 'working' && progress === undefined && bot.state !== 'working') delete bot.progress;
    }
    const shouldLog = !args['no-log'] && (args.log !== undefined || stateChanged || taskChanged);
    if (shouldLog) {
      const msg = args.log !== undefined ? args.log : (taskChanged && bot.task ? bot.task : `Chuyển sang trạng thái: ${bot.state}`);
      bot.log = Array.isArray(bot.log) ? bot.log : [];
      bot.log.push({ t: now, msg });
      bot.log = bot.log.slice(-5);
    }
    changes.push(`${bot.id}: ${bot.state}${bot.project ? ' [' + bot.project + ']' : ''} - ${bot.task}`);
  }
}

if (args.group) {
  const id = String(args.group).trim();
  let g = data.groups.find((x) => x.id === id);
  if (!g) { g = { id, name: args['group-name'] || id, members: [], topic: '' }; data.groups.push(g); changes.push(`tạo nhóm ${id}`); }
  if (args['group-name']) g.name = args['group-name'];
  if (args.members !== undefined) {
    g.members = String(args.members).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = g.members.filter((m) => !data.bots.some((b) => b.id === m));
    if (unknown.length) console.warn('Cảnh báo: chưa có bot: ' + unknown.join(', '));
  }
  if (args.topic !== undefined) g.topic = args.topic;
  if (args.active !== undefined) { if (!['true', 'false'].includes(args.active)) fail('--active phải là true hoặc false'); g.active = args.active === 'true'; }
  changes.push(`nhóm ${id}`);
}
if (args['remove-group']) {
  const before = data.groups.length;
  data.groups = data.groups.filter((x) => x.id !== args['remove-group']);
  if (data.groups.length === before) fail(`Không có nhóm "${args['remove-group']}"`);
  changes.push(`xoá nhóm ${args['remove-group']}`);
}

if (!changes.length) fail('Không có gì để cập nhật. Dùng --help để xem tuỳ chọn.');

data.updatedAt = now;
const json = JSON.stringify(data, null, 2) + '\n';
if (args['dry-run']) { process.stdout.write(json); process.exit(0); }
fs.writeFileSync(file, json);
console.log('Đã ghi ' + path.relative(process.cwd(), file) + ': ' + changes.join(' | '));

if (args.push) {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
  const rel = path.relative(ROOT, file);
  try {
    git('add', rel);
    const staged = git('diff', '--cached', '--name-only');
    if (!staged) { console.log('Không có thay đổi để commit.'); process.exit(0); }
    git('commit', '-m', args.message || `status: ${changes[0]}`, '--', rel);
    try { git('pull', '--rebase', '--autostash', '-q'); } catch { /* chưa có remote hoặc offline: bỏ qua, push sẽ báo lỗi nếu cần */ }
    git('push', '-q');
    console.log('Đã push: ' + git('rev-parse', '--short', 'HEAD'));
  } catch (e) { fail('git thất bại: ' + e.message); }
}
