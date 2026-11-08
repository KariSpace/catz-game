import Phaser from 'phaser';
import { VIEW } from '../../shared/config';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('PreloadScene');
  }

  preload(): void {
    // 16×16 px кадри, кадр 0 — стоячий персонаж
    this.load.spritesheet('cat-orange', 'assets/cat-orange.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('cat-light', 'assets/cat-light.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('cat-dark', 'assets/cat-dark.png', { frameWidth: 16, frameHeight: 16 });

    const bar = this.add.graphics();
    this.load.on('progress', (p: number) => {
      bar.clear();
      bar.fillStyle(0x1f2937);
      bar.fillRect(VIEW.W * 0.2, VIEW.H * 0.5, VIEW.W * 0.6, 12);
      bar.fillStyle(0xfbbf24);
      bar.fillRect(VIEW.W * 0.2, VIEW.H * 0.5, VIEW.W * 0.6 * p, 12);
    });

    this.add
      .text(VIEW.W / 2, VIEW.H / 2 - 30, 'CATZ vs DOGZ', {
        fontSize: '32px', fontFamily: 'Arial Black', color: '#fbbf24',
        stroke: '#92400e', strokeThickness: 4,
      })
      .setOrigin(0.5);
  }

  create(): void {
    this.scene.start('MenuScene');
  }
}
