import { describe, expect, it } from 'vitest';
import { CombatSystem, falloffDamage, impactDamage, type BlockTarget, type CharTarget, type CombatDeps } from './CombatSystem';
import { DAMAGE, WEAPONS } from '../../shared/config';
import type { BodyRef } from '../physics/PhysicsWorld';

describe('falloffDamage', () => {
  it('в епіцентрі — повна шкода', () => {
    expect(falloffDamage(30, 0, 66)).toBe(30);
  });

  it("від'ємна відстань (перекриття з капсулою) не підсилює шкоду", () => {
    expect(falloffDamage(30, -10, 66)).toBe(30);
  });

  it('на межі reach і далі — нуль', () => {
    expect(falloffDamage(30, 66, 66)).toBe(0);
    expect(falloffDamage(30, 100, 66)).toBe(0);
  });

  it('посередині — лінійна половина', () => {
    expect(falloffDamage(30, 33, 66)).toBe(15);
  });
});

describe('impactDamage', () => {
  it('удари до порога безболісні', () => {
    expect(impactDamage(DAMAGE.IMPACT_MIN_DV)).toBe(0);
    expect(impactDamage(DAMAGE.IMPACT_MIN_DV - 1)).toBe(0);
  });

  it('понад поріг — лінійно', () => {
    expect(impactDamage(DAMAGE.IMPACT_MIN_DV + 2)).toBe(2 * DAMAGE.IMPACT_DMG_PER_DV);
  });

  it('стеля IMPACT_MAX', () => {
    expect(impactDamage(1000)).toBe(DAMAGE.IMPACT_MAX);
  });

  it('BLOCK_IMPACT_SCALE пом’якшує шкоду блокам', () => {
    const dv = DAMAGE.IMPACT_MIN_DV + 2;
    expect(impactDamage(dv, DAMAGE.BLOCK_IMPACT_SCALE)).toBe(
      Math.round(2 * DAMAGE.IMPACT_DMG_PER_DV * DAMAGE.BLOCK_IMPACT_SCALE),
    );
  });
});

// ─── CombatSystem на фейкових цілях ────────────────────────────────────

function makeBlock(x: number, y: number, ghosted = false) {
  const block = {
    x, y, ghosted,
    taken: [] as number[],
    takeDamage(n: number) { block.taken.push(n); },
  };
  return block satisfies BlockTarget & { taken: number[] };
}

function makeChar(x: number, y: number, dead = false) {
  const char = {
    x, y, dead,
    taken: [] as number[],
    takeDamage(n: number) { char.taken.push(n); },
  };
  return char satisfies CharTarget & { taken: number[] };
}

function makeGhostable(destroyed = false) {
  const block = {
    destroyed,
    ghost: null as boolean | null,
    setGhost(on: boolean) { block.ghost = on; },
  };
  return block;
}

function makeCombat(
  blocks: BlockTarget[], chars: CharTarget[],
  teamBlocks: { cats: ReturnType<typeof makeGhostable>[]; dogs: ReturnType<typeof makeGhostable>[] } = { cats: [], dogs: [] },
) {
  const calls = {
    explosions: [] as { x: number; y: number; r: number }[],
    fragments: [] as { x: number; y: number; velX: number; velY: number }[],
    skips: null as ((ref: BodyRef) => boolean) | null,
    hpChanged: 0,
  };
  const deps: CombatDeps = {
    applyExplosion: (_x, _y, _r, _s, skip) => { calls.skips = skip; },
    blocks: () => blocks,
    teamBlocks: (team) => teamBlocks[team],
    chars: () => chars,
    spawnFragment: (x, y, velX, velY) => calls.fragments.push({ x, y, velX, velY }),
    fx: {
      explosion: (x, y, r) => calls.explosions.push({ x, y, r }),
      damageNumber: () => {},
    },
    onHpChanged: () => calls.hpChanged++,
  };
  return { calls, combat: new CombatSystem(deps) };
}

describe('CombatSystem.explode', () => {
  it('шкодить блокам і персонажам за falloff, повідомляє про HP', () => {
    const def = WEAPONS.hairball;
    const reach = def.blastRadiusPx * 1.2;
    const block = makeBlock(0, 0);
    const char = makeChar(0, 0);
    const { calls, combat } = makeCombat([block], [char]);

    combat.explode(0, 0, 'hairball');

    expect(block.taken).toEqual([def.damage]);
    // Персонажу відстань міряється до краю капсули (−18px) — епіцентр дає повну шкоду
    expect(char.taken).toEqual([falloffDamage(def.damage, -18, reach)]);
    expect(calls.explosions).toEqual([{ x: 0, y: 0, r: def.blastRadiusPx }]);
    expect(calls.hpChanged).toBe(1);
  });

  it('примарні блоки і мертві персонажі поза шкодою; skip-предикат фільтрує примарні тіла', () => {
    const ghost = makeBlock(0, 0, true);
    const dead = makeChar(0, 0, true);
    const { calls, combat } = makeCombat([ghost], [dead]);

    combat.explode(0, 0, 'hairball');

    expect(ghost.taken).toEqual([]);
    expect(dead.taken).toEqual([]);
    expect(calls.skips!({ tag: { kind: 'block', owner: ghost } } as BodyRef)).toBe(true);
    expect(calls.skips!({ tag: { kind: 'block', owner: makeBlock(0, 0) } } as BodyRef)).toBe(false);
    expect(calls.skips!({ tag: { kind: 'character', owner: dead } } as BodyRef)).toBe(false);
  });
});

describe('CombatSystem.impact', () => {
  const charRef = (char: CharTarget) => ({ tag: { kind: 'character', owner: char } }) as BodyRef;
  const blockRef = (block: BlockTarget) => ({ tag: { kind: 'block', owner: block } }) as BodyRef;

  it('вимкнена до першого ходу — початкове осідання безболісне', () => {
    const char = makeChar(0, 0);
    const { combat } = makeCombat([], [char]);
    combat.impact(charRef(char), 100);
    expect(char.taken).toEqual([]);
  });

  it('персонаж: шкода за Δv + onHpChanged; блок: масштабована, без onHpChanged', () => {
    const char = makeChar(0, 0);
    const block = makeBlock(0, 0);
    const { calls, combat } = makeCombat([block], [char]);
    combat.impactDamageEnabled = true;

    const dv = DAMAGE.IMPACT_MIN_DV + 3;
    combat.impact(charRef(char), dv);
    combat.impact(blockRef(block), dv);

    expect(char.taken).toEqual([impactDamage(dv)]);
    expect(calls.hpChanged).toBe(1);
    expect(block.taken).toEqual([impactDamage(dv, DAMAGE.BLOCK_IMPACT_SCALE)]);
  });
});

describe('CombatSystem.setActiveTeam', () => {
  it('база стрільця примарна, чужа — тверда, зруйновані блоки не чіпаються', () => {
    const catBlock = makeGhostable();
    const catRuin = makeGhostable(true);
    const dogBlock = makeGhostable();
    const { combat } = makeCombat([], [], { cats: [catBlock, catRuin], dogs: [dogBlock] });

    combat.setActiveTeam('cats');
    expect(catBlock.ghost).toBe(true);
    expect(catRuin.ghost).toBe(false);
    expect(dogBlock.ghost).toBe(false);

    combat.setActiveTeam('dogs');
    expect(catBlock.ghost).toBe(false);
    expect(dogBlock.ghost).toBe(true);
  });
});

describe('CombatSystem.splitCluster', () => {
  it('три осколки віялом угору, оригінал знищено', () => {
    const { calls, combat } = makeCombat([], []);
    let destroyed = false;
    combat.splitCluster({
      x: 100, y: 200, weaponKey: 'furball', shooter: null,
      destroy: () => { destroyed = true; },
    } as never);

    expect(destroyed).toBe(true);
    expect(calls.fragments).toHaveLength(3);
    for (const f of calls.fragments) {
      expect(f.y).toBe(194);
      expect(f.velY).toBeLessThan(0);
    }
    // Віяло симетричне: лівий + правий = 0, середній вертикальний
    expect(calls.fragments[0].velX + calls.fragments[2].velX).toBeCloseTo(0, 6);
    expect(calls.fragments[1].velX).toBeCloseTo(0, 6);
  });
});
