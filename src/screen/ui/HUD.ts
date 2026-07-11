import Phaser from 'phaser';
import { PHYSICS, TEAMS, VIEW, WEAPONS } from '../../shared/config';
import type { WeaponKey } from '../../shared/protocol';
import type { CharacterUnit } from '../entities/CharacterUnit';

/** Верхній шар екрана: вітер, таймер, активний гравець, зброя, HP команд */
export class HUD {
  private windBar: Phaser.GameObjects.Rectangle;
  private windText: Phaser.GameObjects.Text;
  private timerText: Phaser.GameObjects.Text;
  private turnText: Phaser.GameObjects.Text;
  private weaponText: Phaser.GameObjects.Text;
  private catHpText: Phaser.GameObjects.Text;
  private dogHpText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    scene.add.rectangle(VIEW.W / 2, 28, 220, 36, 0x1f2937, 0.85).setDepth(10);
    this.windBar = scene.add.rectangle(VIEW.W / 2, 28, 0, 14, 0x60a5fa).setDepth(10);
    this.windText = scene.add
      .text(VIEW.W / 2, 50, '', { fontSize: '11px', fontFamily: 'Arial', color: '#93c5fd' })
      .setOrigin(0.5, 0)
      .setDepth(10);

    scene.add.rectangle(VIEW.W / 2, VIEW.H - 28, 120, 36, 0x1f2937, 0.85).setDepth(10);
    this.timerText = scene.add
      .text(VIEW.W / 2, VIEW.H - 28, '', { fontSize: '26px', fontFamily: 'Arial Black', color: '#fbbf24' })
      .setOrigin(0.5)
      .setDepth(10);

    this.turnText = scene.add
      .text(12, 12, '', {
        fontSize: '16px', fontFamily: 'Arial', color: '#ffffff',
        backgroundColor: '#00000088', padding: { x: 8, y: 4 },
      })
      .setDepth(10);

    this.weaponText = scene.add
      .text(VIEW.W - 12, 12, '', {
        fontSize: '14px', fontFamily: 'Arial', color: '#fbbf24',
        backgroundColor: '#00000088', padding: { x: 8, y: 4 },
      })
      .setOrigin(1, 0)
      .setDepth(10);

    this.catHpText = scene.add
      .text(12, VIEW.H - 92, '', { fontSize: '12px', fontFamily: 'Arial', color: '#ffffff', lineSpacing: 3 })
      .setDepth(10);
    this.dogHpText = scene.add
      .text(VIEW.W - 12, VIEW.H - 92, '', {
        fontSize: '12px', fontFamily: 'Arial', color: '#ffffff', lineSpacing: 3, align: 'right',
      })
      .setOrigin(1, 0)
      .setDepth(10);

    scene.add
      .text(12, VIEW.H - 110, '🐱 Cats', { fontSize: '13px', fontFamily: 'Arial', color: '#f97316' })
      .setDepth(10);
    scene.add
      .text(VIEW.W - 12, VIEW.H - 110, '🐶 Dogs', { fontSize: '13px', fontFamily: 'Arial', color: '#3b82f6' })
      .setOrigin(1, 0)
      .setDepth(10);
  }

  setWind(wind: number): void {
    const norm = wind / PHYSICS.WIND_MAX_PX;
    this.windBar.width = Math.abs(norm) * 100;
    this.windBar.x = VIEW.W / 2 + norm * 50;
    this.windText.setText(`${norm > 0 ? '→' : '←'} Вітер ${Math.abs(Math.round(wind))}`);
  }

  setTimer(seconds: number): void {
    const label = String(Math.max(0, seconds));
    if (this.timerText.text !== label) {
      this.timerText.setText(label);
      this.timerText.setColor(seconds <= 5 ? '#ef4444' : '#fbbf24');
    }
  }

  setTurn(char: CharacterUnit): void {
    const team = TEAMS[char.team];
    this.turnText.setText(`${team.label} Хід: ${char.name}`);
    this.turnText.setColor(`#${team.color.toString(16).padStart(6, '0')}`);
  }

  setWeapon(weaponKey: WeaponKey, ammo: number): void {
    const w = WEAPONS[weaponKey];
    this.weaponText.setText(`${w.name}  [${ammo === Infinity ? '∞' : ammo}]`);
  }

  updateTeamHp(cats: CharacterUnit[], dogs: CharacterUnit[]): void {
    const line = (c: CharacterUnit) => `${c.dead ? '💀' : '❤️'} ${c.name} ${c.hp}`;
    this.catHpText.setText(cats.map(line).join('\n'));
    this.dogHpText.setText(dogs.map(line).join('\n'));
  }
}
