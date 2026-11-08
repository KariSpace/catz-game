import Phaser from 'phaser';
import { VIEW } from '../../shared/config';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const GROUND_BASE_Y = VIEW.H - 90;

/**
 * Статичний рельєф: хвилястий heightmap із рівними майданчиками під
 * будівлями. Не руйнується — вся руйнація в блокових будівлях.
 */
export class Ground {
  private pts: { x: number; y: number }[] = [];

  constructor(scene: Phaser.Scene, physics: PhysicsWorld, private flatCenters: number[]) {
    this.generate();
    this.draw(scene);
    physics.createGround(this.pts);
  }

  private generate(): void {
    const count = 200;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const x = t * VIEW.W;
      let y = GROUND_BASE_Y
        - Math.sin(t * Math.PI * 2.8) * 70
        - Math.sin(t * Math.PI * 5.5) * 34
        - Math.sin(t * Math.PI * 12) * 14;

      // Рівні майданчики під будівлями (плавний перехід по краях)
      for (const cx of this.flatCenters) {
        const dist = Math.abs(x - cx);
        const flatR = 210;
        if (dist < flatR) {
          const blend = Math.min(1, Math.max(0, (dist - flatR * 0.6) / (flatR * 0.4)));
          y = Phaser.Math.Linear(GROUND_BASE_Y, y, blend);
        }
      }
      this.pts.push({ x, y });
    }
  }

  getYAt(x: number): number {
    const step = VIEW.W / (this.pts.length - 1);
    const i = Phaser.Math.Clamp(Math.floor(x / step), 0, this.pts.length - 2);
    const t = (x - i * step) / step;
    return Phaser.Math.Linear(this.pts[i].y, this.pts[i + 1].y, t);
  }

  private draw(scene: Phaser.Scene): void {
    const g = scene.add.graphics().setDepth(0);

    // Небо, зорі, місяць
    g.fillStyle(0x0d0a1e);
    g.fillRect(0, 0, VIEW.W, VIEW.H);
    g.fillStyle(0xffffff, 0.5);
    for (let i = 0; i < 70; i++) {
      g.fillRect(Phaser.Math.Between(0, VIEW.W), Phaser.Math.Between(0, VIEW.H * 0.55), 2, 2);
    }
    g.fillStyle(0xfef9c3);
    g.fillCircle(VIEW.W - 110, 65, 32);
    g.fillStyle(0x0d0a1e);
    g.fillCircle(VIEW.W - 97, 57, 26);

    // Трава + ґрунт
    g.lineStyle(3, 0x4ade80);
    g.beginPath();
    this.pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.strokePath();

    g.fillStyle(0x15803d);
    g.beginPath();
    this.pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.lineTo(VIEW.W, VIEW.H);
    g.lineTo(0, VIEW.H);
    g.closePath();
    g.fillPath();

    g.fillStyle(0x78350f);
    g.fillRect(0, VIEW.H - 28, VIEW.W, 28);
  }
}
