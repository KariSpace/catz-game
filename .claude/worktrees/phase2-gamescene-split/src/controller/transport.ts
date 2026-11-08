import type { ControllerMessage, ScreenMessage } from '../shared/protocol';

export interface ControllerTransport {
  send(msg: ControllerMessage): void;
  onConnect(fn: () => void): void;
  onMessage(fn: (msg: ScreenMessage) => void): void;
  /** З'єднання втрачено; транспорт сам перепідключається — UI лише показує стан */
  onDisconnect(fn: () => void): void;
}

export function createAirConsoleTransport(): ControllerTransport {
  const ac = new AirConsole({ orientation: AirConsole.ORIENTATION_PORTRAIT });
  let connectFn: (() => void) | null = null;
  let messageFn: ((msg: ScreenMessage) => void) | null = null;

  ac.onConnect = () => connectFn?.();
  ac.onMessage = (_from, data) => messageFn?.(data as ScreenMessage);

  return {
    send: (msg) => ac.message(AirConsole.SCREEN, msg),
    onConnect: (fn) => (connectFn = fn),
    onMessage: (fn) => (messageFn = fn),
    onDisconnect: () => { /* AirConsole показує власний оверлей звʼязку */ },
  };
}

export function createWsTransport(): ControllerTransport {
  let connectFn: (() => void) | null = null;
  let messageFn: ((msg: ScreenMessage) => void) | null = null;
  let disconnectFn: (() => void) | null = null;
  let ws: WebSocket | null = null;

  // Телефон блокується, wifi моргає — з'єднання рветься постійно.
  // Перепідключаємось самі; екран побачить нове підключення, а контролер
  // у onConnect нагадає свою команду (див. main.ts).
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // Dev-релей живе на порту 3001 (Vite займає свій — див. server/relay.js)
    ws = new WebSocket(`${proto}://${location.hostname}:3001`);
    ws.onopen = () => ws?.send(JSON.stringify({ role: 'controller' }));
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'your_id') connectFn?.();
      else messageFn?.(msg as ScreenMessage);
    };
    ws.onclose = () => {
      disconnectFn?.();
      if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1500);
    };
  };
  connect();

  // Повернення вкладки з фону: таймери були заморожені, а «відкритий» ws міг
  // умерти напівдорозі (релей уже його вбив heartbeat-ом). Пробуємо одразу:
  // мертвому TCP send зірве onclose → реконект; живому — нешкідливий probe.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ to: 'screen', type: 'probe' }));
    } else if (ws?.readyState !== WebSocket.CONNECTING) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      connect();
    }
  });

  return {
    send: (msg) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ to: 'screen', ...msg }));
    },
    onConnect: (fn) => (connectFn = fn),
    onMessage: (fn) => (messageFn = fn),
    onDisconnect: (fn) => (disconnectFn = fn),
  };
}

export function createTransport(): ControllerTransport {
  const isLocal = new URLSearchParams(location.search).get('local') === '1';
  return isLocal || typeof AirConsole === 'undefined'
    ? createWsTransport()
    : createAirConsoleTransport();
}
