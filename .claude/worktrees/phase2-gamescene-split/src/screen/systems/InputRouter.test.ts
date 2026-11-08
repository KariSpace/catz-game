import { describe, expect, it } from 'vitest';
import { InputRouter, type ActiveShooter, type GameCommands } from './InputRouter';
import { TurnStateMachine } from './TurnStateMachine';
import type { Player } from '../net/PlayerHub';
import type { ControllerMessage } from '../../shared/protocol';

function makeRouter(shooter: ActiveShooter | null) {
  const machine = new TurnStateMachine({
    now: () => 0,
    isPhysicsSettled: () => true,
    hasProjectilesInFlight: () => false,
    onSettled: () => {},
    onTurnTimeout: () => {},
    onTimerTick: () => {},
  });
  const log: string[] = [];
  const commands: GameCommands = {
    aim: (angle, power) => log.push(`aim ${angle} ${power}`),
    fire: (angle, power) => log.push(`fire ${angle} ${power}`),
    selectWeapon: (key) => log.push(`weapon ${key}`),
    tap: () => log.push('tap'),
  };
  const router = new InputRouter(machine, () => shooter, commands);

  // Фейкові джерела: збираємо обробники і смикаємо їх напряму
  const phone: ((p: Player, m: ControllerMessage) => void)[] = [];
  router.attachPhone({
    on: (_e, fn) => phone.push(fn),
    off: () => {},
  });
  const keys = new Map<string, () => void>();
  router.attachKeyboard({ on: (event, fn) => keys.set(event, fn) });

  const press = (key: string) => keys.get(`keydown-${key}`)!();
  const message = (team: 'cats' | 'dogs', msg: ControllerMessage) =>
    phone[0]({ id: 'p1', team, name: 'P1' } as Player, msg);

  return { machine, log, press, message };
}

const shooter: ActiveShooter = {
  team: 'cats', aimAngle: 45, aimPower: 60, baseWeapon: 'hairball', special: 'furball',
};

describe('InputRouter: телефон', () => {
  it('команди проходять лише у фазі aiming і лише від команди, що ходить', () => {
    const { machine, log, message } = makeRouter(shooter);
    machine.startAiming();

    message('dogs', { type: 'aim', angle: 90, power: 50 });
    expect(log).toEqual([]);

    message('cats', { type: 'aim', angle: 90, power: 50 });
    message('cats', { type: 'weapon', weaponKey: 'furball' });
    message('cats', { type: 'fire', angle: 80, power: 70 });
    expect(log).toEqual(['aim 90 50', 'weapon furball', 'fire 80 70']);
  });

  it('поза фазою aiming aim/fire/weapon ігноруються; tap працює лише у fishing', () => {
    const { machine, log, message } = makeRouter(shooter);

    machine.startFlying();
    message('cats', { type: 'fire', angle: 80, power: 70 });
    message('cats', { type: 'tap' });
    expect(log).toEqual([]);

    machine.startFishing();
    message('cats', { type: 'tap' });
    expect(log).toEqual(['tap']);
  });
});

describe('InputRouter: клавіатура', () => {
  it('WASD дає ті самі aim-команди з клампом сили 10–100', () => {
    const { machine, log, press } = makeRouter(shooter);
    machine.startAiming();

    press('A');
    press('D');
    press('W');
    press('S');
    expect(log).toEqual(['aim 49 60', 'aim 41 60', 'aim 45 65', 'aim 45 55']);
  });

  it('SPACE: постріл у aiming, тап у fishing, ніщо інакше', () => {
    const { machine, log, press } = makeRouter(shooter);

    machine.startAiming();
    press('SPACE');
    machine.startFishing();
    press('SPACE');
    machine.startFlying();
    press('SPACE');
    expect(log).toEqual(['fire 45 60', 'tap']);
  });

  it('на паузі німі і телефон, і клавіатура', () => {
    const { machine, log, press, message } = makeRouter(shooter);
    machine.startAiming();
    machine.pause();

    press('SPACE');
    message('cats', { type: 'fire', angle: 80, power: 70 });
    machine.startFishing();
    message('cats', { type: 'tap' });
    expect(log).toEqual([]);

    machine.resume();
    message('cats', { type: 'tap' });
    expect(log).toEqual(['tap']);
  });

  it('без активного стрільця клавіші німі', () => {
    const { machine, log, press } = makeRouter(null);
    machine.startAiming();
    press('A');
    press('SPACE');
    press('ONE');
    expect(log).toEqual([]);
  });
});
