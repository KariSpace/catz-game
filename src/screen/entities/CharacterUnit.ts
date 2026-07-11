import Phaser from 'phaser';
import { BASE_WEAPON, CHARACTERS, WEAPONS, type CharacterDef } from '../../shared/config';
import type { Team, WeaponKey } from '../../shared/protocol';
import type { BodyRef, PhysicsWorld } from '../physics/PhysicsWorld';

const HALF_HEIGHT = 24; // капсула ≈ 48px заввишки

/** Персонаж: фізична капсула + спрайт, HP, прицілювання, боєзапас */
export class CharacterUnit {
  readonly def: CharacterDef;
  readonly team: Team;
  readonly name: string;
  readonly baseWeapon: WeaponKey;
  readonly special: WeaponKey;

  hp: number;
  readonly maxHp: number;
  dead = false;
  ammo: Partial<Record<WeaponKey, number>> = {};
  selectedWeapon: WeaponKey;
  aimAngle: number;
  aimPower = 60;

  ref: BodyRef;

  private container: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Image;
  private hpBar: Phaser.GameObjects.Rectangle;
  private aimGfx: Phaser.GameObjects.Graphics;
  private active = false;

  constructor(
    private scene: Phaser.Scene,
    private physics: PhysicsWorld,
    readonly key: string,
    feetX: number,
    feetY: number,
  ) {
    this.def = CHARACTERS[key];
    this.team = this.def.team;
    this.name = this.def.name;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.baseWeapon = BASE_WEAPON[this.team];
    this.special = this.def.special;
    this.selectedWeapon = this.baseWeapon;
    this.aimAngle = this.team === 'cats' ? 45 : 135;

    this.ammo[this.baseWeapon] = Infinity;
    this.ammo[this.special] = WEAPONS[this.special].ammo;

    this.ref = physics.createCharacter(feetX, feetY - HALF_HEIGHT, this);

    this.container = scene.add.container(feetX, feetY - HALF_HEIGHT).setDepth(3);
    this.aimGfx = scene.add.graphics();

    this.sprite = scene.add
      .image(0, HALF_HEIGHT, this.def.sprite, 0)
      .setOrigin(0.5, 1)
      .setScale(3)
      .setTint(this.def.tint);
    if (this.team === 'dogs') this.sprite.setFlipX(true);

    const barY = -HALF_HEIGHT - 14;
    const hpBg = scene.add.rectangle(0, barY, 52, 7, 0x1f2937);
    this.hpBar = scene.add.rectangle(-26, barY, 52, 7, 0x4ade80).setOrigin(0, 0.5);
    const nameTag = scene.add
      .text(0, barY - 10, this.name, {
        fontSize: '10px', fontFamily: 'Arial', color: '#fff',
        backgroundColor: '#00000077', padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);

    this.container.add([this.aimGfx, this.sprite, hpBg, this.hpBar, nameTag]);
  }

  get x(): number { return this.physics.posPx(this.ref).x; }
  get y(): number { return this.physics.posPx(this.ref).y; }

  sync(): void {
    if (this.dead) return;
    const p = this.physics.posPx(this.ref);
    this.container.setPosition(p.x, p.y);
    if (this.physics.isOutOfBounds(this.ref)) this.kill();
  }

  // ─── Прицілювання ────────────────────────────────────────────────────

  setActive(val: boolean): void {
    this.active = val;
    if (val) {
      this.sprite.setTint(this.team === 'cats' ? 0xffeecc : 0xccddff);
    } else {
      this.sprite.setTint(this.def.tint);
      this.aimGfx.clear();
    }
  }

  setAim(angle: number, power: number): void {
    this.aimAngle = angle;
    this.aimPower = power;
    this.drawAim();
  }

  /** Стрілка напрямку — траєкторію поверх неї малює GameScene */
  private drawAim(): void {
    const g = this.aimGfx;
    g.clear();
    if (!this.active || this.dead) return;

    const rad = Phaser.Math.DegToRad(this.aimAngle);
    const len = 22 + this.aimPower * 0.3;
    const ex = Math.cos(rad) * len;
    const ey = -Math.sin(rad) * len;

    g.lineStyle(2, 0xfbbf24, 0.9);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(ex, ey);
    g.strokePath();

    const ang = Math.atan2(ey, ex);
    g.fillStyle(0xfbbf24);
    g.fillTriangle(
      ex, ey,
      ex - Math.cos(ang - 0.4) * 7, ey - Math.sin(ang - 0.4) * 7,
      ex - Math.cos(ang + 0.4) * 7, ey - Math.sin(ang + 0.4) * 7,
    );
  }

  /** Точка вильоту снаряда — досить далеко, щоб не зачепити власну капсулу */
  fireOrigin(): { x: number; y: number } {
    const rad = Phaser.Math.DegToRad(this.aimAngle);
    return {
      x: this.x + Math.cos(rad) * 40,
      y: this.y - Math.sin(rad) * 40,
    };
  }

  // ─── Шкода ───────────────────────────────────────────────────────────

  takeDamage(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.updateHpBar();
    if (this.hp === 0) {
      this.kill();
    } else {
      this.scene.tweens.add({
        targets: this.sprite, alpha: 0.15, duration: 70, yoyo: true, repeat: 2,
        onComplete: () => this.sprite.setAlpha(1),
      });
    }
  }

  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.aimGfx.clear();
    this.physics.remove(this.ref);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      y: this.container.y + 50,
      angle: this.team === 'cats' ? 90 : -90,
      duration: 600,
      ease: 'Power2',
    });
  }

  private updateHpBar(): void {
    const frac = this.hp / this.maxHp;
    this.hpBar.width = 52 * frac;
    this.hpBar.fillColor = frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfbbf24 : 0xef4444;
  }
}
