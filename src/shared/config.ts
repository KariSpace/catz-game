import type { StructureId, Team, WeaponKey } from './protocol';

// ─── Екран ────────────────────────────────────────────────────────────
export const VIEW = { W: 1280, H: 720 } as const;

// ─── Фізика ───────────────────────────────────────────────────────────
// Rapier працює в метрах: солвер стабільний, коли тіла мають розмір ~0.1–10.
// Увесь геймплейний код оперує пікселями; конвертація — лише на межі з Rapier.
export const PIXELS_PER_METER = 50;

export const PHYSICS = {
  GRAVITY_M: 9.81,           // м/с², вниз (екранна вісь Y)
  TIMESTEP: 1 / 60,          // фіксований крок симуляції, c
  MAX_SUBSTEPS: 4,           // скільки кроків максимум наздоганяємо за кадр
  WIND_MAX_PX: 120,          // px/s² горизонтального прискорення снаряда
  SETTLE_TIMEOUT_MS: 4000,   // максимум чекання, поки уламки заспокояться
  SETTLE_SPEED_PX: 8,        // тіла повільніші за це вважаємо нерухомими
} as const;

// Шкода від ударів (падіння персонажа, блок падає на голову) рахується
// від зміни швидкості Δv = імпульс контакту / маса тіла — однакова формула
// для fall damage і crush damage.
export const DAMAGE = {
  IMPACT_MIN_DV: 4,          // м/с — м'якші удари (осідання, дрібні стрибки) безболісні
  IMPACT_DMG_PER_DV: 7,      // шкода за кожен м/с понад поріг
  IMPACT_MAX: 45,            // стеля шкоди від одного удару
  BLOCK_IMPACT_SCALE: 0.5,   // блоки страждають від ударів слабше за персонажів
} as const;

// ─── Раунд ────────────────────────────────────────────────────────────
export const ROUND = {
  TURN_SECONDS: 25,
  VOTE_SECONDS: 15,
  FISH_ZONE_HALF_PX: 120,
  FISH_ARROW_SPEED_PX: 160,
  FISH_TIMEOUT_MS: 8000,     // фаза 2 фішинг-бомби не може тривати вічно
} as const;

// ─── Команди ──────────────────────────────────────────────────────────
export const TEAMS: Record<Team, { name: string; color: number; label: string }> = {
  cats: { name: 'Cats', color: 0xf97316, label: '🐱' },
  dogs: { name: 'Dogs', color: 0x3b82f6, label: '🐶' },
};

export const BASE_WEAPON: Record<Team, WeaponKey> = {
  cats: 'hairball',
  dogs: 'boneCannon',
};

// ─── Персонажі (пари з GDD, по 4 на команду) ─────────────────────────
export interface CharacterDef {
  team: Team;
  name: string;
  hp: number;
  special: WeaponKey;
  sprite: string;
  tint: number;
}

export const CHARACTERS: Record<string, CharacterDef> = {
  // Cats
  ginger: { team: 'cats', name: 'Рижий кіт', hp: 90, special: 'sausage', sprite: 'cat-orange', tint: 0xffa040 },
  fluffy: { team: 'cats', name: 'Лохматий кіт', hp: 85, special: 'furball', sprite: 'cat-light', tint: 0xe8e8e8 },
  fisher: { team: 'cats', name: 'Fisher Cat', hp: 75, special: 'fishingBomb', sprite: 'cat-light', tint: 0x80b8d0 },
  fatcat: { team: 'cats', name: 'Fat Cat', hp: 110, special: 'stinkyBomb', sprite: 'cat-orange', tint: 0xff7040 },
  // Dogs
  dachshund: { team: 'dogs', name: 'Такса', hp: 90, special: 'sausage', sprite: 'cat-dark', tint: 0x6090e0 },
  poodle: { team: 'dogs', name: 'Пудель', hp: 85, special: 'furball', sprite: 'cat-light', tint: 0x90c8ff },
  terrier: { team: 'dogs', name: 'Terrier', hp: 75, special: 'fishingBomb', sprite: 'cat-dark', tint: 0x5080c0 },
  bulldog: { team: 'dogs', name: 'Bulldog', hp: 130, special: 'stinkyBomb', sprite: 'cat-orange', tint: 0x4060b0 },
};

export const TEAM_ROSTER: Record<Team, string[]> = {
  cats: ['ginger', 'fluffy', 'fisher', 'fatcat'],
  dogs: ['dachshund', 'poodle', 'terrier', 'bulldog'],
};

// ─── Зброя ────────────────────────────────────────────────────────────
export type WeaponBehavior = 'standard' | 'wide' | 'cluster' | 'fishing' | 'mortar';

export interface WeaponDef {
  name: string;
  ammo: number; // Infinity для базової
  damage: number;
  blastRadiusPx: number;
  /** Приріст швидкості в епіцентрі вибуху, м/с — розкидає блоки та персонажів */
  blastSpeed: number;
  muzzleSpeedPx: number;
  behavior: WeaponBehavior;
  projectileColor: number;
  trailColor: number;
}

export const WEAPONS: Record<WeaponKey, WeaponDef> = {
  hairball: {
    name: 'Hairball', ammo: Infinity, damage: 30, blastRadiusPx: 55, blastSpeed: 6,
    muzzleSpeedPx: 620, behavior: 'standard', projectileColor: 0xd97706, trailColor: 0xf59e0b,
  },
  boneCannon: {
    name: 'Bone Cannon', ammo: Infinity, damage: 30, blastRadiusPx: 55, blastSpeed: 6,
    muzzleSpeedPx: 620, behavior: 'standard', projectileColor: 0xe5e7eb, trailColor: 0x9ca3af,
  },
  sausage: {
    name: 'Sausage', ammo: 3, damage: 25, blastRadiusPx: 85, blastSpeed: 5,
    muzzleSpeedPx: 590, behavior: 'wide', projectileColor: 0xb45309, trailColor: 0xd97706,
  },
  furball: {
    name: 'Furball', ammo: 3, damage: 14, blastRadiusPx: 35, blastSpeed: 3.5,
    muzzleSpeedPx: 540, behavior: 'cluster', projectileColor: 0xa78bfa, trailColor: 0x7c3aed,
  },
  fishingBomb: {
    name: 'Fishing Bomb', ammo: 2, damage: 45, blastRadiusPx: 65, blastSpeed: 7,
    muzzleSpeedPx: 580, behavior: 'fishing', projectileColor: 0xef4444, trailColor: 0xff8080,
  },
  stinkyBomb: {
    name: 'Stinky Bomb', ammo: 2, damage: 50, blastRadiusPx: 95, blastSpeed: 9,
    muzzleSpeedPx: 480, behavior: 'mortar', projectileColor: 0x4ade80, trailColor: 0x16a34a,
  },
};

export const STRUCTURES: StructureId[] = ['tower', 'ramp', 'bunker', 'stack', 'platform'];

export const STRUCTURE_INFO: Record<StructureId, { title: string; desc: string }> = {
  tower: { title: 'TOWER', desc: 'Висока та вузька' },
  ramp: { title: 'RAMP', desc: 'Похила платформа' },
  bunker: { title: 'BUNKER', desc: 'Низька та міцна' },
  stack: { title: 'STACK', desc: 'Хаотична купа' },
  platform: { title: 'PLATFORM', desc: 'Рівна пластина' },
};
