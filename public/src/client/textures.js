// Все текстуры игры рисуются кодом: тайлы блоков 16x16, спрайты растений,
// иконки предметов и стадии трещин. Никаких внешних картинок.
import { TILES, BLOCKS, ITEMS, PAINTS, TIER_NAMES, I } from '../shared/blocks.js';
import { mulberry32 } from '../shared/noise.js';

export const TS = 16;

class Tile {
  constructor(seed) {
    this.d = new Uint8ClampedArray(TS * TS * 4);
    this.r = mulberry32(seed);
  }
  px(x, y, hex, a = 255) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] = (hex >> 16) & 255;
    this.d[i + 1] = (hex >> 8) & 255;
    this.d[i + 2] = hex & 255;
    this.d[i + 3] = a;
  }
  fill(hex, vary = 0, a = 255) {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const j = (this.r() - 0.5) * 2 * vary;
        const i = (y * TS + x) * 4;
        this.d[i] = ((hex >> 16) & 255) + j;
        this.d[i + 1] = ((hex >> 8) & 255) + j;
        this.d[i + 2] = (hex & 255) + j;
        this.d[i + 3] = a;
      }
    }
  }
  speck(hex, n, a = 255) {
    for (let i = 0; i < n; i++) this.px((this.r() * TS) | 0, (this.r() * TS) | 0, hex, a);
  }
  mul(x, y, f) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] *= f;
    this.d[i + 1] *= f;
    this.d[i + 2] *= f;
  }
  rect(x0, y0, w, h, hex, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, hex, a);
  }
  bevel(light = 1.18, dark = 0.8) {
    for (let i = 0; i < TS; i++) {
      this.mul(i, 0, light);
      this.mul(0, i, light);
      this.mul(i, TS - 1, dark);
      this.mul(TS - 1, i, dark);
    }
  }
  sprite(rows, pal) {
    for (let y = 0; y < rows.length && y < TS; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length && x < TS; x++) {
        const c = pal[row[x]];
        if (c !== undefined) this.px(x, y, c);
      }
    }
  }
}

function rings(t, cols, edge) {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7.6) t.px(x, y, edge);
      else t.px(x, y, cols[Math.floor(d / 1.6) % cols.length]);
    }
  }
}

function ore(t, a, b) {
  P.stone(t);
  for (let k = 0; k < 6; k++) {
    const x = 1 + ((t.r() * 12) | 0);
    const y = 1 + ((t.r() * 12) | 0);
    t.px(x, y, a);
    t.px(x + 1, y, a);
    t.px(x, y + 1, b);
    if (t.r() < 0.6) t.px(x + 1, y + 1, a);
    if (t.r() < 0.4) t.px(x - 1, y + 1, b);
  }
}

const SPR = {
  flower_red: [
    [
      '................', '................', '.......o........', '......oro.......', '......rrr..o....',
      '..o..rryrr.r....', '..ro.rryrr.r....', '..rr..rrr.......', '...r...g........', '....g..g..g.....',
      '.....g.g.g......', '......gg........', '.......g........', '.......g........', '.......g........',
      '.......g........',
    ],
    { r: 0xe5482f, o: 0xff8a3d, y: 0xffd84a, g: 0x3f9438 },
  ],
  flower_yellow: [
    [
      '................', '................', '................', '.....y.yy.y.....', '......yyyy......',
      '....yyyoooyy....', '.....yobboy.....', '....yyobboyy....', '.....yyoooy.....', '......yyyy......',
      '.....y.gy.y.....', '.......g........', '......gg.g......', '.......ggg......', '.......g........',
      '.......g........',
    ],
    { y: 0xffd43b, o: 0xf59f00, b: 0x7a4a12, g: 0x4c983a },
  ],
  tallgrass: [
    [
      '................', '................', '................', '................', '.....g..........',
      '.....g....l.....', '..l..gg...l.....', '..l...g..ll..g..', '..ll..g..l...g..', '...l..gl.l..gg..',
      '...l.ggl.lg.g...', '...lg.gllgg.g...', '...lg.gllg.gg...', '....gggllggg....', '....gggllgg.....',
      '.....ggllgg.....',
    ],
    { g: 0x4c983a, l: 0x6fc04f },
  ],
  glowshroom: [
    [
      '................', '................', '................', '................', '................',
      '......cccc......', '....ccCCCCcc....', '...cCCwCCCCCc...', '...cCCCCCwCCc...', '....cccccccc....',
      '......ssss......', '.......ss.......', '.......ss.......', '.......ss.......', '......ssss......',
      '................',
    ],
    { c: 0x2fc4d6, C: 0x7ff3ff, w: 0xffffff, s: 0xdfe9e2 },
  ],
  berry_bush: [
    [
      '................', '................', '................', '................', '.....gg..gg.....',
      '....gGGggGGg....', '...gGGbGGGGGg...', '..gGGGGGGbGGGg..', '..gGbGGGGGGGGg..', '..gGGGGbGGGbGg..',
      '..gGGGGGGGGGGg..', '...gGGbGGGbGg...', '...ggGGGGGGgg...', '....gggGGggg....', '......gtt.......',
      '.......tt.......',
    ],
    { g: 0x2f7d32, G: 0x4fae48, b: 0x6d5ff0, t: 0x6b4a2e },
  ],
  drybush: [
    [
      '................', '................', '................', '................', '..t.....t.......',
      '..t....t....t...', '...t...t...t....', '...tt..t..t.....', '....t.tt.tt..t..', '.....ttt.t..t...',
      '......tttt.t....', '.......tttt.....', '.......tt.......', '.......tt.......', '.......tt.......',
      '.......tt.......',
    ],
    { t: 0x8a6a45 },
  ],
};

const P = {
  grass_top(t) {
    t.fill(0x62b245, 9);
    t.speck(0x7fcf58, 30);
    t.speck(0x4c983a, 26);
  },
  dirt(t) {
    t.fill(0x8b5e3c, 8);
    t.speck(0x6e482c, 26);
    t.speck(0xa67850, 14);
    t.speck(0x5c3d26, 8);
  },
  grass_side(t) {
    P.dirt(t);
    for (let x = 0; x < TS; x++) {
      const h = 2 + ((t.r() * 3) | 0);
      for (let y = 0; y < h; y++) t.px(x, y, y === h - 1 ? 0x4c983a : t.r() < 0.3 ? 0x7fcf58 : 0x62b245);
    }
  },
  stone(t) {
    t.fill(0x8d9197, 6);
    for (const y of [2, 6, 10, 14]) {
      for (let x = 0; x < TS; x++) if (t.r() < 0.72) t.px(x, y + (t.r() < 0.25 ? 1 : 0), 0x7a7e84);
    }
    t.speck(0xa5a9ae, 14);
    t.speck(0x72767c, 10);
  },
  sand(t) {
    t.fill(0xe4d49a, 5);
    t.speck(0xd2bf80, 26);
    t.speck(0xf1e5b5, 20);
  },
  water(t) {
    t.fill(0x2f73d8, 5, 178);
    for (const [y, x0, n] of [[3, 2, 6], [8, 9, 5], [12, 1, 4], [14, 8, 6]]) {
      for (let x = x0; x < x0 + n; x++) t.px(x, y, 0x6aa6f2, 200);
    }
  },
  log_side(t) {
    t.fill(0x6b4a2e, 7);
    for (let x = 0; x < TS; x++) {
      if (t.r() < 0.4) for (let y = 0; y < TS; y++) if (t.r() < 0.8) t.px(x, y, 0x553a22);
    }
    t.speck(0x7d5a3a, 14);
  },
  log_top(t) {
    rings(t, [0xb89260, 0x9c7646], 0x6b4a2e);
  },
  leaves(t) {
    t.fill(0x3f9438, 12);
    t.speck(0x57b14a, 36);
    t.speck(0x2c7630, 30);
    t.speck(0, 14, 0);
  },
  planks(t) {
    t.fill(0xc49a5c, 5);
    for (let y = 3; y < TS; y += 4) for (let x = 0; x < TS; x++) t.px(x, y, 0x9c7743);
    for (let b = 0; b < 4; b++) {
      const x = (t.r() * TS) | 0;
      for (let y = b * 4; y < b * 4 + 3; y++) t.px(x, y, 0x9c7743);
      t.px((x + 2) % TS, b * 4 + 1, 0x84622f);
    }
  },
  cobble(t) {
    const pts = [];
    for (let i = 0; i < 10; i++) pts.push([t.r() * TS, t.r() * TS, 0x8a8d92 + ((t.r() * 3) | 0) * 0x0c0c0c]);
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        let d1 = 99;
        let d2 = 99;
        let c = 0;
        for (const p of pts) {
          // расстояние с учётом зацикливания, чтобы тайл был бесшовным
          const dx = Math.min(Math.abs(x - p[0]), TS - Math.abs(x - p[0]));
          const dy = Math.min(Math.abs(y - p[1]), TS - Math.abs(y - p[1]));
          const d = Math.hypot(dx, dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            c = p[2];
          } else if (d < d2) d2 = d;
        }
        t.px(x, y, d2 - d1 < 1.1 ? 0x5f6266 : c);
        if (d2 - d1 >= 1.1) t.mul(x, y, 0.95 + t.r() * 0.1);
      }
    }
  },
  glass(t) {
    t.fill(0xffffff, 0, 0);
    for (let i = 0; i < TS; i++) {
      t.px(i, 0, 0xd4eef5);
      t.px(i, TS - 1, 0xb5d6e0);
      t.px(0, i, 0xd4eef5);
      t.px(TS - 1, i, 0xb5d6e0);
    }
    for (const [x, y] of [[3, 5], [4, 4], [5, 3], [4, 6], [5, 5], [6, 4], [10, 12], [11, 11], [12, 10]]) t.px(x, y, 0xffffff);
  },
  coal_ore(t) {
    ore(t, 0x2b2b2e, 0x45454a);
  },
  copper_ore(t) {
    ore(t, 0xdf8a4f, 0x4fb39a);
  },
  crystal_ore(t) {
    ore(t, 0xc86bff, 0x7fe7ff);
  },
  snow(t) {
    t.fill(0xf4f8fb, 3);
    t.speck(0xdfeaf2, 24);
  },
  ice(t) {
    t.fill(0xa9d8f5, 4, 205);
    for (let i = 0; i < 6; i++) {
      t.px(2 + i, 9 - i, 0xe8f7ff, 235);
      t.px(8 + i, 14 - ((i / 2) | 0), 0xe8f7ff, 235);
    }
  },
  brick(t) {
    t.fill(0xc9c1b3, 4);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let x = 0; x < TS; x++) {
        if ((x + off) % 8 === 7) continue;
        const c = 0xb5513c;
        for (let y = row * 4; y < row * 4 + 3; y++) {
          t.px(x, y, c);
          t.mul(x, y, 0.9 + t.r() * 0.2);
        }
      }
    }
  },
  lamp(t) {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        t.px(x, y, d > 7 ? 0x6b4a2e : d > 5 ? 0xffc94a : d > 3 ? 0xffe08a : 0xfff6c9);
      }
    }
    for (let i = 1; i < TS - 1; i++) {
      t.px(i, 7, 0x8a6238);
      t.px(7, i, 0x8a6238);
    }
  },
  tramp_top(t) {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        t.px(x, y, d > 7.4 ? 0x3a3f4a : d > 5.6 ? 0x4dabf7 : d > 3.6 ? 0xffe066 : d > 1.6 ? 0xff5d73 : 0xffffff);
      }
    }
  },
  tramp_side(t) {
    t.fill(0x23262d, 3);
    t.rect(0, 0, TS, 3, 0x4dabf7);
    t.rect(0, 13, TS, 3, 0x3a3f4a);
    for (let x = 0; x < TS; x++) {
      const k = x % 4;
      const y = 4 + (k === 0 ? 0 : k === 1 ? 3 : k === 2 ? 6 : 3);
      t.px(x, y, 0xc8ccd4);
      t.px(x, y + 1, 0xc8ccd4);
      t.px(x, y + 2, 0x8d929c);
    }
  },
  barrel_top(t) {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        t.px(x, y, d > 7.6 ? 0x4a4a4f : d > 6.4 ? 0x5f6066 : d > 2.2 ? (x % 4 === 3 ? 0x7a4a28 : 0x9b6238) : d > 1 ? 0x2b2b2e : 0xffd43b);
      }
    }
  },
  barrel_side(t) {
    t.fill(0x9b6238, 5);
    for (let x = 3; x < TS; x += 4) for (let y = 0; y < TS; y++) t.px(x, y, 0x7a4a28);
    t.rect(0, 1, TS, 2, 0x55565c);
    t.rect(0, 13, TS, 2, 0x55565c);
    for (let y = 5; y < 11; y++) for (let x = 0; x < TS; x++) t.px(x, y, ((x + y) >> 2) % 2 ? 0xf2c62e : 0x26262a);
  },
  barrel_lit(t) {
    t.fill(0xffd9c2, 6);
    t.rect(0, 1, TS, 2, 0xffffff);
    t.rect(0, 13, TS, 2, 0xffffff);
    for (let y = 5; y < 11; y++) for (let x = 0; x < TS; x++) t.px(x, y, ((x + y) >> 2) % 2 ? 0xfff3b0 : 0xff5d3a);
  },
  pad_top(t) {
    const cols = [0xffffff, 0x38d9e0, 0x2b2440, 0x7b5cff, 0x2b2440, 0x38d9e0, 0x2b2440, 0x7b5cff];
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        t.px(x, y, cols[Math.min(cols.length - 1, Math.floor(d / 1.9))]);
      }
    }
  },
  pad_side(t) {
    t.fill(0x3a3350, 5);
    t.rect(0, 0, TS, 2, 0x7b5cff);
    t.rect(0, 7, TS, 2, 0x38d9e0);
    t.speck(0x2b2440, 16);
  },
  bedrock(t) {
    t.fill(0x33343a, 10);
    t.speck(0x1e1f24, 44);
    t.speck(0x4b4d55, 20);
  },
  sandstone(t) {
    t.fill(0xd9c383, 4);
    for (const y of [3, 8, 12]) for (let x = 0; x < TS; x++) if (t.r() < 0.85) t.px(x, y, 0xc2aa68);
    for (let x = 0; x < TS; x++) t.px(x, 0, 0xe8d79f);
  },
  pine_side(t) {
    t.fill(0x4a3423, 6);
    for (let x = 0; x < TS; x++) {
      if (t.r() < 0.45) for (let y = 0; y < TS; y++) if (t.r() < 0.8) t.px(x, y, 0x382619);
    }
  },
  pine_top(t) {
    rings(t, [0x9a7748, 0x7d5e37], 0x4a3423);
  },
  pine_leaves(t) {
    t.fill(0x2c6b4a, 10);
    t.speck(0x3d8660, 28);
    t.speck(0x1e5038, 30);
    t.speck(0, 10, 0);
  },
  skymoss_top(t) {
    t.fill(0x3fc9b0, 9);
    t.speck(0x7ae8d2, 26);
    t.speck(0x2aa590, 20);
    t.speck(0xe9fff9, 4);
  },
  skystone(t) {
    t.fill(0xcfd6e6, 5);
    t.speck(0xb4bdd2, 24);
    t.speck(0xe6ebf5, 14);
    for (let i = 0; i < 7; i++) t.px(3 + i, 5 + ((i / 3) | 0), 0xaab3c9);
    for (let i = 0; i < 5; i++) t.px(8 + i, 12 - ((i / 2) | 0), 0xaab3c9);
  },
  skymoss_side(t) {
    P.skystone(t);
    for (let x = 0; x < TS; x++) {
      const h = 2 + ((t.r() * 3) | 0);
      for (let y = 0; y < h; y++) t.px(x, y, y === h - 1 ? 0x2aa590 : t.r() < 0.3 ? 0x7ae8d2 : 0x3fc9b0);
    }
  },
  copper_block(t) {
    t.fill(0xd9824a, 5);
    t.speck(0x4fb39a, 5);
    t.speck(0xeea06a, 14);
    t.bevel(1.2, 0.76);
  },
  crystal_block(t) {
    const cols = [0xc86bff, 0xa24de0, 0xe3a6ff, 0xb45cf0];
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) t.px(x, y, cols[((x + y * 2) >> 2) % 4]);
    t.speck(0xffffff, 7);
    t.bevel(1.25, 0.75);
  },
  gravel(t) {
    t.fill(0x8b8680, 12);
    t.speck(0x6d6862, 44);
    t.speck(0xaaa59e, 30);
  },
  lava(t) {
    t.fill(0xf7811c, 12);
    for (let k = 0; k < 7; k++) {
      const x = (t.r() * TS) | 0;
      const y = (t.r() * TS) | 0;
      for (let i = 0; i < 4; i++) t.px((x + i) % TS, (y + ((i / 2) | 0)) % TS, 0xffd23e);
    }
    t.speck(0xfff3a0, 10);
    t.speck(0xc23c0e, 30);
    t.speck(0x8f2a0a, 10);
  },
  basalt(t) {
    t.fill(0x3b3d45, 5);
    for (const x of [3, 8, 12]) for (let y = 0; y < TS; y++) if (t.r() < 0.7) t.px(x + (t.r() < 0.15 ? 1 : 0), y, 0x2a2c33);
    t.speck(0x50535e, 22);
    t.speck(0x24262c, 14);
  },
  crate_side(t) {
    t.fill(0xb98a4e, 5);
    for (let i = 0; i < TS; i++) {
      t.px(i, i, 0x93693a);
      t.px(TS - 1 - i, i, 0x93693a);
    }
    for (let i = 0; i < TS; i++) {
      for (const e of [0, 1, TS - 2, TS - 1]) {
        t.px(i, e, 0x7a5530);
        t.px(e, i, 0x7a5530);
      }
    }
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) t.px(x, y, 0xd9dde4);
  },
  crate_top(t) {
    t.fill(0xc0935a, 5);
    for (let y = 4; y < TS; y += 4) for (let x = 0; x < TS; x++) t.px(x, y - 1, 0x93693a);
    for (let i = 0; i < TS; i++) {
      for (const e of [0, 1, TS - 2, TS - 1]) {
        t.px(i, e, 0x7a5530);
        t.px(e, i, 0x7a5530);
      }
    }
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) t.px(x, y, 0xd9dde4);
  },
  stone_bricks(t) {
    t.fill(0x6c6f75, 3);
    for (let row = 0; row < 2; row++) {
      const off = row ? 4 : 0;
      for (let x = 0; x < TS; x++) {
        if ((x + off) % 8 === 7) continue;
        for (let y = row * 8; y < row * 8 + 7; y++) {
          t.px(x, y, 0x979ba1);
          t.mul(x, y, 0.93 + t.r() * 0.14);
        }
      }
    }
  },
};
for (const k of Object.keys(SPR)) {
  P[k] = (t) => {
    t.fill(0, 0, 0);
    t.sprite(SPR[k][0], SPR[k][1]);
  };
}
for (const [key, , hex] of PAINTS) {
  P['paint_' + key] = (t) => {
    t.fill(hex, 4);
    t.bevel(1.12, 0.86);
  };
}

// ---------- иконки предметов ----------
const TIER_PAL = {
  wood: { h: 0xc49a5c, H: 0xe0bb80, d: 0x8a6a3a },
  stone: { h: 0x9a9da2, H: 0xc3c6cb, d: 0x65686d },
  copper: { h: 0xe08a50, H: 0xf7b987, d: 0xa85d30 },
  crystal: { h: 0xc86bff, H: 0xf0c9ff, d: 0x8a35c9 },
};
const STICK_PAL = { s: 0xb08a55, S: 0x7a5a33, g: 0x55565c };
const TOOL_SPR = {
  pick: [
    '................', '......dhhhhd....', '....dhhHHHHhhd..', '...dhH.....sHhd.', '...dh.....sS.hhd', '..........sS..hd',
    '.........sS...hd', '........sS....d.', '.......sS.......', '......sS........', '.....sS.........',
    '....sS..........', '...sS...........', '..sS............', '.sS.............', '................',
  ],
  axe: [
    '................', '...........dd...', '.........ddhhd..', '........dhhHhd..', '........dhHhsd..', '.........dhsShd.',
    '..........sShhd.', '.........sS.dd..', '........sS......', '.......sS.......', '......sS........',
    '.....sS.........', '....sS..........', '...sS...........', '..sS............', '................',
  ],
  shovel: [
    '................', '............ddd.', '...........dhHhd', '..........dhHhhd', '..........dhhhd.', '.........sShdd..',
    '........sS.d....', '.......sS.......', '......sS........', '.....sS.........', '....sS..........',
    '...sS...........', '..sS............', '.sS.............', '................', '................',
  ],
  sword: [
    '................', '.............dd.', '............dhHd', '...........dhHd.', '..........dhHd..', '.........dhHd...',
    '........dhHd....', '..g....dhHd.....', '..gg..dhHd......', '...ggdhHd.......', '....ggHd........',
    '....sgg.........', '...sS.gg........', '..sS...g........', '.sS.............', '................',
  ],
};
const BUCKET_ROWS = [
  '................', '................', '....hhhhhhhh....', '...h........h...', '..hhhhhhhhhhhh..', '..gddddddddddg..',
  '..gdwddddddddg..', '..gGGGGGGGGGGg..', '...gGGGGGGGGg...', '...gGGLGGGGGg...', '...gGGLGGGGGg...',
  '....gGGGGGGg....', '....gGGGGGGg....', '....gggggggg....', '................', '................',
];
const BUCKET_PAL = { h: 0xd5dae3, g: 0x6f7480, G: 0xaeb4bf, L: 0xd5dae3 };

const ITEM_SPR = {
  bucket: [BUCKET_ROWS, { ...BUCKET_PAL, d: 0x3a3f4a, w: 0x3a3f4a }],
  bucket_water: [BUCKET_ROWS, { ...BUCKET_PAL, d: 0x2f73d8, w: 0x9cc6ff }],
  bucket_lava: [BUCKET_ROWS, { ...BUCKET_PAL, d: 0xf7811c, w: 0xffe27a }],
  stick: [
    [
      '................', '................', '............sS..', '...........sS...', '..........sS....', '.........sS.....',
      '........sS......', '.......sS.......', '......sS........', '.....sS.........', '....sS..........',
      '...sS...........', '..sS............', '................', '................', '................',
    ],
    STICK_PAL,
  ],
  coal: [
    [
      '................', '................', '................', '.....kkkk.......', '....kKKkkkk.....', '...kKkkkkKkk....',
      '...kkkkKkkkk....', '..kkKkkkkkKkk...', '..kkkkkKkkkkk...', '..kkkKkkkkkk....', '...kkkkkKkk.....',
      '....kkkkkk......', '................', '................', '................', '................',
    ],
    { k: 0x2b2b2e, K: 0x4f4f56 },
  ],
  copper_ingot: [
    [
      '................', '................', '................', '................', '................', '....cccccccc....',
      '...cCCCCCCCcd...', '..cCCCCCCCcdd...', '..ccccccccddd...', '..dddddddddd....', '................',
      '................', '................', '................', '................', '................',
    ],
    { c: 0xe8975c, C: 0xf7b987, d: 0xa85d30 },
  ],
  crystal: [
    [
      '................', '.......pp.......', '......pPPp......', '.....pPWPPp.....', '.....pPWPPp.....', '....pPPWPPPp....',
      '....pPPPPPPp....', '....pPPPPPPp....', '.....pPPPPp.....', '.....pPPPPp.....', '......pPPp......',
      '......pPPp......', '.......pp.......', '................', '................', '................',
    ],
    { p: 0x9b3fe0, P: 0xd58cff, W: 0xffffff },
  ],
  fluff: [
    [
      '................', '................', '................', '.....wwww.......', '....wWWWWww.....', '...wWWWWWWWw....',
      '...wWWWWWWWw....', '..wWWWWWWWWWw...', '..wWWWWWWWWWw...', '...wWWWWWWWw....', '...wwWWWWWww....',
      '.....wwwww......', '................', '................', '................', '................',
    ],
    { w: 0xb9c2d6, W: 0xffffff },
  ],
  shadow_dust: [
    [
      '................', '................', '................', '................', '......d..d......', '....d.dDd..d....',
      '...dDDDDDDd.....', '..dDDvDDDvDDd...', '..dDDDDvDDDDd...', '...ddddddddd....', '................',
      '................', '................', '................', '................', '................',
    ],
    { d: 0x3a2a5c, D: 0x5b3f8f, v: 0xb197fc },
  ],
  berries: [
    [
      '................', '................', '.......g........', '......gg........', '.....g..g.......', '....bb..bb......',
      '...bBbb.bBbb....', '...bbbb.bbbb....', '....bb.bbbb.....', '......bBbb......', '......bbbb......',
      '.......bb.......', '................', '................', '................', '................',
    ],
    { b: 0x6d5ff0, B: 0xb4acff, g: 0x4c983a },
  ],
  hook: [
    [
      '................', '..........cc....', '.........c..c...', '.........C...c..', '....c....Cc..c..', '...c......ccc...',
      '...C.....cc.....', '...Cc...cc......', '....Ccccc.......', '.....rcc........', '....r...........',
      '...r............', '..r..r..........', '..r.r...........', '...r............', '................',
    ],
    { c: 0xb8bdc7, C: 0x7d828c, r: 0xc9a66b },
  ],
  glider: [
    [
      '................', '.......ww.......', '......wWWw......', '.....wWWWWw.....', '....wWWbbWWw....', '...wWWWbbWWWw...',
      '..wWWWWbbWWWWw..', '.wWWWWWbbWWWWWw.', '.wwwwwwbbwwwwww.', '.......bb.......', '......s..s......',
      '.....s....s.....', '................', '................', '................', '................',
    ],
    { w: 0xe0563f, W: 0xff8a6b, b: 0xfff3b0, s: 0x7a5a33 },
  ],
};

function tileCanvas(data) {
  const c = document.createElement('canvas');
  c.width = TS;
  c.height = TS;
  c.getContext('2d').putImageData(new ImageData(data, TS, TS), 0, 0);
  return c;
}

function spriteCanvas(rows, pal) {
  const t = new Tile(1);
  t.sprite(rows, pal);
  return tileCanvas(t.d);
}

// Собирает все тайлы: общий буфер для массива текстур, канвасы и средние цвета.
export function buildTiles() {
  const n = TILES.length;
  const data = new Uint8Array(TS * TS * 4 * n);
  const canvases = [];
  const avg = [];
  TILES.forEach((name, i) => {
    const t = new Tile(1000 + i * 7919);
    const paint = P[name];
    if (paint) paint(t);
    else t.fill(0xff00ff, 0);
    data.set(t.d, i * TS * TS * 4);
    canvases.push(tileCanvas(t.d));
    let r = 0;
    let g = 0;
    let b = 0;
    let k = 0;
    for (let p = 0; p < t.d.length; p += 4) {
      if (t.d[p + 3] > 100) {
        r += t.d[p];
        g += t.d[p + 1];
        b += t.d[p + 2];
        k++;
      }
    }
    avg.push(k ? [r / k, g / k, b / k] : [128, 128, 128]);
  });
  return { data, canvases, avg, count: n };
}

// Иконки для интерфейса: изометрический кубик для блоков, спрайт для предметов.
export function buildIcons(tiles) {
  const icons = {};
  const S = 48;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return [c, g];
  };
  for (const def of BLOCKS) {
    if (!def) continue;
    const [c, g] = mk();
    if (def.shape === 'cross') {
      g.drawImage(tiles.canvases[def.tiles[1]], 0, 0, S, S);
    } else {
      const top = tiles.canvases[def.tiles[0]];
      const side = tiles.canvases[def.tiles[1]];
      const k = 1 / TS;
      // верх
      g.setTransform(21 * k, 10.5 * k, -21 * k, 10.5 * k, 24, 2);
      g.drawImage(top, 0, 0);
      // левая грань
      g.setTransform(21 * k, 10.5 * k, 0, 23 * k, 3, 12.5);
      g.drawImage(side, 0, 0);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, 0, TS, TS);
      // правая грань
      g.setTransform(21 * k, -10.5 * k, 0, 23 * k, 24, 23);
      g.drawImage(side, 0, 0);
      g.fillStyle = 'rgba(0,0,0,0.42)';
      g.fillRect(0, 0, TS, TS);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    icons[def.id] = c.toDataURL();
  }
  for (const id of Object.keys(ITEMS)) {
    const it = ITEMS[id];
    let spr;
    if (it.tool) spr = spriteCanvas(TOOL_SPR[it.tool.type], { ...STICK_PAL, ...TIER_PAL[TIER_NAMES[it.tool.tier]] });
    else if (ITEM_SPR[it.key]) spr = spriteCanvas(ITEM_SPR[it.key][0], ITEM_SPR[it.key][1]);
    else continue;
    const [c, g] = mk();
    g.drawImage(spr, 0, 0, S, S);
    icons[id] = c.toDataURL();
    icons['spr' + id] = spr;
  }
  return icons;
}

// Стадии трещин для анимации разрушения блока.
export function buildCracks(stages = 6) {
  const out = [];
  const rnd = mulberry32(4242);
  const segs = [];
  for (let b = 0; b < 7; b++) {
    let x = 7.5;
    let y = 7.5;
    let a = rnd() * Math.PI * 2;
    for (let i = 0; i < 9; i++) {
      a += (rnd() - 0.5) * 1.3;
      x += Math.cos(a);
      y += Math.sin(a);
      segs.push([Math.round(x), Math.round(y), i]);
    }
  }
  for (let s = 0; s < stages; s++) {
    const t = new Tile(1);
    const lim = ((s + 1) / stages) * 9;
    for (const [x, y, i] of segs) if (i < lim) t.px(x, y, 0x15151a, 215);
    out.push(tileCanvas(t.d));
  }
  return out;
}

export { I };
