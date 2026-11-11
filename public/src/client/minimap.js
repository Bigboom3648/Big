// Круглая миникарта: вид сверху по данным загруженных чанков.
import { BLOCKS } from '../shared/blocks.js';

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.img = this.ctx.createImageData(this.size, this.size);
    this.timer = 0;
    this.colors = new Uint8Array(256 * 3);
    for (const def of BLOCKS) {
      if (!def) continue;
      const c = game.tiles.avg[def.tiles[0]];
      this.colors[def.id * 3] = c[0];
      this.colors[def.id * 3 + 1] = c[1];
      this.colors[def.id * 3 + 2] = c[2];
    }
  }

  update(dt) {
    this.timer -= dt;
    const g = this.game;
    if (this.timer > 0) return;
    this.timer = 0.3;
    const S = this.size;
    const half = S >> 1;
    const d = this.img.data;
    const w = g.world;
    const px = Math.floor(g.player.pos.x);
    const pz = Math.floor(g.player.pos.z);
    const col = this.colors;
    let lastKey = null;
    let chunk = null;
    for (let my = 0; my < S; my++) {
      const wz = pz + my - half;
      for (let mx = 0; mx < S; mx++) {
        const wx = px + mx - half;
        const key = (wx >> 4) * 65536 + (wz >> 4);
        if (key !== lastKey) {
          lastKey = key;
          chunk = w.chunkAt(wx, wz);
        }
        const o = (my * S + mx) * 4;
        if (!chunk || !chunk.top) {
          d[o] = 16;
          d[o + 1] = 21;
          d[o + 2] = 31;
          d[o + 3] = 255;
          continue;
        }
        const ci = (wx & 15) + ((wz & 15) << 4);
        const id = chunk.top[ci];
        const y = chunk.topY[ci];
        // рельеф: сравниваем с высотой клетки севернее
        let rel = 0;
        if ((wz & 15) > 0) rel = y - chunk.topY[ci - 16];
        const sh = Math.max(0.55, Math.min(1.3, 0.72 + (y - 40) / 110 + rel * 0.09));
        d[o] = col[id * 3] * sh;
        d[o + 1] = col[id * 3 + 1] * sh;
        d[o + 2] = col[id * 3 + 2] * sh;
        d[o + 3] = 255;
      }
    }
    const c = this.ctx;
    c.putImageData(this.img, 0, 0);
    // другие игроки
    for (const p of g.entities.players.values()) {
      const dx = p.group.position.x - g.player.pos.x;
      const dz = p.group.position.z - g.player.pos.z;
      const l = Math.hypot(dx, dz);
      const k = l > half - 6 ? (half - 6) / l : 1;
      c.fillStyle = p.color;
      c.strokeStyle = '#000';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(half + dx * k, half + dz * k, 4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // стрелка игрока
    c.save();
    c.translate(half, half);
    c.rotate(-g.player.yaw);
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -8);
    c.lineTo(5.5, 6);
    c.lineTo(0, 3);
    c.lineTo(-5.5, 6);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}
