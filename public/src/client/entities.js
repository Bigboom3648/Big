// Существа и эффекты: другие игроки, мобы, частицы, выделение блока,
// трещины, верёвка крюка и предмет в руке.
import * as THREE from './three.js';
import { BLOCKS, ITEMS, isBlock } from '../shared/blocks.js';

const tmpColor = new THREE.Color();

function nameSprite(text, color) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = 'bold 30px system-ui, "Segoe UI", sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w;
  c.height = 44;
  g.font = font;
  g.fillStyle = 'rgba(12,14,24,0.6)';
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(0, 0, w, 44, 12);
    g.fill();
  } else g.fillRect(0, 0, w, 44);
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, 12, 23);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true, fog: false }),
  );
  s.scale.set((w / 44) * 0.3, 0.3, 1);
  return s;
}

// Игрок: «капсульный» человечек с колпаком цвета игрока. Смотрит в -Z.
class RemotePlayer {
  constructor(info) {
    this.id = info.id;
    this.name = info.name;
    this.color = info.color;
    this.group = new THREE.Group();
    this.target = new THREE.Vector3(info.p[0], info.p[1], info.p[2]);
    this.group.position.copy(this.target);
    this.yaw = 0;
    this.pitch = 0;
    this.phase = 0;
    const col = new THREE.Color(info.color);
    const bodyMat = new THREE.MeshLambertMaterial({ color: col });
    const darkMat = new THREE.MeshLambertMaterial({ color: col.clone().multiplyScalar(0.5) });
    const skin = new THREE.MeshLambertMaterial({ color: 0xf2d6b8 });
    const visor = new THREE.MeshLambertMaterial({ color: 0x1b2333 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 4, 10), bodyMat);
    body.position.y = 0.76;
    this.head = new THREE.Group();
    this.head.position.y = 1.42;
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), skin));
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.14), visor);
    v.position.set(0, 0.03, -0.19);
    this.head.add(v);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 10), bodyMat);
    hat.position.y = 0.33;
    this.head.add(hat);
    const hand = () => new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), skin);
    this.handL = hand();
    this.handR = hand();
    const foot = () => new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.28), darkMat);
    this.footL = foot();
    this.footR = foot();
    this.group.add(body, this.head, this.handL, this.handR, this.footL, this.footR);
    this.tag = nameSprite(info.name, info.color);
    this.tag.position.y = 2.1;
    this.group.add(this.tag);
    this.pose(0);
  }

  pose(s) {
    this.handL.position.set(-0.4, 0.82, -s * 0.22);
    this.handR.position.set(0.4, 0.82, s * 0.22);
    this.footL.position.set(-0.14, 0.07, s * 0.2);
    this.footR.position.set(0.14, 0.07, -s * 0.2);
  }

  update(dt) {
    const p = this.group.position;
    const before = p.clone();
    p.lerp(this.target, 1 - Math.exp(-dt * 14));
    const sp = Math.hypot(p.x - before.x, p.z - before.z) / Math.max(dt, 1e-3);
    this.phase += Math.min(sp, 8) * dt * 2.4;
    this.pose(Math.sin(this.phase) * Math.min(1, sp / 3));
    let dy = this.yaw - this.group.rotation.y;
    dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.group.rotation.y += dy * (1 - Math.exp(-dt * 14));
    this.head.rotation.x += (this.pitch - this.head.rotation.x) * (1 - Math.exp(-dt * 14));
  }
}

const FLUFF_COLORS = [0xffffff, 0xfff1d6, 0xffdfe8, 0xe2f0ff];

class MobView {
  constructor(id, type, x, y, z) {
    this.id = id;
    this.type = type;
    this.group = new THREE.Group();
    this.group.position.set(x, y, z);
    this.target = new THREE.Vector3(x, y, z);
    this.yaw = 0;
    this.hurt = false;
    this.mats = [];
    this.t = Math.random() * 10;
    this.prevY = y;
    this.seen = 0;
    const lam = (color, emissive = 0) => {
      const m = new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });
      m.userData.em = emissive;
      this.mats.push(m);
      return m;
    };
    if (type === 0) {
      // Пушик: круглый зверёк с длинными ушами
      const fur = lam(FLUFF_COLORS[id % FLUFF_COLORS.length]);
      this.body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), fur);
      this.body.position.y = 0.33;
      this.body.scale.set(1, 0.88, 1.08);
      const ear = () => new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.26, 3, 6), fur);
      this.earL = ear();
      this.earR = ear();
      this.earL.position.set(-0.14, 0.72, -0.04);
      this.earR.position.set(0.14, 0.72, -0.04);
      const black = new THREE.MeshBasicMaterial({ color: 0x15151c });
      const eye = () => new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), black);
      const eL = eye();
      const eR = eye();
      eL.position.set(-0.13, 0.42, 0.33);
      eR.position.set(0.13, 0.42, 0.33);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff8fa8 }));
      nose.position.set(0, 0.34, 0.39);
      const tail = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), fur);
      tail.position.set(0, 0.3, -0.38);
      this.group.add(this.body, this.earL, this.earR, eL, eR, nose, tail);
      this.radius = 0.5;
      this.cy = 0.35;
    } else {
      // Мрачник: тёмный кристалл с одним светящимся глазом
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), lam(0x2a1846, 0x1c0c3a));
      core.position.y = 0.42;
      this.body = core;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2a8 }));
      eye.position.set(0, 0.45, 0.24);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0x150a22 }));
      pupil.position.set(0, 0.45, 0.35);
      this.shards = new THREE.Group();
      this.shards.position.y = 0.42;
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.1, 0), lam(0x5b3f8f, 0x2a1658));
        const a = (i / 4) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.62, Math.sin(a * 2) * 0.12, Math.sin(a) * 0.62);
        this.shards.add(s);
      }
      this.group.add(core, eye, pupil, this.shards);
      this.radius = 0.55;
      this.cy = 0.42;
    }
  }

  update(dt) {
    this.t += dt;
    const p = this.group.position;
    p.lerp(this.target, 1 - Math.exp(-dt * 12));
    let dy = this.yaw - this.group.rotation.y;
    dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.group.rotation.y += dy * (1 - Math.exp(-dt * 10));
    const vy = (p.y - this.prevY) / Math.max(dt, 1e-3);
    this.prevY = p.y;
    if (this.type === 0) {
      const st = Math.max(-0.2, Math.min(0.28, vy * 0.045));
      this.body.scale.set(1 - st * 0.5, 0.88 + st, 1.08 - st * 0.5);
      const w = Math.sin(this.t * 3) * 0.12 - st * 1.6;
      this.earL.rotation.set(w, 0, 0.18);
      this.earR.rotation.set(w, 0, -0.18);
    } else {
      this.shards.rotation.y = this.t * 1.8;
      this.body.rotation.y = this.t * 0.6;
      this.body.position.y = 0.42 + Math.sin(this.t * 2.2) * 0.06;
    }
    for (const m of this.mats) m.emissive.setHex(this.hurt ? 0xaa1111 : m.userData.em);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

class Particles {
  constructor(scene, max = 1200) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life, grav = 1) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    tmpColor.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    this.col[i * 3] = tmpColor.r;
    this.col[i * 3 + 1] = tmpColor.g;
    this.col[i * 3 + 2] = tmpColor.b;
    this.life[i] = life;
    this.grav[i] = grav;
  }

  burst(x, y, z, n, rgb, speed = 3, spread = 0.4, grav = 1, life = 0.7, dim = 1) {
    for (let i = 0; i < n; i++) {
      const j = (0.75 + Math.random() * 0.4) * dim;
      this.emit(
        x + (Math.random() - 0.5) * spread * 2,
        y + (Math.random() - 0.5) * spread * 2,
        z + (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.9,
        (Math.random() - 0.5) * speed,
        rgb[0] * j,
        rgb[1] * j,
        rgb[2] * j,
        life * (0.6 + Math.random() * 0.8),
        grav,
      );
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (l !== i) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[l * 3 + k];
            this.vel[i * 3 + k] = this.vel[l * 3 + k];
            this.col[i * 3 + k] = this.col[l * 3 + k];
          }
          this.life[i] = this.life[l];
          this.grav[i] = this.grav[l];
        }
        continue;
      }
      this.vel[i * 3 + 1] -= 18 * this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// Куб с атрибутами чанкового шейдера — для блока в руке.
function blockGeometry(def) {
  const faces = [
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1], 0.8, 1],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0], 0.8, 1],
    [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0], 1, 0],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], 0.5, 2],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], 0.66, 1],
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0], 0.66, 1],
  ];
  const uv = [0, 1, 1, 1, 1, 0, 0, 0];
  const pos = [];
  const uvl = [];
  const light = [];
  const idx = [];
  faces.forEach((f, fi) => {
    for (let k = 0; k < 4; k++) {
      pos.push(f[k][0] - 0.5, f[k][1] - 0.5, f[k][2] - 0.5);
      uvl.push(uv[k * 2], uv[k * 2 + 1], def.tiles[f[5]]);
      light.push(255, 0, f[4] * 255, 0);
    }
    idx.push(fi * 4, fi * 4 + 1, fi * 4 + 2, fi * 4, fi * 4 + 2, fi * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uvl', new THREE.BufferAttribute(new Float32Array(uvl), 3));
  g.setAttribute('light', new THREE.BufferAttribute(new Uint8Array(light), 4, true));
  g.setIndex(idx);
  return g;
}

class Hand {
  constructor(renderer, tiles, icons) {
    this.renderer = renderer;
    this.tiles = tiles;
    this.icons = icons;
    this.group = new THREE.Group();
    renderer.handScene.add(this.group);
    this.id = -1;
    this.obj = null;
    this.swing = 0;
    this.raise = 1;
    this.next = 0;
    this.bob = 0;
    this.texCache = new Map();
  }

  spriteTex(canvas) {
    let t = this.texCache.get(canvas);
    if (!t) {
      t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      this.texCache.set(canvas, t);
    }
    return t;
  }

  build(id) {
    if (this.obj) {
      this.group.remove(this.obj);
      this.obj.geometry.dispose();
      if (this.obj.material !== this.renderer.handMat) this.obj.material.dispose();
      this.obj = null;
    }
    this.id = id;
    if (!id) {
      this.obj = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0xf2d6b8 }));
      this.obj.position.set(0.56, -0.52, -0.8);
      this.obj.rotation.set(0.55, 0.3, 0);
    } else if (isBlock(id) && BLOCKS[id].shape === 'cube') {
      this.obj = new THREE.Mesh(blockGeometry(BLOCKS[id]), this.renderer.handMat);
      this.obj.scale.setScalar(0.36);
      this.obj.position.set(0.56, -0.46, -0.9);
      this.obj.rotation.set(0.12, 0.7, 0);
    } else {
      const canvas = isBlock(id) ? this.tiles.canvases[BLOCKS[id].tiles[1]] : this.icons['spr' + id];
      const mat = new THREE.MeshBasicMaterial({ map: this.spriteTex(canvas), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      this.obj = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat);
      this.obj.position.set(0.52, -0.36, -0.86);
      this.obj.rotation.set(0, -0.5, ITEMS[id] && ITEMS[id].tool ? 0.25 : 0);
    }
    this.base = this.obj.position.clone();
    this.baseRot = this.obj.rotation.clone();
    this.group.add(this.obj);
  }

  setItem(id) {
    if (id === this.next) return;
    this.next = id;
  }

  doSwing() {
    this.swing = 1;
  }

  update(dt, walkAmount) {
    if (this.next !== this.id) {
      this.raise -= dt * 7;
      if (this.raise <= 0) {
        this.build(this.next);
        this.raise = 0;
      }
    } else if (this.raise < 1) this.raise = Math.min(1, this.raise + dt * 7);
    if (!this.obj) return;
    this.swing = Math.max(0, this.swing - dt * 4.5);
    this.bob += dt * 9 * walkAmount;
    const s = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const o = this.obj;
    o.position.copy(this.base);
    o.position.y += (this.raise - 1) * 0.5 + Math.sin(this.bob) * 0.012 * walkAmount - s * 0.1;
    o.position.x += Math.cos(this.bob * 0.5) * 0.012 * walkAmount - s * 0.16;
    o.position.z -= s * 0.16;
    o.rotation.set(this.baseRot.x - s * 0.9, this.baseRot.y + s * 0.3, this.baseRot.z);
  }
}

export class Entities {
  constructor(game) {
    this.game = game;
    const scene = game.renderer.scene;
    this.scene = scene;
    this.players = new Map();
    this.mobs = new Map();
    this.particles = new Particles(scene);
    this.hand = new Hand(game.renderer, game.tiles, game.icons);
    this.hand.build(0);

    this.sel = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }),
    );
    this.sel.visible = false;
    scene.add(this.sel);

    this.crackTex = game.cracks.map((c) => {
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      return t;
    });
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.008, 1.008, 1.008),
      new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, fog: false }),
    );
    this.crack.visible = false;
    this.crack.renderOrder = 3;
    scene.add(this.crack);

    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.rope = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0xd9b678 }));
    this.rope.frustumCulled = false;
    this.rope.visible = false;
    scene.add(this.rope);
  }

  // ----- игроки -----
  addPlayer(info) {
    if (this.players.has(info.id)) return;
    const p = new RemotePlayer(info);
    this.players.set(info.id, p);
    this.scene.add(p.group);
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    p.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.players.delete(id);
  }

  onPlayers(list, selfId) {
    for (const s of list) {
      if (s[0] === selfId) continue;
      const p = this.players.get(s[0]);
      if (!p) continue;
      p.target.set(s[1], s[2], s[3]);
      p.yaw = s[4];
      p.pitch = s[5];
    }
  }

  // ----- мобы -----
  onMobs(list) {
    const now = performance.now();
    for (const s of list) {
      let m = this.mobs.get(s[0]);
      if (!m) {
        m = new MobView(s[0], s[1], s[2], s[3], s[4]);
        this.mobs.set(s[0], m);
        this.scene.add(m.group);
      }
      m.target.set(s[2], s[3], s[4]);
      m.yaw = s[5];
      m.hurt = !!s[6];
      m.seen = now;
    }
    for (const m of this.mobs.values()) if (now - m.seen > 600) this.removeMob(m.id);
  }

  removeMob(id) {
    const m = this.mobs.get(id);
    if (!m) return;
    this.scene.remove(m.group);
    m.dispose();
    this.mobs.delete(id);
  }

  // Ближайший моб на луче взгляда.
  pickMob(o, d, maxDist) {
    let best = null;
    let bt = maxDist;
    for (const m of this.mobs.values()) {
      const p = m.group.position;
      const cx = p.x - o.x;
      const cy = p.y + m.cy - o.y;
      const cz = p.z - o.z;
      const t = cx * d.x + cy * d.y + cz * d.z;
      if (t < 0 || t > bt) continue;
      const px = cx - d.x * t;
      const py = cy - d.y * t;
      const pz = cz - d.z * t;
      if (px * px + py * py + pz * pz < m.radius * m.radius) {
        bt = t;
        best = m;
      }
    }
    return best;
  }

  blockBurst(x, y, z, id, n = 14) {
    const def = BLOCKS[id];
    if (!def) return;
    const rgb = this.game.tiles.avg[def.tiles[1]];
    this.particles.burst(x + 0.5, y + 0.5, z + 0.5, n, rgb, 3.2, 0.35, 1, 0.6, 0.45 + 0.55 * this.game.renderer.day);
  }

  update(dt) {
    for (const p of this.players.values()) p.update(dt);
    for (const m of this.mobs.values()) m.update(dt);
    this.particles.update(dt);
  }
}
