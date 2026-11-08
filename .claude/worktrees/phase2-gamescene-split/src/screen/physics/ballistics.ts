import { PHYSICS, PIXELS_PER_METER, WEAPONS } from '../../shared/config';
import type { WeaponKey } from '../../shared/protocol';

// Єдине місце формул польоту снаряда. Реальний політ (ProjectileEntity)
// і пунктирне прев'ю (GameScene) беруть швидкість/дугу ТІЛЬКИ звідси —
// інакше вони розсинхронізуються.

export const GRAVITY_PX = PHYSICS.GRAVITY_M * PIXELS_PER_METER;

export interface Vec2 {
  x: number;
  y: number;
}

/** Початкова швидкість із кута (градуси) та сили (0–100). Мортира: vy ×1.4 */
export function velocityFromAim(angleDeg: number, power: number, weaponKey: WeaponKey): Vec2 {
  const def = WEAPONS[weaponKey];
  const speed = def.muzzleSpeedPx * (power / 100);
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.cos(rad) * speed,
    y: -Math.sin(rad) * speed * (def.behavior === 'mortar' ? 1.4 : 1),
  };
}

/** Точка дуги в момент t, c: гравітація + стале вітрове прискорення */
export function arcPoint(origin: Vec2, vel: Vec2, windPxS2: number, t: number): Vec2 {
  return {
    x: origin.x + vel.x * t + 0.5 * windPxS2 * t * t,
    y: origin.y + vel.y * t + 0.5 * GRAVITY_PX * t * t,
  };
}

/** Точки для пунктирного прев'ю: steps кроків по dt секунд */
export function sampleArc(
  origin: Vec2,
  vel: Vec2,
  windPxS2: number,
  steps = 16,
  dt = 0.09,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 1; i <= steps; i++) pts.push(arcPoint(origin, vel, windPxS2, i * dt));
  return pts;
}
