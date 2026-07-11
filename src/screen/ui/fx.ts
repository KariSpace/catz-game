import Phaser from 'phaser';

/** Кільце вибуху + спалах + іскри */
export function explosionFx(scene: Phaser.Scene, x: number, y: number, r: number): void {
  const g = scene.add.graphics().setDepth(8);
  let t = 0;
  const steps = 18;

  scene.time.addEvent({
    delay: 16,
    repeat: steps,
    callback: () => {
      t++;
      const prog = t / steps;
      g.clear();
      g.lineStyle(3, 0xfbbf24, 1 - prog);
      g.strokeCircle(x, y, r * prog);
      g.fillStyle(0xff4500, (1 - prog) * 0.65);
      g.fillCircle(x, y, r * prog * 0.55);
      g.fillStyle(0xffffff, (1 - prog) * 0.85);
      g.fillCircle(x, y, r * prog * 0.22);
      if (t >= steps) g.destroy();
    },
  });

  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const spark = scene.add.circle(x, y, 4, 0xfbbf24).setDepth(8);
    scene.tweens.add({
      targets: spark,
      x: x + Math.cos(ang) * r * 1.1,
      y: y + Math.sin(ang) * r * 1.1,
      alpha: 0,
      duration: 350,
      ease: 'Power2',
      onComplete: () => spark.destroy(),
    });
  }
}

/** Число шкоди, що спливає над ціллю */
export function damageNumber(scene: Phaser.Scene, x: number, y: number, amount: number): void {
  if (amount <= 0) return;
  const text = scene.add
    .text(x, y - 30, `-${Math.round(amount)}`, {
      fontSize: '22px', fontFamily: 'Arial Black', color: '#ef4444',
      stroke: '#ffffff', strokeThickness: 3,
    })
    .setOrigin(0.5)
    .setDepth(10);

  scene.tweens.add({
    targets: text, y: y - 80, alpha: 0, duration: 900, ease: 'Power2',
    onComplete: () => text.destroy(),
  });
}

/** Банер по центру екрана, зникає сам */
export function banner(scene: Phaser.Scene, message: string, color = '#ffffff'): void {
  const W = scene.scale.width;
  const H = scene.scale.height;
  const bg = scene.add.rectangle(W / 2, H / 2, 500, 70, 0x1f2937, 0.9).setDepth(12);
  const t = scene.add
    .text(W / 2, H / 2, message, { fontSize: '28px', fontFamily: 'Arial Black', color })
    .setOrigin(0.5)
    .setDepth(13);

  scene.tweens.add({
    targets: [bg, t], alpha: 0, delay: 1600, duration: 400,
    onComplete: () => { bg.destroy(); t.destroy(); },
  });
}
