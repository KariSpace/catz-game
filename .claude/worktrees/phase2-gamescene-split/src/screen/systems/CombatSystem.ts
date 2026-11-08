import { DAMAGE, WEAPONS } from '../../shared/config';
import type { Team, WeaponKey } from '../../shared/protocol';
import type { BodyRef } from '../physics/PhysicsWorld';
import type { CharacterUnit } from '../entities/CharacterUnit';
import type { ProjectileEntity } from '../entities/ProjectileEntity';

/** Шкода вибуху сягає далі за візуальний радіус — узгоджено з applyExplosion (×1.6 для імпульсу) */
const DAMAGE_REACH_SCALE = 1.2;
/** Поправка на габарит капсули персонажа: відстань міряємо до краю, не до центру */
const CHAR_RADIUS_PX = 18;
/** Осколки furball: віяло вгору і швидкість розльоту */
const CLUSTER_ANGLES_DEG = [65, 90, 115];
const CLUSTER_SPEED_PX = 260;

export interface BlockTarget {
  x: number;
  y: number;
  ghosted: boolean;
  takeDamage(amount: number): void;
}

/** Блок, якому можна вмикати «примарність» (Block — виконавець візуалу й фізики) */
export interface GhostableBlock {
  destroyed: boolean;
  setGhost(on: boolean): void;
}

export interface CharTarget {
  x: number;
  y: number;
  dead: boolean;
  takeDamage(amount: number): void;
}

export interface CombatDeps {
  /** Фізичний розкид тіл вибухом; skip — тіла, яких вибух не торкається */
  applyExplosion(
    xPx: number, yPx: number, radiusPx: number, blastSpeed: number,
    skip: (ref: BodyRef) => boolean,
  ): void;
  /** Живі блоки обох будівель */
  blocks(): BlockTarget[];
  /** Усі блоки будівлі команди — для керування примарністю */
  teamBlocks(team: Team): GhostableBlock[];
  chars(): CharTarget[];
  /** Заспавнити кластерний осколок (сцена додає вітер і веде список снарядів) */
  spawnFragment(
    xPx: number, yPx: number, velX: number, velY: number,
    weaponKey: WeaponKey, shooter: CharacterUnit | null,
  ): void;
  fx: {
    explosion(xPx: number, yPx: number, radiusPx: number): void;
    damageNumber(xPx: number, yPx: number, amount: number): void;
  };
  /** Чиєсь HP змінилось — сцена оновлює HUD */
  onHpChanged(): void;
}

/** Лінійне спадання шкоди від епіцентру; на межі reach і далі — 0 */
export function falloffDamage(base: number, dist: number, reach: number): number {
  if (dist >= reach) return 0;
  return Math.round(base * (1 - Math.max(0, dist) / reach));
}

/**
 * Шкода від удару зі зміною швидкості Δv (м/с) — однакова формула для
 * fall damage і crush damage; scale пом'якшує її для блоків.
 */
export function impactDamage(dv: number, scale = 1): number {
  const over = dv - DAMAGE.IMPACT_MIN_DV;
  if (over <= 0) return 0;
  return Math.min(DAMAGE.IMPACT_MAX, Math.round(over * DAMAGE.IMPACT_DMG_PER_DV * scale));
}

/** Єдине місце шкоди: вибухи, Δv-удари, кластерні осколки */
export class CombatSystem {
  /** Шкода від ударів вмикається з першого ходу — початкове осідання безболісне */
  impactDamageEnabled = false;

  constructor(private deps: CombatDeps) {}

  /**
   * База команди, що ходить, — «примарна» (канон, GDD §5): прозора, снаряд
   * пролітає крізь неї, вибух її не чіпає (skip-предикат у explode). Для
   * персонажів вона далі тверда — тримає стрільця.
   */
  setActiveTeam(team: Team): void {
    for (const t of ['cats', 'dogs'] as const) {
      const ghost = t === team;
      for (const block of this.deps.teamBlocks(t)) block.setGhost(ghost && !block.destroyed);
    }
  }

  explode(x: number, y: number, weaponKey: WeaponKey): void {
    const def = WEAPONS[weaponKey];
    this.deps.fx.explosion(x, y, def.blastRadiusPx);
    // Примарну базу стрільця вибух не чіпає — ані імпульсом, ані шкодою
    this.deps.applyExplosion(
      x, y, def.blastRadiusPx, def.blastSpeed,
      (ref) => ref.tag.kind === 'block' && (ref.tag.owner as BlockTarget).ghosted,
    );

    const reach = def.blastRadiusPx * DAMAGE_REACH_SCALE;

    for (const block of this.deps.blocks()) {
      if (block.ghosted) continue;
      block.takeDamage(falloffDamage(def.damage, Math.hypot(block.x - x, block.y - y), reach));
    }

    for (const char of this.deps.chars()) {
      if (char.dead) continue;
      const dmg = falloffDamage(def.damage, Math.hypot(char.x - x, char.y - y) - CHAR_RADIUS_PX, reach);
      if (dmg > 0) {
        this.deps.fx.damageNumber(char.x, char.y - 30, dmg);
        char.takeDamage(dmg);
      }
    }

    this.deps.onHpChanged();
  }

  /** Удар (падіння, приліт блока) від фізичної події contact force */
  impact(ref: BodyRef, dv: number): void {
    if (!this.impactDamageEnabled) return;

    if (ref.tag.kind === 'character') {
      const char = ref.tag.owner as CharTarget;
      if (char.dead) return;
      const dmg = impactDamage(dv);
      if (dmg > 0) {
        this.deps.fx.damageNumber(char.x, char.y - 30, dmg);
        char.takeDamage(dmg);
        this.deps.onHpChanged();
      }
    } else if (ref.tag.kind === 'block') {
      (ref.tag.owner as BlockTarget).takeDamage(impactDamage(dv, DAMAGE.BLOCK_IMPACT_SCALE));
    }
  }

  /** Furball за GDD не вибухає сам — розбивається на 3 осколки при ударі */
  splitCluster(proj: ProjectileEntity): void {
    const { x, y, weaponKey, shooter } = proj;
    proj.destroy();
    for (const angle of CLUSTER_ANGLES_DEG) {
      const rad = (angle * Math.PI) / 180;
      this.deps.spawnFragment(
        x, y - 6,
        Math.cos(rad) * CLUSTER_SPEED_PX, -Math.sin(rad) * CLUSTER_SPEED_PX,
        weaponKey, shooter,
      );
    }
  }
}
