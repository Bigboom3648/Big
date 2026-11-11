// Точка входа: собирает подсистемы и крутит главный цикл.
import * as THREE from './three.js';
import { B, I, BLOCKS, itemName } from '../shared/blocks.js';
import { DAY_LENGTH } from '../shared/constants.js';
import { buildTiles, buildIcons, buildCracks, buildMask } from './textures.js';
import { Renderer } from './renderer.js';
import { World } from './world.js';
import { Net } from './net.js';
import { Sound } from './audio.js';
import { Inventory } from './inventory.js';
import { Entities } from './entities.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Minimap } from './minimap.js';

const SETTINGS_KEY = 'kubozemye.settings';
const DEFAULTS = { dist: 7, fov: 75, sens: 5, vol: 6, autoJump: false, shaders: true, horror: true };

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = { ...DEFAULTS };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    } catch {}
    let saved = null;
    try {
      saved = localStorage.getItem(SETTINGS_KEY);
    } catch {}
    if (matchMedia('(pointer: coarse)').matches && !saved) {
      this.settings.dist = 5;
      this.settings.autoJump = true;
      this.settings.shaders = false; // на телефонах шейдеры по умолчанию выключены — их можно включить в меню
    }
    this.state = 'start';
    this.joined = false;
    this.ready = false;
    this.time = 0;
    this.dayLength = DAY_LENGTH;
    this.elapsed = 0;
    this.shake = 0;
    this.selfId = 0;
    this.names = new Map();
    this.posTimer = 0;
    this.saveTimer = 0;
    this.fps = 60;

    this.tiles = buildTiles();
    this.icons = buildIcons(this.tiles);
    this.cracks = buildCracks();
    this.maskImage = buildMask();
    this.beatT = 0;
    this.morokSeen = false;
    this.renderer = new Renderer(this.canvas, this.tiles);
    this.net = new Net();
    this.sound = new Sound();
    this.inv = new Inventory();
    this.world = new World(this);
    this.renderer.scene.add(this.world.group);
    this.entities = new Entities(this);
    this.player = new Player(this);
    this.input = new Input(this);
    this.ui = new UI(this);
    this.minimap = new Minimap(this, document.getElementById('minimap'));
    this.inv.onChange = () => {
      this.ui.renderHotbar();
      this.ui.setArmor();
      this.player.dirty = true;
    };
    this.applySettings();
    this.bindNet();
    this.last = performance.now();
    this.frame = this.frame.bind(this);
  }

  setState(s) {
    this.state = s;
    this.input.reset();
  }

  applySettings() {
    const s = this.settings;
    this.world.setRenderDist(s.dist);
    this.renderer.setRenderDist(s.dist);
    this.input.sens = 0.0005 * s.sens;
    this.sound.setVolume(s.vol / 10);
    if (this.renderer.fancy !== !!s.shaders && !this.renderer.setShaders(s.shaders) && s.shaders) {
      s.shaders = false;
      this.ui.toast('Шейдеры не поддерживаются этим устройством');
      if (this.ui.syncSettings) this.ui.syncSettings();
    }
    if (this.joined) this.net.send({ t: 'pref', horror: !!s.horror });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {}
  }

  selectSlot(i) {
    if (this.inv.sel === i) return;
    this.inv.sel = i;
    this.ui.renderHotbar();
    const name = this.player.heldName();
    if (name) this.ui.toast(name, 1200);
  }

  // how: 'auto' | 'host' (мир для друзей) | { join: код } (в мир друга)
  async join(name, mode, how = 'auto') {
    if (this.joining) return;
    this.joining = true;
    this.sound.init();
    this.ui.setLoading(how && how.join ? 'Подключаюсь к миру друга…' : 'Подключение…');
    let token = '';
    try {
      token = localStorage.getItem('kubozemye.token') || '';
      if (!token) {
        token = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
        localStorage.setItem('kubozemye.token', token);
      }
    } catch {}
    let w;
    try {
      await this.world.engine.ready;
      w = await this.net.connect({ name, token, mode }, how);
    } catch (e) {
      this.joining = false;
      this.ui.startError(e && e.friendly ? e.message : 'Не удалось подключиться: ' + (e && e.message ? e.message : 'ошибка'));
      return;
    }
    if (how && how.join) {
      // ссылка в адресной строке — чтобы «Переподключиться» вернуло в этот же мир
      try {
        const u = new URL(location.href);
        u.searchParams.set('join', how.join);
        history.replaceState(null, '', u.href);
      } catch {}
    }
    this.afterReady = how === 'host' ? 'invite' : null;
    this.net.onStatus = (text) => this.ui.toast(text, 4000);
    this.selfId = w.id;
    this.time = w.time;
    this.dayLength = w.dayLength || DAY_LENGTH;
    this.world.init(w.seed);
    const p = this.player;
    p.spawn = w.spawn;
    p.pos.set(w.you.pos[0], w.you.pos[1], w.you.pos[2]);
    p.fallTop = p.pos.y;
    p.mode = w.you.mode;
    p.hp = w.you.hp;
    this.inv.load(w.you.inv);
    if (p.mode === 'c' && this.inv.slots.every((s) => !s)) {
      [B.GRASS, B.STONE_BRICKS, B.PLANKS, B.GLASS, B.LAMP, B.TRAMPOLINE, B.BARREL, B.PAD, I.HOOK].forEach((id, i) => {
        this.inv.slots[i] = { id, n: id < 256 ? 99 : 1 };
      });
      this.inv.slots[9] = { id: I.GLIDER, n: 1 };
      this.inv.changed();
    }
    this.names.set(w.id, { name: w.name, color: w.color });
    for (const o of w.players) {
      this.entities.addPlayer(o);
      this.names.set(o.id, { name: o.name, color: o.color });
    }
    this.joined = true;
    this.fresh = w.you.fresh;
    this.net.send({ t: 'pref', horror: !!this.settings.horror });
    this.ui.onJoined();
    this.ui.setLoading('Создаём мир…');
    this.state = 'loading';
    this.net.onClose = () => this.ui.showLost();
    requestAnimationFrame(this.frame);
  }

  bindNet() {
    const n = this.net;
    const ent = () => this.entities;
    n.on('join', (m) => {
      ent().addPlayer(m);
      this.names.set(m.id, { name: m.name, color: m.color });
      this.ui.renderInvitePlayers();
    });
    n.on('leave', (m) => {
      ent().removePlayer(m.id);
      this.names.delete(m.id);
      this.ui.renderInvitePlayers();
    });
    n.on('pp', (m) => ent().onPlayers(m.l, this.selfId));
    n.on('cd', (m) => this.world.onChunkEdits(m.c));
    n.on('b', (m) => this.world.setBlock(m.x, m.y, m.z, m.id));
    n.on('bb', (m) => {
      const l = m.l;
      for (let i = 0; i + 3 < l.length; i += 4) this.world.setBlock(l[i], l[i + 1], l[i + 2], l[i + 3]);
    });
    n.on('chat', (m) => this.ui.addChat(m.n, m.c, m.m));
    n.on('sys', (m) => this.ui.addChat(null, null, m.m));
    n.on('time', (m) => {
      this.time = m.v;
    });
    n.on('m', (m) => ent().onMobs(m.l));
    n.on('md', (m) => {
      ent().removeMob(m.id);
      if (m.k === 3) {
        // Морок рассыпается чёрным пеплом
        ent().particles.burst(m.p[0], m.p[1] + 1.3, m.p[2], 60, [24, 20, 30], 2.5, 0.9, -0.1, 1.4);
        this.sound.play('whisper', this.volAt(m.p));
        return;
      }
      ent().particles.burst(m.p[0], m.p[1] + 0.4, m.p[2], 22, m.k === 0 ? [255, 255, 255] : [120, 80, 200], 3.5, 0.3, 0.5, 0.8);
      this.sound.play('mobdie', this.volAt(m.p));
    });
    n.on('hurt', (m) => {
      if (m.k === 'morok' && this.player.mode === 's' && !this.player.dead) {
        this.ui.scare();
        this.sound.play('screech');
        this.shake = 1;
      }
      this.player.damage(m.d, m.p, 'mob');
    });
    n.on('give', (m) => {
      this.inv.add(m.id, m.n);
      this.sound.play('pop');
      this.ui.toast(`+${m.n} ${itemName(m.id)}`);
    });
    n.on('tp', (m) => {
      this.player.teleport(m.p);
      if (m.pad) this.player.padLock = true;
      this.sound.play('tp');
      ent().particles.burst(m.p[0], m.p[1] + 1, m.p[2], 40, [90, 220, 235], 3, 0.5, -0.15, 1);
    });
    n.on('mode', (m) => {
      this.player.setMode(m.m);
      this.ui.toast(m.m === 'c' ? 'Режим: творчество. F — полёт' : 'Режим: выживание');
    });
    n.on('fx', (m) => {
      if (m.k === 'fuse') this.sound.play('fuse', this.volAt(m.p));
      else if (m.k === 'pad') {
        this.sound.play('tp', this.volAt(m.p));
        ent().particles.burst(m.p[0], m.p[1], m.p[2], 30, [150, 110, 255], 3, 0.4, -0.15, 1);
      }
    });
    n.on('boom', (m) => {
      const p = m.p;
      const ps = ent().particles;
      ps.burst(p[0], p[1], p[2], 70, [255, 170, 60], 13, 0.8, 0.6, 0.7);
      ps.burst(p[0], p[1], p[2], 60, [90, 90, 95], 9, 1.4, 0.25, 1.3);
      ps.burst(p[0], p[1], p[2], 25, [255, 245, 200], 16, 0.4, 0.4, 0.4);
      const pl = this.player;
      const dx = pl.pos.x - p[0];
      const dy = pl.pos.y + 0.9 - p[1];
      const dz = pl.pos.z - p[2];
      const d = Math.hypot(dx, dy, dz);
      this.sound.play('boom', Math.max(0.08, 1 - d / 60));
      this.shake = Math.max(this.shake, Math.max(0, 1 - d / 24));
      const R = m.r + 2.6;
      if (d < R) {
        const f = 1 - d / R;
        const l = d || 1;
        pl.vel.x += (dx / l) * 16 * f;
        pl.vel.y += 5 + (dy / l) * 10 * f;
        pl.vel.z += (dz / l) * 16 * f;
        pl.onGround = false;
        pl.damage(Math.round(17 * f), null, 'boom');
      }
    });
  }

  volAt(p) {
    const pl = this.player.pos;
    return Math.max(0, 1 - Math.hypot(p[0] - pl.x, p[1] - pl.y, p[2] - pl.z) / 34);
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.elapsed += dt;
    this.fps += (1 / dt - this.fps) * 0.05;
    this.time = (this.time + dt / this.dayLength) % 1;
    const p = this.player;
    const r = this.renderer;
    const inp = this.input;
    inp.update(dt);

    this.world.update(p.pos.x, p.pos.z);
    const bx = Math.floor(p.pos.x);
    const bz = Math.floor(p.pos.z);
    if (!this.ready && this.world.hasMesh(bx, bz)) {
      this.ready = true;
      this.ui.setLoading(null);
      this.setState('play');
      if (this.afterReady === 'invite') this.ui.openInvite();
      else this.input.lock();
      if (this.fresh) {
        const touch = this.input.touch;
        this.ui.addChat(null, null, p.mode === 'c'
          ? `Добро пожаловать в Кубоземье! ${touch ? '🎒 — все блоки, двойное нажатие ▲ — полёт' : 'E — все блоки, F — полёт'}. Попробуйте крюк-кошку, батут и бабах-бочку.`
          : `Добро пожаловать в Кубоземье! Срубите дерево, откройте рюкзак (${touch ? '🎒' : 'E'}) и скрафтите инструменты. Ночью берегитесь мрачников.`);
      }
    }
    if (this.ready && this.world.hasData(bx, bz)) p.update(dt);
    this.entities.update(dt);

    // камера
    const cam = r.camera;
    cam.position.set(p.pos.x, p.pos.y + 1.62 + Math.sin(this.entities.hand.bob) * 0.03 * p.walk, p.pos.z);
    cam.rotation.set(p.pitch, p.yaw, 0);
    if (this.shake > 0.001) {
      const s = this.shake * 0.12;
      cam.position.x += (Math.random() - 0.5) * s * 2;
      cam.position.y += (Math.random() - 0.5) * s * 2;
      cam.rotation.z = (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 5);
    }
    const sprinting = inp.sprint && Math.hypot(p.vel.x, p.vel.z) > 5;
    r.setFov(r.camera.fov + (this.settings.fov + (sprinting || p.gliding || p.hook ? 9 : 0) - r.camera.fov) * Math.min(1, dt * 8));
    r.underwater = p.headFluid;
    this.ui.setFluid(p.headFluid);
    r.setTime(this.time, this.elapsed);
    this.entities.hand.update(dt, p.walk);

    // верёвка крюка
    const rope = this.entities.rope;
    if (p.hook) {
      rope.visible = true;
      const a = rope.geometry.attributes.position;
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      a.setXYZ(0, cam.position.x + right.x * 0.3 + p.dir.x * 0.5, cam.position.y - 0.35, cam.position.z + right.z * 0.3 + p.dir.z * 0.5);
      a.setXYZ(1, p.hook.x, p.hook.y, p.hook.z);
      a.needsUpdate = true;
    } else rope.visible = false;

    document.body.classList.toggle('flying', p.flying);
    this.ui.el.clickhint.classList.toggle('hidden', !(this.state === 'play' && !inp.active));

    // сеть
    this.posTimer -= dt;
    if (this.posTimer <= 0 && this.ready) {
      this.posTimer = 0.08;
      const q = (v) => Math.round(v * 100) / 100;
      this.net.send({ t: 'pos', p: [q(p.pos.x), q(p.pos.y), q(p.pos.z)], r: [q(p.yaw), q(p.pitch)], h: this.inv.selectedId(), a: this.inv.armorCode() });
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0 && p.dirty) {
      this.saveTimer = 3;
      p.dirty = false;
      this.net.send({ t: 'save', inv: this.inv.toJSON(), hp: p.hp, mode: p.mode });
    }

    // Морок поблизости: темнеют края экрана и стучит сердце — тем чаще, чем он ближе
    let near = 99;
    for (const m of this.entities.mobs.values()) {
      if (m.type === 3) near = Math.min(near, m.group.position.distanceTo(p.pos));
    }
    const dread = p.mode === 's' && !p.dead ? Math.max(0, Math.min(1, 1 - near / 26)) : 0;
    this.ui.setDread(dread * 0.85);
    if (near < 60 && !this.morokSeen) this.sound.play('whisper', 0.8);
    this.morokSeen = near < 60;
    if (dread > 0) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.beatT = 0.38 + (1 - dread) * 0.9;
        this.sound.play('heart', 0.35 + dread * 0.65);
      }
    }

    // HUD
    if (this.ui.mapOn) this.minimap.update(dt);
    this.ui.el.coords.textContent = `${bx}, ${Math.floor(p.pos.y)}, ${bz}`;
    if (this.ui.debugOn) {
      const t = p.target;
      const hh = Math.floor(((this.time + 0.25) % 1) * 24);
      const mm = Math.floor((((this.time + 0.25) % 1) * 24 - hh) * 60);
      this.ui.el.debug.textContent =
        `FPS: ${this.fps.toFixed(0)}\n` +
        `Чанков: ${this.world.meshedCount} / ${this.world.chunks.size}, заданий: ${this.world.jobs}\n` +
        `Время: ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}\n` +
        `Мобов: ${this.entities.mobs.size}, частиц: ${this.entities.particles.n}\n` +
        `Цель: ${t ? BLOCKS[t.id].name + ` (${t.x}, ${t.y}, ${t.z})` : '—'}\n` +
        `Сеть: ${this.net.online ? 'сервер' : 'одиночная'}`;
    }

    r.render();
    inp.frameEnd();
  }
}

window.__game = new Game();
