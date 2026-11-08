import type { Team } from '../../shared/protocol';
import type { CharacterUnit } from '../entities/CharacterUnit';

/** Черга ходів: кіт, собака, кіт, собака… мертві пропускаються */
export class TurnSystem {
  private queue: CharacterUnit[];
  private index = -1;
  current: CharacterUnit | null = null;

  constructor(cats: CharacterUnit[], dogs: CharacterUnit[]) {
    this.queue = [];
    const len = Math.max(cats.length, dogs.length);
    for (let i = 0; i < len; i++) {
      if (i < cats.length) this.queue.push(cats[i]);
      if (i < dogs.length) this.queue.push(dogs[i]);
    }
  }

  next(): CharacterUnit | null {
    this.current?.setActive(false);

    for (let attempts = 0; attempts < this.queue.length; attempts++) {
      this.index = (this.index + 1) % this.queue.length;
      const candidate = this.queue[this.index];
      if (!candidate.dead) {
        this.current = candidate;
        candidate.setActive(true);
        return candidate;
      }
    }

    this.current = null;
    return null; // всі мертві
  }

  alive(team: Team): CharacterUnit[] {
    return this.queue.filter((c) => c.team === team && !c.dead);
  }

  /** Команда, що програла (усі мертві), або null якщо гра триває */
  defeatedTeam(): Team | null {
    if (this.alive('cats').length === 0) return 'cats';
    if (this.alive('dogs').length === 0) return 'dogs';
    return null;
  }
}
