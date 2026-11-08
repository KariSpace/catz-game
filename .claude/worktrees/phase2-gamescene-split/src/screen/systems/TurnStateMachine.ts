import { PHYSICS, ROUND } from '../../shared/config';

export type TurnPhase = 'settling' | 'aiming' | 'flying' | 'fishing' | 'resolving' | 'ended';

export interface TurnMachineDeps {
  /** Поточний час, мс (у сцені — this.time.now) */
  now(): number;
  /** Чи всі динамічні тіла заспокоїлись (PhysicsWorld.isSettled) */
  isPhysicsSettled(): boolean;
  /** Чи є снаряди в польоті (поплавок фішинг-бомби не рахується) */
  hasProjectilesInFlight(): boolean;
  /** Осідання завершене: вирішити смерті і почати наступний хід або кінець матчу */
  onSettled(): void;
  /** Дедлайн ходу минув; машина сама переходить у settling після колбека */
  onTurnTimeout(): void;
  /** Тік таймера прицілювання (щокадру, секунд лишилось) — для HUD */
  onTimerTick(secondsLeft: number): void;
}

export interface TurnMachineTiming {
  settleMinMs: number;
  settleTimeoutMs: number;
  turnMs: number;
}

/**
 * Стейт-машина ходу. Володіє таймерами (дедлайн ходу, мін/макс осідання);
 * сцена лише викликає переходи і делегує сюди update().
 *
 * `resolving` — вибух відкладено анімацією (підліт рибки у фішинг-бомбі):
 * ввід заблоковано, перехід у settling робить колбек анімації явним
 * викликом enterSettling(), а не таймінгом tween.
 */
export class TurnStateMachine {
  private phase_: TurnPhase = 'settling';
  private settleStart: number;
  private deadline = 0;
  private pausedAt: number | null = null;

  constructor(
    private deps: TurnMachineDeps,
    private timing: TurnMachineTiming = {
      settleMinMs: PHYSICS.SETTLE_MIN_MS,
      settleTimeoutMs: PHYSICS.SETTLE_TIMEOUT_MS,
      turnMs: ROUND.TURN_SECONDS * 1000,
    },
  ) {
    this.settleStart = deps.now();
  }

  get phase(): TurnPhase {
    return this.phase_;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Заморозити хід (гравець відключився): update() не тікає, дедлайни стоять */
  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.deps.now();
  }

  /** Продовжити: таймери зсуваються на тривалість паузи — час ходу не згорає */
  resume(): void {
    if (this.pausedAt === null) return;
    const pausedFor = this.deps.now() - this.pausedAt;
    this.deadline += pausedFor;
    this.settleStart += pausedFor;
    this.pausedAt = null;
  }

  enterSettling(): void {
    this.phase_ = 'settling';
    this.settleStart = this.deps.now();
  }

  startAiming(): void {
    this.phase_ = 'aiming';
    this.deadline = this.deps.now() + this.timing.turnMs;
  }

  startFlying(): void {
    this.phase_ = 'flying';
  }

  startFishing(): void {
    this.phase_ = 'fishing';
  }

  startResolving(): void {
    this.phase_ = 'resolving';
  }

  end(): void {
    this.phase_ = 'ended';
  }

  update(): void {
    if (this.pausedAt !== null) return;
    switch (this.phase_) {
      case 'aiming': {
        const left = Math.ceil((this.deadline - this.deps.now()) / 1000);
        this.deps.onTimerTick(left);
        if (left <= 0) {
          this.deps.onTurnTimeout();
          this.enterSettling();
        }
        break;
      }
      case 'flying':
        if (!this.deps.hasProjectilesInFlight()) this.enterSettling();
        break;
      case 'settling': {
        const elapsed = this.deps.now() - this.settleStart;
        if (
          elapsed > this.timing.settleMinMs &&
          (this.deps.isPhysicsSettled() || elapsed > this.timing.settleTimeoutMs)
        ) {
          this.deps.onSettled();
        }
        break;
      }
      case 'fishing':
      case 'resolving':
      case 'ended':
        break;
    }
  }
}
