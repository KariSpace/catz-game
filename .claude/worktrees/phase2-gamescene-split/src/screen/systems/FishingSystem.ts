import type Phaser from 'phaser';
import type { WeaponKey } from '../../shared/protocol';
import type { ProjectileEntity } from '../entities/ProjectileEntity';
import { FishMinigame } from '../ui/FishMinigame';
import type { TurnStateMachine } from './TurnStateMachine';

export interface FishingDeps {
  /** Вибух рибки — через CombatSystem */
  explode(xPx: number, yPx: number, weaponKey: WeaponKey): void;
  /** Повідомити телефони команди стрільця про фазу 2 */
  notifyPhase2(): void;
}

/**
 * Двофазова фішинг-бомба: поплавок приземлився (фаза 1) → мініігра зі
 * стрілкою і таймаутом (фаза 2) → рибка вистрибує і вибухає (resolve).
 * Достроковий тап і таймаут мініігри йдуть одним шляхом — resolve().
 * FishMinigame лишається чистим рендером без ігрової логіки.
 */
export class FishingSystem {
  private fish: FishMinigame | null = null;
  private floatProj: ProjectileEntity | null = null;

  constructor(
    private scene: Phaser.Scene,
    private machine: TurnStateMachine,
    private deps: FishingDeps,
  ) {}

  /** Фаза 1 → 2: поплавок приземлився — заморозити і підняти мініігру */
  start(proj: ProjectileEntity): void {
    proj.freezeAsFloat();
    this.floatProj = proj;
    this.fish = new FishMinigame(this.scene, proj.x, proj.y);
    this.machine.startFishing();
    this.deps.notifyPhase2();
  }

  /** Заморожений поплавок не рахується снарядом у польоті і не детонує від контактів */
  isFloat(proj: ProjectileEntity): boolean {
    return proj === this.floatProj;
  }

  update(delta: number): void {
    if (!this.fish) return;
    this.fish.update(delta);
    if (this.fish.isTimedOut()) this.resolve();
  }

  /** Тап гравця або таймаут мініігри */
  resolve(): void {
    if (!this.fish || this.machine.phase !== 'fishing') return;
    const x = this.fish.resolveX();
    const y = this.fish.floatY;

    this.fish.destroy();
    this.fish = null;
    this.floatProj?.destroy();
    this.floatProj = null;

    // Підліт рибки — стан resolving (ввід заблоковано); вибух і перехід
    // у settling робить колбек анімації, а не таймінг tween
    this.machine.startResolving();
    const fishGfx = this.scene.add.circle(x, y, 10, 0x60a5fa).setDepth(7);
    this.scene.tweens.add({
      targets: fishGfx,
      y: y - 50,
      duration: 300,
      ease: 'Back.Out',
      onComplete: () => {
        fishGfx.destroy();
        this.deps.explode(x, y - 50, 'fishingBomb');
        this.machine.enterSettling();
      },
    });
  }
}
