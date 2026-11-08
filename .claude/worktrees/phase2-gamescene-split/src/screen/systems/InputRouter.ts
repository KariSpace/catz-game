import type { ControllerMessage, Team, WeaponKey } from '../../shared/protocol';
import type { Player } from '../net/PlayerHub';
import type { TurnStateMachine } from './TurnStateMachine';

/** Єдині ігрові команди — однакові для телефона і клавіатури */
export interface GameCommands {
  aim(angle: number, power: number): void;
  fire(angle: number, power: number): void;
  selectWeapon(key: WeaponKey): void;
  tap(): void;
}

/** Те, що роутеру треба знати про активного стрільця (CharacterUnit підходить структурно) */
export interface ActiveShooter {
  team: Team;
  aimAngle: number;
  aimPower: number;
  baseWeapon: WeaponKey;
  special: WeaponKey;
}

export interface PhoneSource {
  on(event: 'message', fn: (player: Player, msg: ControllerMessage) => void): unknown;
  off(event: 'message', fn: (player: Player, msg: ControllerMessage) => void): unknown;
}

export interface KeySource {
  on(event: string, fn: () => void): unknown;
}

/**
 * Перетворює ControllerMessage і клавіатурні біндінги на команди GameCommands,
 * уже відфільтровані по стану ходу (через TurnStateMachine) і по гравцю:
 * aim/fire/weapon — лише у фазі aiming, tap — лише у fishing, телефонні
 * повідомлення — лише від команди, що зараз ходить.
 */
export class InputRouter {
  constructor(
    private machine: TurnStateMachine,
    private current: () => ActiveShooter | null,
    private commands: GameCommands,
  ) {}

  /** Підписка на телефони; повертає відписку для shutdown сцени */
  attachPhone(hub: PhoneSource): () => void {
    const handler = (player: Player, msg: ControllerMessage) => this.onPhoneMessage(player, msg);
    hub.on('message', handler);
    return () => hub.off('message', handler);
  }

  /** Клавіатурний режим (?kb=1): WASD — приціл, 1/2 — зброя, SPACE — постріл/тап */
  attachKeyboard(kb: KeySource | null): void {
    if (!kb) return;
    const aiming = () => this.aimingShooter();

    kb.on('keydown-A', () => { const c = aiming(); if (c) this.commands.aim(c.aimAngle + 4, c.aimPower); });
    kb.on('keydown-D', () => { const c = aiming(); if (c) this.commands.aim(c.aimAngle - 4, c.aimPower); });
    kb.on('keydown-W', () => { const c = aiming(); if (c) this.commands.aim(c.aimAngle, Math.min(100, c.aimPower + 5)); });
    kb.on('keydown-S', () => { const c = aiming(); if (c) this.commands.aim(c.aimAngle, Math.max(10, c.aimPower - 5)); });
    kb.on('keydown-ONE', () => { const c = aiming(); if (c) this.commands.selectWeapon(c.baseWeapon); });
    kb.on('keydown-TWO', () => { const c = aiming(); if (c) this.commands.selectWeapon(c.special); });
    kb.on('keydown-SPACE', () => {
      const c = aiming();
      if (c) this.commands.fire(c.aimAngle, c.aimPower);
      else if (!this.machine.paused && this.machine.phase === 'fishing') this.commands.tap();
    });
  }

  private aimingShooter(): ActiveShooter | null {
    if (this.machine.paused) return null;
    return this.machine.phase === 'aiming' ? this.current() : null;
  }

  private onPhoneMessage(player: Player, msg: ControllerMessage): void {
    if (this.machine.paused) return;
    const current = this.current();
    if (!current || player.team !== current.team) return;

    switch (msg.type) {
      case 'aim':
        if (this.machine.phase === 'aiming') this.commands.aim(msg.angle, msg.power);
        break;
      case 'fire':
        if (this.machine.phase === 'aiming') this.commands.fire(msg.angle, msg.power);
        break;
      case 'weapon':
        if (this.machine.phase === 'aiming') this.commands.selectWeapon(msg.weaponKey);
        break;
      case 'tap':
        if (this.machine.phase === 'fishing') this.commands.tap();
        break;
      default:
        break;
    }
  }
}
