// Игра с друзьями без сервера: браузер хозяина держит мир, друзья подключаются
// к нему напрямую (WebRTC). Чтобы найти друг друга, браузеры один раз
// обмениваются адресами через бесплатный сервер соединений PeerJS.

const PREFIX = 'kubozemye-v1-'; // пространство имён игры на сервере соединений
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без похожих друг на друга I, L, O, 0, 1
const CODE_LEN = 6;
const CODE_KEY = 'kubozemye.hostcode';
const MAX_GUESTS = 11;
const PIECE = 4000; // символов в одном куске большого сообщения (в байтах меньше 16 КБ)

// Кириллические буквы, похожие на латинские, — на случай русской раскладки.
const LOOKALIKE = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };

export const CODE_HINT = 'Код — это 6 латинских букв и цифр, например K7M4QX.';

// Приводит введённый код (или вставленную ссылку-приглашение) к виду K7M4QX.
// Возвращает null, если это не код.
export function normalizeCode(text) {
  let s = String(text || '').trim();
  const m = s.match(/[?&#]join=([^&#\s]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/[А-ЯЁ]/g, (ch) => LOOKALIKE[ch] || ch);
  s = s.replace(/[^A-Z0-9]/g, '');
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

export function newCode() {
  const a = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(a);
  let s = '';
  for (const v of a) s += ALPHABET[v % ALPHABET.length];
  return s;
}

// Можно ли в этом браузере и на этой странице играть с друзьями напрямую.
export function p2pSupported() {
  return globalThis.KUBOZEMYE_P2P !== false && typeof globalThis.RTCPeerConnection === 'function';
}

let loading = null;
function loadPeerJS() {
  if (globalThis.peerjs && globalThis.peerjs.Peer) return Promise.resolve(globalThis.peerjs.Peer);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/peerjs/peerjs.min.js', import.meta.url).href;
      s.onload = () => (globalThis.peerjs && globalThis.peerjs.Peer ? resolve(globalThis.peerjs.Peer) : reject(new Error('peerjs')));
      s.onerror = () => {
        loading = null;
        reject(friendly('Не удалось загрузить модуль сетевой игры. Обновите страницу.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// Для проверки на своём компьютере: ?peerserver=localhost:9000 — свой сервер соединений.
// Работает только на localhost, чтобы чужая ссылка не могла подменить сервер.
function peerOptions() {
  const opts = { debug: 0 };
  const ps = new URLSearchParams(location.search).get('peerserver');
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (ps && local) {
    const [host, port] = ps.split(':');
    Object.assign(opts, { host, port: Number(port) || 9000, path: '/', secure: false });
  }
  return opts;
}

function friendly(message) {
  const e = new Error(message);
  e.friendly = true;
  return e;
}

function explain(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') {
    return friendly('Игра с таким кодом не найдена. Проверьте код — или попросите друга нажать «Создать игру для друзей» ещё раз.');
  }
  if (type === 'browser-incompatible') {
    return friendly('Этот браузер не умеет играть по сети. Откройте игру в Chrome, Edge, Firefox или Safari.');
  }
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
    return friendly('Нет связи с сервером соединений. Проверьте интернет и попробуйте ещё раз.');
  }
  return friendly('Не получилось соединиться: ' + ((err && err.message) || 'неизвестная ошибка'));
}

// Следит за соединением: если друг пропал (закрыл вкладку, отключился интернет),
// браузер замечает это через несколько секунд — и мы закрываем канал.
function watchLink(conn, onDead) {
  let timer = null;
  let hooked = null;
  const check = () => {
    const pc = conn.peerConnection;
    if (!pc) return;
    const st = pc.iceConnectionState;
    const cs = pc.connectionState;
    if (st === 'failed' || st === 'closed' || cs === 'failed' || cs === 'closed') {
      clearTimeout(timer);
      onDead();
    } else if (st === 'disconnected' || cs === 'disconnected') {
      if (!timer) timer = setTimeout(onDead, 4000);
    } else {
      clearTimeout(timer);
      timer = null;
    }
  };
  const hook = () => {
    const pc = conn.peerConnection;
    if (!pc || pc === hooked) return;
    hooked = pc;
    pc.addEventListener('iceconnectionstatechange', check);
    pc.addEventListener('connectionstatechange', check);
  };
  hook();
  conn.on('open', hook);
}

// ---------- сообщения: JSON-строки, большие режутся на куски ----------

export function sendFramed(conn, m) {
  if (!conn.open) return;
  const s = JSON.stringify(m);
  if (s.length <= PIECE) {
    conn.send(s);
    return;
  }
  const id = (conn._kzSeq = (conn._kzSeq || 0) + 1);
  const n = Math.ceil(s.length / PIECE);
  for (let i = 0; i < n; i++) conn.send(`~${id}|${i}|${n}|` + s.slice(i * PIECE, (i + 1) * PIECE));
}

export function makeReceiver() {
  const parts = new Map();
  return (data) => {
    if (typeof data !== 'string' || !data) return null;
    if (data[0] === '{') {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }
    if (data[0] !== '~') return null;
    const a = data.indexOf('|');
    const b = data.indexOf('|', a + 1);
    const c = data.indexOf('|', b + 1);
    if (a < 0 || b < 0 || c < 0) return null;
    const id = data.slice(1, a);
    const i = Number(data.slice(a + 1, b));
    const n = Number(data.slice(b + 1, c));
    if (!(n > 0 && n <= 500 && i >= 0 && i < n)) return null;
    let p = parts.get(id);
    if (!p) {
      if (parts.size >= 4) parts.clear();
      p = { n, got: 0, list: new Array(n) };
      parts.set(id, p);
    }
    if (p.n !== n || p.list[i] !== undefined) return null;
    p.list[i] = data.slice(c + 1);
    if (++p.got < n) return null;
    parts.delete(id);
    try {
      return JSON.parse(p.list.join(''));
    } catch {
      return null;
    }
  };
}

// ---------- хозяин мира ----------

export class Host {
  // local — LocalCore с миром; onStatus(text) — сообщения для игрока.
  constructor(local, onStatus) {
    this.local = local;
    this.onStatus = onStatus || (() => {});
    this.peer = null;
    this.code = null;
    this.conns = new Map();
    this.nextCid = 1;
    this.starting = null;
  }

  get guests() {
    return this.conns.size;
  }

  // Открывает мир для друзей. Возвращает код. Код запоминается, чтобы ссылка
  // для друзей оставалась прежней и в следующий раз.
  start() {
    if (this.peer && !this.peer.destroyed) return Promise.resolve(this.code);
    if (!this.starting) this.starting = this.open().finally(() => (this.starting = null));
    return this.starting;
  }

  async open() {
    const Peer = await loadPeerJS();
    let code = null;
    try {
      code = normalizeCode(localStorage.getItem(CODE_KEY));
    } catch {}
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!code) code = newCode();
      try {
        this.peer = await this.listen(Peer, code);
        this.code = code;
        try {
          localStorage.setItem(CODE_KEY, code);
        } catch {}
        return code;
      } catch (e) {
        if (e && e.type === 'unavailable-id') {
          code = null; // код занят — берём новый
          continue;
        }
        throw e && e.friendly ? e : explain(e);
      }
    }
    throw friendly('Не удалось получить свободный код. Попробуйте ещё раз.');
  }

  listen(Peer, code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, peerOptions());
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        peer.destroy();
        reject(explain({ type: 'network' }));
      }, 15000);
      peer.on('open', () => {
        opened = true;
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on('connection', (conn) => this.accept(conn));
      peer.on('disconnected', () => {
        // связь с сервером соединений пропала: текущие друзья играют дальше,
        // а чтобы могли зайти новые — переподключаемся
        if (peer.destroyed) return;
        this.onStatus('Связь с сервером соединений пропала — переподключаюсь…');
        setTimeout(() => {
          if (!peer.destroyed && peer.disconnected) peer.reconnect();
        }, 3000);
      });
      peer.on('error', (err) => {
        if (!opened) {
          clearTimeout(timer);
          peer.destroy();
          reject(err);
        }
      });
    });
  }

  accept(conn) {
    if (this.conns.size >= MAX_GUESTS) {
      conn.on('open', () => {
        sendFramed(conn, { t: 'kick', m: 'В этом мире уже максимум игроков.' });
        setTimeout(() => conn.close(), 1000);
      });
      return;
    }
    const cid = this.nextCid++;
    const rx = makeReceiver();
    let closed = false;
    this.conns.set(cid, conn);
    this.local.open(cid, (m) => sendFramed(conn, m));
    conn.on('data', (d) => {
      const m = rx(d);
      if (m && typeof m === 'object' && typeof m.t === 'string') this.local.send(cid, m);
    });
    const end = () => {
      if (closed) return;
      closed = true;
      this.conns.delete(cid);
      this.local.close(cid);
    };
    conn.on('close', end);
    conn.on('error', end);
    watchLink(conn, () => {
      end();
      conn.close();
    });
  }

  stop() {
    for (const conn of this.conns.values()) conn.close();
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}

// ---------- гость ----------

// Подключается к миру друга. Возвращает канал { send, onMessage, onClose, close }.
export async function joinPeer(code) {
  const Peer = await loadPeerJS();
  const peer = await new Promise((resolve, reject) => {
    const p = new Peer(peerOptions());
    const fail = (err) => {
      clearTimeout(timer);
      p.off('error', fail);
      p.destroy();
      reject(explain(err));
    };
    const timer = setTimeout(() => fail({ type: 'network' }), 15000);
    p.on('error', fail);
    p.on('open', () => {
      clearTimeout(timer);
      p.off('error', fail);
      resolve(p);
    });
  });

  const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
  await new Promise((resolve, reject) => {
    const fail = (err) => {
      clearTimeout(timer);
      peer.off('error', fail);
      peer.destroy();
      reject(err && err.friendly ? err : explain(err));
    };
    const timer = setTimeout(
      () =>
        fail(
          friendly(
            'Мир друга не ответил. Проверьте, что у друга открыта игра, и попробуйте ещё раз. Если не помогает — подключитесь к другому Wi-Fi или мобильному интернету.',
          ),
        ),
      25000,
    );
    peer.on('error', fail);
    conn.on('open', () => {
      clearTimeout(timer);
      peer.off('error', fail);
      resolve();
    });
  });

  const rx = makeReceiver();
  let onMsg = () => {};
  let onEnd = () => {};
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  conn.on('data', (d) => {
    const m = rx(d);
    if (m && typeof m === 'object' && typeof m.t === 'string') onMsg(m);
  });
  conn.on('close', end);
  conn.on('error', end);
  watchLink(conn, () => {
    end();
    peer.destroy();
  });
  peer.on('error', () => {});
  // закрываем вкладку — сразу освобождаем место в мире друга
  addEventListener('pagehide', () => peer.destroy());
  return {
    send: (m) => sendFramed(conn, m),
    onMessage: (fn) => (onMsg = fn),
    onClose: (fn) => (onEnd = fn),
    close: () => {
      ended = true;
      peer.destroy();
    },
  };
}
