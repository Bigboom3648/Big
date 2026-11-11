// Мир в браузере: то же серверное ядро, но внутри воркера. Поддерживает
// нескольких игроков — своего (cid 0) и друзей, подключённых по коду.
import { GameCore } from '../shared/gamecore.js';
import { TICK_RATE } from '../shared/constants.js';

let core = null;
const clients = new Map();

self.onmessage = (e) => {
  const d = e.data;
  if (d.k === 'init') {
    core = new GameCore({
      storage: {
        load: () => d.save || null,
        save: (data) => self.postMessage({ k: 'save', data }),
      },
    });
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      core.tick(dt);
    }, 1000 / TICK_RATE);
    self.postMessage({ k: 'ready' });
    return;
  }
  if (!core) return;
  if (d.k === 'open') {
    const cid = d.cid;
    clients.set(cid, core.connect((m) => self.postMessage({ k: 'msg', cid, m })));
  } else if (d.k === 'msg') {
    const c = clients.get(d.cid);
    if (c) core.handle(c, d.m);
  } else if (d.k === 'close') {
    const c = clients.get(d.cid);
    if (c) {
      core.disconnect(c);
      clients.delete(d.cid);
    }
  } else if (d.k === 'flush') {
    core.save();
  }
};
