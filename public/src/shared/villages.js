// Деревни: где они стоят и из чего построены. Всё детерминировано по зерну,
// поэтому сервер и клиенты получают одинаковые деревни без передачи по сети.
import { SEA } from './constants.js';
import { B } from './blocks.js';
import { hash2, hash3 } from './noise.js';

export const VILLAGE_CELL = 160; // одна возможная деревня на клетку такой ширины
const HALF = VILLAGE_CELL / 2;
const MARGIN = 46; // насколько центр деревни может отходить от центра клетки
const R = 34; // наибольший размах построек от центра

// Режимы записи блоков чертежа: 0 — поставить, 1 — столб вниз до опоры,
// 3 — заменить только поверхность земли (тропинка).
export const STAMP_SET = 0;
export const STAMP_PILLAR = 1;
export const STAMP_PATH = 3;

export function createVillages(seed, column, BIOME, getSpawn) {
  const cache = new Map();
  let spawnVillage; // ближайшая к точке появления, считается один раз

  // Подходит ли место: суша, не горы, достаточно ровно.
  function flat(x, z, tol) {
    const c = column(x, z);
    if (c.biome === BIOME.MOUNTAIN || c.h <= SEA + 1 || c.h > SEA + 32) return null;
    let lo = c.h;
    let hi = c.h;
    for (let r = 12; r <= 24; r += 12) {
      for (let a = 0; a < 8; a++) {
        const s = column(x + Math.round(Math.cos((a * Math.PI) / 4) * r), z + Math.round(Math.sin((a * Math.PI) / 4) * r));
        if (s.h <= SEA + 1) return null;
        if (s.h < lo) lo = s.h;
        if (s.h > hi) hi = s.h;
      }
    }
    return hi - lo > tol ? null : c;
  }

  function build(key, x, z, c, hsh) {
    const E = [];
    const desert = c.biome === BIOME.DESERT;
    const snow = c.biome === BIOME.SNOW;
    const wall = desert ? B.SANDSTONE : B.PLANKS;
    const post = desert ? B.STONE_BRICKS : snow ? B.PINE_LOG : B.LOG;
    const base = desert ? B.SANDSTONE : B.COBBLE;
    const pathId = desert ? B.SANDSTONE : B.GRAVEL;
    const ROOFS = [B.PAINT_RED, B.PAINT_ORANGE, B.PAINT_BLUE, B.PAINT_GREEN, B.PAINT_PURPLE, B.PAINT_CYAN];
    const roof = ROOFS[hsh % ROOFS.length];
    const roof2 = ROOFS[(hsh >>> 5) % ROOFS.length];

    const set = (bx, by, bz, id) => E.push(bx, by, bz, id, STAMP_SET);
    const pillar = (bx, by, bz, id) => E.push(bx, by, bz, id, STAMP_PILLAR);
    const clear = (ax, ay, az, bx, by, bz) => {
      for (let yy = ay; yy <= by; yy++) for (let zz = az; zz <= bz; zz++) for (let xx = ax; xx <= bx; xx++) set(xx, yy, zz, 0);
    };

    // --- расстановка: дома, башня и огород по кругу вокруг колодца ---
    const plan = [];
    const boxes = [[x - 3, z - 3, x + 3, z + 3]];
    const n = 4 + ((hsh >>> 8) % 4);
    const a0 = ((hsh >>> 12) % 628) / 100;
    const slots = n + 2;
    for (let i = 0; i < slots; i++) {
      const hh = hash3(seed ^ 0x9a17, hsh | 0, i, 77);
      const kind = i === n ? 'tower' : i === n + 1 ? 'farm' : 'house';
      const ang = a0 + (i / slots) * Math.PI * 2 + ((hh % 100) / 100 - 0.5) * 0.3;
      const rad = 13 + ((hh >>> 8) % 10);
      const hx = x + Math.round(Math.cos(ang) * rad);
      const hz = z + Math.round(Math.sin(ang) * rad);
      let a = 2 + ((hh >>> 16) & 1);
      let b = 2 + ((hh >>> 17) & 1);
      if (kind === 'tower') a = b = 3;
      else if (kind === 'farm') {
        a = 3;
        b = 2;
      }
      const box = [hx - a - 2, hz - b - 2, hx + a + 2, hz + b + 2];
      if (boxes.some((o) => box[0] <= o[2] && box[2] >= o[0] && box[1] <= o[3] && box[3] >= o[1])) continue;
      const col = column(hx, hz);
      if (col.h <= SEA + 1 || Math.abs(col.h - c.h) > 6) continue;
      boxes.push(box);
      // дверь смотрит на колодец
      let sx = 0;
      let sz = 0;
      if (Math.abs(x - hx) >= Math.abs(z - hz)) sx = x > hx ? 1 : -1;
      else sz = z > hz ? 1 : -1;
      plan.push({ kind, x: hx, z: hz, y: col.h, a, b, sx, sz, hh });
    }

    // --- тропинки от дверей к колодцу и фонарные столбы ---
    const houses = [];
    for (const p of plan) {
      if (p.kind !== 'house') continue;
      const dx0 = p.x + p.sx * (p.a + 1);
      const dz0 = p.z + p.sz * (p.b + 1);
      houses.push({ x: p.x, z: p.z, y: p.y, dx: dx0, dz: dz0 });
      const steps = Math.max(Math.abs(x - dx0), Math.abs(z - dz0));
      const alongX = Math.abs(x - dx0) >= Math.abs(z - dz0);
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(dx0 + ((x - dx0) * s) / steps);
        const pz = Math.round(dz0 + ((z - dz0) * s) / steps);
        if (Math.max(Math.abs(px - x), Math.abs(pz - z)) <= 2) break;
        for (let w = 0; w < 2; w++) {
          const qx = px + (alongX ? 0 : w);
          const qz = pz + (alongX ? w : 0);
          const h = column(qx, qz).h;
          if (h > SEA) E.push(qx, h, qz, pathId, STAMP_PATH);
        }
        if (s === (steps >> 1) && houses.length % 2 === 1) {
          const lx = px + (alongX ? 0 : -2);
          const lz = pz + (alongX ? -2 : 0);
          const h = column(lx, lz).h;
          if (h > SEA) {
            set(lx, h + 1, lz, post);
            set(lx, h + 2, lz, post);
            set(lx, h + 3, lz, B.LAMP);
          }
        }
      }
    }

    // --- колодец ---
    {
      const y0 = c.h;
      clear(x - 2, y0 + 1, z - 2, x + 2, y0 + 6, z + 2);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const mid = dx === 0 && dz === 0;
          pillar(x + dx, y0 - 3, z + dz, base);
          for (let yy = y0 - 2; yy <= y0 + 1; yy++) {
            set(x + dx, yy, z + dz, mid ? (yy === y0 - 2 ? B.STONE_BRICKS : yy <= y0 ? B.WATER : 0) : B.STONE_BRICKS);
          }
          if (dx !== 0 && dz !== 0) {
            set(x + dx, y0 + 2, z + dz, post);
            set(x + dx, y0 + 3, z + dz, post);
          }
          set(x + dx, y0 + 4, z + dz, mid ? B.LAMP : roof2);
        }
      }
      set(x, y0 + 5, z, roof2);
    }

    // --- постройки ---
    for (const p of plan) {
      const { x: hx, z: hz, y: y0, a, b, sx, sz, hh } = p;
      if (p.kind === 'house') {
        const roofH = Math.min(a, b) + 2;
        clear(hx - a - 1, y0 + 1, hz - b - 1, hx + a + 1, y0 + 4 + roofH, hz + b + 1);
        for (let dx = -a; dx <= a; dx++) {
          for (let dz = -b; dz <= b; dz++) {
            const ex = Math.abs(dx) === a;
            const ez = Math.abs(dz) === b;
            pillar(hx + dx, y0 - 1, hz + dz, base);
            set(hx + dx, y0, hz + dz, ex || ez ? base : B.PLANKS);
            if (ex || ez) for (let yy = y0 + 1; yy <= y0 + 3; yy++) set(hx + dx, yy, hz + dz, ex && ez ? post : wall);
          }
        }
        for (const [wx, wz] of [[hx, hz - b], [hx, hz + b], [hx - a, hz], [hx + a, hz]]) set(wx, y0 + 2, wz, B.GLASS);
        set(hx + sx * a, y0 + 1, hz + sz * b, 0);
        set(hx + sx * a, y0 + 2, hz + sz * b, 0);
        for (let k = 0; ; k++) {
          const ha = a + 1 - k;
          const hb = b + 1 - k;
          if (ha < 0 || hb < 0) break;
          for (let dx = -ha; dx <= ha; dx++) for (let dz = -hb; dz <= hb; dz++) set(hx + dx, y0 + 4 + k, hz + dz, roof);
        }
        set(hx, y0 + 4, hz, B.LAMP);
        if (hh % 5 < 3) set(hx + (a - 1) * (sx !== 0 ? -sx : 1), y0 + 1, hz + (b - 1) * (sz !== 0 ? -sz : 1), B.CRATE);
      } else if (p.kind === 'tower') {
        clear(hx - 3, y0 + 1, hz - 3, hx + 3, y0 + 13, hz + 3);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            pillar(hx + dx, y0 - 1, hz + dz, base);
            for (let yy = y0; yy <= y0 + 8; yy++) {
              set(hx + dx, yy, hz + dz, hash3(seed ^ 0x70e4, hx + dx, yy, hz + dz) % 4 === 0 ? B.COBBLE : B.STONE_BRICKS);
            }
          }
        }
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            set(hx + dx, y0 + 9, hz + dz, B.PLANKS);
            const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            if (edge && (dx + dz) % 2 === 0) set(hx + dx, y0 + 10, hz + dz, post);
          }
        }
        set(hx, y0 + 10, hz, post);
        set(hx, y0 + 11, hz, B.LAMP);
        set(hx + 1, y0 + 10, hz + 1, B.CRATE);
        // батут у подножия — способ запрыгнуть наверх
        pillar(hx + 3, y0, hz, base);
        set(hx + 3, y0 + 1, hz, B.TRAMPOLINE);
      } else {
        clear(hx - a, y0 + 1, hz - b, hx + a, y0 + 4, hz + b);
        for (let dx = -a; dx <= a; dx++) {
          for (let dz = -b; dz <= b; dz++) {
            pillar(hx + dx, y0 - 1, hz + dz, B.DIRT);
            if (Math.abs(dx) === a || Math.abs(dz) === b) set(hx + dx, y0, hz + dz, post);
            else if (dz === 0) set(hx + dx, y0, hz + dz, B.WATER);
            else {
              set(hx + dx, y0, hz + dz, B.DIRT);
              const r = hash3(seed ^ 0xfa12, hx + dx, 3, hz + dz) % 10;
              const crop = r < 4 ? B.BERRY_BUSH : r < 6 ? B.FLOWER_YELLOW : r < 8 ? B.TALLGRASS : 0;
              if (crop) set(hx + dx, y0 + 1, hz + dz, crop);
            }
          }
        }
      }
    }

    return { key, x, z, y: c.h, houses, E: Int32Array.from(E), x0: x - R, z0: z - R, x1: x + R, z1: z + R };
  }

  // Деревня рядом с точкой появления — чтобы её было видно с первых минут.
  function getSpawnVillage() {
    if (spawnVillage !== undefined) return spawnVillage;
    spawnVillage = null;
    const sp = getSpawn();
    for (const tol of [6, 9]) {
      for (let r = 46; r <= 94 && !spawnVillage; r += 16) {
        for (let a = 0; a < 12 && !spawnVillage; a++) {
          const ang = (a * Math.PI) / 6 + (seed & 7);
          const x = sp[0] + Math.round(Math.cos(ang) * r);
          const z = sp[2] + Math.round(Math.sin(ang) * r);
          const c = flat(x, z, tol);
          if (c) spawnVillage = build('spawn', x, z, c, hash2(seed ^ 0x5eed, x, z));
        }
      }
      if (spawnVillage) break;
    }
    return spawnVillage;
  }

  function cellVillage(vx, vz) {
    const k = vx + ',' + vz;
    if (cache.has(k)) return cache.get(k);
    let v = null;
    if (hash2(seed ^ 0x71c9, vx, vz) % 100 < 50) {
      const sv = getSpawnVillage();
      const sp = getSpawn();
      for (let t = 0; t < 3 && !v; t++) {
        const h2 = hash3(seed ^ 0x33aa, vx, t, vz);
        const x = vx * VILLAGE_CELL + (h2 % (MARGIN * 2 + 1)) - MARGIN;
        const z = vz * VILLAGE_CELL + ((h2 >>> 10) % (MARGIN * 2 + 1)) - MARGIN;
        if (sv && Math.hypot(x - sv.x, z - sv.z) < 100) continue;
        if (Math.hypot(x - sp[0], z - sp[2]) < 44) continue;
        const c = flat(x, z, 6);
        if (c) v = build(k, x, z, c, h2);
      }
    }
    if (cache.size > 96) cache.clear();
    cache.set(k, v);
    return v;
  }

  const cellOf = (v) => Math.floor((v + HALF) / VILLAGE_CELL);

  // Деревни, чьи постройки могут попасть в прямоугольник.
  function near(x0, z0, x1, z1) {
    const out = [];
    for (let vx = cellOf(x0 - R); vx <= cellOf(x1 + R); vx++) {
      for (let vz = cellOf(z0 - R); vz <= cellOf(z1 + R); vz++) {
        const v = cellVillage(vx, vz);
        if (v && v.x0 <= x1 && v.x1 >= x0 && v.z0 <= z1 && v.z1 >= z0) out.push(v);
      }
    }
    const sv = getSpawnVillage();
    if (sv && sv.x0 <= x1 && sv.x1 >= x0 && sv.z0 <= z1 && sv.z1 >= z0) out.push(sv);
    return out;
  }

  // Ближайшая деревня в пределах cells клеток от точки.
  function nearest(x, z, cells = 1) {
    let best = getSpawnVillage();
    let bd = best ? Math.hypot(best.x - x, best.z - z) : Infinity;
    const cx = cellOf(x);
    const cz = cellOf(z);
    for (let vx = cx - cells; vx <= cx + cells; vx++) {
      for (let vz = cz - cells; vz <= cz + cells; vz++) {
        const v = cellVillage(vx, vz);
        if (!v) continue;
        const d = Math.hypot(v.x - x, v.z - z);
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
    }
    return best ? { village: best, dist: bd } : null;
  }

  return { near, nearest };
}
