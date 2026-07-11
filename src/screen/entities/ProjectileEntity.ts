import Phaser from 'phaser';
import { WEAPONS, type WeaponDef } from '../../shared/config';
import type { WeaponKey } from '../../shared/protocol';
import { velocityFromAim } from '../physics/ballistics';
import type { BodyRef, PhysicsWorld } from '../physics/PhysicsWorld';
import type { CharacterUnit } from './CharacterUnit';

/** Снаряд: фізична куля з CCD + слід. Вибухом керує GameScene. */
export class ProjectileEntity {
  readonly weapon: WeaponDef;
  readonly weaponKey: WeaponKey;
  readonly shooter: CharacterUnit | null;
  readonly firedAt: number;
  /** Кластерний осколок не породжує нових осколків */
  readonly isFragment: boolean;

  ref: BodyRef;
  finished = false;

  private gfx: Phaser.GameObjects.Graphics;
  private trail: { x: number; y: number }[] = [];

  constructor(
    scene: Phaser.Scene,
    private physics: PhysicsWorld,
    x: number,
    y: number,
    velX: number,
    velY: number,
    weaponKey: WeaponKey,
    windPxS2: number,
    shooter: CharacterUnit | null,
    opts: { isFragment?: boolean } = {},
  ) {
    this.weaponKey = weaponKey;
    this.weapon = WEAPONS[weaponKey];
    this.shooter = shooter;
    this.isFragment = opts.isFragment ?? false;
    this.firedAt = scene.time.now;

    const radius = this.isFragment ? 5 : 8;
    this.ref = physics.createProjectile(x, y, radius, { x: velX, y: velY }, windPxS2, this);
    this.gfx = scene.add.graphics().setDepth(6);
  }

  /** Створити снаряд із кута (градуси) та сили (0–100) */
  static fromAim(
    scene: Phaser.Scene,
    physics: PhysicsWorld,
    x: number,
    y: number,
    angleDeg: number,
    power: number,
    weaponKey: WeaponKey,
    windPxS2: number,
    shooter: CharacterUnit,
  ): ProjectileEntity {
    const vel = velocityFromAim(angleDeg, power, weaponKey);
    return new ProjectileEntity(scene, physics, x, y, vel.x, vel.y, weaponKey, windPxS2, shooter);
  }

  get x(): number { return this.physics.posPx(this.ref).x; }
  get y(): number { return this.physics.posPx(this.ref).y; }

  /** Контакт із власником у перші миті польоту не рахується */
  ignoresContactWith(other: unknown, now: number): boolean {
    return other === this.shooter && now - this.firedAt < 250;
  }

  sync(): void {
    if (this.finished) return;

    if (this.physics.isOutOfBounds(this.ref)) {
      this.destroy();
      return;
    }

    const p = this.physics.posPx(this.ref);
    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > 24) this.trail.shift();

    const g = this.gfx;
    g.clear();
    this.trail.forEach((t, i) => {
      g.fillStyle(this.weapon.trailColor, (i / this.trail.length) * 0.55);
      g.fillCircle(t.x, t.y, (i / this.trail.length) * 5);
    });

    g.fillStyle(this.weapon.projectileColor);
    g.fillCircle(p.x, p.y, this.isFragment ? 5 : 8);
    g.fillStyle(0xffffff, 0.45);
    g.fillCircle(p.x - 2, p.y - 2, 3);

    // Поплавок фішинг-бомби має впізнаваний вигляд
    if (this.weapon.behavior === 'fishing' && !this.isFragment) {
      g.fillStyle(0xef4444);
      g.fillCircle(p.x, p.y, 9);
      g.fillStyle(0xffffff);
      g.fillCircle(p.x, p.y + 3, 5);
    }
  }

  /** Прибрати снаряд (після вибуху або вильоту за межі) */
  destroy(): void {
    if (this.finished) return;
    this.finished = true;
    this.physics.remove(this.ref);
    this.gfx.destroy();
  }

  /** Поплавок приземлився: тіло стає нерухомим, візуал лишається */
  freezeAsFloat(): void {
    this.physics.freeze(this.ref);
  }
}
