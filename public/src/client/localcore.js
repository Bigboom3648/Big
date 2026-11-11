// Мир, который крутится в этом браузере: в воркере, а если воркеры недоступны —
// прямо в основном потоке. Каждый игрок — свой номер cid (0 — мы сами).
const SAVE_KEY = 'kubozemye.world.v1';

export class LocalCore {
  constructor() {
    this.handlers = new Map(); // cid -> (сообщение) => void
    this.impl = null;
  }

  async start() {
    let save = null;
    try {
      save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch {}
    const store = (data) => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {}
    };
    const deliver = (cid, m) => {
      const h = this.handlers.get(cid);
      if (h) h(m);
    };
    try {
      this.impl = await this.startWorker(save, store, deliver);
    } catch {
      this.impl = await this.startInline(save, store, deliver);
    }
    addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  startWorker(save, store, deliver) {
    return new Promise((resolve, reject) => {
      let w;
      try {
        w = new Worker(new URL('./localworker.js', import.meta.url), { type: 'module' });
      } catch (e) {
        reject(e);
        return;
      }
      const timer = setTimeout(() => reject(new Error('worker timeout')), 5000);
      w.onerror = () => {
        clearTimeout(timer);
        reject(new Error('worker error'));
      };
      w.onmessage = (e) => {
        const d = e.data;
        if (d.k === 'ready') {
          clearTimeout(timer);
          resolve({
            open: (cid) => w.postMessage({ k: 'open', cid }),
            send: (cid, m) => w.postMessage({ k: 'msg', cid, m }),
            close: (cid) => w.postMessage({ k: 'close', cid }),
            flush: () => w.postMessage({ k: 'flush' }),
          });
        } else if (d.k === 'msg') deliver(d.cid, d.m);
        else if (d.k === 'save') store(d.data);
      };
      w.postMessage({ k: 'init', save });
    });
  }

  async startInline(save, store, deliver) {
    const { GameCore } = await import('../shared/gamecore.js');
    const core = new GameCore({ storage: { load: () => save, save: store } });
    const clients = new Map();
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      core.tick(Math.min(0.5, (now - last) / 1000));
      last = now;
    }, 100);
    return {
      open: (cid) => clients.set(cid, core.connect((m) => queueMicrotask(() => deliver(cid, m)))),
      send: (cid, m) => {
        const c = clients.get(cid);
        if (c) core.handle(c, m);
      },
      close: (cid) => {
        const c = clients.get(cid);
        if (c) {
          core.disconnect(c);
          clients.delete(cid);
        }
      },
      flush: () => core.save(),
    };
  }

  open(cid, onMessage) {
    this.handlers.set(cid, onMessage);
    this.impl.open(cid);
  }

  send(cid, m) {
    this.impl.send(cid, m);
  }

  close(cid) {
    this.handlers.delete(cid);
    this.impl.close(cid);
  }

  flush() {
    if (this.impl) this.impl.flush();
  }
}
