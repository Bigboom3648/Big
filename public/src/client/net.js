// Сеть: WebSocket к серверу, а если сервера нет — локальное ядро в браузере.
const SAVE_KEY = 'kubozemye.world.v1';

export class Net {
  constructor() {
    this.handlers = {};
    this.online = false;
    this.ws = null;
    this.local = null;
    this.onClose = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  dispatch(m) {
    const h = this.handlers[m.t];
    if (h) h(m);
  }

  send(m) {
    if (this.ws) {
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    } else if (this.local) this.local.send(m);
  }

  // Подключение. Возвращает сообщение welcome.
  async connect(hello) {
    const q = new URLSearchParams(location.search);
    const forced = q.get('server');
    const canWs = !q.has('offline') && (forced || location.protocol === 'http:' || location.protocol === 'https:');
    if (canWs) {
      const url = forced || (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      try {
        return await this.connectWs(url, hello);
      } catch (e) {
        this.ws = null;
        if (e && e.kick) throw e; // сервер ответил отказом — не уходим молча в одиночную игру
      }
    }
    return this.connectLocal(hello);
  }

  connectWs(url, hello) {
    return new Promise((resolve, reject) => {
      let done = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          try {
            ws.close();
          } catch {}
          reject(new Error('timeout'));
        }
      }, 4000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...hello }));
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!done) {
          if (m.t === 'welcome') {
            done = true;
            clearTimeout(timer);
            this.ws = ws;
            this.online = true;
            resolve(m);
          } else if (m.t === 'kick') {
            done = true;
            clearTimeout(timer);
            const err = new Error(m.m);
            err.kick = true;
            reject(err);
          }
          return;
        }
        this.dispatch(m);
      };
      ws.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(new Error('ws error'));
        }
      };
      ws.onclose = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(new Error('closed'));
        } else if (this.ws === ws && this.onClose) this.onClose();
      };
    });
  }

  async connectLocal(hello) {
    let save = null;
    try {
      save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch {}
    const store = (data) => {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {}
    };
    let resolveWelcome;
    const welcome = new Promise((r) => (resolveWelcome = r));
    const onMsg = (m) => {
      if (m.t === 'welcome') resolveWelcome(m);
      else this.dispatch(m);
    };

    const viaWorker = () =>
      new Promise((resolve, reject) => {
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
            resolve({ send: (m) => w.postMessage({ k: 'msg', m }), flush: () => w.postMessage({ k: 'flush' }) });
          } else if (d.k === 'msg') onMsg(d.m);
          else if (d.k === 'save') store(d.data);
        };
        w.postMessage({ k: 'init', save });
      });

    const inline = async () => {
      const { GameCore } = await import('../shared/gamecore.js');
      const core = new GameCore({ storage: { load: () => save, save: store } });
      const client = core.connect((m) => queueMicrotask(() => onMsg(m)));
      let last = Date.now();
      setInterval(() => {
        const now = Date.now();
        core.tick(Math.min(0.5, (now - last) / 1000));
        last = now;
      }, 100);
      return { send: (m) => core.handle(client, m), flush: () => core.save() };
    };

    try {
      this.local = await viaWorker();
    } catch {
      this.local = await inline();
    }
    this.online = false;
    addEventListener('pagehide', () => this.local.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.local.flush();
    });
    this.local.send({ t: 'hello', ...hello });
    return welcome;
  }
}
