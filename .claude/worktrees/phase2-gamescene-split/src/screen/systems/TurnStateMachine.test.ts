import { describe, expect, it } from 'vitest';
import { TurnStateMachine, type TurnMachineDeps } from './TurnStateMachine';

const TIMING = { settleMinMs: 100, settleTimeoutMs: 400, turnMs: 5000 };

/** Керований світ: ручний годинник + прапорці фізики + лічильники колбеків */
function makeWorld() {
  const world = {
    t: 0,
    settled: true,
    inFlight: false,
    settledCalls: 0,
    timeoutCalls: 0,
    ticks: [] as number[],
  };
  const deps: TurnMachineDeps = {
    now: () => world.t,
    isPhysicsSettled: () => world.settled,
    hasProjectilesInFlight: () => world.inFlight,
    onSettled: () => world.settledCalls++,
    onTurnTimeout: () => world.timeoutCalls++,
    onTimerTick: (left) => world.ticks.push(left),
  };
  return { world, machine: new TurnStateMachine(deps, TIMING) };
}

describe('TurnStateMachine', () => {
  it('стартує в settling', () => {
    const { machine } = makeWorld();
    expect(machine.phase).toBe('settling');
  });

  it('повний цикл: aiming → flying → settling → onSettled → aiming', () => {
    const { world, machine } = makeWorld();

    machine.startAiming();
    expect(machine.phase).toBe('aiming');

    machine.startFlying();
    world.inFlight = true;
    machine.update();
    expect(machine.phase).toBe('flying');

    world.inFlight = false;
    machine.update();
    expect(machine.phase).toBe('settling');

    // Мінімум осідання ще не минув — навіть якщо фізика вже спокійна
    world.t += TIMING.settleMinMs;
    machine.update();
    expect(world.settledCalls).toBe(0);

    world.t += 1;
    machine.update();
    expect(world.settledCalls).toBe(1);

    // Сцена в onSettled починає наступний хід
    machine.startAiming();
    expect(machine.phase).toBe('aiming');
  });

  it('settling завершується таймаутом, коли фізика не заспокоюється', () => {
    const { world, machine } = makeWorld();
    world.settled = false;
    machine.enterSettling();

    world.t += TIMING.settleTimeoutMs;
    machine.update();
    expect(world.settledCalls).toBe(0);

    world.t += 1;
    machine.update();
    expect(world.settledCalls).toBe(1);
  });

  it('таймаут ходу: onTurnTimeout і перехід у settling', () => {
    const { world, machine } = makeWorld();
    machine.startAiming();

    world.t += TIMING.turnMs - 1000;
    machine.update();
    expect(world.timeoutCalls).toBe(0);
    expect(world.ticks.at(-1)).toBe(1);

    world.t += 1000;
    machine.update();
    expect(world.timeoutCalls).toBe(1);
    expect(machine.phase).toBe('settling');
    expect(world.ticks.at(-1)).toBe(0);
  });

  it('resolving не переходить сам — лише явний enterSettling', () => {
    const { world, machine } = makeWorld();
    machine.startResolving();

    world.t += TIMING.settleTimeoutMs * 10;
    machine.update();
    expect(machine.phase).toBe('resolving');
    expect(world.settledCalls).toBe(0);

    machine.enterSettling();
    expect(machine.phase).toBe('settling');
    // Відлік осідання починається з моменту переходу, не з старту resolving
    machine.update();
    expect(world.settledCalls).toBe(0);
    world.t += TIMING.settleMinMs + 1;
    machine.update();
    expect(world.settledCalls).toBe(1);
  });

  it('пауза заморожує update, resume зсуває дедлайн на тривалість паузи', () => {
    const { world, machine } = makeWorld();
    machine.startAiming();

    world.t += 1000;
    machine.pause();
    expect(machine.paused).toBe(true);

    // Під час паузи час іде, але нічого не тікає і таймаут не спрацьовує
    world.t += TIMING.turnMs * 3;
    machine.update();
    expect(world.timeoutCalls).toBe(0);
    expect(world.ticks).toEqual([]);
    expect(machine.phase).toBe('aiming');

    machine.resume();
    expect(machine.paused).toBe(false);
    // Лишалося turnMs-1000 — після резюму лишається стільки ж
    machine.update();
    expect(world.ticks.at(-1)).toBe((TIMING.turnMs - 1000) / 1000);
    world.t += TIMING.turnMs - 1000;
    machine.update();
    expect(world.timeoutCalls).toBe(1);
  });

  it('пауза в settling не з’їдає мінімум осідання', () => {
    const { world, machine } = makeWorld();
    machine.enterSettling();
    machine.pause();
    world.t += TIMING.settleTimeoutMs * 5;
    machine.update();
    expect(world.settledCalls).toBe(0);

    machine.resume();
    machine.update();
    expect(world.settledCalls).toBe(0); // відлік продовжився, а не вибухнув таймаутом
    world.t += TIMING.settleMinMs + 1;
    machine.update();
    expect(world.settledCalls).toBe(1);
  });

  it('fishing і ended інертні в update', () => {
    const { world, machine } = makeWorld();

    machine.startFishing();
    world.t += 100_000;
    machine.update();
    expect(machine.phase).toBe('fishing');

    machine.end();
    machine.update();
    expect(machine.phase).toBe('ended');
    expect(world.settledCalls).toBe(0);
    expect(world.timeoutCalls).toBe(0);
  });
});
