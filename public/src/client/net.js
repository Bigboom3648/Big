// Сеть. Три способа играть:
//  - 'server' — страница открыта с сервера игры (npm start), все играют на нём;
//  - 'local'  — мир крутится в этом браузере; его можно открыть друзьям по коду;
//  - 'guest'  — мы в мире друга, подключились к его браузеру по коду.
import { LocalCore } from './localcore.js';

export class Net {
  constructor() {
    this.handlers = {};
    this.mode = 'none';
    this.ws = null;
    this.local = null;
    this.link = null; // канал к миру друга
    this.host = null; // открытый для друзей мир
    this.code = null; // код мира (свой или друга)
    this.onClose = null;
    this.onStatus = null;
  }

  // true — в мире могут быть другие игроки
  get online() {
    return this.mode === 'server' || this.mode === 'guest' || !!(this.host && this.host.peer);
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
    } else if (this.link) this.link.send(m);
    else if (this.local) this.local.send(0, m);
  }

  // Подключение. how: 'auto' — сервер, а если его нет — мир в браузере;
  // 'host' — сразу мир в браузере (потом откроем его друзьям); { join: код } — к другу.
  // Возвращает сообщение welcome.
  async connect(hello, how = 'auto') {
    if (how && how.join) return this.connectGuest(how.join, hello);
    const q = new URLSearchParams(location.search);
    const forced = q.get('server');
    // window.KUBOZEMYE_OFFLINE = true на странице — без своего сервера (статический хостинг)
    const offline =
      q.has('offline') || globalThis.KUBOZEMYE_OFFLINE === true || location.hostname.endsWith('.github.io');
    const canWs = how === 'auto' && !offline && (forced || location.protocol === 'http:' || location.protocol === 'https:');
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
            this.mode = 'server';
            resolve(m);
          } else if (m.t === 'kick') {
            done = true;
            clearTimeout(timer);
            const err = new Error(m.m);
            err.kick = true;
            err.friendly = true;
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
    this.local = new LocalCore();
    await this.local.start();
    this.mode = 'local';
    return new Promise((resolve) => {
      let welcomed = false;
      this.local.open(0, (m) => {
        if (!welcomed && m.t === 'welcome') {
          welcomed = true;
          resolve(m);
        } else this.dispatch(m);
      });
      this.local.send(0, { t: 'hello', ...hello });
    });
  }

  async connectGuest(code, hello) {
    const { joinPeer } = await import('./p2p.js');
    const link = await joinPeer(code);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, m) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) {
          link.close();
          reject(err);
        } else {
          this.link = link;
          this.mode = 'guest';
          this.code = code;
          resolve(m);
        }
      };
      const timer = setTimeout(() => {
        const e = new Error('Мир друга не ответил. Попробуйте ещё раз.');
        e.friendly = true;
        finish(e);
      }, 15000);
      link.onMessage((m) => {
        if (done) {
          this.dispatch(m);
          return;
        }
        if (m.t === 'welcome') finish(null, m);
        else if (m.t === 'kick') {
          const e = new Error(m.m);
          e.friendly = true;
          finish(e);
        }
      });
      link.onClose(() => {
        if (!done) {
          const e = new Error('Связь с другом прервалась. Попробуйте ещё раз.');
          e.friendly = true;
          finish(e);
        } else if (this.link === link && this.onClose) this.onClose();
      });
      link.send({ t: 'hello', ...hello });
    });
  }

  // Можно ли открыть этот мир друзьям (мир в браузере и браузер умеет WebRTC).
  async canHost() {
    if (this.mode !== 'local') return false;
    const { p2pSupported } = await import('./p2p.js');
    return p2pSupported();
  }

  // Открывает мир в браузере для друзей. Возвращает код мира.
  async startHosting() {
    if (this.mode !== 'local') throw new Error('not local');
    if (!this.host) {
      const { Host } = await import('./p2p.js');
      this.host = new Host(this.local, (text) => this.onStatus && this.onStatus(text));
      // закрываем вкладку — друзья сразу узнают, что мир закрыт
      addEventListener('pagehide', () => this.host.stop());
    }
    this.code = await this.host.start();
    return this.code;
  }
}
