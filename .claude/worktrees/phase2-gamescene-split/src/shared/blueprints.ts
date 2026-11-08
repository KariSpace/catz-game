import type { StructureId } from './protocol';

// Будівля = набір фізичних блоків. Координати локальні:
// x — від центру будівлі (вправо +), y — висота ЦЕНТРУ блока над землею (вгору +).
// GameScene конвертує їх у світові екранні координати при спавні.

export type MaterialId = 'stone' | 'wood' | 'box';

export interface MaterialDef {
  density: number;   // кг/м² (2D)
  friction: number;
  hp: number;
  fill: number;
  edge: number;
}

// Густини підібрані так, щоб персонаж (~1.4 кг) не продавлював структуру:
// блоки мають бути співмірні з ним або важчі
export const MATERIALS: Record<MaterialId, MaterialDef> = {
  stone: { density: 3.0, friction: 0.9, hp: 120, fill: 0x6b7280, edge: 0x374151 },
  wood:  { density: 1.6, friction: 0.8, hp: 60,  fill: 0xb87030, edge: 0x5a3515 },
  box:   { density: 0.8, friction: 0.7, hp: 25,  fill: 0xd97706, edge: 0x92400e },
};

export interface BlockSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  material: MaterialId;
}

export interface Blueprint {
  blocks: BlockSpec[];
  /** Точки, де стоять персонажі (позиція ніг): x від центру, y — висота поверхні над землею */
  spawns: { x: number; y: number }[];
  width: number;
}

const GAP = 2; // зазор між блоками, щоб солвер стартував без взаємопроникнень

// ─── Tower: вузька, 4 поверхи на дерев'яних стовпах ───────────────────
function tower(): Blueprint {
  const blocks: BlockSpec[] = [];
  const spawns: Blueprint['spawns'] = [];
  const W = 180;

  for (const x of [-60, 0, 60]) blocks.push({ x, y: 18, w: 58, h: 36, material: 'stone' });

  // Стовп поверху — один суцільний блок: менше суглобів = стійкіша вежа
  const postH = 70;
  const floorH = postH + GAP * 2 + 16;
  for (let f = 0; f < 4; f++) {
    const bottom = 36 + GAP + f * (floorH + GAP);
    for (const px of [-72, 72]) {
      blocks.push({ x: px, y: bottom + postH / 2, w: 34, h: postH, material: 'wood' });
    }
    const plankY = bottom + postH + GAP * 2 + 8;
    blocks.push({ x: 0, y: plankY, w: W, h: 16, material: 'wood' });
    blocks.push({ x: f % 2 === 0 ? 30 : -30, y: bottom + 16, w: 32, h: 32, material: 'box' });
    spawns.push({ x: f % 2 === 0 ? -34 : 34, y: plankY + 8 });
  }

  return { blocks, spawns, width: W };
}

// ─── Ramp: сходи з ящиків, спуск вправо ───────────────────────────────
function ramp(): Blueprint {
  const blocks: BlockSpec[] = [];
  const spawns: Blueprint['spawns'] = [];
  const W = 300;
  const colW = 50;

  for (let c = 0; c < 6; c++) {
    const x = -W / 2 + colW / 2 + c * colW;
    blocks.push({ x, y: 16, w: 48, h: 32, material: 'stone' });

    const crates = 6 - c;
    for (let r = 0; r < crates; r++) {
      blocks.push({ x, y: 32 + GAP + r * (28 + GAP) + 14, w: 46, h: 28, material: 'box' });
    }
    const topY = 32 + GAP + crates * (28 + GAP) + 6;
    blocks.push({ x, y: topY, w: 48, h: 12, material: 'wood' });
    if (c === 0 || c === 2 || c === 3 || c === 5) spawns.push({ x, y: topY + 6 });
  }

  return { blocks, spawns, width: W };
}

// ─── Bunker: цегляна кладка з кам'яним дахом ──────────────────────────
function bunker(): Blueprint {
  const blocks: BlockSpec[] = [];
  const W = 288;

  for (const x of [-108, -36, 36, 108]) blocks.push({ x, y: 18, w: 70, h: 36, material: 'stone' });

  const rows = 4;
  const bw = 46;
  const bh = 26;
  let wallTop = 36 + GAP;
  for (let r = 0; r < rows; r++) {
    const y = 36 + GAP + r * (bh + GAP) + bh / 2;
    const offset = (r % 2) * (bw / 2);
    for (let x = -W / 2 + bw / 2 - offset; x <= W / 2; x += bw + GAP) {
      if (x - bw / 2 < -W / 2 - 4 || x + bw / 2 > W / 2 + 4) continue;
      blocks.push({ x, y, w: bw, h: bh, material: 'wood' });
    }
    wallTop = 36 + GAP + (r + 1) * (bh + GAP);
  }

  const roofY = wallTop + 9;
  blocks.push({ x: -72, y: roofY, w: 142, h: 18, material: 'stone' });
  blocks.push({ x: 72, y: roofY, w: 142, h: 18, material: 'stone' });

  const roofTop = roofY + 9;
  const spawns = [-105, -35, 35, 105].map((x) => ({ x, y: roofTop }));
  return { blocks, spawns, width: W };
}

// ─── Stack: піраміда ящиків із широкими сходинками ────────────────────
function stack(): Blueprint {
  const blocks: BlockSpec[] = [];
  const W = 320;
  const crateW = 50;
  const crateH = 34;

  let rng = 7;
  const rand = () => {
    // маленький детермінований LCG — розкидає ящики, але однаково щоразу
    rng = (rng * 1103515245 + 12345) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  // Шари звужуються на 2 ящики: сходинка ~52px — персонаж (36px) стоїть вільно.
  // Джитер лише ±1px: менший за зазор, інакше блоки спавняться одне в одному
  // і солвер розкидає всю купу.
  const layers = [6, 4, 2];
  layers.forEach((count, layer) => {
    const y = layer * (crateH + GAP) + crateH / 2;
    const rowW = count * (crateW + GAP);
    for (let i = 0; i < count; i++) {
      const jitter = (rand() - 0.5) * 2;
      blocks.push({
        x: -rowW / 2 + crateW / 2 + i * (crateW + GAP) + jitter,
        y,
        w: crateW,
        h: crateH,
        material: rand() < 0.3 ? 'wood' : 'box',
      });
    }
  });

  // Пара коробок на вершині (центр вільний від персонажів)
  const topY = layers.length * (crateH + GAP);
  blocks.push({ x: -20, y: topY + 13, w: 26, h: 26, material: 'box' });
  blocks.push({ x: 20, y: topY + 13, w: 26, h: 26, material: 'box' });

  // Персонажі — на відкритих сходинках 1-го та 0-го шарів
  const layerTop = (n: number) => n * (crateH + GAP) + crateH;
  const spawns = [
    { x: -78, y: layerTop(1) },
    { x: 78, y: layerTop(1) },
    { x: -130, y: layerTop(0) },
    { x: 130, y: layerTop(0) },
  ];
  return { blocks, spawns, width: W };
}

// ─── Platform: палуба на стовпах ──────────────────────────────────────
function platform(): Blueprint {
  const blocks: BlockSpec[] = [];
  const W = 320;

  // Суцільна кам'яна основа: кожен стовп мусить мати опору
  for (const x of [-100, 0, 100]) blocks.push({ x, y: 15, w: 98, h: 30, material: 'stone' });

  // Стовпи стоять ПІД стиками дощок (±52) і під краями (±140),
  // інакше палуба гойдається на стику і завалює все
  const postTop = 30 + GAP + 56;
  for (const x of [-140, -52, 52, 140]) {
    blocks.push({ x, y: 30 + GAP + 28, w: 24, h: 56, material: 'wood' });
  }

  const deckY = postTop + GAP + 7;
  for (const x of [-104, 0, 104]) {
    blocks.push({ x, y: deckY, w: 102, h: 14, material: 'wood' });
  }

  // Коробки лише по краях палуби — центр вільний для персонажів
  const deckTop = deckY + 7;
  for (const x of [-130, 130]) {
    blocks.push({ x, y: deckTop + GAP + 14, w: 28, h: 28, material: 'box' });
  }

  const spawns = [-75, -25, 25, 75].map((x) => ({ x, y: deckTop }));
  return { blocks, spawns, width: W };
}

export const BLUEPRINTS: Record<StructureId, () => Blueprint> = {
  tower,
  ramp,
  bunker,
  stack,
  platform,
};
