// Интерфейс: панель быстрого доступа, рюкзак, крафт, чат, меню, подсказки.
import { RECIPES, CREATIVE_ITEMS, ITEMS, ARMOR_SLOTS, itemName, maxStack } from '../shared/blocks.js';
import { HOTBAR, SLOTS, TOTAL } from './inventory.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of [
      'hud', 'tint', 'debug', 'mapwrap', 'coords', 'chatlog', 'chatinput', 'toast', 'hp', 'hotbar', 'players', 'clickhint',
      'inventory', 'side', 'bag', 'bar', 'held', 'tabCraft', 'tabAll', 'invClose', 'menu', 'netinfo', 'mResume', 'mMode',
      'sDist', 'sFov', 'sSens', 'sVol', 'vDist', 'vFov', 'vSens', 'vVol', 'cJump', 'death', 'dRespawn', 'lost', 'lReload',
      'loading', 'loadtext', 'start', 'name', 'play', 'starterr',
      'armor', 'armorinfo', 'armorhud', 'cShaders', 'cHorror', 'dread', 'scare',
    ]) {
      this.el[id] = $(id);
    }
    this.held = null;
    this.tab = 'craft';
    this.toastTimer = 0;
    this.flashTimer = 0;
    this.debugOn = false;
    this.mapOn = true;
    this.startMode = 's';
    this.bindStart();
    this.bindInventory();
    this.bindMenu();
    this.bindChat();
    this.buildHotbar();
  }

  icon(id) {
    return this.game.icons[id] || '';
  }

  slotHtml(s) {
    if (!s) return '';
    return `<img src="${this.icon(s.id)}" alt="">${s.n > 1 ? `<span class="n">${s.n}</span>` : ''}`;
  }

  // ---------- старт ----------
  bindStart() {
    const e = this.el;
    if (globalThis.KUBOZEMYE_OFFLINE === true) {
      document.querySelector('.tag').textContent =
        'Воксельная песочница: копай, строй, летай на крюке. Здесь одиночная игра, мультиплеер работает в версии с сервером.';
    }
    try {
      e.name.value = localStorage.getItem('kubozemye.name') || '';
    } catch {}
    for (const b of document.querySelectorAll('.mode')) {
      b.addEventListener('click', () => {
        this.startMode = b.dataset.mode;
        for (const o of document.querySelectorAll('.mode')) o.classList.toggle('on', o === b);
      });
    }
    const go = () => {
      const name = e.name.value.trim();
      try {
        localStorage.setItem('kubozemye.name', name);
      } catch {}
      this.game.join(name, this.startMode);
    };
    e.play.addEventListener('click', go);
    e.name.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') go();
    });
    e.dRespawn.addEventListener('click', () => {
      e.death.classList.add('hidden');
      this.game.player.respawn();
      this.game.setState('play');
      this.game.input.lock();
    });
    e.lReload.addEventListener('click', () => location.reload());
  }

  setLoading(text) {
    this.el.loading.classList.toggle('hidden', !text);
    if (text) this.el.loadtext.textContent = text;
  }

  startError(text) {
    this.el.starterr.textContent = text;
    this.el.start.classList.remove('hidden');
    this.setLoading(null);
  }

  onJoined() {
    this.el.start.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.onMode();
    this.renderHotbar();
    this.setHp(this.game.player.hp);
  }

  // ---------- HUD ----------
  buildHotbar() {
    const hb = this.el.hotbar;
    hb.innerHTML = '';
    for (let i = 0; i < HOTBAR; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.game.selectSlot(i);
      });
      hb.appendChild(d);
    }
  }

  renderHotbar() {
    const inv = this.game.inv;
    const kids = this.el.hotbar.children;
    for (let i = 0; i < HOTBAR; i++) {
      kids[i].innerHTML = this.slotHtml(inv.slots[i]);
      kids[i].classList.toggle('sel', i === inv.sel);
    }
  }

  // Показатель защиты над полоской здоровья.
  setArmor() {
    const g = this.game;
    const pts = g.inv.armorPoints();
    const el = this.el.armorhud;
    el.classList.toggle('hidden', pts === 0 || g.player.mode !== 's');
    el.textContent = '🛡 ' + pts;
  }

  // Морок рядом: темнеют края экрана. k от 0 до 1.
  setDread(k) {
    const v = k.toFixed(2);
    if (this.dreadV !== v) {
      this.dreadV = v;
      this.el.dread.style.opacity = v;
    }
  }

  // Морок напал: на полсекунды показываем его маску.
  scare() {
    const el = this.el.scare;
    el.style.backgroundImage = `url(${this.game.maskImage})`;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this.scareTimer);
    this.scareTimer = setTimeout(() => el.classList.add('hidden'), 520);
  }

  setHp(hp) {
    const h = this.el.hp;
    h.firstElementChild.style.width = (hp / 20) * 100 + '%';
    h.lastElementChild.textContent = Math.ceil(hp) + ' / 20';
  }

  onMode() {
    const p = this.game.player;
    this.el.hp.classList.toggle('hidden', p.mode !== 's');
    this.el.mMode.textContent = p.mode === 's' ? 'Режим: Выживание → сменить на Творчество' : 'Режим: Творчество → сменить на Выживание';
    this.tab = p.mode === 'c' ? 'all' : 'craft';
    this.el.tabAll.classList.toggle('hidden', p.mode !== 'c');
    this.setArmor();
  }

  toast(text, ms = 1800) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  flash(kind) {
    const t = this.el.tint;
    t.className = kind;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      t.className = ['', 'water', 'lava'][this.game.player.headFluid];
    }, 180);
  }

  // kind: 0 — ничего, 1 — голова в воде, 2 — в лаве
  setFluid(kind) {
    const t = this.el.tint;
    if (t.className === 'hurt') return;
    const cls = ['', 'water', 'lava'][kind];
    if (t.className !== cls) t.className = cls;
  }

  toggleDebug() {
    this.debugOn = !this.debugOn;
    this.el.debug.classList.toggle('hidden', !this.debugOn);
  }

  toggleMap() {
    this.mapOn = !this.mapOn;
    this.el.mapwrap.classList.toggle('hidden', !this.mapOn);
  }

  showPlayers(on) {
    const el = this.el.players;
    el.classList.toggle('hidden', !on);
    if (!on) return;
    const g = this.game;
    el.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = g.net.online ? `Игроки онлайн: ${g.names.size}` : 'Одиночная игра';
    el.appendChild(h);
    for (const p of g.names.values()) {
      const d = document.createElement('div');
      d.textContent = p.name;
      d.style.color = p.color;
      el.appendChild(d);
    }
  }

  // ---------- чат ----------
  bindChat() {
    const inp = this.el.chatinput;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (text) this.game.net.send({ t: 'chat', m: text });
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    inp.addEventListener('blur', () => {
      if (this.game.state === 'chat') this.closeChat();
    });
  }

  openChat(prefix) {
    const g = this.game;
    if (g.state !== 'play') return;
    g.setState('chat');
    g.input.unlock();
    const inp = this.el.chatinput;
    inp.classList.remove('hidden');
    inp.value = prefix;
    this.el.chatlog.classList.add('open');
    setTimeout(() => inp.focus(), 0);
  }

  closeChat() {
    const g = this.game;
    if (g.state !== 'chat') return;
    g.setState('play');
    const inp = this.el.chatinput;
    inp.classList.add('hidden');
    this.el.chatlog.classList.remove('open');
    inp.blur();
    g.input.lock();
  }

  addChat(name, color, text) {
    const d = document.createElement('div');
    d.className = 'msg';
    if (name) {
      const b = document.createElement('b');
      b.textContent = name + ': ';
      b.style.color = color;
      d.appendChild(b);
      d.appendChild(document.createTextNode(text));
    } else {
      d.classList.add('sys');
      d.textContent = text;
    }
    const log = this.el.chatlog;
    log.appendChild(d);
    while (log.children.length > 40) log.removeChild(log.firstChild);
    setTimeout(() => d.classList.add('old'), 9000);
  }

  // ---------- рюкзак и крафт ----------
  bindInventory() {
    const e = this.el;
    e.tabCraft.addEventListener('click', () => {
      this.tab = 'craft';
      this.renderSide();
    });
    e.tabAll.addEventListener('click', () => {
      this.tab = 'all';
      this.renderSide();
    });
    e.invClose.addEventListener('click', () => this.closeInventory());
    e.inventory.addEventListener('pointermove', (ev) => {
      e.held.style.left = ev.clientX + 'px';
      e.held.style.top = ev.clientY + 'px';
    });
    e.inventory.addEventListener('contextmenu', (ev) => ev.preventDefault());
    const mkSlots = (root, from, to) => {
      for (let i = from; i < to; i++) {
        const d = document.createElement('div');
        d.className = 'slot';
        d.dataset.i = i;
        d.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          e.held.style.left = ev.clientX + 'px';
          e.held.style.top = ev.clientY + 'px';
          this.clickSlot(i, ev.button === 2, ev.shiftKey);
        });
        root.appendChild(d);
      }
    };
    mkSlots(e.bag, HOTBAR, SLOTS);
    mkSlots(e.bar, 0, HOTBAR);
    mkSlots(e.armor, SLOTS, TOTAL);
  }

  clickSlot(i, right, shift) {
    const inv = this.game.inv;
    const s = inv.slots[i];
    const h = this.held;
    if (i >= SLOTS) {
      // слот брони: принимает только свой тип
      const a = h && ITEMS[h.id] ? ITEMS[h.id].armor : null;
      if (h && (!a || a.slot !== i - SLOTS)) {
        this.toast('Сюда надевается: ' + ARMOR_SLOTS[i - SLOTS].toLowerCase());
        return;
      }
      inv.slots[i] = h;
      this.held = s;
    } else if (shift && s && !h && ITEMS[s.id] && ITEMS[s.id].armor) {
      inv.equipFrom(i); // быстрый способ надеть
    } else if (shift && s && !h) {
      // быстрый перенос между рюкзаком и панелью
      const [a, b] = i < HOTBAR ? [HOTBAR, SLOTS] : [0, HOTBAR];
      const max = maxStack(s.id);
      for (let k = a; k < b && s.n > 0; k++) {
        const t = inv.slots[k];
        if (t && t.id === s.id && t.n < max) {
          const m = Math.min(s.n, max - t.n);
          t.n += m;
          s.n -= m;
        }
      }
      for (let k = a; k < b && s.n > 0; k++) {
        if (!inv.slots[k]) {
          inv.slots[k] = { id: s.id, n: s.n };
          s.n = 0;
        }
      }
      if (s.n <= 0) inv.slots[i] = null;
    } else if (!h) {
      if (!s) return;
      if (right && s.n > 1) {
        const half = Math.ceil(s.n / 2);
        this.held = { id: s.id, n: half };
        s.n -= half;
      } else {
        this.held = s;
        inv.slots[i] = null;
      }
    } else if (!s) {
      if (right && h.n > 1) {
        inv.slots[i] = { id: h.id, n: 1 };
        h.n--;
      } else {
        inv.slots[i] = h;
        this.held = null;
      }
    } else if (s.id === h.id) {
      const max = maxStack(s.id);
      const m = Math.min(right ? 1 : h.n, max - s.n);
      s.n += m;
      h.n -= m;
      if (h.n <= 0) this.held = null;
    } else {
      inv.slots[i] = h;
      this.held = s;
    }
    inv.changed();
    this.renderInventory();
  }

  renderInventory() {
    const inv = this.game.inv;
    const e = this.el;
    for (const d of e.bag.children) d.innerHTML = this.slotHtml(inv.slots[d.dataset.i]);
    for (const d of e.bar.children) {
      d.innerHTML = this.slotHtml(inv.slots[d.dataset.i]);
      d.classList.toggle('sel', Number(d.dataset.i) === inv.sel);
    }
    e.held.innerHTML = this.slotHtml(this.held);
    for (const d of e.armor.children) {
      const s = inv.slots[d.dataset.i];
      const k = d.dataset.i - SLOTS;
      d.innerHTML = s ? this.slotHtml(s) : ARMOR_SLOTS[k].slice(0, 4);
      d.classList.toggle('full', !!s);
      d.title = s ? itemName(s.id) : ARMOR_SLOTS[k];
    }
    const pts = inv.armorPoints();
    e.armorinfo.innerHTML = `Защита: <b>${pts}</b><br>−${Math.min(80, pts * 4)}% урона от мобов и взрывов`;
    for (const d of [...e.bag.children, ...e.bar.children]) {
      const s = inv.slots[d.dataset.i];
      d.title = s ? itemName(s.id) : '';
    }
    this.renderSide();
  }

  renderSide() {
    const e = this.el;
    const g = this.game;
    const inv = g.inv;
    const side = e.side;
    e.tabCraft.classList.toggle('on', this.tab === 'craft');
    e.tabAll.classList.toggle('on', this.tab === 'all');
    side.innerHTML = '';
    side.classList.toggle('palette', this.tab === 'all');
    if (this.tab === 'all') {
      for (const id of CREATIVE_ITEMS) {
        const d = document.createElement('div');
        d.className = 'slot';
        d.title = itemName(id);
        d.innerHTML = `<img src="${this.icon(id)}" alt="">`;
        d.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          e.held.style.left = ev.clientX + 'px';
          e.held.style.top = ev.clientY + 'px';
          // взять стопку; если в руке уже что-то есть — выбросить
          this.held = this.held ? null : { id, n: maxStack(id) };
          e.held.innerHTML = this.slotHtml(this.held);
        });
        side.appendChild(d);
      }
      return;
    }
    const list = RECIPES.map((r, i) => ({ r, i, ok: inv.canCraft(r) })).sort((a, b) => b.ok - a.ok || a.i - b.i);
    for (const { r, ok } of list) {
      const d = document.createElement('div');
      d.className = 'recipe ' + (ok ? 'ok' : 'no');
      const ing = r.ins
        .map(([id, n]) => `<span title="${itemName(id)}"><img src="${this.icon(id)}" alt="">${n}</span>`)
        .join('');
      d.innerHTML = `<img src="${this.icon(r.out[0])}" alt=""><div class="nm">${itemName(r.out[0])}${r.out[1] > 1 ? ' ×' + r.out[1] : ''}</div><div class="ing">${ing}</div>`;
      d.title = r.ins.map(([id, n]) => `${itemName(id)} ×${n}`).join(', ');
      if (ok) {
        d.addEventListener('click', () => {
          if (inv.craft(r)) {
            g.sound.play('craft');
            g.player.dirty = true;
            this.renderInventory();
          }
        });
      }
      side.appendChild(d);
    }
  }

  openInventory() {
    const g = this.game;
    if (g.state !== 'play') return;
    g.setState('inv');
    g.input.unlock();
    this.el.inventory.classList.remove('hidden');
    this.renderInventory();
  }

  closeInventory() {
    const g = this.game;
    if (g.state !== 'inv') return;
    if (this.held) {
      g.inv.add(this.held.id, this.held.n);
      this.held = null;
    }
    this.el.inventory.classList.add('hidden');
    g.setState('play');
    g.input.lock();
  }

  // ---------- меню ----------
  bindMenu() {
    const e = this.el;
    const g = this.game;
    e.mResume.addEventListener('click', () => this.closeMenu());
    e.mMode.addEventListener('click', () => {
      g.net.send({ t: 'chat', m: '/mode ' + (g.player.mode === 's' ? 'c' : 's') });
    });
    const s = g.settings;
    const sync = () => {
      e.sDist.value = s.dist;
      e.sFov.value = s.fov;
      e.sSens.value = s.sens;
      e.sVol.value = s.vol;
      e.cJump.checked = s.autoJump;
      e.cShaders.checked = s.shaders;
      e.cHorror.checked = s.horror;
      e.vDist.textContent = s.dist + ' чанков';
      e.vFov.textContent = s.fov + '°';
      e.vSens.textContent = s.sens;
      e.vVol.textContent = s.vol * 10 + '%';
    };
    this.syncSettings = sync;
    const on = (el, key, bool) =>
      el.addEventListener('input', () => {
        s[key] = bool ? el.checked : Number(el.value);
        sync();
        g.applySettings();
      });
    on(e.sDist, 'dist');
    on(e.sFov, 'fov');
    on(e.sSens, 'sens');
    on(e.sVol, 'vol');
    on(e.cJump, 'autoJump', true);
    on(e.cShaders, 'shaders', true);
    on(e.cHorror, 'horror', true);
    sync();
  }

  openMenu() {
    const g = this.game;
    if (g.state !== 'play') return;
    g.setState('menu');
    g.input.unlock();
    this.el.netinfo.textContent = g.net.online
      ? `Мультиплеер: игроков онлайн — ${g.names.size}. Друзья заходят по адресу этого сервера: ${location.host}`
      : 'Одиночная игра: сервер не найден, мир сохраняется в этом браузере. Для игры с друзьями запустите сервер (npm start).';
    this.el.menu.classList.remove('hidden');
  }

  closeMenu() {
    const g = this.game;
    if (g.state !== 'menu') return;
    this.el.menu.classList.add('hidden');
    g.setState('play');
    g.input.lock();
  }

  showDeath() {
    const g = this.game;
    if (g.state === 'inv') this.closeInventory();
    if (g.state === 'chat') this.closeChat();
    this.el.menu.classList.add('hidden');
    g.setState('dead');
    g.input.unlock();
    this.el.death.classList.remove('hidden');
  }

  showLost() {
    this.game.input.unlock();
    this.el.lost.classList.remove('hidden');
  }
}
