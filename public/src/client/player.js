// Локальный игрок: физика, взаимодействие с блоками, крюк, планер, здоровье.
import * as THREE from './three.js';
import { BUILD_LIMIT, REACH } from '../shared/constants.js';
import { B, BLOCKS, I, ITEMS, SOLID, SHAPE, LIQUID, JOBS, CRATE_LOOT, isBlock, breakTime, dropsFor, itemName } from '../shared/blocks.js';
import { moveBox, boxBlocked } from '../shared/physics.js';

const HW = 0.3; // половина ширины
const PH = 1.8; // рост
const EYE = 1.62;
const GRAVITY = 28;
const JUMP = 8.7;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(0, 80, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.mode = 's';
    this.hp = 20;
    this.dead = false;
    this.onGround = false;
    this.flying = false;
    this.inWater = false; // в любой жидкости
    this.inLava = false;
    this.headFluid = 0; // 0 — воздух, 1 — голова в воде, 2 — в лаве
    this.lavaT = 0;
    this.gliding = false;
    this.hook = null;
    this.fallTop = 0;
    this.res = { onGround: false, hitX: false, hitY: false, hitZ: false };
    this.spawn = [0, 80, 0];
    this.target = null;
    this.breakT = 0;
    this.breakKey = '';
    this.cool = 0;
    this.useCool = 0;
    this.attackLock = false;
    this.digT = 0;
    this.stepT = 0;
    this.regenT = 0;
    this.padLock = false;
    this.lastHurt = -10;
    this.walk = 0;
    this.dirty = false;
    this.dir = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.isSolid = (x, y, z) => SOLID[game.world.getBlock(x, y, z)] === 1;
  }

  look(dx, dy) {
    this.yaw += dx;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy));
  }

  setMode(m) {
    this.mode = m;
    if (m === 's') this.flying = false;
    this.dirty = true;
    this.game.ui.onMode();
  }

  toggleFly() {
    if (this.mode !== 'c') return;
    this.flying = !this.flying;
    if (this.flying) this.vel.y = 0;
  }

  teleport(p) {
    this.pos.set(p[0], p[1], p[2]);
    this.vel.set(0, 0, 0);
    this.fallTop = p[1];
    this.hook = null;
  }

  // kind: 'mob' | 'boom' | 'fall' | 'lava' | 'void' — от этого зависит, помогает ли броня.
  damage(d, from, kind = 'mob') {
    if (this.mode !== 's' || this.dead || d <= 0) return;
    const g0 = this.game;
    if (from && g0.elapsed - this.lastHurt < 0.8) return; // краткая неуязвимость после удара
    this.lastHurt = g0.elapsed;
    // броня снимает 4% урона от мобов и взрывов за очко, ботинки смягчают падение
    if (kind === 'mob' || kind === 'boom') d *= 1 - Math.min(0.8, g0.inv.armorPoints() * 0.04);
    else if (kind === 'fall') d *= 1 - Math.min(0.6, g0.inv.bootsPoints() * 0.15);
    d = Math.max(0.5, Math.round(d * 2) / 2);
    this.hp = Math.max(0, this.hp - d);
    this.dirty = true;
    this.regenT = 0;
    const g = this.game;
    g.sound.play('hurt');
    g.ui.flash('hurt');
    g.shake = Math.max(g.shake, 0.25);
    if (from) {
      const dx = this.pos.x - from[0];
      const dz = this.pos.z - from[2];
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / l) * 7;
      this.vel.z += (dz / l) * 7;
      this.vel.y = Math.max(this.vel.y, 5);
    }
    g.ui.setHp(this.hp);
    if (this.hp <= 0) {
      this.dead = true;
      this.hook = null;
      g.ui.showDeath();
    }
  }

  respawn() {
    this.dead = false;
    this.hp = 20;
    this.teleport(this.spawn);
    this.game.ui.setHp(this.hp);
    this.dirty = true;
  }

  update(dt) {
    const g = this.game;
    const w = g.world;
    const inp = g.input;
    const p = this.pos;
    const v = this.vel;
    if (this.dead) return;

    const fx = Math.floor(p.x);
    const fz = Math.floor(p.z);
    const feet = w.getBlock(fx, Math.floor(p.y + 0.1), fz);
    const body = w.getBlock(fx, Math.floor(p.y + 0.9), fz);
    this.inLava = feet === B.LAVA || body === B.LAVA;
    this.inWater = this.inLava || feet === B.WATER || body === B.WATER;
    this.headFluid = LIQUID[w.getBlock(fx, Math.floor(p.y + EYE), fz)];
    if (this.inLava && !this.flying) {
      this.lavaT -= dt;
      if (this.lavaT <= 0) {
        this.lavaT = 0.5;
        this.damage(4, null, 'lava');
      }
    } else this.lavaT = 0;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let wx = -sinY * inp.moveF + cosY * inp.moveS;
    let wz = -cosY * inp.moveF - sinY * inp.moveS;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const held = g.inv.selectedId();
    this.gliding = false;

    if (this.flying) {
      const sp = inp.sprint ? 24 : 11;
      const k = Math.min(1, dt * 9);
      v.x += (wx * sp - v.x) * k;
      v.z += (wz * sp - v.z) * k;
      v.y += (((inp.jump ? 1 : 0) - (inp.down ? 1 : 0)) * sp * 0.75 - v.y) * k;
    } else if (this.hook) {
      const ax = this.hook.x - p.x;
      const ay = this.hook.y - (p.y + 0.9);
      const az = this.hook.z - p.z;
      const d = Math.hypot(ax, ay, az);
      if (d < 1.7 || inp.jumpPressed) {
        this.hook = null;
        if (inp.jumpPressed) v.y = Math.max(v.y, 7.5);
      } else {
        const pull = 50 * dt;
        v.x += (ax / d) * pull + wx * 6 * dt;
        v.y += (ay / d) * pull - 9 * dt;
        v.z += (az / d) * pull + wz * 6 * dt;
        v.multiplyScalar(1 - Math.min(1, dt * 1.3));
        const sp = v.length();
        if (sp > 26) v.multiplyScalar(26 / sp);
      }
    } else if (this.inWater) {
      const k = Math.min(1, dt * 6);
      const swim = this.inLava ? 1.7 : 3.3; // лава вязкая
      v.x += (wx * swim - v.x) * k;
      v.z += (wz * swim - v.z) * k;
      v.y -= 9 * dt;
      v.y *= 1 - Math.min(1, dt * 2.6);
      if (inp.jump) v.y = Math.min(3.8, v.y + 26 * dt);
      if (inp.down) v.y -= 12 * dt;
    } else {
      const speed = inp.sprint ? 6.3 : inp.down ? 1.7 : 4.4;
      const rate = this.onGround ? 14 : wl > 0.05 ? 3 : 0.5;
      const k = Math.min(1, dt * rate);
      v.x += (wx * speed - v.x) * k;
      v.z += (wz * speed - v.z) * k;
      v.y -= GRAVITY * dt;
      if (v.y < -58) v.y = -58;
      if (inp.jump && this.onGround) {
        v.y = JUMP;
        this.onGround = false;
      }
      if (held === I.GLIDER && inp.jump && !this.onGround && v.y < 0) {
        this.gliding = true;
        v.y += (-1.7 - v.y) * Math.min(1, dt * 7);
        const gk = Math.min(1, dt * 1.6);
        v.x += (-sinY * 10.5 - v.x) * gk;
        v.z += (-cosY * 10.5 - v.z) * gk;
      }
    }

    const prevVy = v.y;
    const wasGround = this.onGround;
    moveBox(this.isSolid, p, v, HW, PH, dt, this.res);
    this.onGround = this.res.onGround;

    if (this.onGround) {
      const bx = Math.floor(p.x);
      const by = Math.floor(p.y - 0.5);
      const bz = Math.floor(p.z);
      const below = w.getBlock(bx, by, bz);
      if (below === B.TRAMPOLINE && prevVy < -2.5) {
        v.y = Math.min(24, -prevVy * 0.82 + (inp.jump ? 5 : 2));
        this.onGround = false;
        g.sound.play('boing');
      } else if (!wasGround) {
        const dist = this.fallTop - p.y;
        if (dist > 3.6 && !this.inWater) this.damage(Math.floor(dist - 3), null, 'fall');
        if (dist > 0.6) g.sound.play('step', 0.9);
      }
      this.fallTop = p.y;
      // телепорт-плита под ногами
      if (below === B.PAD) {
        if (!this.padLock) {
          this.padLock = true;
          g.net.send({ t: 'pad', x: bx, y: by, z: bz });
        }
      } else this.padLock = false;
      // автопрыжок на уступ высотой в один блок
      if (g.settings.autoJump && (this.res.hitX || this.res.hitZ) && wl > 0.2 && !this.flying && !this.inWater) {
        const ax = p.x + wx * 0.55;
        const az = p.z + wz * 0.55;
        if (boxBlocked(this.isSolid, ax, p.y, az, HW, 0.9) && !boxBlocked(this.isSolid, ax, p.y + 1.05, az, HW, PH) && !boxBlocked(this.isSolid, p.x, p.y + 1.05, p.z, HW, PH)) {
          v.y = JUMP;
          this.onGround = false;
        }
      }
    } else {
      if (p.y > this.fallTop || this.inWater || this.flying || this.hook || this.gliding) this.fallTop = p.y;
      if (this.padLock && w.getBlock(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)) !== B.PAD) this.padLock = false;
    }
    if (this.flying && this.onGround && inp.down) this.flying = false;

    // шаги
    const hs = Math.hypot(v.x, v.z);
    this.walk += ((this.onGround ? Math.min(1, hs / 4.4) : 0) - this.walk) * Math.min(1, dt * 10);
    if (this.onGround && hs > 1.5) {
      this.stepT -= dt * hs;
      if (this.stepT <= 0) {
        this.stepT = 2.6;
        g.sound.play('step', 0.7);
      }
    }

    if (p.y < -24) {
      this.damage(6, null, 'void');
      if (!this.dead) this.teleport(this.spawn);
    }

    if (this.mode === 's' && this.hp < 20) {
      this.regenT += dt;
      if (this.regenT >= 4) {
        this.regenT = 0;
        this.hp = Math.min(20, this.hp + 1);
        this.dirty = true;
        g.ui.setHp(this.hp);
      }
    }

    this.interact(dt);
  }

  // Пересекается ли блок с телом игрока.
  touchesBlock(x, y, z) {
    const p = this.pos;
    return x + 1 > p.x - HW && x < p.x + HW && y + 1 > p.y && y < p.y + PH && z + 1 > p.z - HW && z < p.z + HW;
  }

  interact(dt) {
    const g = this.game;
    const w = g.world;
    const inp = g.input;
    const inv = g.inv;
    const ent = g.entities;
    this.eye.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    const cp = Math.cos(this.pitch);
    this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const e = this.eye;
    const d = this.dir;
    const reach = this.mode === 'c' ? REACH + 1.5 : REACH;
    const t = w.raycast(e.x, e.y, e.z, d.x, d.y, d.z, reach);
    this.target = t;
    this.cool -= dt;
    this.useCool -= dt;
    const held = inv.selected();
    const heldId = held ? held.id : 0;

    // --- удар / ломание ---
    if (inp.attackPressed) {
      ent.hand.doSwing();
      const mob = ent.pickMob(e, d, Math.min(3.8, t ? t.dist : 99));
      if (mob && mob.type === 2) {
        g.ui.toast('Жителей обижать нельзя. Правая кнопка — обмен');
        this.attackLock = true;
      } else if (mob) {
        const dmg = ITEMS[heldId] ? ITEMS[heldId].dmg : 1;
        g.net.send({ t: 'hit', id: mob.id, d: dmg });
        mob.hurt = true;
        g.sound.play('hit');
        this.attackLock = true;
      }
    }
    if (!inp.attack) this.attackLock = false;
    if (inp.attack && !this.attackLock && t) {
      const key = t.x + ',' + t.y + ',' + t.z;
      if (key !== this.breakKey) {
        this.breakKey = key;
        this.breakT = 0;
      }
      if (this.mode === 'c') {
        if (this.cool <= 0 && BLOCKS[t.id].hard >= 0) {
          this.breakBlock(t, heldId);
          this.cool = 0.2;
          ent.hand.doSwing();
        }
      } else {
        const bt = breakTime(t.id, heldId);
        if (bt !== Infinity && this.cool <= 0) {
          this.breakT += dt / Math.max(bt, 0.05);
          this.digT -= dt;
          if (this.digT <= 0) {
            this.digT = 0.22;
            g.sound.play('dig');
            ent.hand.doSwing();
            ent.blockBurst(t.x + t.nx * 0.5, t.y + t.ny * 0.5, t.z + t.nz * 0.5, t.id, 2);
          }
          if (this.breakT >= 1) {
            this.breakBlock(t, heldId);
            this.breakT = 0;
            this.cool = 0.08;
          }
        }
      }
    } else {
      this.breakT = 0;
      this.breakKey = '';
    }

    // --- использование / установка ---
    if (inp.usePressed || (inp.use && this.useCool <= 0)) {
      this.useCool = 0.24;
      this.useItem(t, held);
    }

    // --- выбор блока средней кнопкой (творческий режим) ---
    if (inp.pickPressed && t && this.mode === 'c') {
      inv.slots[inv.sel] = { id: t.id === B.BARREL_LIT ? B.BARREL : t.id, n: 1 };
      inv.changed();
    }

    // --- визуальные подсказки ---
    if (t) {
      const cross = BLOCKS[t.id].shape === 'cross';
      ent.sel.visible = true;
      ent.sel.scale.set(cross ? 0.74 : 1, cross ? 0.9 : 1, cross ? 0.74 : 1);
      ent.sel.position.set(t.x + 0.5, t.y + (cross ? 0.45 : 0.5), t.z + 0.5);
    } else ent.sel.visible = false;
    if (t && this.breakT > 0) {
      const n = ent.crackTex.length;
      ent.crack.visible = true;
      ent.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      ent.crack.material.map = ent.crackTex[Math.min(n - 1, Math.floor(this.breakT * n))];
    } else ent.crack.visible = false;
    ent.hand.setItem(heldId);
  }

  breakBlock(t, heldId) {
    const g = this.game;
    g.world.setBlock(t.x, t.y, t.z, 0);
    g.net.send({ t: 'set', x: t.x, y: t.y, z: t.z, id: 0 });
    g.entities.blockBurst(t.x, t.y, t.z, t.id, 16);
    g.sound.play('break');
    if (this.mode === 's' && t.id === B.CRATE) {
      const got = [];
      for (let k = 0; k < 2; k++) {
        const [id, n] = CRATE_LOOT[Math.floor(Math.random() * CRATE_LOOT.length)];
        g.inv.add(id, n);
        got.push(`${itemName(id)} ×${n}`);
      }
      g.ui.toast('Из ящика: ' + got.join(', '), 3500);
      g.sound.play('pop');
      this.dirty = true;
    } else if (this.mode === 's') {
      const drop = dropsFor(t.id, heldId);
      if (drop) {
        const left = g.inv.add(drop[0], drop[1]);
        if (left > 0) g.ui.toast('Рюкзак полон!');
        else g.sound.play('pop', 0.6);
      }
      this.dirty = true;
    }
  }

  useItem(t, held) {
    const g = this.game;
    const w = g.world;
    const inp = g.input;
    const hand = g.entities.hand;
    const villager = g.entities.pickMob(this.eye, this.dir, Math.min(4, t ? t.dist : 99));
    if (villager && villager.type === 2) {
      this.trade(villager);
      hand.doSwing();
      return;
    }
    if (held && ITEMS[held.id] && ITEMS[held.id].armor) {
      // броню в руке можно надеть одним нажатием
      if (g.inv.equipFrom(g.inv.sel)) {
        g.sound.play('craft');
        g.ui.toast('Надето: ' + itemName(held.id));
        hand.doSwing();
        this.dirty = true;
      }
      return;
    }
    if (held && (held.id === I.BUCKET || held.id === I.BUCKET_WATER || held.id === I.BUCKET_LAVA)) {
      this.useBucket(t, held);
      return;
    }
    if (t && t.id === B.BARREL && !inp.down) {
      g.net.send({ t: 'ignite', x: t.x, y: t.y, z: t.z });
      hand.doSwing();
      return;
    }
    if (!held) return;
    const id = held.id;
    if (id === I.HOOK) {
      hand.doSwing();
      if (this.hook) {
        this.hook = null;
        return;
      }
      const e = this.eye;
      const d = this.dir;
      const hit = w.raycast(e.x, e.y, e.z, d.x, d.y, d.z, 44);
      g.sound.play('hook');
      if (hit) {
        this.hook = { x: hit.x + 0.5 + hit.nx * 0.55, y: hit.y + 0.5 + hit.ny * 0.55, z: hit.z + 0.5 + hit.nz * 0.55 };
        this.flying = false;
      } else g.ui.toast('Слишком далеко — крюку не за что зацепиться');
      return;
    }
    if (ITEMS[id] && ITEMS[id].food) {
      if (this.mode === 's' && this.hp < 20) {
        this.hp = Math.min(20, this.hp + ITEMS[id].food);
        g.inv.consumeSelected(1);
        g.ui.setHp(this.hp);
        g.sound.play('eat');
        this.dirty = true;
        hand.doSwing();
      }
      return;
    }
    if (!isBlock(id) || !t) return;
    let x = t.x + t.nx;
    let y = t.y + t.ny;
    let z = t.z + t.nz;
    if (BLOCKS[t.id].replaceable) {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && !BLOCKS[cur].replaceable) return;
    if (y < 1 || y > BUILD_LIMIT) {
      g.ui.toast('Здесь строить нельзя — предел высоты');
      return;
    }
    const def = BLOCKS[id];
    if (def.solid && this.touchesBlock(x, y, z)) return;
    if (def.needsGround && !SOLID[w.getBlock(x, y - 1, z)]) return;
    if (!w.hasData(x, z)) return;
    w.setBlock(x, y, z, id);
    g.net.send({ t: 'set', x, y, z, id });
    g.sound.play('place');
    hand.doSwing();
    if (this.mode === 's') {
      g.inv.consumeSelected(1);
      this.dirty = true;
    }
  }

  // Обмен с жителем: у каждой профессии своя сделка.
  trade(mob) {
    const g = this.game;
    const job = JOBS[mob.job] || JOBS[0];
    const [giveId, giveN] = job.give;
    const [getId, getN] = job.get;
    const offer = `${giveN} × ${itemName(giveId)} → ${getN} × ${itemName(getId)}`;
    if (g.inv.count(giveId) < giveN) {
      g.ui.toast(`${job.name} меняет: ${offer}`, 3500);
      return;
    }
    g.inv.remove(giveId, giveN);
    const left = g.inv.add(getId, getN);
    if (left > 0) g.inv.add(giveId, giveN); // не поместилось — возвращаем плату
    g.ui.toast(left > 0 ? 'Рюкзак полон!' : `Обмен: ${offer}`, 2500);
    if (left === 0) g.sound.play('craft');
    this.dirty = true;
  }

  // Ведро: пустым зачерпываем воду или лаву, полным — выливаем.
  useBucket(t, held) {
    const g = this.game;
    const w = g.world;
    const e = this.eye;
    const d = this.dir;
    const hand = g.entities.hand;
    if (held.id === I.BUCKET) {
      const hit = w.raycast(e.x, e.y, e.z, d.x, d.y, d.z, REACH, true);
      if (!hit || !LIQUID[hit.id]) return;
      g.net.send({ t: 'bucket', a: 'fill', x: hit.x, y: hit.y, z: hit.z });
      g.sound.play('splash');
      hand.doSwing();
      if (this.mode === 's') {
        const full = hit.id === B.LAVA ? I.BUCKET_LAVA : I.BUCKET_WATER;
        g.inv.consumeSelected(1);
        if (!g.inv.selected()) {
          g.inv.slots[g.inv.sel] = { id: full, n: 1 };
          g.inv.changed();
        } else if (g.inv.add(full, 1) > 0) g.ui.toast('Рюкзак полон!');
        this.dirty = true;
      }
      return;
    }
    if (!t) return;
    let x = t.x + t.nx;
    let y = t.y + t.ny;
    let z = t.z + t.nz;
    if (SHAPE[t.id] === 1) {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    const fluid = held.id === I.BUCKET_LAVA ? B.LAVA : B.WATER;
    const cur = w.getBlock(x, y, z);
    if (cur !== 0 && SHAPE[cur] !== 1 && !(LIQUID[cur] && cur !== fluid)) return;
    if (y < 1 || y > BUILD_LIMIT || !w.hasData(x, z)) return;
    g.net.send({ t: 'bucket', a: 'pour', x, y, z, id: fluid });
    g.sound.play('splash');
    hand.doSwing();
    if (this.mode === 's') {
      g.inv.slots[g.inv.sel] = { id: I.BUCKET, n: 1 };
      g.inv.changed();
      this.dirty = true;
    }
  }

  heldName() {
    const s = this.game.inv.selected();
    return s ? itemName(s.id) : '';
  }
}
