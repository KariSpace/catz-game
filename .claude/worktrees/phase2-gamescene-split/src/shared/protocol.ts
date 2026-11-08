// Єдине джерело правди для повідомлень екран ↔ контролер.
// Обидва бандли імпортують ці типи — протокол не може розсинхронізуватись.

export type Team = 'cats' | 'dogs';

export type StructureId = 'tower' | 'ramp' | 'bunker' | 'stack' | 'platform';

export type WeaponKey =
  | 'hairball'
  | 'boneCannon'
  | 'sausage'
  | 'furball'
  | 'fishingBomb'
  | 'stinkyBomb';

export interface WeaponInfo {
  key: WeaponKey;
  name: string;
  /** -1 = нескінченно */
  ammo: number;
}

/** Контролер → екран */
export type ControllerMessage =
  | { type: 'team_select'; team: Team }
  | { type: 'start' }
  | { type: 'structure_vote'; structureId: StructureId }
  | { type: 'aim'; angle: number; power: number }
  | { type: 'fire'; angle: number; power: number }
  | { type: 'weapon'; weaponKey: WeaponKey }
  | { type: 'tap' }
  | { type: 'rematch' };

/** Стан лобі — одна правда для екрана і всіх контролерів */
export interface LobbyState {
  /** Імена гравців по командах (поки максимум один на команду) */
  teams: Record<Team, string[]>;
  /** Обидві команди укомплектовані — старт дозволений */
  ready: boolean;
  /** Підключені телефони, які ще не обрали команду */
  unassigned: number;
}

/** Екран → контролер */
export type ScreenMessage =
  | { type: 'connected' }
  | ({ type: 'lobby' } & LobbyState)
  | { type: 'team_ok'; team: Team }
  | { type: 'team_denied'; team: Team }
  | { type: 'structure_vote'; options: StructureId[]; seconds: number }
  | { type: 'vote_result'; cats: StructureId; dogs: StructureId }
  | {
      type: 'your_turn';
      characterName: string;
      weapons: WeaponInfo[];
      active: WeaponKey;
      /** Поточний приціл персонажа — стартова точка регулювання */
      angle: number;
      power: number;
    }
  | { type: 'end_turn' }
  | { type: 'fish_phase2' }
  /** Гра на паузі (гравець відключився) — контролер показує оверлей */
  | { type: 'pause'; reason: string }
  | { type: 'resume' }
  | { type: 'you_win' }
  | { type: 'you_lose' };

export function isControllerMessage(data: unknown): data is ControllerMessage {
  return typeof data === 'object' && data !== null && typeof (data as { type?: unknown }).type === 'string';
}
