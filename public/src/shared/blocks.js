// Реестр блоков, предметов и рецептов. Общий для сервера, клиента и воркера.

// ---------- Предметы (id >= 256) ----------
export const I = {
  STICK: 256,
  COAL: 257,
  COPPER_INGOT: 258,
  CRYSTAL: 259,
  FLUFF: 260,
  SHADOW_DUST: 261,
  BERRIES: 262,
  HOOK: 263,
  GLIDER: 264,
  PICK_WOOD: 270,
  PICK_STONE: 271,
  PICK_COPPER: 272,
  PICK_CRYSTAL: 273,
  AXE_WOOD: 274,
  AXE_STONE: 275,
  AXE_COPPER: 276,
  AXE_CRYSTAL: 277,
  SHOVEL_WOOD: 278,
  SHOVEL_STONE: 279,
  SHOVEL_COPPER: 280,
  SHOVEL_CRYSTAL: 281,
  SWORD_WOOD: 282,
  SWORD_STONE: 283,
  SWORD_COPPER: 284,
  SWORD_CRYSTAL: 285,
  BUCKET: 290,
  BUCKET_WATER: 291,
  BUCKET_LAVA: 292,
};

// ---------- Тайлы текстур ----------
export const TILES = [];
const tileIndex = new Map();
function tile(name) {
  let i = tileIndex.get(name);
  if (i === undefined) {
    i = TILES.length;
    TILES.push(name);
    tileIndex.set(name, i);
  }
  return i;
}

// ---------- Блоки (id 1..255) ----------
export const BLOCKS = [];
export const B = { AIR: 0 };

export const SOLID = new Uint8Array(256); // сталкивается с игроком
export const OPAQUE = new Uint8Array(256); // полностью непрозрачный куб
export const EMIT = new Uint8Array(256); // излучаемый свет 0..15
export const LOPAC = new Uint8Array(256); // доп. поглощение света прозрачным блоком
export const SHAPE = new Uint8Array(256); // 0 куб, 1 крест (растение)
export const RENDER = new Uint8Array(256); // 0 сплошной, 1 вырезной, 2 полупрозрачный
export const CULLSAME = new Uint8Array(256); // не рисовать грани между одинаковыми блоками
export const LIQUID = new Uint8Array(256); // 0 не жидкость, 1 вода, 2 лава
export const SKYLIT = new Uint8Array(256); // пропускает рассеянный свет неба (небесные острова)
export const TILE = new Uint16Array(256 * 3); // тайлы: верх, бок, низ

function block(id, key, name, o = {}) {
  const tiles = (o.tiles || [key, key, key]).map(tile);
  const def = {
    id,
    key,
    name,
    tiles,
    solid: o.solid !== false,
    opaque: o.opaque !== false,
    shape: o.shape || 'cube',
    render: o.render || 'opaque',
    light: o.light || 0,
    lopac: o.lopac || 0,
    hard: o.hard === undefined ? 1 : o.hard, // секунд ломать рукой; <0 — неразрушимый
    tool: o.tool || null, // 'pick' | 'axe' | 'shovel'
    tier: o.tier || 0, // минимальный уровень инструмента для выпадения
    drop: o.drop === undefined ? [id, 1] : o.drop,
    cullSame: !!o.cullSame,
    replaceable: !!o.replaceable,
    needsGround: !!o.needsGround,
    liquid: o.liquid || 0,
  };
  BLOCKS[id] = def;
  B[key.toUpperCase()] = id;
  SOLID[id] = def.solid ? 1 : 0;
  OPAQUE[id] = def.opaque ? 1 : 0;
  EMIT[id] = def.light;
  LOPAC[id] = def.lopac;
  SHAPE[id] = def.shape === 'cross' ? 1 : 0;
  RENDER[id] = def.render === 'cutout' ? 1 : def.render === 'blend' ? 2 : 0;
  CULLSAME[id] = def.cullSame ? 1 : 0;
  LIQUID[id] = def.liquid;
  SKYLIT[id] = o.skylit ? 1 : 0;
  TILE[id * 3] = tiles[0];
  TILE[id * 3 + 1] = tiles[1];
  TILE[id * 3 + 2] = tiles[2];
}

const plant = (o = {}) => ({
  shape: 'cross',
  solid: false,
  opaque: false,
  render: 'cutout',
  hard: 0.05,
  needsGround: true,
  ...o,
});

block(1, 'grass', 'Дёрн', { tiles: ['grass_top', 'grass_side', 'dirt'], hard: 0.7, tool: 'shovel', drop: [2, 1] });
block(2, 'dirt', 'Земля', { hard: 0.6, tool: 'shovel' });
block(3, 'stone', 'Камень', { hard: 4, tool: 'pick', tier: 1, drop: [9, 1] });
block(4, 'sand', 'Песок', { hard: 0.6, tool: 'shovel' });
block(5, 'water', 'Вода', {
  solid: false,
  opaque: false,
  render: 'blend',
  lopac: 2,
  hard: -1,
  cullSame: true,
  replaceable: true,
  drop: null,
  liquid: 1,
});
block(6, 'log', 'Бревно', { tiles: ['log_top', 'log_side', 'log_top'], hard: 2, tool: 'axe' });
block(7, 'leaves', 'Листва', { opaque: false, render: 'cutout', lopac: 1, hard: 0.3 });
block(8, 'planks', 'Доски', { hard: 1.6, tool: 'axe' });
block(9, 'cobble', 'Булыжник', { hard: 4, tool: 'pick', tier: 1 });
block(10, 'glass', 'Стекло', { opaque: false, render: 'cutout', hard: 0.4, cullSame: true });
block(11, 'coal_ore', 'Угольная руда', { hard: 5, tool: 'pick', tier: 1, drop: [I.COAL, 1] });
block(12, 'copper_ore', 'Медная руда', { hard: 5, tool: 'pick', tier: 2 });
block(13, 'crystal_ore', 'Кристальная жила', { hard: 6, tool: 'pick', tier: 3, drop: [I.CRYSTAL, 1], light: 4, skylit: true });
block(14, 'snow', 'Снег', { hard: 0.4, tool: 'shovel' });
block(15, 'ice', 'Лёд', { opaque: false, render: 'blend', lopac: 1, hard: 0.7, tool: 'pick', cullSame: true });
block(16, 'brick', 'Кирпич', { hard: 4, tool: 'pick', tier: 1 });
block(17, 'lamp', 'Фонарь', { hard: 0.5, light: 15 });
block(18, 'trampoline', 'Батут', { tiles: ['tramp_top', 'tramp_side', 'planks'], hard: 0.8, tool: 'axe' });
block(19, 'barrel', 'Бабах-бочка', { tiles: ['barrel_top', 'barrel_side', 'barrel_top'], hard: 1, tool: 'axe' });
block(20, 'barrel_lit', 'Горящая бочка', {
  tiles: ['barrel_lit', 'barrel_lit', 'barrel_lit'],
  hard: -1,
  light: 12,
  drop: null,
});
block(21, 'pad', 'Телепорт-плита', { tiles: ['pad_top', 'pad_side', 'pad_side'], hard: 2, tool: 'pick', light: 7 });
block(22, 'bedrock', 'Основа мира', { hard: -1, drop: null });
block(23, 'flower_red', 'Огнецвет', plant());
block(24, 'flower_yellow', 'Солнечник', plant());
block(25, 'tallgrass', 'Трава', plant({ drop: null, replaceable: true }));
block(26, 'sandstone', 'Песчаник', { hard: 2.5, tool: 'pick', tier: 1 });
block(27, 'pine_log', 'Еловое бревно', { tiles: ['pine_top', 'pine_side', 'pine_top'], hard: 2, tool: 'axe' });
block(28, 'pine_leaves', 'Хвоя', { opaque: false, render: 'cutout', lopac: 1, hard: 0.3 });
block(29, 'glowshroom', 'Светогриб', plant({ light: 9 }));
block(30, 'berry_bush', 'Ягодный куст', plant({ drop: [I.BERRIES, 2], hard: 0.3 }));
block(31, 'skymoss', 'Небесный мох', {
  tiles: ['skymoss_top', 'skymoss_side', 'skystone'],
  hard: 0.8,
  tool: 'shovel',
  skylit: true,
});
block(32, 'skystone', 'Небесный камень', { hard: 3, tool: 'pick', tier: 1, skylit: true });
block(33, 'copper_block', 'Медный блок', { hard: 5, tool: 'pick', tier: 1 });
block(34, 'crystal_block', 'Кристальный блок', { hard: 5, tool: 'pick', tier: 1, light: 12 });
block(35, 'gravel', 'Гравий', { hard: 0.7, tool: 'shovel' });
block(36, 'drybush', 'Сухой куст', plant({ drop: [I.STICK, 1] }));
block(37, 'stone_bricks', 'Каменный кирпич', { hard: 4, tool: 'pick', tier: 1 });
block(38, 'lava', 'Лава', {
  solid: false,
  opaque: false,
  light: 15,
  lopac: 3,
  hard: -1,
  cullSame: true,
  replaceable: true,
  drop: null,
  liquid: 2,
});
block(39, 'basalt', 'Базальт', { hard: 5, tool: 'pick', tier: 1 });

export const PAINTS = [
  ['white', 'Белый блок', 0xf2f2ee],
  ['red', 'Красный блок', 0xd9453d],
  ['orange', 'Оранжевый блок', 0xf08a2c],
  ['yellow', 'Жёлтый блок', 0xf2cf3a],
  ['green', 'Зелёный блок', 0x4fb04a],
  ['cyan', 'Бирюзовый блок', 0x38bdb8],
  ['blue', 'Синий блок', 0x3f6fd9],
  ['purple', 'Фиолетовый блок', 0x8c52c9],
  ['black', 'Чёрный блок', 0x2a2a30],
];
PAINTS.forEach(([key, name], i) => block(40 + i, 'paint_' + key, name, { hard: 1.2, tool: 'pick' }));
// Ящик: при разрушении даёт случайные припасы (см. CRATE_LOOT).
block(49, 'crate', 'Ящик с припасами', { tiles: ['crate_top', 'crate_side', 'crate_top'], hard: 1.2, tool: 'axe', drop: null });

export const TILE_COUNT = TILES.length;

// ---------- Описания предметов ----------
export const ITEMS = {};
function item(id, key, name, o = {}) {
  ITEMS[id] = { id, key, name, stack: o.stack || 99, tool: o.tool || null, dmg: o.dmg || 1, food: o.food || 0 };
}
item(I.STICK, 'stick', 'Палка');
item(I.COAL, 'coal', 'Уголь');
item(I.COPPER_INGOT, 'copper_ingot', 'Медный слиток');
item(I.CRYSTAL, 'crystal', 'Кристалл');
item(I.FLUFF, 'fluff', 'Пух');
item(I.SHADOW_DUST, 'shadow_dust', 'Теневая пыль');
item(I.BERRIES, 'berries', 'Ягоды', { food: 4 });
item(I.HOOK, 'hook', 'Крюк-кошка', { stack: 1 });
item(I.GLIDER, 'glider', 'Планер', { stack: 1 });
item(I.BUCKET, 'bucket', 'Ведро', { stack: 16 });
item(I.BUCKET_WATER, 'bucket_water', 'Ведро воды', { stack: 1 });
item(I.BUCKET_LAVA, 'bucket_lava', 'Ведро лавы', { stack: 1 });

export const TIER_NAMES = ['', 'wood', 'stone', 'copper', 'crystal'];
const TIER_RU_F = ['', 'Деревянная', 'Каменная', 'Медная', 'Кристальная'];
const TIER_RU_M = ['', 'Деревянный', 'Каменный', 'Медный', 'Кристальный'];
export const TIER_MULT = [1, 2.5, 4, 6, 9];
for (let t = 1; t <= 4; t++) {
  item(I.PICK_WOOD + t - 1, 'pick_' + TIER_NAMES[t], TIER_RU_F[t] + ' кирка', {
    stack: 1,
    tool: { type: 'pick', tier: t },
    dmg: 2,
  });
  item(I.AXE_WOOD + t - 1, 'axe_' + TIER_NAMES[t], TIER_RU_M[t] + ' топор', {
    stack: 1,
    tool: { type: 'axe', tier: t },
    dmg: 2 + t,
  });
  item(I.SHOVEL_WOOD + t - 1, 'shovel_' + TIER_NAMES[t], TIER_RU_F[t] + ' лопата', {
    stack: 1,
    tool: { type: 'shovel', tier: t },
    dmg: 2,
  });
  item(I.SWORD_WOOD + t - 1, 'sword_' + TIER_NAMES[t], TIER_RU_M[t] + ' меч', {
    stack: 1,
    tool: { type: 'sword', tier: t },
    dmg: 2 + t * 1.5,
  });
}

export const isBlock = (id) => id > 0 && id < 256;
export const itemName = (id) => (id < 256 ? BLOCKS[id]?.name : ITEMS[id]?.name) || '???';
export const maxStack = (id) => (id < 256 ? 99 : ITEMS[id]?.stack || 99);
export const validItem = (id) => (id < 256 ? !!BLOCKS[id] : !!ITEMS[id]);

// Время разрушения блока предметом в руке (секунды). Infinity — нельзя сломать.
export function breakTime(blockId, heldId) {
  const def = BLOCKS[blockId];
  if (!def || def.hard < 0) return Infinity;
  const tool = ITEMS[heldId]?.tool;
  const mult = tool && def.tool && tool.type === def.tool ? TIER_MULT[tool.tier] : 1;
  return def.hard / mult;
}

// Что выпадет из блока: [id, n] или null.
export function dropsFor(blockId, heldId) {
  const def = BLOCKS[blockId];
  if (!def || !def.drop) return null;
  if (def.tier > 0) {
    const tool = ITEMS[heldId]?.tool;
    if (!tool || tool.type !== def.tool || tool.tier < def.tier) return null;
  }
  return def.drop;
}

// ---------- Рецепты ----------
export const RECIPES = [];
function recipe(out, n, ...ins) {
  RECIPES.push({ out: [out, n], ins });
}
recipe(B.PLANKS, 4, [B.LOG, 1]);
recipe(B.PLANKS, 4, [B.PINE_LOG, 1]);
recipe(I.STICK, 4, [B.PLANKS, 2]);
const TIER_MAT = [0, B.PLANKS, B.COBBLE, I.COPPER_INGOT, I.CRYSTAL];
for (let t = 1; t <= 4; t++) {
  recipe(I.PICK_WOOD + t - 1, 1, [TIER_MAT[t], 3], [I.STICK, 2]);
  recipe(I.AXE_WOOD + t - 1, 1, [TIER_MAT[t], 3], [I.STICK, 2]);
  recipe(I.SHOVEL_WOOD + t - 1, 1, [TIER_MAT[t], 1], [I.STICK, 2]);
  recipe(I.SWORD_WOOD + t - 1, 1, [TIER_MAT[t], 2], [I.STICK, 1]);
}
recipe(I.COPPER_INGOT, 1, [B.COPPER_ORE, 1], [I.COAL, 1]);
recipe(B.LAMP, 2, [B.GLASS, 1], [I.COAL, 1], [I.STICK, 1]);
recipe(B.GLASS, 2, [B.SAND, 2], [I.COAL, 1]);
recipe(B.BRICK, 2, [B.DIRT, 2], [I.COAL, 1]);
recipe(B.STONE_BRICKS, 4, [B.COBBLE, 4]);
recipe(B.SANDSTONE, 2, [B.SAND, 4]);
recipe(B.TRAMPOLINE, 1, [I.FLUFF, 3], [B.PLANKS, 2]);
recipe(I.GLIDER, 1, [I.FLUFF, 6], [I.STICK, 4]);
recipe(I.HOOK, 1, [I.COPPER_INGOT, 3], [I.STICK, 2], [I.FLUFF, 2]);
recipe(I.BUCKET, 1, [I.COPPER_INGOT, 3]);
recipe(B.BARREL, 1, [B.PLANKS, 4], [I.COAL, 2], [I.SHADOW_DUST, 1]);
recipe(B.PAD, 2, [I.CRYSTAL, 2], [I.SHADOW_DUST, 2], [B.COBBLE, 4]);
recipe(B.COPPER_BLOCK, 1, [I.COPPER_INGOT, 4]);
recipe(B.CRYSTAL_BLOCK, 1, [I.CRYSTAL, 4]);
recipe(B.PAINT_WHITE, 4, [B.COBBLE, 2], [B.SNOW, 1]);
recipe(B.PAINT_WHITE, 4, [B.COBBLE, 2], [I.FLUFF, 1]);
recipe(B.PAINT_RED, 4, [B.COBBLE, 2], [B.FLOWER_RED, 1]);
recipe(B.PAINT_ORANGE, 4, [B.COBBLE, 2], [B.FLOWER_RED, 1], [B.FLOWER_YELLOW, 1]);
recipe(B.PAINT_YELLOW, 4, [B.COBBLE, 2], [B.FLOWER_YELLOW, 1]);
recipe(B.PAINT_GREEN, 4, [B.COBBLE, 2], [B.LEAVES, 2]);
recipe(B.PAINT_CYAN, 4, [B.COBBLE, 2], [B.GLOWSHROOM, 1]);
recipe(B.PAINT_BLUE, 4, [B.COBBLE, 2], [I.BERRIES, 2]);
recipe(B.PAINT_PURPLE, 4, [B.COBBLE, 2], [I.SHADOW_DUST, 1]);
recipe(B.PAINT_BLACK, 4, [B.COBBLE, 2], [I.COAL, 1]);

// Палитра творческого режима.
export const CREATIVE_ITEMS = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.STONE_BRICKS, B.SAND, B.SANDSTONE, B.GRAVEL, B.SNOW, B.ICE,
  B.LOG, B.PLANKS, B.LEAVES, B.PINE_LOG, B.PINE_LEAVES, B.BRICK, B.GLASS, B.LAMP,
  B.COAL_ORE, B.COPPER_ORE, B.CRYSTAL_ORE, B.COPPER_BLOCK, B.CRYSTAL_BLOCK, B.SKYMOSS, B.SKYSTONE,
  B.PAINT_WHITE, B.PAINT_RED, B.PAINT_ORANGE, B.PAINT_YELLOW, B.PAINT_GREEN, B.PAINT_CYAN, B.PAINT_BLUE,
  B.PAINT_PURPLE, B.PAINT_BLACK,
  B.FLOWER_RED, B.FLOWER_YELLOW, B.TALLGRASS, B.GLOWSHROOM, B.BERRY_BUSH, B.DRYBUSH,
  B.BASALT, B.CRATE, B.TRAMPOLINE, B.BARREL, B.PAD, I.HOOK, I.GLIDER, I.BUCKET, I.BUCKET_WATER, I.BUCKET_LAVA,
  I.PICK_CRYSTAL, I.AXE_CRYSTAL, I.SHOVEL_CRYSTAL, I.SWORD_CRYSTAL, I.BERRIES,
];

// Что лежит в ящиках с припасами (выпадают две случайные позиции).
export const CRATE_LOOT = [
  [I.COAL, 4],
  [I.COPPER_INGOT, 2],
  [I.BERRIES, 5],
  [I.CRYSTAL, 1],
  [I.FLUFF, 3],
  [I.STICK, 6],
  [B.LAMP, 2],
  [I.SHADOW_DUST, 1],
  [I.BUCKET, 1],
];

// Профессии жителей деревень: что житель берёт и что даёт взамен.
export const JOBS = [
  { name: 'Кузнец', color: '#ff9d5c', give: [I.COAL, 6], get: [I.COPPER_INGOT, 1] },
  { name: 'Фермер', color: '#8fd96b', give: [I.BERRIES, 6], get: [I.FLUFF, 2] },
  { name: 'Алхимик', color: '#b197fc', give: [I.SHADOW_DUST, 3], get: [I.CRYSTAL, 2] },
  { name: 'Каменщик', color: '#c3cad6', give: [B.COBBLE, 16], get: [B.LAMP, 3] },
  { name: 'Водонос', color: '#5cc8ff', give: [I.COPPER_INGOT, 2], get: [I.BUCKET, 1] },
];
