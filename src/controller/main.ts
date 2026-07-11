import './controller.css';
import { STRUCTURE_INFO } from '../shared/config';
import type { ScreenMessage, StructureId, Team, WeaponInfo, WeaponKey } from '../shared/protocol';
import { createTransport } from './transport';

const transport = createTransport();

let myTeam: Team | null = null;

// ─── Екрани ──────────────────────────────────────────────────────────

type ScreenId =
  | 'screen-connected' | 'screen-team' | 'screen-lobby' | 'screen-vote'
  | 'screen-turn' | 'screen-wait' | 'screen-fish2' | 'screen-result';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function showScreen(id: ScreenId): void {
  document.querySelectorAll<HTMLElement>('.screen').forEach((s) => s.classList.remove('visible'));
  el(id).classList.add('visible');
}

showScreen('screen-connected');

// ─── Вхідні повідомлення ─────────────────────────────────────────────

// Dev: ?team=cats|dogs — команда обирається автоматично при підключенні
const autoTeamParam = new URLSearchParams(location.search).get('team');
const autoTeam: Team | null = autoTeamParam === 'cats' || autoTeamParam === 'dogs' ? autoTeamParam : null;

function onConnected(): void {
  if (myTeam) {
    // Екран міг перезавантажитись і забути нас — нагадуємо свою команду
    transport.send({ type: 'team_select', team: myTeam });
    showScreen('screen-lobby');
  } else if (autoTeam) {
    requestTeam(autoTeam);
  } else {
    showScreen('screen-team');
  }
}

transport.onConnect(onConnected);

transport.onMessage((msg: ScreenMessage) => {
  switch (msg.type) {
    case 'connected': onConnected(); break;
    case 'lobby':
      updateTeamButtons(msg.taken);
      showScreen(myTeam ? 'screen-lobby' : 'screen-team');
      break;
    case 'team_ok': confirmTeam(msg.team); break;
    case 'team_denied': denyTeam(msg.team); break;
    case 'structure_vote': showVote(msg.options, msg.seconds); break;
    case 'vote_result': showScreen('screen-wait'); break;
    case 'your_turn': showTurn(msg); break;
    case 'end_turn': showScreen('screen-wait'); break;
    case 'fish_phase2': showScreen('screen-fish2'); break;
    case 'you_win': showResult(true); break;
    case 'you_lose': showResult(false); break;
  }
});

// ─── Вибір команди + лобі ────────────────────────────────────────────
// Вибір підтверджує екран: команди ексклюзивні, тож чекаємо team_ok/team_denied

function requestTeam(team: Team): void {
  transport.send({ type: 'team_select', team });
}

function confirmTeam(team: Team): void {
  myTeam = team;
  el('lobby-emoji').textContent = team === 'cats' ? '🐱' : '🐶';
  showScreen('screen-lobby');
}

function denyTeam(team: Team): void {
  const btn = document.querySelector<HTMLButtonElement>(`.team-btn[data-team="${team}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = team === 'cats' ? '🐱 Cats — зайнято' : '🐶 Dogs — зайнято';
  }
  showScreen('screen-team');
}

function updateTeamButtons(taken: Team[]): void {
  document.querySelectorAll<HTMLButtonElement>('.team-btn').forEach((btn) => {
    const team = btn.dataset.team as Team;
    const isTaken = taken.includes(team) && team !== myTeam;
    btn.disabled = isTaken;
    btn.textContent =
      team === 'cats'
        ? `🐱 Cats${isTaken ? ' — зайнято' : ''}`
        : `🐶 Dogs${isTaken ? ' — зайнято' : ''}`;
  });
}

document.querySelectorAll<HTMLButtonElement>('.team-btn').forEach((btn) => {
  btn.onclick = () => requestTeam(btn.dataset.team as Team);
});

el<HTMLButtonElement>('start-btn').onclick = () => transport.send({ type: 'start' });

// ─── Голосування ─────────────────────────────────────────────────────

let voteCountdown: ReturnType<typeof setInterval> | null = null;

function showVote(options: StructureId[], seconds: number): void {
  showScreen('screen-vote');

  const timerEl = el('vote-timer');
  let left = seconds;
  timerEl.textContent = String(left);
  if (voteCountdown) clearInterval(voteCountdown);
  voteCountdown = setInterval(() => {
    left -= 1;
    timerEl.textContent = String(Math.max(0, left));
    if (left <= 0 && voteCountdown) clearInterval(voteCountdown);
  }, 1000);

  const container = el('vote-options');
  container.innerHTML = '';
  let voted = false;

  options.forEach((key) => {
    const info = STRUCTURE_INFO[key];
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.innerHTML = `<b>${info.title}</b><div class="vote-desc">${info.desc}</div>`;
    btn.onclick = () => {
      if (voted) return;
      voted = true;
      btn.classList.add('voted');
      transport.send({ type: 'structure_vote', structureId: key });
    };
    container.appendChild(btn);
  });
}

// ─── Хід: свайп регулює приціл, стріляє окрема кнопка ВОГОНЬ ─────────

let lastAim = { angle: 45, power: 60 };

function showTurn(msg: Extract<ScreenMessage, { type: 'your_turn' }>): void {
  el('turn-name').textContent = msg.characterName;
  lastAim = { angle: msg.angle, power: msg.power };
  updateAimIndicator();
  showScreen('screen-turn');
  buildWeaponBar(msg.weapons, msg.active);
}

function updateAimIndicator(): void {
  el('aim-indicator').textContent = `${Math.round(lastAim.angle)}° · ${Math.round(lastAim.power)}%`;
}

function buildWeaponBar(weapons: WeaponInfo[], activeKey: WeaponKey): void {
  const bar = el('weapon-bar');
  bar.innerHTML = '';
  weapons.forEach((w) => {
    const empty = w.ammo === 0;
    const btn = document.createElement('button');
    btn.className = 'weapon-btn' + (w.key === activeKey ? ' active' : '') + (empty ? ' empty' : '');
    btn.innerHTML = `${w.name}<span class="weapon-ammo">${w.ammo === -1 ? '∞' : w.ammo}</span>`;
    if (!empty) {
      btn.onclick = () => {
        transport.send({ type: 'weapon', weaponKey: w.key });
        bar.querySelectorAll('.weapon-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      };
    }
    bar.appendChild(btn);
  });
}

// Свайп: напрям → кут, довжина → сила. Відпускання пальця НЕ стріляє —
// приціл зберігається, можна свайпати скільки завгодно і вистрілити кнопкою.
{
  const zone = el('swipe-zone');
  let start: { x: number; y: number } | null = null;

  const calcAim = (x: number, y: number) => {
    const dx = x - start!.x;
    const dy = y - start!.y;
    const raw = Math.atan2(-dy, dx) * (180 / Math.PI);
    return {
      angle: Math.max(5, Math.min(175, raw)),
      power: Math.min(100, Math.hypot(dx, dy) / 1.4),
    };
  };

  zone.onpointerdown = (e) => {
    zone.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
  };
  zone.onpointermove = (e) => {
    if (!start) return;
    const aim = calcAim(e.clientX, e.clientY);
    if (aim.power < 5) return; // випадковий дотик не збиває прицілу
    lastAim = aim;
    updateAimIndicator();
    transport.send({ type: 'aim', ...lastAim });
  };
  zone.onpointerup = () => { start = null; };
  zone.onpointercancel = () => { start = null; };
}

el<HTMLButtonElement>('fire-btn').onclick = () => {
  transport.send({ type: 'fire', ...lastAim });
};

// ─── Фішинг фаза 2 / результат ───────────────────────────────────────

el<HTMLButtonElement>('fish-tap-btn').onclick = () => {
  transport.send({ type: 'tap' });
  showScreen('screen-wait');
};

function showResult(won: boolean): void {
  el('result-emoji').textContent = won ? '🏆' : '😿';
  el('result-text').textContent = won ? 'ПЕРЕМОГА!' : 'Програш';
  showScreen('screen-result');
}

el<HTMLButtonElement>('rematch-btn').onclick = () => {
  transport.send({ type: 'rematch' });
  showScreen('screen-wait');
};
