// Управление: клавиатура и мышь (с захватом курсора) либо сенсорный экран.
import { HOTBAR } from './inventory.js';

export class Input {
  constructor(game) {
    this.game = game;
    this.canvas = game.canvas;
    this.keys = new Set();
    this.moveF = 0;
    this.moveS = 0;
    this.jump = false;
    this.down = false;
    this.sprint = false;
    this.attack = false;
    this.use = false;
    this.attackPressed = false;
    this.usePressed = false;
    this.jumpPressed = false;
    this.pickPressed = false;
    this.touch = false;
    this.noLock = new URLSearchParams(location.search).has('nolock');
    this.sens = 0.0025;
    this.lastW = 0;
    this.lastSpace = 0;
    this.sprintLatch = false;
    this.everLocked = false;
    this.lockFails = 0;
    this.lastFail = 0;
    this.joy = { id: null, x: 0, y: 0 };
    this.lookP = { id: null, x: 0, y: 0, t: 0, moved: 0, long: false, timer: 0 };
    this.btn = { jump: false, down: false, attack: false };
    this.bindKeys();
    this.bindMouse();
    this.bindTouch();
  }

  get active() {
    return this.game.state === 'play' && (this.touch || this.noLock || document.pointerLockElement === this.canvas);
  }

  lock() {
    if (this.touch || this.noLock) return;
    try {
      if (!this.canvas.requestPointerLock) {
        this.lockFailed();
        return;
      }
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.lockFailed());
    } catch {
      this.lockFailed();
    }
  }

  // Если захват мыши недоступен (встроенный просмотр и т. п.), играем без него:
  // обзор — движением мыши и стрелками.
  lockFailed() {
    const now = performance.now();
    if (this.everLocked || this.noLock || now - this.lastFail < 150) return;
    this.lastFail = now;
    if (++this.lockFails >= 2) {
      this.noLock = true;
      this.game.ui.toast('Захват мыши недоступен: обзор — движением мыши и стрелками', 6000);
    }
  }

  unlock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  reset() {
    this.keys.clear();
    this.attack = false;
    this.use = false;
    this.sprintLatch = false;
    this.btn.jump = false;
    this.btn.down = false;
    this.btn.attack = false;
  }

  update(dt = 0.016) {
    if (!this.active) {
      this.moveF = 0;
      this.moveS = 0;
      this.jump = false;
      this.down = false;
      this.sprint = false;
      this.attack = false;
      this.use = false;
      return;
    }
    const k = this.keys;
    let f;
    let s;
    if (this.noLock && !this.touch) {
      // без захвата мыши стрелки поворачивают взгляд
      f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const lx = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
      const ly = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
      if (lx || ly) this.game.player.look(lx * dt * 2.2, ly * dt * 1.6);
    } else {
      f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    }
    let run = k.has('ShiftLeft') || k.has('ShiftRight') || this.sprintLatch;
    if (this.joy.id !== null) {
      f = -this.joy.y;
      s = this.joy.x;
      if (Math.hypot(f, s) > 0.93) run = true;
    }
    this.moveF = f;
    this.moveS = s;
    this.jump = k.has('Space') || this.btn.jump;
    this.down = k.has('KeyC') || this.btn.down;
    this.sprint = run && f > 0;
    if (this.btn.attack) this.attack = true;
  }

  frameEnd() {
    this.attackPressed = false;
    this.usePressed = false;
    this.jumpPressed = false;
    this.pickPressed = false;
  }

  bindKeys() {
    addEventListener('keydown', (e) => {
      const g = this.game;
      const st = g.state;
      if (st === 'start' || st === 'dead' || st === 'lost' || st === 'loading') return;
      if (st === 'invite') {
        if (e.code === 'Escape') g.ui.closeInvite();
        return;
      }
      if (st === 'chat') {
        if (e.code === 'Escape') g.ui.closeChat();
        return;
      }
      if (st === 'inv') {
        if (e.code === 'KeyE' || e.code === 'Escape') {
          e.preventDefault();
          g.ui.closeInventory();
        }
        return;
      }
      if (st === 'menu') {
        if (e.code === 'Escape' && !e.repeat) g.ui.closeMenu();
        return;
      }
      if (st !== 'play') return;
      if (e.code === 'Tab' || e.code === 'F3' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const now = performance.now();
      switch (e.code) {
        case 'KeyW':
          if (now - this.lastW < 280) this.sprintLatch = true;
          this.lastW = now;
          break;
        case 'Space':
          this.jumpPressed = true;
          if (now - this.lastSpace < 300) g.player.toggleFly();
          this.lastSpace = now;
          break;
        case 'KeyF':
          g.player.toggleFly();
          break;
        case 'KeyE':
          g.ui.openInventory();
          break;
        case 'KeyT':
        case 'Enter':
          e.preventDefault();
          g.ui.openChat('');
          break;
        case 'Slash':
          e.preventDefault();
          g.ui.openChat('/');
          break;
        case 'Escape':
          g.ui.openMenu();
          break;
        case 'F3':
          g.ui.toggleDebug();
          break;
        case 'KeyM':
          g.ui.toggleMap();
          break;
        case 'KeyG':
          g.settings.shaders = !g.settings.shaders;
          g.applySettings();
          g.ui.syncSettings();
          g.ui.toast(g.settings.shaders ? 'Шейдеры включены' : 'Шейдеры выключены');
          break;
        case 'Tab':
          g.ui.showPlayers(true);
          break;
        default:
          if (e.code.startsWith('Digit')) {
            const n = Number(e.code.slice(5));
            if (n >= 1 && n <= HOTBAR) g.selectSlot(n - 1);
          }
      }
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyW') this.sprintLatch = false;
      if (e.code === 'Tab') this.game.ui.showPlayers(false);
    });
    addEventListener('blur', () => this.reset());
  }

  bindMouse() {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (!this.active) {
        if (this.game.state === 'play') this.lock();
        return;
      }
      if (e.button === 0) {
        this.attack = true;
        this.attackPressed = true;
      } else if (e.button === 2) {
        this.use = true;
        this.usePressed = true;
      } else if (e.button === 1) {
        this.pickPressed = true;
        e.preventDefault();
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attack = false;
      if (e.button === 2) this.use = false;
    });
    document.addEventListener('mousemove', (e) => {
      const free = this.noLock && !this.touch && e.target === c;
      if ((document.pointerLockElement === c || free) && this.game.state === 'play') {
        this.game.player.look(-e.movementX * this.sens, -e.movementY * this.sens);
      }
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        const g = this.game;
        g.selectSlot((g.inv.sel + (e.deltaY > 0 ? 1 : HOTBAR - 1)) % HOTBAR);
      },
      { passive: true },
    );
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === c) this.everLocked = true;
      this.reset();
      if (document.pointerLockElement !== c && this.game.state === 'play' && !this.touch && !this.noLock) this.game.ui.openMenu();
    });
  }

  bindTouch() {
    addEventListener(
      'touchstart',
      () => {
        if (!this.touch) {
          this.touch = true;
          document.body.classList.add('touch');
          this.unlock();
        }
      },
      { passive: true },
    );
    const joy = document.getElementById('joy');
    const knob = document.getElementById('joyknob');
    const setJoy = (e) => {
      const r = joy.getBoundingClientRect();
      const R = r.width / 2;
      let x = (e.clientX - (r.left + R)) / R;
      let y = (e.clientY - (r.top + R)) / R;
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      this.joy.x = x;
      this.joy.y = y;
      knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
    };
    const endJoy = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = null;
      this.joy.x = 0;
      this.joy.y = 0;
      knob.style.transform = '';
    };
    joy.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joy.id = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      setJoy(e);
    });
    joy.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joy.id) setJoy(e);
    });
    joy.addEventListener('pointerup', endJoy);
    joy.addEventListener('pointercancel', endJoy);

    // обзор: ведём пальцем по экрану; короткое касание — поставить, долгое — ломать
    const c = this.canvas;
    const L = this.lookP;
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || L.id !== null || this.game.state !== 'play') return;
      L.id = e.pointerId;
      L.x = e.clientX;
      L.y = e.clientY;
      L.t = performance.now();
      L.moved = 0;
      L.long = false;
      c.setPointerCapture(e.pointerId);
      L.timer = setTimeout(() => {
        if (L.id !== null && L.moved < 14) {
          L.long = true;
          this.attack = true;
          this.attackPressed = true;
        }
      }, 380);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== L.id) return;
      const dx = e.clientX - L.x;
      const dy = e.clientY - L.y;
      L.x = e.clientX;
      L.y = e.clientY;
      L.moved += Math.abs(dx) + Math.abs(dy);
      this.game.player.look(-dx * this.sens * 2.2, -dy * this.sens * 2.2);
    });
    const endLook = (e) => {
      if (e.pointerId !== L.id) return;
      clearTimeout(L.timer);
      if (L.long) this.attack = false;
      else if (performance.now() - L.t < 280 && L.moved < 16) this.usePressed = true;
      L.id = null;
    };
    c.addEventListener('pointerup', endLook);
    c.addEventListener('pointercancel', endLook);

    for (const el of document.querySelectorAll('#touch [data-act]')) {
      const act = el.dataset.act;
      const down = (e) => {
        e.preventDefault();
        el.classList.add('on');
        const g = this.game;
        if (act === 'jump') {
          this.btn.jump = true;
          this.jumpPressed = true;
          const now = performance.now();
          if (now - this.lastSpace < 320) g.player.toggleFly();
          this.lastSpace = now;
        } else if (act === 'down') this.btn.down = true;
        else if (act === 'attack') {
          this.btn.attack = true;
          this.attackPressed = true;
        } else if (act === 'use') this.usePressed = true;
        else if (act === 'inv') g.ui.openInventory();
        else if (act === 'chat') g.ui.openChat('');
        else if (act === 'menu') g.ui.openMenu();
      };
      const up = () => {
        el.classList.remove('on');
        if (act === 'jump') this.btn.jump = false;
        else if (act === 'down') this.btn.down = false;
        else if (act === 'attack') {
          this.btn.attack = false;
          this.attack = false;
        }
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    }
  }
}
