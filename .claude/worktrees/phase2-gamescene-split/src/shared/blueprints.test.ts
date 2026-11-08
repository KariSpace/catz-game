import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, type Blueprint, type BlockSpec } from './blueprints';

// Валідація правил стабільності блупринтів (README): жодних перетинів при
// спавні, кожен блок має опору, спавни стоять на блоках, усе в межах ширини.
// T19 ганятиме ці ж перевірки по 100 сідах на блупринт.

const left = (b: BlockSpec) => b.x - b.w / 2;
const right = (b: BlockSpec) => b.x + b.w / 2;
const top = (b: BlockSpec) => b.y + b.h / 2; // y — висота центру над землею, вгору +
const bottom = (b: BlockSpec) => b.y - b.h / 2;

function overlaps(a: BlockSpec, b: BlockSpec): boolean {
  return (
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 0.01 &&
    Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 0.01
  );
}

function findOverlaps(bp: Blueprint): string[] {
  const bad: string[] = [];
  for (let i = 0; i < bp.blocks.length; i++) {
    for (let j = i + 1; j < bp.blocks.length; j++) {
      if (overlaps(bp.blocks[i], bp.blocks[j])) bad.push(`#${i}~#${j}`);
    }
  }
  return bad;
}

/** Блок стоїть на землі (низ ≤ 4px) або на іншому блоці (зазор 0–6px, перекриття по X ≥ 6px) */
function unsupported(bp: Blueprint): number[] {
  return bp.blocks.flatMap((b, i) => {
    if (bottom(b) <= 4) return [];
    const held = bp.blocks.some((s, j) => {
      if (i === j) return false;
      const gap = bottom(b) - top(s);
      if (gap < -1 || gap > 6) return false;
      const xOverlap = Math.min(right(b), right(s)) - Math.max(left(b), left(s));
      return xOverlap >= 6;
    });
    return held ? [] : [i];
  });
}

/** Спавн стоїть на верхній грані якогось блока */
function orphanSpawns(bp: Blueprint): number[] {
  return bp.spawns.flatMap((s, i) => {
    const onBlock = bp.blocks.some(
      (b) => Math.abs(top(b) - s.y) <= 6 && Math.abs(s.x - b.x) <= b.w / 2 + 1,
    );
    return onBlock ? [] : [i];
  });
}

describe.each(Object.entries(BLUEPRINTS))('блупринт %s', (_name, make) => {
  const bp = make();

  it('блоки не перетинаються при спавні', () => {
    expect(findOverlaps(bp)).toEqual([]);
  });

  it('кожен блок має опору під собою', () => {
    expect(unsupported(bp)).toEqual([]);
  });

  it('усі спавни стоять на блоках', () => {
    expect(bp.spawns.length).toBeGreaterThanOrEqual(4);
    expect(orphanSpawns(bp)).toEqual([]);
  });

  it('усе в межах заявленої ширини', () => {
    for (const b of bp.blocks) {
      expect(Math.abs(b.x) + b.w / 2).toBeLessThanOrEqual(bp.width / 2 + 2);
    }
    for (const s of bp.spawns) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(bp.width / 2);
    }
  });
});

describe('валідатор ловить зіпсутий блупринт', () => {
  const broken: Blueprint = {
    width: 100,
    blocks: [
      { x: 0, y: 20, w: 40, h: 40, material: 'box' }, // на землі
      { x: 10, y: 30, w: 40, h: 40, material: 'box' }, // перетинається з першим
      { x: 0, y: 200, w: 40, h: 40, material: 'box' }, // висить у повітрі
    ],
    spawns: [{ x: 90, y: 40 }], // не на блоці
  };

  it('бачить перетин, відсутність опори і сирітський спавн', () => {
    expect(findOverlaps(broken)).not.toEqual([]);
    expect(unsupported(broken)).toContain(2);
    expect(orphanSpawns(broken)).toEqual([0]);
  });
});
