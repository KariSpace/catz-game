/*
 * Headless smoke-прогін ?kb=1: меню → бій → приціл → постріл → ротація ходів →
 * фішинг-бомба (fisher) → мініігра → тап → вибух → наступний хід.
 * Асерти — через дев-хук window.__game (активна сцена, фаза TurnStateMachine,
 * поточний персонаж, HP). Скриншоти кладе поруч у tools/smoke-out/.
 *
 * Запуск: npm run build && npm run smoke
 * Одноразова підготовка браузера:
 *   npx playwright-core install chromium-headless-shell
 *   sudo npx playwright-core install-deps chromium
 */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 4173;
// 127.0.0.1 явно: node fetch резолвить localhost у ::1, а vite слухає лише IPv4
const HOST = `http://127.0.0.1:${PORT}`;
const URL = `${HOST}/screen.html?kb=1&struct=tower,bunker`;
const OUT = path.join(__dirname, 'smoke-out');

const log = (...a) => console.log('[smoke]', ...a);
let failures = 0;
const expect = (cond, name) => {
  console.log(cond ? `  PASS ${name}` : `  FAIL ${name}`);
  if (!cond) failures++;
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // vite напряму (не через npx): kill() тоді вбиває сам сервер, не обгортку
  const preview = spawn(
    path.join(__dirname, '..', 'node_modules', '.bin', 'vite'),
    ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: path.join(__dirname, '..'), stdio: 'ignore' },
  );

  try {
    await waitForServer();
    await run();
  } finally {
    preview.kill();
  }
  console.log(failures === 0 ? 'SMOKE OK' : `SMOKE FAILED: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${HOST}/screen.html`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`vite preview не піднявся на :${PORT} (спершу npm run build)`);
}

async function run() {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { console.log('[pageerror]', e.message); failures++; });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

  const state = () => page.evaluate(() => {
    const game = window.__game;
    if (!game) return null;
    const active = game.scene.getScenes(true).map((s) => s.scene.key);
    const gs = game.scene.getScene('GameScene');
    const machine = gs && gs.machine ? gs.machine.phase : null;
    const current = gs && gs.turns && gs.turns.current ? gs.turns.current.name : null;
    const hp = gs && gs.chars ? gs.chars.map((c) => `${c.name}:${c.hp}`) : null;
    return { active, machine, current, hp };
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const waitPhase = async (phase, timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await state();
      if (s && s.machine === phase) return s;
      await page.waitForTimeout(150);
    }
    return await state();
  };
  const press = async (key, times = 1) => {
    for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(40); }
  };

  log('open', URL);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 20000 });
  await page.waitForTimeout(2000); // kb-транспорт підключає фейкових гравців через 100мс

  let s = await state();
  expect(s.active.includes('MenuScene'), 'меню піднялось');
  await shot('01-menu');

  await press('Space'); // старт матчу
  s = await waitPhase('aiming', 12000); // осідання будівель → перший хід
  expect(s.active.includes('GameScene'), 'GameScene активна');
  expect(s.machine === 'aiming', 'фаза aiming після осідання');
  expect(s.current === 'Рижий кіт', 'перший хід — c0 (Рижий кіт)');
  await shot('02-first-turn');

  // Приціл: траєкторія має малюватись (перевірити оком у 03-traj-preview.png)
  await press('w', 3);
  await press('a', 3);
  await shot('03-traj-preview');

  await press('Space'); // постріл
  s = await state();
  expect(s.machine === 'flying' || s.machine === 'settling', `після пострілу flying/settling (${s.machine})`);
  await page.waitForTimeout(400);
  await shot('04-in-flight');

  s = await waitPhase('aiming', 15000);
  expect(s.current === 'Такса', 'хід перейшов до собак (Такса)');

  // Прогортаємо ходи до fisher: d0 → c1 → d1 → c2(fisher)
  for (const expected of ['Лохматий кіт', 'Пудель', 'Fisher Cat']) {
    await press('Space');
    s = await waitPhase('aiming', 15000);
    if (s.machine !== 'aiming') { expect(false, `дочекались aiming (зараз ${s.machine})`); break; }
    expect(s.current === expected, `хід ${expected} (фактично ${s.current})`);
  }

  // Фішинг-бомба: зброя 2, слабший постріл, тап у мініігрі
  await press('2');
  await press('s', 4);
  await press('Space');
  s = await waitPhase('fishing', 15000);
  expect(s.machine === 'fishing', 'фаза fishing (мініігра піднялась)');
  await shot('05-fish-minigame');

  await page.waitForTimeout(700); // стрілка бігає
  await press('Space');           // тап
  s = await state();
  expect(s.machine === 'resolving', `тап → resolving (${s.machine})`);
  await page.waitForTimeout(350); // підліт рибки завершився
  await shot('06-fish-explosion');
  s = await state();
  expect(s.machine === 'settling', `після вибуху settling (${s.machine})`);

  s = await waitPhase('aiming', 15000);
  expect(s.machine === 'aiming', 'гра продовжилась після фішингу');
  expect(s.current === 'Terrier', `наступний хід Terrier (фактично ${s.current})`);
  await shot('07-after-fishing');
  log('hp:', JSON.stringify(s.hp));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
