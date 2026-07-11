import type { ControllerMessage, ScreenMessage } from '../shared/protocol';

export interface ControllerTransport {
  send(msg: ControllerMessage): void;
  onConnect(fn: () => void): void;
  onMessage(fn: (msg: ScreenMessage) => void): void;
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
  };
}

export function createWsTransport(): ControllerTransport {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Dev-релей живе на порту 3001 (Vite займає свій — див. server/relay.js)
  const ws = new WebSocket(`${proto}://${location.hostname}:3001`);
  let connectFn: (() => void) | null = null;
  let messageFn: ((msg: ScreenMessage) => void) | null = null;

  ws.onopen = () => ws.send(JSON.stringify({ role: 'controller' }));
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'your_id') connectFn?.();
    else messageFn?.(msg as ScreenMessage);
  };

  return {
    send: (msg) => ws.send(JSON.stringify({ to: 'screen', ...msg })),
    onConnect: (fn) => (connectFn = fn),
    onMessage: (fn) => (messageFn = fn),
  };
}

export function createTransport(): ControllerTransport {
  const isLocal = new URLSearchParams(location.search).get('local') === '1';
  return isLocal || typeof AirConsole === 'undefined'
    ? createWsTransport()
    : createAirConsoleTransport();
}
