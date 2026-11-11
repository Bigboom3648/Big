// Интерфейс: панель быстрого доступа, рюкзак, крафт, чат, меню, подсказки.
import { RECIPES, CREATIVE_ITEMS, ITEMS, ARMOR_SLOTS, itemName, maxStack } from '../shared/blocks.js';
import { HOTBAR, SLOTS, TOTAL } from './inventory.js';
import { normalizeCode, p2pSupported, CODE_HINT } from './p2p.js';

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
      'invited', 'invitedCode', 'friends', 'host', 'code', 'join', 'friendsOff', 'mInvite', 'lostText',
      'invite', 'ivStatus', 'ivBox', 'ivCode', 'ivLink', 'ivCopy', 'ivShare', 'ivSteps', 'ivPlayers', 'ivRetry', 'ivClose',
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
    this.bindInvite();
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
    try {
      e.name.value = localStorage.getItem('kubozemye.name') || '';
    } catch {}
    // игра с друзьями: недоступна там, где браузер не умеет прямые соединения
    if (!p2pSupported()) {
      e.friends.classList.add('hidden');
      document.querySelector('.tag').textContent = 'Воксельная песочница: копай, строй, летай на крюке.';
      const off = e.friendsOff;
      off.classList.remove('hidden');
      const site = globalThis.KUBOZEMYE_SITE;
      if (site) {
        off.append('Играть вместе с друзьями можно на сайте игры: ');
        const a = document.createElement('a');
        a.href = site;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = site.replace(/^https?:\/\//, '');
        off.append(a);
      } else off.textContent = 'Этот браузер не умеет играть с друзьями. Откройте игру в Chrome, Edge, Firefox или Safari.';
    }
    // пришли по ссылке-приглашению
    const invited = p2pSupported() ? normalizeCode(new URLSearchParams(location.search).get('join')) : null;
    if (invited) {
      e.invited.classList.remove('hidden');
      e.invitedCode.textContent = invited;
      e.code.value = invited;
      e.join.textContent = 'Войти в мир друга';
      e.join.classList.add('primary');
      e.play.classList.remove('primary', 'big');
      e.play.textContent = 'Играть в своём мире';
    }
    for (const b of document.querySelectorAll('.mode')) {
      b.addEventListener('click', () => {
        this.startMode = b.dataset.mode;
        for (const o of document.querySelectorAll('.mode')) o.classList.toggle('on', o === b);
      });
    }
    const start = (how) => {
      const name = e.name.value.trim();
      try {
        localStorage.setItem('kubozemye.name', name);
      } catch {}
      e.starterr.textContent = '';
      this.game.join(name, this.startMode, how);
    };
    const joinFriend = () => {
      const code = normalizeCode(e.code.value);
      if (!code) {
        e.starterr.textContent = CODE_HINT;
        e.code.focus();
        return;
      }
      start({ join: code });
    };
    e.play.addEventListener('click', () => start('auto'));
    e.host.addEventListener('click', () => start('host'));
    e.join.addEventListener('click', joinFriend);
    e.code.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') joinFriend();
    });
    e.name.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        if (invited) joinFriend();
        else start('auto');
      }
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
    e.mInvite.addEventListener('click', () => this.openInvite());
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
    const net = g.net;
    const n = g.names.size;
    let info;
    if (net.mode === 'server') info = `Сервер игры: игроков онлайн — ${n}. Друзья заходят по адресу ${location.host}.`;
    else if (net.mode === 'guest') info = `Вы в гостях в мире друга (код ${net.code}). Игроков в мире: ${n}.`;
    else if (net.host && net.host.peer) info = `Ваш мир открыт для друзей, код ${net.code}. Игроков в мире: ${n}.`;
    else info = 'Мир хранится в этом браузере. Чтобы играть вместе — нажмите «Позвать друзей».';
    this.el.netinfo.textContent = info;
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
    const g = this.game;
    for (const id of ['menu', 'invite', 'inventory']) this.el[id].classList.add('hidden');
    g.setState('lost');
    g.input.unlock();
    this.el.lostText.textContent =
      g.net.mode === 'guest'
        ? 'Хозяин мира закрыл игру или пропал интернет. Когда друг снова откроет мир (код останется тем же), нажмите «Переподключиться».'
        : 'Сервер недоступен. Мир сохранён на сервере.';
    this.el.lost.classList.remove('hidden');
  }

  // ---------- игра с друзьями ----------
  bindInvite() {
    const e = this.el;
    e.ivClose.addEventListener('click', () => this.closeInvite());
    e.ivRetry.addEventListener('click', () => this.startInvite());
    e.ivLink.addEventListener('focus', () => e.ivLink.select());
    e.ivCopy.addEventListener('click', () => {
      const fallback = () => {
        e.ivLink.focus();
        e.ivLink.select();
        this.toast('Ссылка выделена — скопируйте её (Ctrl+C)', 3000);
      };
      try {
        navigator.clipboard.writeText(e.ivLink.value).then(() => this.toast('Ссылка скопирована — отправьте её друзьям', 3000), fallback);
      } catch {
        fallback();
      }
    });
    if (navigator.share) {
      e.ivShare.classList.remove('hidden');
      e.ivShare.addEventListener('click', () => {
        const code = e.ivCode.textContent;
        navigator
          .share({ title: 'Кубоземье', text: code ? `Заходи ко мне в Кубоземье! Код мира: ${code}` : 'Заходи ко мне в Кубоземье!', url: e.ivLink.value })
          .catch(() => {});
      });
    }
  }

  inviteLink(code) {
    const u = new URL(location.href);
    const ps = u.searchParams.get('peerserver'); // только для проверки на своём компьютере
    u.search = '';
    u.hash = '';
    if (ps) u.searchParams.set('peerserver', ps);
    if (code) u.searchParams.set('join', code);
    return u.href;
  }

  showInvite(status, code, link, steps) {
    const e = this.el;
    e.ivStatus.textContent = status;
    e.ivStatus.classList.remove('bad');
    e.ivRetry.classList.add('hidden');
    e.ivCode.parentElement.classList.toggle('hidden', !code);
    e.ivCode.textContent = code || '';
    e.ivLink.value = link;
    e.ivSteps.replaceChildren(
      ...steps.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
    e.ivBox.classList.remove('hidden');
    this.renderInvitePlayers();
  }

  renderInvitePlayers() {
    const g = this.game;
    const names = [...g.names.values()].map((p) => p.name);
    this.el.ivPlayers.textContent = names.length > 1 ? 'Сейчас в мире: ' + names.join(', ') : 'Пока в мире только вы.';
  }

  async startInvite() {
    const g = this.game;
    const e = this.el;
    const net = g.net;
    if (net.mode === 'server') {
      this.showInvite('Вы играете на сервере игры — друзья заходят по его адресу.', null, this.inviteLink(null), [
        'Отправьте этот адрес друзьям.',
        'Они открывают его в браузере и нажимают «Играть».',
      ]);
      return;
    }
    if (net.mode === 'guest') {
      this.showInvite('Вы в гостях в мире друга. Позовите ещё друзей — по этой же ссылке.', net.code, this.inviteLink(net.code), [
        'Отправьте ссылку другим друзьям — они попадут в этот же мир.',
        'Мир работает, пока он открыт у хозяина.',
      ]);
      return;
    }
    e.ivBox.classList.add('hidden');
    e.ivRetry.classList.add('hidden');
    e.ivStatus.classList.remove('bad');
    if (!(await net.canHost())) {
      const site = globalThis.KUBOZEMYE_SITE;
      e.ivStatus.textContent = site
        ? `В этой версии игры позвать друзей нельзя. Откройте сайт игры — ${site} — и нажмите там «Создать игру для друзей».`
        : 'Этот браузер не умеет играть с друзьями. Откройте игру в Chrome, Edge, Firefox или Safari.';
      return;
    }
    e.ivStatus.textContent = 'Открываю мир для друзей…';
    try {
      const code = await net.startHosting();
      if (g.state !== 'invite') return;
      this.showInvite('Мир открыт! Друзья могут заходить.', code, this.inviteLink(code), [
        'Отправьте ссылку друзьям в любой мессенджер — или просто скажите код.',
        'Друг открывает ссылку и нажимает «Войти в мир друга» — и он у вас в мире.',
        'Мир работает, пока у вас открыта эта вкладка. В следующий раз код будет тем же.',
      ]);
    } catch (err) {
      e.ivStatus.textContent = (err && err.message) || 'Не получилось открыть мир для друзей.';
      e.ivStatus.classList.add('bad');
      e.ivRetry.classList.remove('hidden');
    }
  }

  openInvite() {
    const g = this.game;
    if (g.state === 'menu') this.el.menu.classList.add('hidden');
    else if (g.state !== 'play') return;
    g.setState('invite');
    g.input.unlock();
    this.el.invite.classList.remove('hidden');
    this.startInvite();
  }

  closeInvite() {
    const g = this.game;
    if (g.state !== 'invite') return;
    this.el.invite.classList.add('hidden');
    g.setState('play');
    g.input.lock();
  }
}
