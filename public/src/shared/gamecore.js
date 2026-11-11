// Игровое ядро сервера. Не зависит от окружения: на Node работает за WebSocket,
// а в одиночной игре запускается прямо в браузере (в воркере) с той же логикой.
import { CHUNK, HEIGHT, SEA, DAY_LENGTH, BUILD_LIMIT } from './constants.js';
import { B, BLOCKS, I, SOLID, validItem } from './blocks.js';
import { createWorldGen } from './worldgen.js';
import { moveBox } from './physics.js';

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#e599f7'];
const MAX_PLAYERS = 32;
const MOB_FLUFF = 0;
const MOB_GLOOM = 1;
const MOB_CAP = 48;
const ckey = (cx, cz) => cx + ',' + cz;
const r2 = (v) => Math.round(v * 100) / 100;
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

export class GameCore {
  constructor({ storage = null, seed = null, log = null } = {}) {
    this.storage = storage;
    this.log = log || (() => {});
    const s = storage && storage.load ? storage.load() : null;
    this.seed = s && Number.isFinite(s.seed) ? s.seed | 0 : seed !== null ? seed | 0 : (Math.random() * 2 ** 31) | 0;
    this.time = s && fin(s.time) ? s.time : 0.06;
    this.edits = new Map(); // "cx,cz" -> Map(индекс -> id)
    if (s && s.edits) {
      for (const k of Object.keys(s.edits)) {
        const a = s.edits[k];
        const m = new Map();
        for (let i = 0; i + 1 < a.length; i += 2) m.set(a[i], a[i + 1]);
        this.edits.set(k, m);
      }
    }
    this.pads = s && Array.isArray(s.pads) ? s.pads : [];
    this.saved = (s && s.players) || {};
    this.gen = createWorldGen(this.seed);
    this.cache = new Map();
    this.clients = new Map();
    this.nextId = 1;
    this.mobs = new Map();
    this.nextMob = 1;
    this.fuses = [];
    this.dirty = false;
    this.tSave = 0;
    this.tTime = 0;
    this.tSpawn = 0;
    this.res = { onGround: false, hitX: false, hitY: false, hitZ: false };
    this.isSolid = (x, y, z) => SOLID[this.getBlock(x, y, z)] === 1;
    const sp = this.gen.findSpawn();
    let sy = sp[1] + 1;
    while (sy < HEIGHT - 3 && SOLID[this.getBlock(sp[0], sy, sp[2])]) sy++;
    this.spawn = [sp[0] + 0.5, sy, sp[2] + 0.5];
  }

  // ---------- мир ----------
  chunk(cx, cz) {
    const k = ckey(cx, cz);
    let c = this.cache.get(k);
    if (c) return c;
    c = this.gen.generateChunk(cx, cz);
    const e = this.edits.get(k);
    if (e) for (const [i, id] of e) c[i] = id;
    if (this.cache.size > 420) {
      let n = 0;
      for (const old of this.cache.keys()) {
        this.cache.delete(old);
        if (++n >= 120) break;
      }
    }
    this.cache.set(k, c);
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return 0;
    return this.chunk(x >> 4, z >> 4)[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  applyBlock(x, y, z, id) {
    const cx = x >> 4;
    const cz = z >> 4;
    const k = ckey(cx, cz);
    const i = (x & 15) + ((z & 15) << 4) + (y << 8);
    const c = this.chunk(cx, cz);
    const old = c[i];
    if (old === id) return old;
    c[i] = id;
    let e = this.edits.get(k);
    if (!e) this.edits.set(k, (e = new Map()));
    e.set(i, id);
    if (old === B.PAD) this.pads = this.pads.filter((p) => !(p[0] === x && p[1] === y && p[2] === z));
    if (id === B.PAD) this.pads.push([x, y, z]);
    this.dirty = true;
    return old;
  }

  // После удаления блока: затекает вода, осыпаются растения без опоры.
  settle(x, y, z, out) {
    if (this.getBlock(x, y, z) !== 0) return;
    const up = this.getBlock(x, y + 1, z);
    if (up && BLOCKS[up].needsGround) {
      this.applyBlock(x, y + 1, z, 0);
      out.push(x, y + 1, z, 0);
    }
    if (y <= SEA) {
      const W = B.WATER;
      if (
        up === W ||
        this.getBlock(x + 1, y, z) === W ||
        this.getBlock(x - 1, y, z) === W ||
        this.getBlock(x, y, z + 1) === W ||
        this.getBlock(x, y, z - 1) === W
      ) {
        this.applyBlock(x, y, z, W);
        out.push(x, y, z, W);
      }
    }
  }

  // ---------- клиенты ----------
  connect(send) {
    const c = {
      id: 0,
      send,
      joined: false,
      name: '',
      color: '#fff',
      token: '',
      pos: this.spawn.slice(),
      rot: [0, 0],
      held: 0,
      mode: 's',
      inv: null,
      hp: 20,
      home: null,
      budget: 60,
      chatBudget: 5,
      hadMobs: false,
      age: 0,
    };
    return c;
  }

  broadcast(msg, except = null) {
    for (const c of this.clients.values()) if (c !== except && c.joined) c.send(msg);
  }

  sys(text, to = null) {
    const m = { t: 'sys', m: text };
    if (to) to.send(m);
    else this.broadcast(m);
  }

  disconnect(c) {
    if (!c.joined) return;
    c.joined = false;
    this.persistPlayer(c);
    this.clients.delete(c.id);
    this.broadcast({ t: 'leave', id: c.id });
    this.sys(`${c.name} вышел из игры`);
    this.log(`- ${c.name} (${this.clients.size} онлайн)`);
  }

  persistPlayer(c) {
    if (!c.token) return;
    this.saved[c.token] = { name: c.name, pos: c.pos.map(r2), inv: c.inv, hp: c.hp, mode: c.mode, home: c.home };
    this.dirty = true;
  }

  handle(c, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') return this.onHello(c, m);
    if (!c.joined) return;
    switch (m.t) {
      case 'pos':
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(fin) && Math.abs(m.p[0]) < 4e5 && Math.abs(m.p[2]) < 4e5) {
          c.pos = m.p;
          if (Array.isArray(m.r) && m.r.length === 2 && m.r.every(fin)) c.rot = m.r;
          c.held = m.h | 0;
        }
        break;
      case 'cr':
        this.onChunkRequest(c, m);
        break;
      case 'set':
        this.onSet(c, m);
        break;
      case 'chat':
        this.onChat(c, m);
        break;
      case 'hit':
        this.onHit(c, m);
        break;
      case 'ignite':
        this.onIgnite(c, m);
        break;
      case 'pad':
        this.onPad(c, m);
        break;
      case 'save':
        this.onSave(c, m);
        break;
      default:
        break;
    }
  }

  onHello(c, m) {
    if (c.joined) return;
    if (this.clients.size >= MAX_PLAYERS) {
      c.send({ t: 'kick', m: 'Сервер заполнен' });
      return;
    }
    c.id = this.nextId++;
    let name = String(m.name || '')
      .replace(/[^\p{L}\p{N}_\- ]/gu, '')
      .trim()
      .slice(0, 16);
    if (!name) name = 'Игрок' + c.id;
    const taken = (n) => [...this.clients.values()].some((o) => o.name.toLowerCase() === n.toLowerCase());
    if (taken(name)) {
      let k = 2;
      while (taken(name + k)) k++;
      name += k;
    }
    c.name = name;
    c.color = COLORS[(c.id - 1) % COLORS.length];
    c.token = String(m.token || '').slice(0, 64);
    const sv = c.token ? this.saved[c.token] : null;
    c.mode = m.mode === 'c' || m.mode === 's' ? m.mode : sv && sv.mode === 'c' ? 'c' : 's';
    if (sv && Array.isArray(sv.pos) && sv.pos.length === 3 && sv.pos.every(fin)) c.pos = sv.pos.slice();
    else c.pos = this.spawn.slice();
    c.inv = sv ? sv.inv || null : null;
    c.hp = sv && fin(sv.hp) && sv.hp > 0 ? sv.hp : 20;
    c.home = sv ? sv.home || null : null;
    c.joined = true;
    this.clients.set(c.id, c);
    const players = [];
    for (const o of this.clients.values()) {
      if (o !== c) players.push({ id: o.id, name: o.name, color: o.color, p: o.pos.map(r2) });
    }
    c.send({
      t: 'welcome',
      id: c.id,
      name: c.name,
      color: c.color,
      seed: this.seed,
      time: this.time,
      dayLength: DAY_LENGTH,
      spawn: this.spawn,
      you: { pos: c.pos, inv: c.inv, hp: c.hp, mode: c.mode, fresh: !sv },
      players,
    });
    this.broadcast({ t: 'join', id: c.id, name: c.name, color: c.color, p: c.pos.map(r2) }, c);
    this.sys(`${c.name} вошёл в игру`);
    this.log(`+ ${c.name} (${this.clients.size} онлайн)`);
  }

  onChunkRequest(c, m) {
    if (!Array.isArray(m.c)) return;
    const out = [];
    const n = Math.min(m.c.length, 256);
    for (let i = 0; i < n; i++) {
      const q = m.c[i];
      if (!Array.isArray(q)) continue;
      const cx = q[0] | 0;
      const cz = q[1] | 0;
      const e = this.edits.get(ckey(cx, cz));
      const flat = [];
      if (e) for (const [idx, id] of e) flat.push(idx, id);
      out.push([cx, cz, flat]);
    }
    c.send({ t: 'cd', c: out });
  }

  onSet(c, m) {
    const x = m.x | 0;
    const y = m.y | 0;
    const z = m.z | 0;
    const id = m.id | 0;
    const reject = () => c.send({ t: 'b', x, y, z, id: y >= 0 && y < HEIGHT ? this.getBlock(x, y, z) : 0 });
    if (y < 1 || y > BUILD_LIMIT) return reject();
    if (id !== 0 && (!BLOCKS[id] || id === B.BEDROCK || id === B.WATER || id === B.BARREL_LIT)) return reject();
    const dx = x + 0.5 - c.pos[0];
    const dy = y + 0.5 - c.pos[1];
    const dz = z + 0.5 - c.pos[2];
    if (dx * dx + dy * dy + dz * dz > 14 * 14) return reject();
    if (c.budget < 1) return reject();
    c.budget -= 1;
    const old = this.getBlock(x, y, z);
    if (old === id) return;
    if (old === B.BEDROCK || old === B.BARREL_LIT) return reject();
    if (id !== 0 && old !== 0 && !BLOCKS[old].replaceable) return reject();
    this.applyBlock(x, y, z, id);
    this.broadcast({ t: 'b', x, y, z, id }, c);
    if (id === 0) {
      const extra = [];
      this.settle(x, y, z, extra);
      if (extra.length) this.broadcast({ t: 'bb', l: extra });
    }
  }

  onChat(c, m) {
    let text = String(m.m || '').slice(0, 200).trim();
    if (!text) return;
    if (c.chatBudget < 1) return this.sys('Не так быстро!', c);
    c.chatBudget -= 1;
    if (text[0] === '/') return this.command(c, text.slice(1));
    this.broadcast({ t: 'chat', id: c.id, n: c.name, c: c.color, m: text });
  }

  command(c, line) {
    const a = line.split(/\s+/);
    const cmd = a[0].toLowerCase();
    const tp = (p) => c.send({ t: 'tp', p });
    switch (cmd) {
      case 'help':
      case 'помощь':
        this.sys('Команды: /list, /seed, /spawn, /sethome, /home, /tp <игрок> или /tp x y z, /time day|night|noon, /mode s|c', c);
        break;
      case 'list':
        this.sys('Онлайн: ' + [...this.clients.values()].map((o) => o.name).join(', '), c);
        break;
      case 'seed':
        this.sys('Зерно мира: ' + this.seed, c);
        break;
      case 'spawn':
        tp(this.spawn);
        break;
      case 'sethome':
        c.home = c.pos.map(r2);
        this.persistPlayer(c);
        this.sys('Дом установлен. Вернуться: /home', c);
        break;
      case 'home':
        if (c.home) tp(c.home);
        else this.sys('Дом не задан. Сначала /sethome', c);
        break;
      case 'tp': {
        if (a.length >= 4) {
          const p = [Number(a[1]), Number(a[2]), Number(a[3])];
          if (p.every(fin) && Math.abs(p[0]) < 3e5 && Math.abs(p[2]) < 3e5) tp([p[0], Math.max(1, Math.min(HEIGHT + 20, p[1])), p[2]]);
          else this.sys('Использование: /tp x y z', c);
        } else if (a[1]) {
          const o = [...this.clients.values()].find((q) => q.name.toLowerCase() === a[1].toLowerCase());
          if (o) tp(o.pos.slice());
          else this.sys('Игрок не найден: ' + a[1], c);
        } else this.sys('Использование: /tp <игрок> или /tp x y z', c);
        break;
      }
      case 'time': {
        const v = (a[1] || '').toLowerCase();
        if (v === 'day' || v === 'день') this.time = 0.08;
        else if (v === 'noon' || v === 'полдень') this.time = 0.25;
        else if (v === 'night' || v === 'ночь') this.time = 0.6;
        else if (fin(Number(v)) && v !== '') this.time = ((Number(v) % 1) + 1) % 1;
        else return this.sys('Использование: /time day|noon|night', c);
        this.broadcast({ t: 'time', v: this.time });
        this.sys(`${c.name} изменил время суток`);
        break;
      }
      case 'mode': {
        const v = (a[1] || '').toLowerCase();
        if (v !== 's' && v !== 'c') return this.sys('Использование: /mode s (выживание) или /mode c (творчество)', c);
        c.mode = v;
        c.send({ t: 'mode', m: v });
        break;
      }
      default:
        this.sys('Неизвестная команда. Список: /help', c);
    }
  }

  onSave(c, m) {
    if (Array.isArray(m.inv) && m.inv.length <= 40) {
      const inv = [];
      for (const s of m.inv) {
        if (Array.isArray(s) && validItem(s[0] | 0) && s[1] > 0) inv.push([s[0] | 0, Math.min(99, s[1] | 0)]);
        else inv.push(0);
      }
      c.inv = inv;
    }
    if (fin(m.hp)) c.hp = Math.max(0, Math.min(20, m.hp));
    if (m.mode === 's' || m.mode === 'c') c.mode = m.mode;
    this.persistPlayer(c);
  }

  // ---------- особые блоки ----------
  onIgnite(c, m) {
    const x = m.x | 0;
    const y = m.y | 0;
    const z = m.z | 0;
    if (y < 1 || y >= HEIGHT) return;
    if (this.getBlock(x, y, z) !== B.BARREL) return;
    this.lightFuse(x, y, z, 2.4);
  }

  lightFuse(x, y, z, t) {
    this.applyBlock(x, y, z, B.BARREL_LIT);
    this.broadcast({ t: 'b', x, y, z, id: B.BARREL_LIT });
    this.broadcast({ t: 'fx', k: 'fuse', p: [x + 0.5, y + 0.5, z + 0.5] });
    this.fuses.push({ x, y, z, t });
  }

  explode(x, y, z) {
    const R = 3.7;
    const ch = [];
    if (this.getBlock(x, y, z) === B.BARREL_LIT) {
      this.applyBlock(x, y, z, 0);
      ch.push(x, y, z, 0);
    }
    const lit = [];
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > R || d === 0) continue;
          const bx = x + dx;
          const by = y + dy;
          const bz = z + dz;
          if (by < 1 || by >= HEIGHT) continue;
          const id = this.getBlock(bx, by, bz);
          if (id === 0 || id === B.WATER || id === B.BARREL_LIT) continue;
          if (id === B.BARREL) {
            lit.push([bx, by, bz]);
            continue;
          }
          const hard = BLOCKS[id].hard;
          if (hard < 0) continue;
          if (d > R - 1.3 && hard >= 3 && Math.random() < 0.6) continue;
          if (d > R - 0.7 && Math.random() < 0.4) continue;
          this.applyBlock(bx, by, bz, 0);
          ch.push(bx, by, bz, 0);
        }
      }
    }
    // вода и растения вокруг воронки (несколько проходов для затекания)
    const n0 = ch.length;
    for (let pass = 0; pass < 4; pass++) {
      const before = ch.length;
      for (let i = 0; i < n0; i += 4) this.settle(ch[i], ch[i + 1], ch[i + 2], ch);
      if (ch.length === before) break;
    }
    this.broadcast({ t: 'bb', l: ch });
    this.broadcast({ t: 'boom', p: [x + 0.5, y + 0.5, z + 0.5], r: R });
    for (const b of lit) this.lightFuse(b[0], b[1], b[2], 0.25 + Math.random() * 0.4);
    for (const mob of [...this.mobs.values()]) {
      const dx = mob.x - (x + 0.5);
      const dy = mob.y - (y + 0.5);
      const dz = mob.z - (z + 0.5);
      const d = Math.hypot(dx, dy, dz);
      if (d < R + 1.5) {
        mob.v.x += (dx / (d || 1)) * 9;
        mob.v.y += 6;
        mob.v.z += (dz / (d || 1)) * 9;
        this.damageMob(mob, 14 * (1 - d / (R + 1.5)), null);
      }
    }
  }

  onPad(c, m) {
    const x = m.x | 0;
    const y = m.y | 0;
    const z = m.z | 0;
    const i = this.pads.findIndex((p) => p[0] === x && p[1] === y && p[2] === z);
    if (i < 0) return;
    // выбрасываем из списка плиты, которых уже нет в мире
    this.pads = this.pads.filter((p) => this.getBlock(p[0], p[1], p[2]) === B.PAD);
    const j = this.pads.findIndex((p) => p[0] === x && p[1] === y && p[2] === z);
    if (j < 0) return;
    if (this.pads.length < 2) return this.sys('Нужна вторая телепорт-плита — поставьте её где-нибудь ещё.', c);
    const d = this.pads[(j + 1) % this.pads.length];
    this.broadcast({ t: 'fx', k: 'pad', p: [x + 0.5, y + 1, z + 0.5] }, c);
    this.broadcast({ t: 'fx', k: 'pad', p: [d[0] + 0.5, d[1] + 1, d[2] + 0.5] }, c);
    c.send({ t: 'tp', p: [d[0] + 0.5, d[1] + 1.02, d[2] + 0.5], pad: 1 });
  }

  // ---------- мобы ----------
  isNight() {
    return Math.sin(this.time * Math.PI * 2) < -0.12;
  }

  onHit(c, m) {
    const mob = this.mobs.get(m.id | 0);
    if (!mob) return;
    const dx = mob.x - c.pos[0];
    const dy = mob.y - c.pos[1];
    const dz = mob.z - c.pos[2];
    if (dx * dx + dy * dy + dz * dz > 49) return;
    const l = Math.hypot(dx, dz) || 1;
    mob.v.x = (dx / l) * 6;
    mob.v.z = (dz / l) * 6;
    mob.v.y = mob.type === MOB_FLUFF ? 5 : 2;
    mob.flee = 4;
    mob.fleeFrom = c;
    mob.timer = 0.3;
    this.damageMob(mob, Math.max(1, Math.min(12, Number(m.d) || 1)), c);
  }

  damageMob(mob, dmg, by) {
    mob.hp -= dmg;
    mob.hurt = 0.3;
    if (mob.hp > 0) return;
    this.mobs.delete(mob.id);
    this.broadcast({ t: 'md', id: mob.id, k: mob.type, p: [r2(mob.x), r2(mob.y), r2(mob.z)] });
    if (by && by.joined) {
      if (mob.type === MOB_FLUFF) by.send({ t: 'give', id: I.FLUFF, n: 1 + (Math.random() < 0.5 ? 1 : 0) });
      else by.send({ t: 'give', id: I.SHADOW_DUST, n: 1 + (Math.random() < 0.4 ? 1 : 0) });
    }
  }

  spawnMob(type, x, y, z) {
    const mob = {
      id: this.nextMob++,
      type,
      x,
      y,
      z,
      v: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * 6.28,
      hp: type === MOB_FLUFF ? 6 : 10,
      timer: Math.random() * 2,
      cool: 0,
      hurt: 0,
      flee: 0,
      fleeFrom: null,
      onGround: false,
      wx: x,
      wy: y,
      wz: z,
    };
    this.mobs.set(mob.id, mob);
    return mob;
  }

  trySpawn() {
    const list = [...this.clients.values()].filter((c) => c.joined);
    if (!list.length || this.mobs.size >= MOB_CAP) return;
    const c = list[Math.floor(Math.random() * list.length)];
    const night = this.isNight();
    let fluffs = 0;
    let glooms = 0;
    for (const mob of this.mobs.values()) {
      const dx = mob.x - c.pos[0];
      const dz = mob.z - c.pos[2];
      if (dx * dx + dz * dz < 56 * 56) {
        if (mob.type === MOB_FLUFF) fluffs++;
        else glooms++;
      }
    }
    const ang = Math.random() * Math.PI * 2;
    const dist = 14 + Math.random() * 22;
    const x = Math.floor(c.pos[0] + Math.cos(ang) * dist);
    const z = Math.floor(c.pos[2] + Math.sin(ang) * dist);
    let y = Math.min(HEIGHT - 4, Math.max(this.gen.column(x, z).h + 14, Math.floor(c.pos[1]) + 8));
    while (y > 1 && !SOLID[this.getBlock(x, y, z)]) y--;
    const ground = this.getBlock(x, y, z);
    if (this.getBlock(x, y + 1, z) === B.WATER || SOLID[this.getBlock(x, y + 2, z)]) return;
    if (!night && fluffs < 5) {
      if (ground === B.GRASS || ground === B.SNOW || ground === B.SKYMOSS) this.spawnMob(MOB_FLUFF, x + 0.5, y + 1, z + 0.5);
    } else if (night && glooms < 3 && c.mode === 's' && c.age > 25 && dist > 18) {
      this.spawnMob(MOB_GLOOM, x + 0.5, y + 2 + Math.random() * 3, z + 0.5);
    }
  }

  tickMobs(dt) {
    const night = this.isNight();
    const res = this.res;
    for (const mob of [...this.mobs.values()]) {
      let nd = Infinity;
      let target = null;
      let td = Infinity;
      for (const c of this.clients.values()) {
        if (!c.joined) continue;
        const d = Math.hypot(mob.x - c.pos[0], mob.y - c.pos[1], mob.z - c.pos[2]);
        if (d < nd) nd = d;
        if (c.mode === 's' && c.hp > 0 && d < td) {
          td = d;
          target = c;
        }
      }
      if (nd > 78) {
        this.mobs.delete(mob.id);
        continue;
      }
      if (mob.hurt > 0) mob.hurt -= dt;
      if (mob.flee > 0) mob.flee -= dt;
      if (mob.y < -10) {
        this.mobs.delete(mob.id);
        continue;
      }
      if (mob.type === MOB_FLUFF) {
        const inWater = this.getBlock(Math.floor(mob.x), Math.floor(mob.y + 0.2), Math.floor(mob.z)) === B.WATER;
        if (inWater) mob.v.y += (3 - mob.v.y) * Math.min(1, dt * 5);
        else mob.v.y -= 24 * dt;
        mob.timer -= dt;
        if ((mob.onGround || inWater) && mob.timer <= 0) {
          let yaw = Math.random() * Math.PI * 2;
          const fleeing = mob.flee > 0 && mob.fleeFrom;
          if (fleeing) yaw = Math.atan2(mob.x - mob.fleeFrom.pos[0], mob.z - mob.fleeFrom.pos[2]) + (Math.random() - 0.5);
          const sp = fleeing ? 4.2 : 2.2;
          mob.yaw = yaw;
          mob.v.x = Math.sin(yaw) * sp;
          mob.v.z = Math.cos(yaw) * sp;
          mob.v.y = inWater ? 5 : 6.5;
          mob.timer = fleeing ? 0.15 : 0.5 + Math.random() * 2.5;
        }
        moveBox(this.isSolid, mob, mob.v, 0.3, 0.6, dt, res);
        mob.onGround = res.onGround;
        if (res.onGround) {
          mob.v.x = 0;
          mob.v.z = 0;
        }
      } else {
        if (!night) {
          mob.hp -= 5 * dt;
          if (mob.hp <= 0) {
            this.damageMob(mob, 1, null);
            continue;
          }
        }
        let tx;
        let ty;
        let tz;
        const chase = target && td < 30;
        if (chase) {
          tx = target.pos[0];
          ty = target.pos[1] + 1.1;
          tz = target.pos[2];
        } else {
          mob.timer -= dt;
          if (mob.timer <= 0) {
            mob.wx = mob.x + (Math.random() - 0.5) * 16;
            mob.wz = mob.z + (Math.random() - 0.5) * 16;
            mob.wy = mob.y + (Math.random() - 0.5) * 3;
            mob.timer = 3 + Math.random() * 3;
          }
          tx = mob.wx;
          ty = mob.wy;
          tz = mob.wz;
        }
        const dx = tx - mob.x;
        const dy = ty - (mob.y + 0.35);
        const dz = tz - mob.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const sp = chase ? 3.1 : 1.1;
        const k = Math.min(1, dt * 3);
        mob.v.x += ((dx / d) * sp - mob.v.x) * k;
        mob.v.y += ((dy / d) * sp - mob.v.y) * k;
        mob.v.z += ((dz / d) * sp - mob.v.z) * k;
        moveBox(this.isSolid, mob, mob.v, 0.35, 0.7, dt, res);
        if (res.hitX || res.hitZ) mob.v.y = Math.max(mob.v.y, 2.6);
        mob.yaw = Math.atan2(dx, dz);
        mob.cool -= dt;
        if (chase && d < 1.3 && mob.cool <= 0) {
          mob.cool = 1.7;
          target.send({ t: 'hurt', d: 2, p: [r2(mob.x), r2(mob.y), r2(mob.z)], k: 'gloom' });
          mob.v.x -= (dx / d) * 8;
          mob.v.y += 3;
          mob.v.z -= (dz / d) * 8;
        }
      }
    }
  }

  // ---------- такт сервера ----------
  tick(dt) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;

    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.fuses.splice(i, 1);
        this.explode(f.x, f.y, f.z);
      }
    }

    this.tSpawn += dt;
    if (this.tSpawn >= 1.5) {
      this.tSpawn = 0;
      this.trySpawn();
    }
    this.tickMobs(dt);

    // рассылка состояний игроков и мобов
    const pl = [];
    for (const c of this.clients.values()) {
      if (!c.joined) continue;
      c.age += dt;
      c.budget = Math.min(90, c.budget + 45 * dt);
      c.chatBudget = Math.min(5, c.chatBudget + dt);
      pl.push([c.id, r2(c.pos[0]), r2(c.pos[1]), r2(c.pos[2]), r2(c.rot[0]), r2(c.rot[1]), c.held]);
    }
    for (const c of this.clients.values()) {
      if (!c.joined) continue;
      if (pl.length > 1) c.send({ t: 'pp', l: pl });
      const ml = [];
      for (const mob of this.mobs.values()) {
        const dx = mob.x - c.pos[0];
        const dz = mob.z - c.pos[2];
        if (dx * dx + dz * dz < 90 * 90) {
          ml.push([mob.id, mob.type, r2(mob.x), r2(mob.y), r2(mob.z), r2(mob.yaw), mob.hurt > 0 ? 1 : 0]);
        }
      }
      if (ml.length || c.hadMobs) c.send({ t: 'm', l: ml });
      c.hadMobs = ml.length > 0;
    }

    this.tTime += dt;
    if (this.tTime >= 5) {
      this.tTime = 0;
      this.broadcast({ t: 'time', v: this.time });
    }
    this.tSave += dt;
    if (this.tSave >= 30) {
      this.tSave = 0;
      if (this.dirty) this.save();
    }
  }

  snapshot() {
    const edits = {};
    for (const [k, m] of this.edits) {
      if (!m.size) continue;
      const a = [];
      for (const [i, id] of m) a.push(i, id);
      edits[k] = a;
    }
    return { v: 1, seed: this.seed, time: this.time, edits, pads: this.pads, players: this.saved };
  }

  save() {
    for (const c of this.clients.values()) if (c.joined) this.persistPlayer(c);
    this.dirty = false;
    if (this.storage && this.storage.save) {
      try {
        this.storage.save(this.snapshot());
      } catch (e) {
        this.log('Не удалось сохранить мир: ' + e.message);
      }
    }
  }
}
