import Phaser from 'phaser';
import { ROUND } from '../../shared/config';

/**
 * Фаза 2 фішинг-бомби: стрілочка бігає в зоні навколо поплавка,
 * тап зупиняє її — рибка вибухає в цій точці. Має таймаут,
 * щоб гравець, який не тапає, не завісив гру.
 */
export class FishMinigame {
  private zoneGfx: Phaser.GameObjects.Graphics;
  private arrowGfx: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private arrowX: number;
  private dir = 1;
  /** Накопичений час update-ів: на паузі update не викликається — таймаут стоїть */
  private elapsedMs = 0;

  constructor(
    scene: Phaser.Scene,
    readonly floatX: number,
    readonly floatY: number,
  ) {
    this.arrowX = floatX - ROUND.FISH_ZONE_HALF_PX;

    this.zoneGfx = scene.add.graphics().setDepth(7);
    this.zoneGfx.lineStyle(2, 0x60a5fa, 0.7);
    this.zoneGfx.strokeRect(floatX - ROUND.FISH_ZONE_HALF_PX, floatY - 40, ROUND.FISH_ZONE_HALF_PX * 2, 40);
    this.zoneGfx.fillStyle(0x60a5fa, 0.12);
    this.zoneGfx.fillRect(floatX - ROUND.FISH_ZONE_HALF_PX, floatY - 40, ROUND.FISH_ZONE_HALF_PX * 2, 40);

    this.arrowGfx = scene.add.graphics().setDepth(8);

    this.label = scene.add
      .text(floatX, floatY - 56, 'TAP!', { fontSize: '18px', fontFamily: 'Arial Black', color: '#60a5fa' })
      .setOrigin(0.5)
      .setDepth(9);
    scene.tweens.add({ targets: this.label, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });
  }

  update(delta: number): void {
    this.elapsedMs += delta;
    const half = ROUND.FISH_ZONE_HALF_PX;
    this.arrowX += this.dir * ROUND.FISH_ARROW_SPEED_PX * (delta / 1000);

    if (this.arrowX > this.floatX + half) { this.arrowX = this.floatX + half; this.dir = -1; }
    if (this.arrowX < this.floatX - half) { this.arrowX = this.floatX - half; this.dir = 1; }

    const g = this.arrowGfx;
    g.clear();
    g.fillStyle(0xfbbf24);
    g.fillTriangle(
      this.arrowX, this.floatY - 8,
      this.arrowX - 8, this.floatY - 22,
      this.arrowX + 8, this.floatY - 22,
    );
  }

  isTimedOut(): boolean {
    return this.elapsedMs > ROUND.FISH_TIMEOUT_MS;
  }

  /** Де вибухне рибка */
  resolveX(): number {
    return this.arrowX;
  }

  destroy(): void {
    this.zoneGfx.destroy();
    this.arrowGfx.destroy();
    this.label.destroy();
  }
}
