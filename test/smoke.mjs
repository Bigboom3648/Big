// Дымовой тест: поднимает сервер, подключает двух игроков и проверяет
// основные сценарии протокола. Запуск: npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createWorldGen } from '../public/src/shared/worldgen.js';
import { B, RECIPES, BLOCKS, ITEMS, JOBS, armorId, validItem } from '../public/src/shared/blocks.js';
import { normalizeCode, newCode, sendFramed, makeReceiver } from '../public/src/client/p2p.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kubozemye-'));
const PORT = 3900 + Math.floor(Math.random() * 500);
let failed = 0;
const ok = (cond, name) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, msgs: [], name };
  ws.on('message', (raw) => c.msgs.push(JSON.parse(raw.toString())));
  c.send = (m) => ws.send(JSON.stringify(m));
  c.wait = async (pred, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = c.msgs.find(pred);
      if (m) return m;
      await sleep(20);
    }
    return null;
  };
  c.open = new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });
  return c;
}

console.log('Генерация мира');
{
  const a = createWorldGen(42).generateChunk(3, -2);
  const b = createWorldGen(42).generateChunk(3, -2);
  ok(a.length === 16 * 16 * 128 && a.every((v, i) => v === b[i]), 'чанк детерминирован по зерну');
  ok(a.every((v) => v === 0 || BLOCKS[v]), 'в чанке только известные блоки');
  ok(RECIPES.every((r) => validItem(r.out[0]) && r.ins.every(([id]) => validItem(id))), 'рецепты ссылаются на существующие предметы');
  ok(JOBS.every((j) => validItem(j.give[0]) && validItem(j.get[0])), 'сделки жителей ссылаются на существующие предметы');
  ok([0, 1, 2].every((t) => [0, 1, 2, 3].every((s) => ITEMS[armorId(t, s)].armor.slot === s && RECIPES.some((r) => r.out[0] === armorId(t, s)))), 'у каждой части брони есть слот и рецепт');
  const g1 = createWorldGen(42);
  const v1 = g1.villages.nearest(0, 0, 2);
  const v2 = createWorldGen(42).villages.nearest(0, 0, 2);
  ok(v1 && v2 && v1.village.x === v2.village.x && v1.village.z === v2.village.z && v1.village.houses.length > 0, 'деревни детерминированы по зерну');
  let planks = 0;
  for (let cx = v1.village.x0 >> 4; cx <= v1.village.x1 >> 4; cx++) {
    for (let cz = v1.village.z0 >> 4; cz <= v1.village.z1 >> 4; cz++) {
      for (const id of g1.generateChunk(cx, cz)) if (id === B.PLANKS || id === B.SANDSTONE) planks++;
    }
  }
  ok(planks > 50, 'в чанках деревни есть постройки');
}

console.log('Игра с друзьями по коду');
{
  ok(normalizeCode(' k7m-4qx ') === 'K7M4QX', 'код читается без учёта регистра и дефисов');
  ok(normalizeCode('КМ4ВСЕ') === 'KM4BCE', 'код, набранный в русской раскладке, понимается');
  ok(normalizeCode('https://example.org/public/?join=K7M4QX') === 'K7M4QX', 'можно вставить ссылку-приглашение целиком');
  ok(normalizeCode('abc') === null && normalizeCode('K7M4Q0') === null, 'неправильный код отклоняется');
  const codes = Array.from({ length: 50 }, newCode);
  ok(codes.every((c) => normalizeCode(c) === c), 'новые коды всегда правильные');
  const conn = { open: true, sent: [], send(x) { this.sent.push(x); } };
  const big = { t: 'cd', c: [[1, 2, Array.from({ length: 3000 }, (_, i) => i * 7)], [3, 4, []]], note: 'кириллица' };
  sendFramed(conn, big);
  sendFramed(conn, { t: 'chat', m: 'привет' });
  const rx = makeReceiver();
  const got = conn.sent.map(rx).filter(Boolean);
  ok(conn.sent.length > 3 && conn.sent.every((x) => new TextEncoder().encode(x).length < 16000), 'большое сообщение режется на куски меньше 16 КБ');
  ok(got.length === 2 && JSON.stringify(got[0]) === JSON.stringify(big) && got[1].m === 'привет', 'куски собираются обратно без потерь');
}

console.log('Сервер и сеть');
const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: '42' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
try {
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('сервер не запустился')), 8000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('localhost')) {
        clearTimeout(t);
        res();
      }
    });
  });
  const page = await fetch(`http://127.0.0.1:${PORT}/`);
  ok(page.status === 200 && (await page.text()).includes('Кубоземье'), 'главная страница отдаётся');
  ok((await fetch(`http://127.0.0.1:${PORT}/vendor/three/three.module.js`)).status === 200, 'three.js отдаётся');
  ok((await fetch(`http://127.0.0.1:${PORT}/%2e%2e/server.js`)).status !== 200, 'выход за пределы public запрещён');

  const a = client('Аня');
  const b = client('Боря');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'hello', name: 'Аня', token: 'tok-a', mode: 's' });
  const wa = await a.wait((m) => m.t === 'welcome');
  ok(wa && wa.seed === 42 && Array.isArray(wa.spawn), 'первый игрок получает welcome');
  b.send({ t: 'hello', name: 'Аня', token: 'tok-b', mode: 'c' });
  const wb = await b.wait((m) => m.t === 'welcome');
  ok(wb && wb.players.length === 1 && wb.name !== 'Аня', 'второй игрок видит первого, имя не дублируется');
  ok(!!(await a.wait((m) => m.t === 'join' && m.id === wb.id)), 'первый узнаёт о входе второго');

  const [sx, sy, sz] = wa.spawn.map(Math.floor);
  a.send({ t: 'pos', p: wa.spawn, r: [0, 0], h: 0 });
  b.send({ t: 'pos', p: wa.spawn, r: [0, 0], h: 0 });
  await sleep(150);
  a.send({ t: 'set', x: sx + 2, y: sy + 3, z: sz, id: B.PLANKS });
  const got = await b.wait((m) => m.t === 'b' && m.x === sx + 2 && m.y === sy + 3 && m.id === B.PLANKS);
  ok(!!got, 'установка блока доходит до другого игрока');
  a.send({ t: 'set', x: sx + 500, y: sy, z: sz, id: B.PLANKS });
  ok(!!(await a.wait((m) => m.t === 'b' && m.x === sx + 500)), 'блок вне досягаемости отклоняется');
  a.send({ t: 'set', x: sx, y: 0, z: sz, id: 0 });
  ok(!!(await a.wait((m) => m.t === 'b' && m.y === 0 && m.id === B.BEDROCK)), 'основу мира сломать нельзя');

  b.send({ t: 'cr', c: [[(sx + 2) >> 4, sz >> 4]] });
  const cd = await b.wait((m) => m.t === 'cd');
  ok(cd && cd.c[0][2].includes(B.PLANKS), 'правки чанка отдаются по запросу');

  b.send({ t: 'chat', m: 'привет' });
  ok(!!(await a.wait((m) => m.t === 'chat' && m.m === 'привет' && m.id === wb.id)), 'чат работает');
  ok(!!(await a.wait((m) => m.t === 'pp' && m.l.length === 2)), 'рассылаются позиции игроков');
  b.send({ t: 'pos', p: wa.spawn, r: [0, 0], h: 0, a: 171 });
  ok(!!(await a.wait((m) => m.t === 'pp' && m.l.some((e) => e[0] === wb.id && e[7] === 171))), 'надетая броня видна другим игрокам');
  a.send({ t: 'pref', horror: false });

  // бочка: поджиг -> взрыв -> пакет изменений
  a.send({ t: 'set', x: sx + 3, y: sy + 1, z: sz + 3, id: B.BARREL });
  await sleep(100);
  a.send({ t: 'ignite', x: sx + 3, y: sy + 1, z: sz + 3 });
  ok(!!(await b.wait((m) => m.t === 'b' && m.id === B.BARREL_LIT)), 'бочка поджигается');
  ok(!!(await b.wait((m) => m.t === 'boom', 5000)), 'бочка взрывается');
  ok(!!(await b.wait((m) => m.t === 'bb' && m.l.length >= 4)), 'взрыв меняет блоки пакетом');

  // вёдра: жидкости ставятся только ведром и растекаются
  a.send({ t: 'set', x: sx + 1, y: sy + 6, z: sz, id: B.LAVA });
  ok(!!(await a.wait((m) => m.t === 'b' && m.y === sy + 6 && m.id === 0)), 'лаву нельзя поставить как обычный блок');
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) a.send({ t: 'set', x: sx - 8 + dx, y: sy + 5, z: sz + dz, id: B.COBBLE });
  await sleep(150);
  a.send({ t: 'bucket', a: 'pour', x: sx - 8, y: sy + 6, z: sz, id: B.WATER });
  await sleep(900);
  const wet = new Set();
  for (const m of b.msgs) if (m.t === 'bb') for (let i = 0; i < m.l.length; i += 4) if (m.l[i + 3] === B.WATER) wet.add(m.l[i] + ',' + m.l[i + 1] + ',' + m.l[i + 2]);
  ok(wet.size === 13, 'вода из ведра растекается лужей (13 блоков)');
  a.send({ t: 'bucket', a: 'pour', x: sx - 8, y: sy + 6, z: sz, id: B.LAVA });
  ok(!!(await b.wait((m) => m.t === 'bb' && m.l[3] === B.BASALT && m.l[0] === sx - 8)), 'лава в воде застывает базальтом');
  a.send({ t: 'bucket', a: 'fill', x: sx - 7, y: sy + 6, z: sz });
  ok(!!(await b.wait((m) => m.t === 'bb' && m.l[0] === sx - 7 && m.l[1] === sy + 6 && m.l[3] === 0)), 'пустое ведро зачерпывает воду');
  a.send({ t: 'chat', m: '/village' });
  ok(!!(await a.wait((m) => m.t === 'sys' && m.m.includes('деревня'))), 'команда /village находит деревню');

  // телепорт-плиты
  a.send({ t: 'set', x: sx - 3, y: sy + 4, z: sz, id: B.PAD });
  a.send({ t: 'set', x: sx - 3, y: sy + 4, z: sz + 4, id: B.PAD });
  await sleep(150);
  a.send({ t: 'pad', x: sx - 3, y: sy + 4, z: sz });
  const tp = await a.wait((m) => m.t === 'tp');
  ok(tp && Math.floor(tp.p[2]) === sz + 4, 'телепорт-плита переносит ко второй плите');

  a.send({ t: 'save', inv: [[B.PLANKS, 5], 0, [99999, 1]], hp: 13, mode: 's' });
  await sleep(100);
  a.ws.close();
  ok(!!(await b.wait((m) => m.t === 'leave' && m.id === wa.id)), 'выход игрока рассылается');

  // повторный вход: состояние игрока сохранено
  const a2 = client('Аня');
  await a2.open;
  a2.send({ t: 'hello', name: 'Аня', token: 'tok-a' });
  const w2 = await a2.wait((m) => m.t === 'welcome');
  ok(w2 && w2.you.hp === 13 && w2.you.inv[0][0] === B.PLANKS && w2.you.inv[2] === 0, 'инвентарь и здоровье сохраняются, мусор отсеивается');
  a2.ws.close();
  b.ws.close();
} catch (e) {
  console.error(e);
  failed++;
} finally {
  server.kill('SIGINT');
  await sleep(400);
  ok(fs.existsSync(path.join(dataDir, 'world.json')), 'мир сохраняется на диск при остановке');
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки пройдены');
process.exit(failed ? 1 : 0);
