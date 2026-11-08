import { describe, expect, it } from 'vitest';
import { opposite, resolveWinner } from './matchResult';

describe('resolveWinner', () => {
  it('обидві живі → матч триває', () => {
    expect(resolveWinner(false, false, 'cats', true)).toBeNull();
  });

  it('мертва одна команда → інша перемогла (без героїки)', () => {
    expect(resolveWinner(true, false, 'cats', true)).toEqual({ winner: 'dogs', heroic: false });
    expect(resolveWinner(false, true, 'dogs', false)).toEqual({ winner: 'cats', heroic: false });
  });

  it('взаємознищення без прямого влучання → стрілець програє', () => {
    expect(resolveWinner(true, true, 'cats', false)).toEqual({ winner: 'dogs', heroic: false });
    expect(resolveWinner(true, true, 'dogs', false)).toEqual({ winner: 'cats', heroic: false });
  });

  it('взаємознищення прямим влучанням → «все або нічого», стрілець виграє', () => {
    expect(resolveWinner(true, true, 'cats', true)).toEqual({ winner: 'cats', heroic: true });
    expect(resolveWinner(true, true, 'dogs', true)).toEqual({ winner: 'dogs', heroic: true });
  });

  it('фолбек без стрільця — детермінований', () => {
    expect(resolveWinner(true, true, null, true)).toEqual({ winner: 'dogs', heroic: false });
  });

  it('opposite', () => {
    expect(opposite('cats')).toBe('dogs');
    expect(opposite('dogs')).toBe('cats');
  });
});
