// Клиентский мир: подгрузка чанков вокруг игрока, очередь заданий воркеру,
// хранение блоков для физики и построение мешей.
import * as THREE from './three.js';
import { CHUNK, HEIGHT } from '../shared/constants.js';
import { B, LIQUID } from '../shared/blocks.js';

const ckey = (cx, cz) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);

// Обёртка над воркером с запасным вариантом в основном потоке.
class EngineProxy {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.worker = null;
    this.inline = null;
    this.queue = [];
    this.out = [];
    this.ready = this.start();
  }

  async start() {
    try {
      await new Promise((resolve, reject) => {
        const w = new Worker(new URL('./chunkworker.js', import.meta.url), { type: 'module' });
        const timer = setTimeout(() => reject(new Error('timeout')), 6000);
        w.onerror = () => {
          clearTimeout(timer);
          reject(new Error('worker failed'));
        };
        w.onmessage = (e) => {
          if (e.data.t !== 'ready') return;
          clearTimeout(timer);
          w.onerror = null;
          w.onmessage = (ev) => this.onMessage(ev.data);
          this.worker = w;
          resolve();
        };
      });
      for (const m of this.queue) this.worker.postMessage(m);
      this.queue.length = 0;
    } catch {
      const { createEngine } = await import('./enginecore.js');
      this.inline = createEngine((m) => this.out.push(m));
      const run = () => {
        const t0 = performance.now();
        while (this.queue.length && performance.now() - t0 < 7) this.inline.handle(this.queue.shift());
        while (this.out.length) this.onMessage(this.out.shift());
        setTimeout(run, this.queue.length ? 0 : 10);
      };
      run();
    }
  }

  post(m) {
    if (this.worker) this.worker.postMessage(m);
    else this.queue.push(m);
  }
}

export class World {
  constructor(game) {
    this.game = game;
    this.chunks = new Map();
    this.order = [];
    this.prio = [];
    this.jobs = 0;
    this.maxJobs = 3;
    this.renderDist = 7;
    this.pcx = 1e9;
    this.pcz = 1e9;
    this.orderDirty = true;
    this.group = new THREE.Group();
    this.engine = new EngineProxy((m) => this.onEngine(m));
    this.meshedCount = 0;
    this.mapDirty = true;
    this.rev = 0;
  }

  init(seed) {
    this.engine.post({ t: 'init', seed });
  }

  setRenderDist(r) {
    this.renderDist = r;
    this.orderDirty = true;
  }

  chunkAt(x, z) {
    return this.chunks.get(ckey(x >> 4, z >> 4));
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c || !c.data) return 0;
    return c.data[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  hasData(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return !!(c && c.data);
  }

  hasMesh(x, z) {
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return !!(c && c.hasMesh);
  }

  // Изменение блока (своё или пришедшее по сети).
  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c) return;
    if (!c.data) {
      if (c.state >= 2) c.pending.push(x, y, z, id);
      return;
    }
    const i = (x & 15) + ((z & 15) << 4) + (y << 8);
    if (c.data[i] === id) return;
    c.data[i] = id;
    this.engine.post({ t: 'set', x, y, z, id });
    this.markDirty(c, x & 15, z & 15);
  }

  markDirty(c, lx, lz) {
    c.dirty = true;
    this.pushPrio(c);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
        if (!n || n.state !== 4) continue;
        n.dirty = true;
        const nearX = dx === 0 || (dx < 0 ? lx === 0 : lx === 15);
        const nearZ = dz === 0 || (dz < 0 ? lz === 0 : lz === 15);
        if (nearX && nearZ) this.pushPrio(n);
      }
    }
  }

  pushPrio(c) {
    if (!c.inPrio) {
      c.inPrio = true;
      this.prio.push(c);
    }
  }

  // Ответ сервера: правки блоков для запрошенных чанков.
  onChunkEdits(list) {
    for (const [cx, cz, edits] of list) {
      const c = this.chunks.get(ckey(cx, cz));
      if (!c || c.state !== 1) continue;
      c.edits = edits;
      c.pending.length = 0;
      c.state = 2;
    }
  }

  rebuildOrder(cx, cz) {
    this.pcx = cx;
    this.pcz = cz;
    this.orderDirty = false;
    const R = this.renderDist;
    const dataR2 = (R + 1.5) * (R + 1.5);
    const visR2 = (R + 0.5) * (R + 0.5);
    const order = [];
    for (let dz = -R - 2; dz <= R + 2; dz++) {
      for (let dx = -R - 2; dx <= R + 2; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > dataR2) continue;
        const k = ckey(cx + dx, cz + dz);
        let c = this.chunks.get(k);
        if (!c) {
          c = {
            cx: cx + dx,
            cz: cz + dz,
            key: k,
            data: null,
            state: 0, // 0 новый, 1 запрошены правки, 2 правки получены, 3 генерируется, 4 готов
            edits: null,
            pending: [],
            dirty: true,
            meshing: false,
            hasMesh: false,
            inPrio: false,
            vis: false,
            d2: 0,
            meshO: null,
            meshT: null,
            top: null,
            topY: null,
          };
          this.chunks.set(k, c);
        }
        c.d2 = d2;
        c.vis = d2 <= visR2;
        order.push(c);
      }
    }
    order.sort((a, b) => a.d2 - b.d2);
    this.order = order;
    const lim = R + 4;
    for (const c of this.chunks.values()) {
      if (Math.abs(c.cx - cx) > lim || Math.abs(c.cz - cz) > lim) this.unload(c);
    }
  }

  unload(c) {
    this.chunks.delete(c.key);
    if (c.meshO) {
      this.group.remove(c.meshO);
      c.meshO.geometry.dispose();
    }
    if (c.meshT) {
      this.group.remove(c.meshT);
      c.meshT.geometry.dispose();
    }
    if (c.hasMesh) this.meshedCount--;
    if (c.state >= 3) this.engine.post({ t: 'drop', cx: c.cx, cz: c.cz });
    this.mapDirty = true;
  }

  canMesh(c) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
        if (!n || n.state !== 4) return false;
      }
    }
    return true;
  }

  sendMesh(c) {
    c.dirty = false;
    c.meshing = true;
    this.jobs++;
    this.engine.post({ t: 'mesh', cx: c.cx, cz: c.cz });
  }

  update(px, pz) {
    const cx = Math.floor(px) >> 4;
    const cz = Math.floor(pz) >> 4;
    if (cx !== this.pcx || cz !== this.pcz || this.orderDirty) this.rebuildOrder(cx, cz);

    const req = [];
    for (const c of this.order) {
      if (c.state === 0) {
        c.state = 1;
        req.push([c.cx, c.cz]);
        if (req.length >= 96) break;
      }
    }
    if (req.length) this.game.net.send({ t: 'cr', c: req });

    while (this.jobs < this.maxJobs + 1 && this.prio.length) {
      const c = this.prio.shift();
      c.inPrio = false;
      if (!this.chunks.has(c.key) || !c.dirty || c.meshing) continue;
      if (c.state === 4 && this.canMesh(c)) this.sendMesh(c);
    }
    if (this.jobs >= this.maxJobs) return;
    for (const c of this.order) {
      if (this.jobs >= this.maxJobs) break;
      if (c.state === 2) {
        c.state = 3;
        this.jobs++;
        c.rev = ++this.rev;
        this.engine.post({ t: 'gen', cx: c.cx, cz: c.cz, rev: c.rev, edits: c.edits });
        c.edits = null;
      } else if (c.state === 4 && c.dirty && !c.meshing && c.vis && this.canMesh(c)) {
        this.sendMesh(c);
      }
    }
  }

  onEngine(m) {
    if (m.t === 'chunk') {
      this.jobs--;
      const c = this.chunks.get(ckey(m.cx, m.cz));
      if (!c) {
        this.engine.post({ t: 'drop', cx: m.cx, cz: m.cz });
        return;
      }
      if (c.state !== 3 || c.rev !== m.rev) return; // устаревший ответ для пересозданного чанка
      c.data = m.data;
      c.state = 4;
      const p = c.pending;
      for (let i = 0; i < p.length; i += 4) {
        c.data[(p[i] & 15) + ((p[i + 2] & 15) << 4) + (p[i + 1] << 8)] = p[i + 3];
        this.engine.post({ t: 'set', x: p[i], y: p[i + 1], z: p[i + 2], id: p[i + 3] });
      }
      p.length = 0;
    } else if (m.t === 'mesh') {
      this.jobs--;
      const c = this.chunks.get(ckey(m.cx, m.cz));
      if (!c) return;
      c.meshing = false;
      c.top = m.top;
      c.topY = m.topY;
      const mats = this.game.renderer.mats;
      c.meshO = this.buildMesh(c, c.meshO, m.o, mats.opaque, m.h, 0);
      c.meshT = this.buildMesh(c, c.meshT, m.tr, mats.blend, m.h, 1);
      if (!c.hasMesh) {
        c.hasMesh = true;
        this.meshedCount++;
      }
      this.mapDirty = true;
    }
  }

  buildMesh(c, old, d, material, h, order) {
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
    }
    if (!d.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('uvl', new THREE.BufferAttribute(d.uvl, 3));
    g.setAttribute('light', new THREE.BufferAttribute(d.light, 4, true));
    g.setIndex(new THREE.BufferAttribute(d.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, h / 2, 8), Math.sqrt(128 + (h * h) / 4));
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = order;
    this.group.add(mesh);
    return mesh;
  }

  // Луч по вокселям (алгоритм Аманатидеса — Ву). fluids — останавливаться ли на воде и лаве.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, fluids = false) {
    let x = Math.floor(ox);
    let y = Math.floor(oy);
    let z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && (fluids || !LIQUID[id])) return { x, y, z, nx, ny, nz, id, dist: t };
      if (tmx < tmy && tmx < tmz) {
        x += sx;
        t = tmx;
        tmx += tdx;
        nx = -sx;
        ny = 0;
        nz = 0;
      } else if (tmy < tmz) {
        y += sy;
        t = tmy;
        tmy += tdy;
        nx = 0;
        ny = -sy;
        nz = 0;
      } else {
        z += sz;
        t = tmz;
        tmz += tdz;
        nx = 0;
        ny = 0;
        nz = -sz;
      }
    }
    return null;
  }
}
