// Инвентарь игрока: 9 слотов панели быстрого доступа + 27 слотов рюкзака.
import { maxStack, validItem } from '../shared/blocks.js';

export const HOTBAR = 9;
export const SLOTS = 36;

export class Inventory {
  constructor() {
    this.slots = new Array(SLOTS).fill(null);
    this.sel = 0;
    this.onChange = null;
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  selected() {
    return this.slots[this.sel];
  }

  selectedId() {
    const s = this.slots[this.sel];
    return s ? s.id : 0;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  // Добавляет предметы; возвращает, сколько не поместилось.
  add(id, n) {
    const max = maxStack(id);
    for (const s of this.slots) {
      if (n <= 0) break;
      if (s && s.id === id && s.n < max) {
        const k = Math.min(n, max - s.n);
        s.n += k;
        n -= k;
      }
    }
    for (let i = 0; i < SLOTS && n > 0; i++) {
      if (!this.slots[i]) {
        const k = Math.min(n, max);
        this.slots[i] = { id, n: k };
        n -= k;
      }
    }
    this.changed();
    return n;
  }

  remove(id, n) {
    if (this.count(id) < n) return false;
    for (let i = SLOTS - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(n, s.n);
        s.n -= k;
        n -= k;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  consumeSelected(n = 1) {
    const s = this.slots[this.sel];
    if (!s) return;
    s.n -= n;
    if (s.n <= 0) this.slots[this.sel] = null;
    this.changed();
  }

  canCraft(r) {
    return r.ins.every(([id, n]) => this.count(id) >= n);
  }

  craft(r) {
    if (!this.canCraft(r)) return false;
    for (const [id, n] of r.ins) this.remove(id, n);
    this.add(r.out[0], r.out[1]);
    return true;
  }

  toJSON() {
    return this.slots.map((s) => (s ? [s.id, s.n] : 0));
  }

  load(arr) {
    this.slots.fill(null);
    if (Array.isArray(arr)) {
      for (let i = 0; i < SLOTS && i < arr.length; i++) {
        const s = arr[i];
        if (Array.isArray(s) && validItem(s[0]) && s[1] > 0) this.slots[i] = { id: s[0], n: Math.min(s[1], maxStack(s[0])) };
      }
    }
    this.changed();
  }
}
