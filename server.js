// Сервер «Кубоземья»: раздаёт клиент, принимает WebSocket-подключения
// и хранит мир на диске. Запуск: npm start (порт задаётся переменной PORT).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameCore } from './public/src/shared/gamecore.js';
import { TICK_RATE } from './public/src/shared/constants.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'world.json');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- хранилище мира ----------
const storage = {
  load() {
    try {
      return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    } catch {
      return null;
    }
  },
  save(data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, SAVE_FILE);
  },
};

const seedEnv = process.env.SEED;
const core = new GameCore({
  storage,
  seed: seedEnv !== undefined && seedEnv !== '' ? Number(seedEnv) | 0 : null,
  log: (m) => console.log(m),
});

// ---------- раздача файлов ----------
function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (file !== base && !file.startsWith(base + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  serveFile(res, PUBLIC, pathname.slice(1));
});

// ---------- сеть ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  const client = core.connect((msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  });
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      core.handle(client, msg);
    } catch (e) {
      console.error('Ошибка обработки сообщения:', e);
    }
  });
  ws.on('close', () => core.disconnect(client));
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.5, (now - last) / 1000);
  last = now;
  try {
    core.tick(dt);
  } catch (e) {
    console.error('Ошибка такта:', e);
  }
}, 1000 / TICK_RATE);

function shutdown() {
  console.log('\nСохраняю мир…');
  core.save();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Кубоземье запущено. Зерно мира: ${core.seed}`);
  console.log(`  На этом компьютере: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log(`  Для друзей в сети:   http://${ni.address}:${PORT}`);
    }
  }
});
