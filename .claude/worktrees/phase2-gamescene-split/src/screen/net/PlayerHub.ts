import Phaser from 'phaser';
import type { ControllerMessage, LobbyState, ScreenMessage, Team } from '../../shared/protocol';
import type { PlayerId, ScreenTransport } from './Transport';

export interface Player {
  id: PlayerId;
  team: Team | null;
  name: string;
}

/**
 * Єдина точка входу мережі для сцен. Тримає реєстр гравців і роздає
 * типізовані події. Сцени підписуються у create() і ВІДПИСУЮТЬСЯ у
 * shutdown() — жодних глобальних колбеків, які сцени перезаписують.
 *
 * Події: 'join' (player), 'leave' (player), 'message' (player, msg).
 */
export class PlayerHub extends Phaser.Events.EventEmitter {
  private players = new Map<PlayerId, Player>();
  /** Монотонний лічильник імен: size+1 після дисконектів дає дублікати */
  private nameCounter = 0;

  constructor(private transport: ScreenTransport) {
    super();
    transport.bind({
      connect: (id) => this.handleConnect(id),
      disconnect: (id) => this.handleDisconnect(id),
      message: (id, msg) => this.handleMessage(id, msg),
    });
  }

  get mode() {
    return this.transport.mode;
  }

  /** Соло-розробка без телефонів: голосувати нікому, реванш — через меню */
  isSolo(): boolean {
    return this.transport.mode === 'keyboard';
  }

  private handleConnect(id: PlayerId): void {
    // Повторний connect того самого id (екран перепідключився до релея) —
    // не затираємо гравцю команду
    if (this.players.has(id)) {
      this.transport.send(id, { type: 'connected' });
      return;
    }
    const player: Player = { id, team: null, name: `Player ${++this.nameCounter}` };
    this.players.set(id, player);
    this.transport.send(id, { type: 'connected' });
    this.emit('join', player);
  }

  private handleDisconnect(id: PlayerId): void {
    const player = this.players.get(id);
    if (!player) return;
    this.players.delete(id);
    this.emit('leave', player);
  }

  private handleMessage(id: PlayerId, msg: ControllerMessage): void {
    const player = this.players.get(id);
    if (!player) return;

    if (msg.type === 'team_select') {
      // Команда ексклюзивна: один гравець = одна команда
      const takenByOther = this.all().some((p) => p.id !== id && p.team === msg.team);
      if (takenByOther) {
        this.transport.send(id, { type: 'team_denied', team: msg.team });
        return; // вибір не відбувся — сцени не сповіщаємо
      }
      player.team = msg.team;
      this.transport.send(id, { type: 'team_ok', team: msg.team });
    }

    this.emit('message', player, msg);
  }

  /** Команди, які вже зайняті гравцями */
  takenTeams(): Team[] {
    const taken: Team[] = [];
    for (const team of ['cats', 'dogs'] as const) {
      if (this.team(team).length > 0) taken.push(team);
    }
    return taken;
  }

  /** Знімок лобі — те, що бачать і екран, і контролери */
  lobbyState(): LobbyState {
    const names = (team: Team) => this.team(team).map((p) => p.name);
    const cats = names('cats');
    const dogs = names('dogs');
    return {
      teams: { cats, dogs },
      ready: cats.length > 0 && dogs.length > 0,
      unassigned: this.all().filter((p) => p.team === null).length,
    };
  }

  // ─── Запити ─────────────────────────────────────────────────────────

  all(): Player[] {
    return [...this.players.values()];
  }

  team(team: Team): Player[] {
    return this.all().filter((p) => p.team === team);
  }

  count(): number {
    return this.players.size;
  }

  // ─── Надсилання ─────────────────────────────────────────────────────

  send(id: PlayerId, msg: ScreenMessage): void {
    this.transport.send(id, msg);
  }

  sendToTeam(team: Team, msg: ScreenMessage): void {
    for (const p of this.team(team)) this.transport.send(p.id, msg);
  }

  broadcast(msg: ScreenMessage): void {
    this.transport.broadcast(msg);
  }
}
