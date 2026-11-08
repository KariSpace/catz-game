/*
 * Headless smoke мультиплеєра (?local=1): екран + 2 «телефони» через релей.
 * Перевіряє: лобі і гейт старту (не стартує без другої команди), вибір команд
 * на контролері, голосування, хід з телефона, ПАУЗУ при дисконекті гравця
 * і резюм із повторним your_turn після повернення.
 *
 * Запуск: npm run build && npm run smoke:multi   (браузер — див. tools/smoke.cjs)
 */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4173;
const HOST = `http://127.0.0.1:${PORT}`;

let failures = 0;
const expect = (cond, name) => {
  console.log(cond ? `  PASS ${name}` : `  FAIL ${name}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const root = path.join(__dirname, '..');
  const preview = spawn(
    path.join(root, 'node_modules', '.bin', 'vite'),
    ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: 'ignore' },
  );
  const relay = spawn('node', [path.join(root, 'server', 'relay.js')], { cwd: root, stdio: 'ignore' });
  // Якщо порт 3001 тримає старий npm run dev — тест мовчки говоритиме зі
  // СТАРИМ релеєм; краще впасти голосно
  let shuttingDown = false;
  relay.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[relay] впав (code ${code}) — порт 3001 зайнятий? Вбий старий: pkill -f relay.js`);
      failures++;
    }
  });

  try {
    await waitForServer();
    await run();
  } finally {
    shuttingDown = true;
    preview.kill();
    relay.kill();
  }
  console.log(failures === 0 ? 'SMOKE-MULTI OK' : `SMOKE-MULTI FAILED: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${HOST}/screen.html`);
      return;
    } catch {
      await wait(200);
    }
  }
  throw new Error(`vite preview не піднявся на :${PORT} (спершу npm run build)`);
}

async function run() {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  // ─── Екран ───────────────────────────────────────────────────────────
  const screen = await ctx.newPage();
  screen.on('pageerror', (e) => { console.log('[screen pageerror]', e.message); failures++; });
  await screen.goto(`${HOST}/screen.html?local=1`, { waitUntil: 'load' });
  await screen.waitForFunction(() => window.__game !== undefined, null, { timeout: 20000 });
  await wait(1000);

  const gameState = () => screen.evaluate(() => {
    const game = window.__game;
    const active = game.scene.getScenes(true).map((s) => s.scene.key);
    const gs = game.scene.getScene('GameScene');
    return {
      active,
      machine: gs && gs.machine ? gs.machine.phase : null,
      paused: gs && gs.machine ? gs.machine.paused : null,
      current: gs && gs.turns && gs.turns.current ? gs.turns.current.name : null,
    };
  });
  const visibleScreenId = (page) => page.evaluate(() => document.querySelector('.screen.visible')?.id);

  // ─── Контролер: хелпер підключення і вибору команди ──────────────────
  // Кожен контролер у власному контексті — щоб можна було симулювати
  // «тихе вмирання» з'єднання через setOffline (заблокований телефон).
  // Після вибору команди контролер може пролетіти лобі миттєво
  // (реконект посеред бою: team_ok → resume → your_turn), тому екран,
  // на який чекати, задає викликач.
  const openController = async (team, waitFor = '#screen-lobby.visible') => {
    const pctx = await browser.newContext({ viewport: { width: 400, height: 700 } });
    const page = await pctx.newPage();
    page.on('pageerror', (e) => { console.log('[controller pageerror]', e.message); failures++; });
    await page.goto(`${HOST}/controller.html?local=1`, { waitUntil: 'load' });
    await page.waitForSelector('#screen-team.visible', { timeout: 10000 });
    await page.click(`.team-btn[data-team="${team}"]`);
    await page.waitForSelector(waitFor, { timeout: 8000 });
    return { page, pctx };
  };

  // 1. Перший телефон обирає котів — старт має бути заблокований
  const { page: phoneA } = await openController('cats');
  await wait(500);
  expect(await phoneA.locator('#start-btn').isHidden(), 'кнопка старту прихована, поки друга команда порожня');

  await screen.keyboard.press('Space'); // спроба стартувати з екрана
  await phoneA.click('#start-btn', { force: true }).catch(() => {}); // і силою з телефона
  await wait(800);
  let s = await gameState();
  expect(s.active.includes('MenuScene'), 'без другої команди гра НЕ стартувала');

  // 2. Другий телефон обирає собак — лобі готове
  const { page: phoneB } = await openController('dogs');
  await wait(600);
  expect(await phoneA.locator('#start-btn').isVisible(), 'кнопка старту з’явилась, коли обидві команди зайняті');
  const lobbyText = await phoneA.locator('#lobby-teams').textContent();
  expect(lobbyText.includes('🐱 ✅') && lobbyText.includes('🐶 ✅'), `контролер бачить обидві команди (${lobbyText})`);

  // 3. Старт з телефона → голосування на обох
  await phoneA.click('#start-btn');
  await phoneA.waitForSelector('#screen-vote.visible', { timeout: 8000 });
  await phoneB.waitForSelector('#screen-vote.visible', { timeout: 8000 });
  expect(true, 'голосування прийшло на обидва телефони');

  // 3а. Собаки вилітають ДО голосування; коти голосують — гра НЕ стартує
  // ([].every давав true і фіналізував без команди)
  await phoneB.close();
  await wait(500);
  await phoneA.click('.vote-btn');
  await wait(1500);
  s = await gameState();
  expect(s.active.includes('VoteScene'), 'голосування чекає на команду, що відпала');

  // 3б. Собаки повертаються — бюлетень ресендиться, голосують → бій
  const { page: phoneB2 } = await openController('dogs', '#screen-vote.visible');
  expect(true, 'після реконекту бюлетень прийшов повторно');
  await phoneB2.click('.vote-btn');

  // 4. Бій: чекаємо ходу котів, контролер A отримує your_turn
  await screen.waitForFunction(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return gs && gs.machine && gs.machine.phase === 'aiming';
  }, null, { timeout: 30000 });
  await phoneA.waitForSelector('#screen-turn.visible', { timeout: 5000 });
  expect(true, 'хід котів прийшов на телефон A');
  expect((await visibleScreenId(phoneB2)) === 'screen-wait', 'телефон B чекає');

  // 5. Постріл з телефона A → хід переходить до собак
  await phoneA.click('#fire-btn');
  await screen.waitForFunction(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return gs.machine.phase === 'aiming' && gs.turns.current && gs.turns.current.team === 'dogs';
  }, null, { timeout: 30000 });
  await phoneB2.waitForSelector('#screen-turn.visible', { timeout: 5000 });
  expect(true, 'постріл з телефона спрацював, хід перейшов до собак');

  // 6а. Heartbeat релея: клієнт, що НЕ відповідає на ping (заблокований
  // телефон, зниклий wifi — close не приходить) — релей мусить вбити сам.
  // setOffline у Chromium не рве відкриті ws, тому симулюємо raw-клієнтом.
  const WS = require('ws');
  const deadClient = new WS(`ws://127.0.0.1:3001`, { autoPong: false });
  const killedMs = await new Promise((resolve) => {
    const t0 = Date.now();
    deadClient.on('open', () => deadClient.send(JSON.stringify({ role: 'controller' })));
    deadClient.on('close', () => resolve(Date.now() - t0));
    deadClient.on('error', () => resolve(-1));
    setTimeout(() => resolve(Infinity), 16000);
  });
  expect(killedMs > 0 && killedMs < 15000, `релей вбиває мовчазне з’єднання heartbeat-ом (${Math.round(killedMs / 1000)}с)`);

  // 6б. Телефон B вилітає посеред свого ходу → пауза
  await phoneB2.close();
  await screen.waitForFunction(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return gs.machine.paused === true;
  }, null, { timeout: 8000 });
  expect(true, 'дисконект гравця поставив гру на паузу');
  await phoneA.waitForSelector('#screen-pause.visible', { timeout: 5000 });
  expect(true, 'телефон A бачить екран паузи');

  // Ввід на паузі мертвий: постріл із чужого телефона не проходить
  await phoneA.click('#fire-btn', { force: true }).catch(() => {});
  await wait(500);
  s = await gameState();
  expect(s.paused === true && s.machine === 'aiming', 'на паузі ввід ігнорується');

  // 7. «Той самий» гравець повертається (нове підключення) → резюм + your_turn
  const { page: phoneC } = await openController('dogs', '#screen-turn.visible');
  expect(true, 'your_turn повторно надіслано гравцю, що повернувся');
  await screen.waitForFunction(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return gs.machine.paused === false;
  }, null, { timeout: 8000 });
  expect(true, 'повернення гравця зняло паузу');
  s = await gameState();
  expect(s.current !== null && s.machine === 'aiming', `гра продовжується (хід: ${s.current})`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
