// Одиночная игра: то же серверное ядро, но внутри воркера браузера.
import { GameCore } from '../shared/gamecore.js';
import { TICK_RATE } from '../shared/constants.js';

let core = null;
let client = null;

self.onmessage = (e) => {
  const d = e.data;
  if (d.k === 'init') {
    core = new GameCore({
      storage: {
        load: () => d.save || null,
        save: (data) => self.postMessage({ k: 'save', data }),
      },
    });
    client = core.connect((m) => self.postMessage({ k: 'msg', m }));
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      core.tick(dt);
    }, 1000 / TICK_RATE);
    self.postMessage({ k: 'ready' });
  } else if (d.k === 'msg' && core) {
    core.handle(client, d.m);
  } else if (d.k === 'flush' && core) {
    core.save();
  }
};
