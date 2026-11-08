import { describe, expect, it } from 'vitest';
import { TurnSystem } from './TurnSystem';
import type { CharacterUnit } from '../entities/CharacterUnit';
import type { Team } from '../../shared/protocol';

// Мінімальний двійник CharacterUnit: TurnSystem читає лише team/dead/setActive
function fakeChar(team: Team, name: string): CharacterUnit {
  return {
    team,
    name,
    dead: false,
    setActive() {},
  } as unknown as CharacterUnit;
}

function makeTeams(catCount = 4, dogCount = 4) {
  const cats = Array.from({ length: catCount }, (_, i) => fakeChar('cats', `c${i}`));
  const dogs = Array.from({ length: dogCount }, (_, i) => fakeChar('dogs', `d${i}`));
  return { cats, dogs, turns: new TurnSystem(cats, dogs) };
}

describe('TurnSystem', () => {
  it('чергує кота і пса по колу', () => {
    const { turns } = makeTeams();
    const order = Array.from({ length: 10 }, () => turns.next()!.name);
    expect(order).toEqual(['c0', 'd0', 'c1', 'd1', 'c2', 'd2', 'c3', 'd3', 'c0', 'd0']);
  });

  it('пропускає мертвих (ПОТОЧНА поведінка: чергування команд ламається)', () => {
    const { cats, turns } = makeTeams();
    cats[1].dead = true;
    const order = Array.from({ length: 4 }, () => turns.next()!.name);
    // Ring-черга перескакує мертвого c1 і віддає хід d1 одразу після d0 —
    // команда ходить двічі поспіль. Квірк чесності, виправляється переписом
    // TurnSystem у T13 (строге чергування команд).
    expect(order).toEqual(['c0', 'd0', 'd1', 'c2']);
  });

  it('нерівні команди чергуються без провалів', () => {
    const { turns } = makeTeams(2, 4);
    const order = Array.from({ length: 6 }, () => turns.next()!.name);
    expect(order).toEqual(['c0', 'd0', 'c1', 'd1', 'd2', 'd3']);
  });

  it('усі мертві → next() дає null і current скидається', () => {
    const { cats, dogs, turns } = makeTeams();
    [...cats, ...dogs].forEach((c) => (c.dead = true));
    expect(turns.next()).toBeNull();
    expect(turns.current).toBeNull();
  });

  it('defeatedTeam: команда без живих програла', () => {
    const { cats, turns } = makeTeams();
    expect(turns.defeatedTeam()).toBeNull();
    cats.forEach((c) => (c.dead = true));
    expect(turns.defeatedTeam()).toBe('cats');
  });

  it('alive рахує лише живих своєї команди', () => {
    const { cats, turns } = makeTeams();
    cats[0].dead = true;
    expect(turns.alive('cats')).toHaveLength(3);
    expect(turns.alive('dogs')).toHaveLength(4);
  });
});
