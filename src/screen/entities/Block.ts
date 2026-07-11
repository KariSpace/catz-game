import Phaser from 'phaser';
import { MATERIALS, type BlockSpec } from '../../shared/blueprints';
import type { BodyRef, PhysicsWorld } from '../physics/PhysicsWorld';

/** Один фізичний блок будівлі: тіло в Rapier + прямокутник на екрані */
export class Block {
  readonly ref: BodyRef;
  hp: number;
  readonly maxHp: number;
  destroyed = false;
  /** База команди, що ходить: прозора і невидима для снарядів */
  ghosted = false;

  private rect: Phaser.GameObjects.Rectangle;
  private baseFill: number;

  constructor(
    private scene: Phaser.Scene,
    private physics: PhysicsWorld,
    cxPx: number,
    cyPx: number,
    spec: BlockSpec,
  ) {
    const mat = MATERIALS[spec.material];
    this.hp = mat.hp;
    this.maxHp = mat.hp;
    this.baseFill = mat.fill;

    this.ref = physics.createBlock(cxPx, cyPx, spec.w, spec.h, mat, this);
    this.rect = scene.add
      .rectangle(cxPx, cyPx, spec.w, spec.h, mat.fill)
      .setStrokeStyle(1.5, mat.edge)
      .setDepth(2);
  }

  get x(): number { return this.rect.x; }
  get y(): number { return this.rect.y; }

  sync(): void {
    if (this.destroyed) return;
    if (this.physics.isOutOfBounds(this.ref)) {
      this.destroy(false);
      return;
    }
    const p = this.physics.posPx(this.ref);
    this.rect.setPosition(p.x, p.y);
    this.rect.setRotation(this.physics.rotation(this.ref));
  }

  takeDamage(amount: number): void {
    if (this.destroyed || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);

    // Візуальна деградація: темніє з утратою HP
    const frac = this.hp / this.maxHp;
    if (frac <= 0) {
      this.destroy(true);
    } else if (frac < 0.35) {
      this.rect.setFillStyle(this.darken(this.baseFill, 0.45));
    } else if (frac < 0.7) {
      this.rect.setFillStyle(this.darken(this.baseFill, 0.72));
    }
    this.applyAlpha();
  }

  setGhost(ghost: boolean): void {
    if (this.destroyed || this.ghosted === ghost) return;
    this.ghosted = ghost;
    this.physics.setBlockGhost(this.ref, ghost);
    this.applyAlpha();
  }

  private applyAlpha(): void {
    const damaged = this.hp / this.maxHp < 0.35 ? 0.85 : 1;
    this.rect.setAlpha(this.ghosted ? 0.3 : damaged);
  }

  private darken(color: number, k: number): number {
    const r = ((color >> 16) & 0xff) * k;
    const g = ((color >> 8) & 0xff) * k;
    const b = (color & 0xff) * k;
    return (r << 16) | (g << 8) | b;
  }

  private destroy(withDebris: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (withDebris) {
      const p = this.physics.posPx(this.ref);
      for (let i = 0; i < 5; i++) {
        const shard = this.scene.add
          .rectangle(p.x, p.y, 7, 7, this.baseFill)
          .setDepth(5);
        this.scene.tweens.add({
          targets: shard,
          x: p.x + Phaser.Math.Between(-45, 45),
          y: p.y + Phaser.Math.Between(-20, 60),
          angle: Phaser.Math.Between(-180, 180),
          alpha: 0,
          duration: 500,
          ease: 'Power2',
          onComplete: () => shard.destroy(),
        });
      }
    }

    this.physics.remove(this.ref);
    this.rect.destroy();
  }
}
