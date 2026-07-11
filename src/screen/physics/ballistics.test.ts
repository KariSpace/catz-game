import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../../shared/config';
import { GRAVITY_PX, arcPoint, sampleArc, velocityFromAim } from './ballistics';

describe('velocityFromAim', () => {
  it('стандартна зброя: розклад по куту, сила масштабує лінійно', () => {
    const v = velocityFromAim(45, 100, 'hairball');
    const expected = WEAPONS.hairball.muzzleSpeedPx * Math.SQRT1_2;
    expect(v.x).toBeCloseTo(expected, 5);
    expect(v.y).toBeCloseTo(-expected, 5); // екранна вісь Y — вниз, постріл угору = мінус

    const half = velocityFromAim(45, 50, 'hairball');
    expect(half.x).toBeCloseTo(v.x / 2, 5);
    expect(half.y).toBeCloseTo(v.y / 2, 5);
  });

  it('мортира (stinky): вертикальна складова ×1.4, горизонтальна без змін', () => {
    const std = velocityFromAim(60, 80, 'hairball');
    const mortar = velocityFromAim(60, 80, 'stinkyBomb');
    const ratio = WEAPONS.stinkyBomb.muzzleSpeedPx / WEAPONS.hairball.muzzleSpeedPx;
    expect(mortar.x).toBeCloseTo(std.x * ratio, 5);
    expect(mortar.y).toBeCloseTo(std.y * ratio * 1.4, 5);
  });

  it('кут 90° — чисто вертикальний постріл', () => {
    const v = velocityFromAim(90, 100, 'boneCannon');
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(-WEAPONS.boneCannon.muzzleSpeedPx, 5);
  });
});

describe('arcPoint / sampleArc', () => {
  const origin = { x: 100, y: 500 };
  const vel = { x: 200, y: -300 };
  const wind = 60;

  it('точка дуги відповідає аналітичній формулі рівноприскореного руху', () => {
    const t = 0.7;
    const p = arcPoint(origin, vel, wind, t);
    expect(p.x).toBeCloseTo(100 + 200 * t + 0.5 * wind * t * t, 5);
    expect(p.y).toBeCloseTo(500 - 300 * t + 0.5 * GRAVITY_PX * t * t, 5);
  });

  it('sampleArc — рівномірні кроки, останній збігається з arcPoint', () => {
    const pts = sampleArc(origin, vel, wind, 16, 0.09);
    expect(pts).toHaveLength(16);
    expect(pts[15]).toEqual(arcPoint(origin, vel, wind, 16 * 0.09));
    expect(pts[0]).toEqual(arcPoint(origin, vel, wind, 0.09));
  });

  it('без вітру політ по X лінійний', () => {
    const [p1, p2] = sampleArc(origin, vel, 0, 2, 0.5);
    expect(p2.x - p1.x).toBeCloseTo(vel.x * 0.5, 5);
  });
});
