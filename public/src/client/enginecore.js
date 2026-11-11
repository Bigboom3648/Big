// Ядро чанков: генерация, освещение и построение геометрии.
// Работает в воркере (или в основном потоке, если воркеры недоступны).
import { CHUNK, HEIGHT } from '../shared/constants.js';
import { OPAQUE, EMIT, LOPAC, SHAPE, RENDER, CULLSAME, TILE, B } from '../shared/blocks.js';
import { createWorldGen } from '../shared/worldgen.js';

const PAD = 16; // запас вокруг чанка для распространения света
const RW = CHUNK + PAD * 2;
const SY = RW * RW;
const CELLS = SY * HEIGHT;

const rb = new Uint8Array(CELLS); // блоки области 3x3 чанка
const sky = new Uint8Array(CELLS); // свет неба
const blk = new Uint8Array(CELLS); // свет от блоков
const QM = (1 << 21) - 1;
const Q = new Int32Array(QM + 1);

// Грани: +X, -X, +Y, -Y, +Z, -Z. Углы — против часовой стрелки снаружи.
const FACE_N = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_C = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const UV = [0, 1, 1, 1, 1, 0, 0, 0];
const FACE_SHADE = [0.8, 0.8, 1, 0.52, 0.66, 0.66];
const AO_F = [0.48, 0.66, 0.84, 1];
const NOFF = new Int32Array(6);
// Для каждой грани и угла: смещения соседней клетки, двух боковых и угловой.
const AOOFF = new Int32Array(6 * 4 * 3);
for (let f = 0; f < 6; f++) {
  const n = FACE_N[f];
  NOFF[f] = n[0] + n[2] * RW + n[1] * SY;
  const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
  const o = [0, 1, 2].filter((a) => a !== axis);
  for (let k = 0; k < 4; k++) {
    const c = FACE_C[f][k];
    const s1 = [0, 0, 0];
    const s2 = [0, 0, 0];
    s1[o[0]] = c[o[0]] ? 1 : -1;
    s2[o[1]] = c[o[1]] ? 1 : -1;
    const idx = (v) => v[0] + v[2] * RW + v[1] * SY;
    AOOFF[(f * 4 + k) * 3] = NOFF[f] + idx(s1);
    AOOFF[(f * 4 + k) * 3 + 1] = NOFF[f] + idx(s2);
    AOOFF[(f * 4 + k) * 3 + 2] = NOFF[f] + idx(s1) + idx(s2);
  }
}

class MeshBuf {
  constructor() {
    this.cap = 4096;
    this.pos = new Float32Array(this.cap * 3);
    this.uvl = new Float32Array(this.cap * 3);
    this.light = new Uint8Array(this.cap * 4);
    this.idx = new Uint32Array(this.cap * 6);
    this.nv = 0;
    this.ni = 0;
  }
  reset() {
    this.nv = 0;
    this.ni = 0;
  }
  ensure(nVerts) {
    if (this.nv + nVerts <= this.cap) return;
    let cap = this.cap;
    while (this.nv + nVerts > cap) cap *= 2;
    const grow = (old, T, n) => {
      const a = new T(cap * n);
      a.set(old);
      return a;
    };
    this.pos = grow(this.pos, Float32Array, 3);
    this.uvl = grow(this.uvl, Float32Array, 3);
    this.light = grow(this.light, Uint8Array, 4);
    this.idx = grow(this.idx, Uint32Array, 6);
    this.cap = cap;
  }
  take() {
    return {
      pos: this.pos.slice(0, this.nv * 3),
      uvl: this.uvl.slice(0, this.nv * 3),
      light: this.light.slice(0, this.nv * 4),
      idx: this.idx.slice(0, this.ni),
    };
  }
}

const bufO = new MeshBuf();
const bufT = new MeshBuf();
const vs = new Float32Array(4);
const vb = new Float32Array(4);
const va = new Uint8Array(4);

export function createEngine(post) {
  let gen = null;
  const chunks = new Map();
  const key = (cx, cz) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);

  function topOf(data) {
    for (let i = data.length - 1; i >= 0; i--) if (data[i] !== 0) return i >> 8;
    return 0;
  }

  function doGen(m) {
    const data = gen.generateChunk(m.cx, m.cz);
    const e = m.edits;
    if (e) for (let i = 0; i + 1 < e.length; i += 2) data[e[i]] = e[i + 1];
    chunks.set(key(m.cx, m.cz), { data, top: topOf(data) });
    const copy = data.slice();
    post({ t: 'chunk', cx: m.cx, cz: m.cz, rev: m.rev, data: copy }, [copy.buffer]);
  }

  function doSet(m) {
    const c = chunks.get(key(m.x >> 4, m.z >> 4));
    if (!c) return;
    c.data[(m.x & 15) + ((m.z & 15) << 4) + (m.y << 8)] = m.id;
    if (m.id !== 0 && m.y > c.top) c.top = m.y;
  }

  function spread(light, qh, qt, H) {
    while (qh !== qt) {
      const i = Q[qh];
      qh = (qh + 1) & QM;
      const l = light[i];
      if (l <= 1) continue;
      const x = i % RW;
      const z = ((i / RW) | 0) % RW;
      const y = (i / SY) | 0;
      for (let d = 0; d < 6; d++) {
        let n;
        if (d === 0) {
          if (x === RW - 1) continue;
          n = i + 1;
        } else if (d === 1) {
          if (x === 0) continue;
          n = i - 1;
        } else if (d === 2) {
          if (y >= H - 1) continue;
          n = i + SY;
        } else if (d === 3) {
          if (y === 0) continue;
          n = i - SY;
        } else if (d === 4) {
          if (z === RW - 1) continue;
          n = i + RW;
        } else {
          if (z === 0) continue;
          n = i - RW;
        }
        const id = rb[n];
        if (OPAQUE[id]) continue;
        const nl = l - 1 - LOPAC[id];
        if (nl > light[n]) {
          light[n] = nl;
          Q[qt] = n;
          qt = (qt + 1) & QM;
        }
      }
    }
  }

  function doMesh(m) {
    const { cx, cz } = m;
    // --- собираем область 3x3 ---
    let maxTop = 0;
    const nb = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = chunks.get(key(cx + dx, cz + dz)) || null;
        nb.push(c);
        if (c && c.top > maxTop) maxTop = c.top;
      }
    }
    const H = Math.min(HEIGHT, maxTop + 2);
    for (let j = 0; j < 9; j++) {
      const c = nb[j];
      const ox = (j % 3) * CHUNK;
      const oz = ((j / 3) | 0) * CHUNK;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < CHUNK; z++) {
          const dst = (y * RW + z + oz) * RW + ox;
          if (c) {
            const src = (y << 8) + (z << 4);
            rb.set(c.data.subarray(src, src + CHUNK), dst);
          } else rb.fill(0, dst, dst + CHUNK);
        }
      }
    }
    const N = H * SY;
    sky.fill(0, 0, N);
    blk.fill(0, 0, N);

    // --- свет неба: прямые лучи сверху ---
    for (let z = 0; z < RW; z++) {
      for (let x = 0; x < RW; x++) {
        let l = 15;
        let i = (H - 1) * SY + z * RW + x;
        for (let y = H - 1; y >= 0; y--, i -= SY) {
          const id = rb[i];
          if (OPAQUE[id]) break;
          l -= LOPAC[id];
          if (l <= 0) break;
          sky[i] = l;
        }
      }
    }
    // затравки для заливки: освещённые клетки рядом с более тёмными
    let qt = 0;
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < RW; z++) {
        let i = (y * RW + z) * RW;
        for (let x = 0; x < RW; x++, i++) {
          const l = sky[i];
          if (l < 2) continue;
          const t = l - 1;
          if (
            (x > 0 && sky[i - 1] < t && !OPAQUE[rb[i - 1]]) ||
            (x < RW - 1 && sky[i + 1] < t && !OPAQUE[rb[i + 1]]) ||
            (z > 0 && sky[i - RW] < t && !OPAQUE[rb[i - RW]]) ||
            (z < RW - 1 && sky[i + RW] < t && !OPAQUE[rb[i + RW]])
          ) {
            Q[qt] = i;
            qt = (qt + 1) & QM;
          }
        }
      }
    }
    spread(sky, 0, qt, H);

    // --- свет блоков ---
    qt = 0;
    for (let i = 0; i < N; i++) {
      const e = EMIT[rb[i]];
      if (e) {
        blk[i] = e;
        Q[qt] = i;
        qt = (qt + 1) & QM;
      }
    }
    spread(blk, 0, qt, H);

    // --- геометрия ---
    bufO.reset();
    bufT.reset();
    const top = new Uint8Array(CHUNK * CHUNK);
    const topY = new Uint8Array(CHUNK * CHUNK);
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        let i = (H - 1) * SY + (z + PAD) * RW + x + PAD;
        for (let y = H - 1; y >= 0; y--, i -= SY) {
          const id = rb[i];
          if (id !== 0 && SHAPE[id] === 0) {
            top[x + z * CHUNK] = id;
            topY[x + z * CHUNK] = y;
            break;
          }
        }
      }
    }

    for (let y = 1; y < H; y++) {
      for (let z = 0; z < CHUNK; z++) {
        let i = (y * RW + z + PAD) * RW + PAD;
        for (let x = 0; x < CHUNK; x++, i++) {
          const id = rb[i];
          if (id === 0) continue;
          const emit = EMIT[id];
          if (SHAPE[id] === 1) {
            // растение: два скрещённых квадрата, видимых с обеих сторон
            const b = bufO;
            b.ensure(16);
            const layer = TILE[id * 3 + 1];
            const s = sky[i] * 17;
            const bl = Math.max(blk[i], emit) * 17;
            const a = 0.14;
            const c = 0.86;
            const quads = [
              [a, a, c, c],
              [c, c, a, a],
              [a, c, c, a],
              [c, a, a, c],
            ];
            for (const q of quads) {
              const v0 = b.nv;
              const px = [q[0], q[2], q[2], q[0]];
              const pz = [q[1], q[3], q[3], q[1]];
              const py = [0, 0, 1, 1];
              for (let k = 0; k < 4; k++) {
                const p = b.nv * 3;
                b.pos[p] = x + px[k];
                b.pos[p + 1] = y + py[k];
                b.pos[p + 2] = z + pz[k];
                b.uvl[p] = UV[k * 2];
                b.uvl[p + 1] = UV[k * 2 + 1];
                b.uvl[p + 2] = layer;
                const li = b.nv * 4;
                b.light[li] = s;
                b.light[li + 1] = bl;
                b.light[li + 2] = 235;
                b.light[li + 3] = 0;
                b.nv++;
              }
              b.idx[b.ni++] = v0;
              b.idx[b.ni++] = v0 + 1;
              b.idx[b.ni++] = v0 + 2;
              b.idx[b.ni++] = v0;
              b.idx[b.ni++] = v0 + 2;
              b.idx[b.ni++] = v0 + 3;
            }
            continue;
          }
          const opaque = OPAQUE[id];
          const cull = CULLSAME[id];
          const isWater = id === B.WATER;
          const b = RENDER[id] === 2 ? bufT : bufO;
          const lowTop = isWater && rb[i + SY] !== B.WATER;
          for (let f = 0; f < 6; f++) {
            const ni = i + NOFF[f];
            const nid = rb[ni];
            if (nid !== 0) {
              if (OPAQUE[nid]) continue;
              if (cull && nid === id) continue;
              if (!opaque && !cull && nid === id && f % 2 === 1) continue; // листва: внутренние грани через одну
            }
            b.ensure(4);
            // плавный свет и затенение углов
            for (let k = 0; k < 4; k++) {
              const o = (f * 4 + k) * 3;
              const s1 = i + AOOFF[o];
              const s2 = i + AOOFF[o + 1];
              const cr = i + AOOFF[o + 2];
              const o1 = OPAQUE[rb[s1]];
              const o2 = OPAQUE[rb[s2]];
              const oc = OPAQUE[rb[cr]];
              let s = sky[ni];
              let l = blk[ni];
              let n = 1;
              if (!o1) {
                s += sky[s1];
                l += blk[s1];
                n++;
              }
              if (!o2) {
                s += sky[s2];
                l += blk[s2];
                n++;
              }
              if (!(o1 && o2) && !oc) {
                s += sky[cr];
                l += blk[cr];
                n++;
              }
              vs[k] = s / n;
              vb[k] = l / n;
              va[k] = o1 && o2 ? 0 : 3 - o1 - o2 - oc;
            }
            const layer = TILE[id * 3 + (f === 2 ? 0 : f === 3 ? 2 : 1)];
            const shade = FACE_SHADE[f];
            const v0 = b.nv;
            const corners = FACE_C[f];
            for (let k = 0; k < 4; k++) {
              const c = corners[k];
              const p = b.nv * 3;
              b.pos[p] = x + c[0];
              b.pos[p + 1] = y + (lowTop && c[1] === 1 ? 0.875 : c[1]);
              b.pos[p + 2] = z + c[2];
              b.uvl[p] = UV[k * 2];
              b.uvl[p + 1] = UV[k * 2 + 1];
              b.uvl[p + 2] = layer;
              const li = b.nv * 4;
              b.light[li] = vs[k] * 17;
              b.light[li + 1] = Math.max(vb[k], emit) * 17;
              b.light[li + 2] = shade * AO_F[va[k]] * 255;
              b.light[li + 3] = isWater ? 255 : 0;
              b.nv++;
            }
            if (va[0] + va[2] >= va[1] + va[3]) {
              b.idx[b.ni++] = v0;
              b.idx[b.ni++] = v0 + 1;
              b.idx[b.ni++] = v0 + 2;
              b.idx[b.ni++] = v0;
              b.idx[b.ni++] = v0 + 2;
              b.idx[b.ni++] = v0 + 3;
            } else {
              b.idx[b.ni++] = v0 + 1;
              b.idx[b.ni++] = v0 + 2;
              b.idx[b.ni++] = v0 + 3;
              b.idx[b.ni++] = v0 + 1;
              b.idx[b.ni++] = v0 + 3;
              b.idx[b.ni++] = v0;
            }
          }
        }
      }
    }

    const o = bufO.take();
    const t = bufT.take();
    post({ t: 'mesh', cx, cz, o, tr: t, top, topY, h: H }, [
      o.pos.buffer,
      o.uvl.buffer,
      o.light.buffer,
      o.idx.buffer,
      t.pos.buffer,
      t.uvl.buffer,
      t.light.buffer,
      t.idx.buffer,
      top.buffer,
      topY.buffer,
    ]);
  }

  function handle(m) {
    switch (m.t) {
      case 'init':
        gen = createWorldGen(m.seed);
        chunks.clear();
        break;
      case 'gen':
        doGen(m);
        break;
      case 'mesh':
        doMesh(m);
        break;
      case 'set':
        doSet(m);
        break;
      case 'drop':
        chunks.delete(key(m.cx, m.cz));
        break;
      default:
        break;
    }
  }

  return { handle };
}
