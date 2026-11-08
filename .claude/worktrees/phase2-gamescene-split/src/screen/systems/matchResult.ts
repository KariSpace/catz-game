import type { Team } from '../../shared/protocol';

export interface MatchResult {
  winner: Team;
  /** Взаємознищення виграно прямим влучанням — атака «все або нічого» */
  heroic: boolean;
}

export function opposite(team: Team): Team {
  return team === 'cats' ? 'dogs' : 'cats';
}

/**
 * Політика кінця матчу (рішення 2026-07-11):
 * - жива одна команда → вона перемогла;
 * - взаємознищення → команда стрільця ПРОГРАЄ (самогубство не перемога),
 *   ОКРІМ атаки «все або нічого»: смертельний снаряд прямо влучив у
 *   ворожого персонажа — тоді стрілець виграє.
 */
export function resolveWinner(
  catsDead: boolean,
  dogsDead: boolean,
  shooterTeam: Team | null,
  directHit: boolean,
): MatchResult | null {
  if (!catsDead && !dogsDead) return null;
  if (catsDead !== dogsDead) return { winner: catsDead ? 'dogs' : 'cats', heroic: false };

  // Взаємознищення. Без відомого стрільця (недосяжно у грі) — детермінований фолбек
  if (!shooterTeam) return { winner: 'dogs', heroic: false };
  return directHit
    ? { winner: shooterTeam, heroic: true }
    : { winner: opposite(shooterTeam), heroic: false };
}
