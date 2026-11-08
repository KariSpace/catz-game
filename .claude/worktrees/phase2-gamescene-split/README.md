# CATZ vs DOGZ v2

Покрокова артилерійська гра для AirConsole: TV-екран + телефони-контролери.
Phaser 3 (рендер) + Rapier 2D (фізика) + TypeScript + Vite.

## Запуск

```bash
npm install
npm run dev        # Vite (екран+контролер) + WS-релей одночасно
```

| Режим | URL |
|---|---|
| Соло з клавіатури | `http://localhost:5173/screen.html?kb=1` |
| Соло, конкретні бази | `http://localhost:5173/screen.html?kb=1&struct=tower,bunker` |
| З телефоном (та сама WiFi) | екран `http://localhost:5173/screen.html?local=1`, телефон `http://<IP>:5173/controller.html?local=1` |
| AirConsole (прод) | `npm run build` → задеплоїти `dist/` → AirConsole підхоплює `screen.html`/`controller.html` |

(`http://localhost:5173/` без шляху теж працює — `index.html` редіректить на
`screen.html`, зберігаючи параметри.)

Клавіатура (dev): `A/D` кут, `W/S` сила, `1/2` зброя, `SPACE` вогонь/тап, у меню `SPACE` старт.

## Архітектура

```
src/
├── shared/            ← спільне для екрана і контролера
│   ├── protocol.ts    ← типізовані повідомлення (єдине джерело правди)
│   ├── config.ts      ← весь ігровий баланс: зброя, персонажі, фізика, шкода
│   └── blueprints.ts  ← блокові будівлі: розкладки блоків + точки спавну
├── controller/        ← телефон: vanilla TS, ~4 KB бандл
└── screen/
    ├── net/           ← Transport (airconsole|ws|keyboard) + PlayerHub (події)
    ├── physics/       ← PhysicsWorld: ЄДИНА межа з Rapier (назовні лише пікселі)
    ├── entities/      ← Ground, Block, Building, CharacterUnit, ProjectileEntity
    ├── systems/       ← TurnSystem
    ├── ui/            ← HUD, FishMinigame, fx
    └── scenes/        ← Preload → Menu → Vote → Game → Victory
```

Ключові принципи:
- **Протокол типізований і спільний** — контролер та екран не можуть розсинхронізуватись.
- **Уся Rapier-специфіка в `physics/`** — сцени говорять пікселями та ігровими поняттями
  (блок, вибух, персонаж). Метри існують лише всередині обгортки.
- **Сцени підписуються на PlayerHub у `create()` і відписуються у `shutdown()`** —
  жодних глобальних колбеків.
- **Будівлі — фізичні блоки** (камінь/дерево/картон) з HP; вибухи дають radial impulse,
  падіння та роздавлювання рахуються з Δv контактів (одна формула для fall/crush damage).

## Тюнінг фізики

Все в `src/shared/config.ts` та `blueprints.ts` (MATERIALS):
- дуга снаряда: `muzzleSpeedPx`, `PHYSICS.GRAVITY_M`
- сила розкидання: `blastSpeed` (м/с в епіцентрі)
- шкода від падінь: `DAMAGE.IMPACT_MIN_DV` (поріг), `IMPACT_DMG_PER_DV`
- стабільність будівель: густини `MATERIALS`, персонаж має бути НЕ важчим за блоки,
  на яких стоїть (зараз ≈1.4 кг проти ≈1–3 кг у блоків)

Правила для нових блупринтів: зазор між блоками ≥2px (жодних перетинів при спавні!),
кожен блок мусить мати опору під собою, стики дощок — над стовпами,
сходинки для персонажів ≥40px завширшки.
