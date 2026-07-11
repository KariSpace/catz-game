import RAPIER from '@dimforge/rapier2d-compat';
import { DAMAGE, PHYSICS, VIEW } from '../../shared/config';
import type { MaterialDef } from '../../shared/blueprints';
import { m2px, px2m } from './units';

export type PhysKind = 'ground' | 'block' | 'character' | 'projectile';

/** Ярлик на фізичному тілі: хто це і який ігровий об'єкт ним володіє */
export interface PhysTag {
  kind: PhysKind;
  owner: unknown;
}

export interface BodyRef {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  tag: PhysTag;
}

export interface StepHandlers {
  /** Снаряд торкнувся чогось (other = null, якщо тіло вже видалене) */
  onProjectileContact?(proj: BodyRef, other: BodyRef | null): void;
  /** Тіло отримало удар зі зміною швидкості dv (м/с) — падіння, приліт блока */
  onImpact?(ref: BodyRef, dv: number): void;
}

// Групи колізій: u32 = (членство << 16) | маска-фільтр.
// «Примарні» блоки (база команди, що зараз ходить) не взаємодіють зі
// снарядами, але далі стоять у світі й тримають персонажів.
const BIT_WORLD = 0x0001;
const BIT_PROJ = 0x0002;
const GROUPS = {
  world: (BIT_WORLD << 16) | (BIT_WORLD | BIT_PROJ),
  ghostBlock: (BIT_WORLD << 16) | BIT_WORLD,
  projectile: (BIT_PROJ << 16) | BIT_WORLD, // снаряд-снаряд теж не стикаються
} as const;

let rapierReady = false;

/** Викликати один раз до створення першого світу (завантажує WASM) */
export async function initRapier(): Promise<void> {
  if (rapierReady) return;
  await RAPIER.init();
  rapierReady = true;
}

/**
 * Єдина межа між грою та Rapier. Назовні — пікселі та ігрові поняття
 * (блок, персонаж, снаряд, вибух); усередині — метри й солвер.
 */
export class PhysicsWorld {
  private world: RAPIER.World;
  private events: RAPIER.EventQueue;
  private byCollider = new Map<number, BodyRef>();
  private accumulator = 0;

  constructor() {
    if (!rapierReady) throw new Error('initRapier() must be awaited before creating PhysicsWorld');
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.GRAVITY_M });
    this.world.timestep = PHYSICS.TIMESTEP;
    this.world.numSolverIterations = 8; // високі стеки блоків потребують точнішого солвера
    this.events = new RAPIER.EventQueue(true);
  }

  // ─── Крок симуляції ─────────────────────────────────────────────────

  step(deltaMs: number, handlers: StepHandlers = {}): void {
    this.accumulator = Math.min(this.accumulator + deltaMs / 1000, PHYSICS.TIMESTEP * PHYSICS.MAX_SUBSTEPS);

    while (this.accumulator >= PHYSICS.TIMESTEP) {
      this.accumulator -= PHYSICS.TIMESTEP;
      this.world.step(this.events);
      this.drainEvents(handlers);
    }
  }

  private drainEvents(handlers: StepHandlers): void {
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started || !handlers.onProjectileContact) return;
      const a = this.byCollider.get(h1) ?? null;
      const b = this.byCollider.get(h2) ?? null;
      if (a?.tag.kind === 'projectile') handlers.onProjectileContact(a, b);
      else if (b?.tag.kind === 'projectile') handlers.onProjectileContact(b, a);
    });

    this.events.drainContactForceEvents((ev) => {
      if (!handlers.onImpact) return;
      const impulse = ev.totalForceMagnitude() * PHYSICS.TIMESTEP; // Н·с = кг·м/с
      for (const handle of [ev.collider1(), ev.collider2()]) {
        const ref = this.byCollider.get(handle);
        if (!ref || (ref.tag.kind !== 'block' && ref.tag.kind !== 'character')) continue;
        const mass = ref.body.mass();
        if (mass <= 0) continue;
        const dv = impulse / mass;
        if (dv >= DAMAGE.IMPACT_MIN_DV) handlers.onImpact(ref, dv);
      }
    });
  }

  // ─── Фабрики тіл ────────────────────────────────────────────────────

  /** Статична земля: ламана по точках рельєфу (пікселі) */
  createGround(pointsPx: { x: number; y: number }[]): BodyRef {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const verts = new Float32Array(pointsPx.length * 2);
    pointsPx.forEach((p, i) => {
      verts[i * 2] = px2m(p.x);
      verts[i * 2 + 1] = px2m(p.y);
    });
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.polyline(verts).setFriction(0.9).setCollisionGroups(GROUPS.world),
      body,
    );
    return this.register(body, collider, { kind: 'ground', owner: null });
  }

  createBlock(cxPx: number, cyPx: number, wPx: number, hPx: number, mat: MaterialDef, owner: unknown): BodyRef {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px2m(cxPx), px2m(cyPx))
        .setLinearDamping(0.05)
        .setAngularDamping(0.4), // гасить дрож у високих стеках
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(px2m(wPx / 2), px2m(hPx / 2))
        .setDensity(mat.density)
        .setFriction(mat.friction)
        .setRestitution(0.05)
        .setCollisionGroups(GROUPS.world)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      body,
    );
    // Події контакту лише для ударів, які реально можуть завдати шкоди —
    // інакше кожен лежачий блок сипле подіями щокроку.
    collider.setContactForceEventThreshold(
      (DAMAGE.IMPACT_MIN_DV * body.mass()) / PHYSICS.TIMESTEP * 0.8,
    );
    return this.register(body, collider, { kind: 'block', owner });
  }

  createCharacter(xPx: number, yPx: number, owner: unknown): BodyRef {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px2m(xPx), px2m(yPx))
        .lockRotations()
        .setLinearDamping(0.2),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.3, 0.18) // ≈ 48px заввишки, 36px завширшки
        .setDensity(4.5)                     // маса ≈ 1.4 кг — не продавлює блоки, на яких стоїть
        .setFriction(1.0)
        .setRestitution(0)
        .setCollisionGroups(GROUPS.world)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      body,
    );
    collider.setContactForceEventThreshold(
      (DAMAGE.IMPACT_MIN_DV * body.mass()) / PHYSICS.TIMESTEP * 0.8,
    );
    return this.register(body, collider, { kind: 'character', owner });
  }

  createProjectile(
    xPx: number, yPx: number, radiusPx: number,
    velPx: { x: number; y: number }, windPxS2: number, owner: unknown,
  ): BodyRef {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(px2m(xPx), px2m(yPx))
        .setLinvel(px2m(velPx.x), px2m(velPx.y))
        .setCcdEnabled(true), // швидкий і малий — без CCD прошиває тонкі блоки
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(px2m(radiusPx))
        .setDensity(3)
        .setFriction(0.5)
        .setRestitution(0.2)
        .setCollisionGroups(GROUPS.projectile)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    // Вітер — стала горизонтальна сила на весь політ
    body.addForce({ x: px2m(windPxS2) * body.mass(), y: 0 }, true);
    return this.register(body, collider, { kind: 'projectile', owner });
  }

  private register(body: RAPIER.RigidBody, collider: RAPIER.Collider, tag: PhysTag): BodyRef {
    const ref: BodyRef = { body, collider, tag };
    this.byCollider.set(collider.handle, ref);
    return ref;
  }

  // ─── Ігрові операції ────────────────────────────────────────────────

  /** Блок «примарної» бази не стикається зі снарядами (візуально — прозорий) */
  setBlockGhost(ref: BodyRef, ghost: boolean): void {
    ref.collider.setCollisionGroups(ghost ? GROUPS.ghostBlock : GROUPS.world);
  }

  /**
   * Вибух: радіальний приріст швидкості з лінійним спаданням від епіцентру
   * та легким підкидом угору (виглядає соковитіше, ніж чисто радіальний).
   * skip — тіла, яких вибух не торкається (примарна база стрільця).
   */
  applyExplosion(
    xPx: number, yPx: number, radiusPx: number, blastSpeed: number,
    skip?: (ref: BodyRef) => boolean,
  ): void {
    const ex = px2m(xPx);
    const ey = px2m(yPx);
    const r = px2m(radiusPx);

    for (const ref of this.byCollider.values()) {
      if (ref.body.isFixed()) continue;
      if (skip?.(ref)) continue;
      const t = ref.body.translation();
      const dx = t.x - ex;
      const dy = t.y - ey;
      const dist = Math.hypot(dx, dy);
      if (dist > r * 1.6) continue;

      const falloff = Math.max(0.15, 1 - dist / (r * 1.6));
      let nx = dist > 0.001 ? dx / dist : 0;
      let ny = dist > 0.001 ? dy / dist : -1;
      ny -= 0.4; // підкид
      const len = Math.hypot(nx, ny);
      const dv = blastSpeed * falloff;
      ref.body.applyImpulse(
        { x: (nx / len) * dv * ref.body.mass(), y: (ny / len) * dv * ref.body.mass() },
        true,
      );
    }
  }

  /** Перетворити тіло на нерухоме (поплавок фішинг-бомби, що приземлився) */
  freeze(ref: BodyRef): void {
    ref.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
  }

  /** Чи всі динамічні тіла заспокоїлись (уламки долетіли, вежі досіли) */
  isSettled(): boolean {
    const maxSpeed = px2m(PHYSICS.SETTLE_SPEED_PX);
    for (const ref of this.byCollider.values()) {
      if (ref.body.isFixed() || ref.body.isSleeping()) continue;
      const v = ref.body.linvel();
      if (Math.hypot(v.x, v.y) > maxSpeed || Math.abs(ref.body.angvel()) > 0.4) return false;
    }
    return true;
  }

  // ─── Читання стану (для синку спрайтів) ─────────────────────────────

  posPx(ref: BodyRef): { x: number; y: number } {
    const t = ref.body.translation();
    return { x: m2px(t.x), y: m2px(t.y) };
  }

  rotation(ref: BodyRef): number {
    return ref.body.rotation();
  }

  speedPx(ref: BodyRef): number {
    const v = ref.body.linvel();
    return m2px(Math.hypot(v.x, v.y));
  }

  /** Тіло вилетіло далеко за межі екрана — час прибрати */
  isOutOfBounds(ref: BodyRef): boolean {
    const p = this.posPx(ref);
    return p.x < -200 || p.x > VIEW.W + 200 || p.y > VIEW.H + 300;
  }

  remove(ref: BodyRef): void {
    this.byCollider.delete(ref.collider.handle);
    this.world.removeRigidBody(ref.body);
  }

  destroy(): void {
    this.world.free();
    this.events.free();
    this.byCollider.clear();
  }
}
