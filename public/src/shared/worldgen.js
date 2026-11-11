// Процедурная генерация мира. Чистая функция от зерна: сервер и клиенты
// получают одинаковый ландшафт, по сети передаются только изменения блоков.
import { CHUNK, HEIGHT, SEA } from './constants.js';
import { B } from './blocks.js';
import { createNoise, hash2, hash3, rnd2, rnd3 } from './noise.js';

export const BIOME = { PLAINS: 0, FOREST: 1, DESERT: 2, SNOW: 3, MOUNTAIN: 4 };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createWorldGen(seed) {
  seed |= 0;
  const nCont = createNoise(seed + 11);
  const nHill = createNoise(seed + 23);
  const nMount = createNoise(seed + 37);
  const nTemp = createNoise(seed + 41);
  const nMoist = createNoise(seed + 53);
  const nCaveA = createNoise(seed + 67);
  const nCaveB = createNoise(seed + 71);
  const nSky = createNoise(seed + 83);
  const nDetail = createNoise(seed + 97);

  function fbm(n, x, z, oct) {
    let a = 1;
    let f = 1;
    let s = 0;
    let m = 0;
    for (let i = 0; i < oct; i++) {
      s += n.n2(x * f, z * f) * a;
      m += a;
      a *= 0.5;
      f *= 2;
    }
    return s / m;
  }

  // Высота и биом колонки.
  function column(x, z) {
    const cont = fbm(nCont, x / 520, z / 520, 3);
    const hills = fbm(nHill, x / 110, z / 110, 4);
    const mMask = smooth(0.12, 0.5, nMount.n2(x / 650, z / 650));
    const ridge = 1 - Math.abs(nMount.n2(x / 240 + 50, z / 240 - 50));
    const temp = nTemp.n2(x / 480, z / 480);
    const moist = nMoist.n2(x / 380, z / 380);
    let h = SEA + 5 + cont * 16 + hills * (5 + mMask * 8) + mMask * ridge * ridge * 46;
    h = Math.max(4, Math.min(HEIGHT - 26, Math.floor(h)));
    let biome;
    if (mMask > 0.45 && h > SEA + 22) biome = BIOME.MOUNTAIN;
    else if (temp < -0.32) biome = BIOME.SNOW;
    else if (temp > 0.36 && moist < 0.1) biome = BIOME.DESERT;
    else if (moist > 0.12) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    return { h, biome };
  }

  function isCave(x, y, z, h) {
    if (y < 3) return false;
    if (h <= SEA + 1 && y > h - 7) return false; // не протекаем под водоёмами
    const a = nCaveA.n3(x / 52, y / 34, z / 52);
    const b = nCaveB.n3(x / 52, y / 34, z / 52);
    const thr = y > h - 3 ? 0.0035 : 0.0075;
    if (a * a + b * b < thr) return true;
    if (y < 30 && y < h - 8) {
      const c = nCaveA.n3(x / 84 + 300, y / 44, z / 84 - 300);
      if (c > 0.66) return true;
    }
    return false;
  }

  function topBlock(biome, h) {
    if (h < SEA) return B.SAND;
    if (biome === BIOME.MOUNTAIN) return h > SEA + 52 ? B.SNOW : h > SEA + 36 ? B.STONE : B.GRASS;
    if (biome === BIOME.SNOW) return B.SNOW;
    if (h <= SEA + 1) return B.SAND;
    if (biome === BIOME.DESERT) return B.SAND;
    return B.GRASS;
  }

  function generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const hs = new Int16Array(CHUNK * CHUNK);
    const bs = new Uint8Array(CHUNK * CHUNK);

    const put = (wx, y, wz, id, onlyAir) => {
      const lx = wx - x0;
      const lz = wz - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 1 || y >= HEIGHT - 2) return;
      const i = lx + lz * CHUNK + y * 256;
      if (onlyAir && data[i] !== 0) return;
      data[i] = id;
    };

    // --- рельеф, пещеры, вода ---
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const col = column(wx, wz);
        const h = col.h;
        const biome = col.biome;
        const ci = lx + lz * CHUNK;
        hs[ci] = h;
        bs[ci] = biome;
        const top = topBlock(biome, h);
        let filler = B.DIRT;
        if (top === B.SAND) filler = B.SAND;
        else if (top === B.STONE) filler = B.STONE;
        const gravel = h < SEA - 2 && nDetail.n2(wx / 22, wz / 22) > 0.35;
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < 3 && hash3(seed, wx, y, wz) % (y + 1) === 0) id = B.BEDROCK;
          else if (y === h) id = gravel ? B.GRAVEL : top;
          else if (y >= h - 3) id = gravel ? B.GRAVEL : filler;
          else if (biome === BIOME.DESERT && y >= h - 7) id = B.SANDSTONE;
          else id = B.STONE;
          if (id !== B.BEDROCK && isCave(wx, y, wz, h)) id = 0;
          data[ci + y * 256] = id;
        }
        for (let y = h + 1; y <= SEA; y++) {
          data[ci + y * 256] = y === SEA && biome === BIOME.SNOW ? B.ICE : B.WATER;
        }

        // --- небесные острова ---
        const m = nSky.n2(wx / 240, wz / 240);
        if (m > 0.5) {
          const thick = Math.min(15, (m - 0.5) * 95) * (0.7 + 0.3 * nDetail.n2(wx / 9, wz / 9));
          if (thick >= 1) {
            const topY = 108 + Math.floor(nDetail.n2(wx / 45 + 7, wz / 45 - 7) * 3);
            const botY = Math.max(h + 6, Math.floor(topY - thick));
            for (let y = botY; y <= topY; y++) {
              let id = y === topY ? B.SKYMOSS : B.SKYSTONE;
              if (y < topY - 1 && hash3(seed ^ 0x77, wx, y, wz) % 100 < 5) id = B.CRYSTAL_ORE;
              data[ci + y * 256] = id;
            }
            if (botY <= topY) {
              const r = rnd2(seed ^ 0x1234, wx, wz);
              if (r < 0.02) data[ci + (topY + 1) * 256] = B.GLOWSHROOM;
              else if (r < 0.05) data[ci + (topY + 1) * 256] = B.FLOWER_YELLOW;
              else if (r < 0.14) data[ci + (topY + 1) * 256] = B.TALLGRASS;
            }
          }
        }
      }
    }

    // --- рудные жилы (сетка 8x8x8, детерминированы по хешу) ---
    const V = 8;
    for (let vx = Math.floor((x0 - 5) / V); vx <= Math.floor((x0 + CHUNK + 4) / V); vx++) {
      for (let vz = Math.floor((z0 - 5) / V); vz <= Math.floor((z0 + CHUNK + 4) / V); vz++) {
        for (let vy = 0; vy < 11; vy++) {
          const hsh = hash3(seed ^ 0xa5a5, vx, vy, vz);
          const r = (hsh & 0xffff) / 65536;
          let ox = vx * V + ((hsh >>> 16) & 7);
          let oy = vy * V + ((hsh >>> 19) & 7);
          let oz = vz * V + ((hsh >>> 22) & 7);
          let ore = 0;
          let n = 0;
          if (oy < 18 && r > 0.93) {
            ore = B.CRYSTAL_ORE;
            n = 4;
          } else if (oy < 50 && r > 0.8) {
            ore = B.COPPER_ORE;
            n = 6;
          } else if (r > 0.52) {
            ore = B.COAL_ORE;
            n = 8;
          }
          if (!ore) continue;
          for (let i = 0; i < n; i++) {
            const lx = ox - x0;
            const lz = oz - z0;
            if (lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK && oy > 0 && oy < HEIGHT) {
              const di = lx + lz * CHUNK + oy * 256;
              if (data[di] === B.STONE) data[di] = ore;
            }
            const st = hash3(hsh, i, 7, 13) % 6;
            if (st === 0) ox++;
            else if (st === 1) ox--;
            else if (st === 2) oy++;
            else if (st === 3) oy--;
            else if (st === 4) oz++;
            else oz--;
          }
        }
      }
    }

    // --- деревья (сетка с разбросом, чтобы кроны переходили через границы чанков) ---
    const T = 5;
    for (let gx = Math.floor((x0 - 3) / T); gx <= Math.floor((x0 + CHUNK + 2) / T); gx++) {
      for (let gz = Math.floor((z0 - 3) / T); gz <= Math.floor((z0 + CHUNK + 2) / T); gz++) {
        const hsh = hash2(seed ^ 0x7ee5, gx, gz);
        const tx = gx * T + (hsh % T);
        const tz = gz * T + ((hsh >>> 8) % T);
        const r = ((hsh >>> 16) & 0xffff) / 65536;
        const col = column(tx, tz);
        const h = col.h;
        if (h <= SEA + 1) continue;
        let density = 0;
        if (col.biome === BIOME.FOREST) density = 0.6;
        else if (col.biome === BIOME.PLAINS) density = 0.05;
        else if (col.biome === BIOME.SNOW) density = 0.18;
        else if (col.biome === BIOME.MOUNTAIN && h < SEA + 36) density = 0.08;
        if (r >= density) continue;
        if (isCave(tx, h, tz, h)) continue;
        const v = hash2(seed ^ 0x3131, tx, tz);
        if (col.biome === BIOME.SNOW) {
          // ель: чередующиеся кольца хвои
          const th = 6 + (v % 3);
          const topY = h + th;
          for (let y = h + 1; y <= topY; y++) put(tx, y, tz, B.PINE_LOG, false);
          put(tx, topY + 1, tz, B.PINE_LEAVES, true);
          for (let y = topY; y >= h + 3; y--) {
            const d = topY - y;
            let rad = Math.min(3, 1 + (d >> 1));
            if (d & 1) rad = Math.max(1, rad - 1);
            for (let dx = -rad; dx <= rad; dx++) {
              for (let dz = -rad; dz <= rad; dz++) {
                if (Math.abs(dx) + Math.abs(dz) > rad + 1) continue;
                if (dx === 0 && dz === 0) continue;
                put(tx + dx, y, tz + dz, B.PINE_LEAVES, true);
              }
            }
          }
        } else {
          // лиственное дерево с округлой кроной
          const th = 4 + (v % 3);
          const cy = h + th;
          for (let y = h + 1; y <= cy; y++) put(tx, y, tz, B.LOG, false);
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                const d2 = dx * dx + dy * dy * 1.4 + dz * dz;
                const lim = 4.6 + rnd3(v, dx, dy, dz) * 1.6;
                if (d2 <= lim) put(tx + dx, cy + dy, tz + dz, B.LEAVES, true);
              }
            }
          }
        }
      }
    }

    // --- растения и светогрибы ---
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const ci = lx + lz * CHUNK;
        const h = hs[ci];
        const wx = x0 + lx;
        const wz = z0 + lz;
        const ground = data[ci + h * 256];
        if (h > SEA && h < HEIGHT - 3 && data[ci + (h + 1) * 256] === 0) {
          const r = rnd2(seed ^ 0x51ab, wx, wz);
          const biome = bs[ci];
          let id = 0;
          if (ground === B.GRASS) {
            if (biome === BIOME.FOREST) {
              if (r < 0.07) id = B.TALLGRASS;
              else if (r < 0.08) id = B.BERRY_BUSH;
              else if (r < 0.09) id = B.FLOWER_RED;
            } else {
              if (r < 0.13) id = B.TALLGRASS;
              else if (r < 0.145) id = B.FLOWER_RED;
              else if (r < 0.16) id = B.FLOWER_YELLOW;
              else if (r < 0.163) id = B.BERRY_BUSH;
            }
          } else if (ground === B.SAND && biome === BIOME.DESERT) {
            if (r < 0.012) id = B.DRYBUSH;
          }
          if (id) data[ci + (h + 1) * 256] = id;
        }
        const lim = Math.min(h - 5, 44);
        for (let y = 4; y < lim; y++) {
          const di = ci + y * 256;
          if (data[di] === 0 && data[di - 256] === B.STONE && hash3(seed ^ 0x6106, wx, y, wz) % 100 < 3) {
            data[di] = B.GLOWSHROOM;
          }
        }
      }
    }
    return data;
  }

  // Подходящее место для появления: суша недалеко от начала координат.
  function findSpawn() {
    for (let r = 0; r < 400; r += 4) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos((a * Math.PI) / 4) * r);
        const z = Math.round(Math.sin((a * Math.PI) / 4) * r);
        const c = column(x, z);
        if (c.h > SEA + 1 && c.h < SEA + 30 && c.biome !== BIOME.MOUNTAIN) return [x, c.h, z];
      }
    }
    return [0, column(0, 0).h, 0];
  }

  return { seed, column, generateChunk, findSpawn };
}
