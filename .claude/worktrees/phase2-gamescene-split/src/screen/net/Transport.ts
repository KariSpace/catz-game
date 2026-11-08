import type { ControllerMessage, ScreenMessage } from '../../shared/protocol';

export type PlayerId = string;
export type TransportMode = 'airconsole' | 'ws' | 'keyboard';

export interface TransportEvents {
  connect(id: PlayerId): void;
  disconnect(id: PlayerId): void;
  message(id: PlayerId, msg: ControllerMessage): void;
}

/** Транспорт лише доставляє повідомлення. Стан гравців — у PlayerHub. */
export interface ScreenTransport {
  readonly mode: TransportMode;
  bind(events: TransportEvents): void;
  send(id: PlayerId, msg: ScreenMessage): void;
  broadcast(msg: ScreenMessage): void;
}

// ─── AirConsole (прод) ────────────────────────────────────────────────

class AirConsoleTransport implements ScreenTransport {
  readonly mode: TransportMode = 'airconsole';
  private ac = new AirConsole();

  bind(events: TransportEvents): void {
    this.ac.onConnect = (id) => events.connect(String(id));
    this.ac.onDisconnect = (id) => events.disconnect(String(id));
    this.ac.onMessage = (from, data) => events.message(String(from), data as ControllerMessage);
  }

  send(id: PlayerId, msg: ScreenMessage): void {
    this.ac.message(Number(id), msg);
  }

  broadcast(msg: ScreenMessage): void {
    this.ac.broadcast(msg);
  }
}

// ─── WebSocket-релей (локальна розробка з телефоном) ──────────────────

class WsTransport implements ScreenTransport {
  readonly mode: TransportMode = 'ws';
  private ws!: WebSocket;
  private events: TransportEvents | null = null;

  constructor() {
    this.connect();
  }

  // Релей перезапустився/впав — перепідключаємось; при реєстрації нового
  // екрана релей ресендить connect-и всіх живих контролерів
  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.hostname}:3001`);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ role: 'screen' }));
    this.ws.onmessage = (evt) => {
      if (!this.events) return;
      const msg = JSON.parse(evt.data);
      if (msg.type === 'connect') this.events.connect(String(msg.id));
      else if (msg.type === 'disconnect') this.events.disconnect(String(msg.id));
      else if (msg.from != null) this.events.message(String(msg.from), msg as ControllerMessage);
    };
    this.ws.onclose = () => {
      console.warn('[net] relay disconnected — reconnecting');
      setTimeout(() => this.connect(), 1500);
    };
  }

  bind(events: TransportEvents): void {
    this.events = events;
  }

  send(id: PlayerId, msg: ScreenMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ to: 'controller', id: Number(id), ...msg }));
    }
  }

  broadcast(msg: ScreenMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ to: 'all', ...msg }));
    }
  }
}

// ─── Клавіатура (соло-розробка без телефонів) ─────────────────────────
// Створює по одному фейковому гравцю на команду; ігровий ввід дають
// клавіатурні біндінги сцен, а не транспорт.

class KeyboardTransport implements ScreenTransport {
  readonly mode: TransportMode = 'keyboard';

  bind(events: TransportEvents): void {
    setTimeout(() => {
      for (const [id, team] of [['kb-cat', 'cats'], ['kb-dog', 'dogs']] as const) {
        events.connect(id);
        events.message(id, { type: 'team_select', team });
      }
    }, 100);
  }

  send(): void { /* немає реальних пристроїв */ }
  broadcast(): void { /* немає реальних пристроїв */ }
}

export function createTransport(): ScreenTransport {
  const params = new URLSearchParams(location.search);
  if (params.get('kb') === '1') return new KeyboardTransport();
  if (params.get('local') === '1') return new WsTransport();
  if (typeof AirConsole !== 'undefined') return new AirConsoleTransport();
  return new KeyboardTransport(); // CDN недоступний (офлайн-розробка)
}
