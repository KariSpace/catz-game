import Phaser from 'phaser';
import { ROUND, STRUCTURE_INFO, STRUCTURES, VIEW } from '../../shared/config';
import type { ControllerMessage, StructureId, Team } from '../../shared/protocol';
import type { Player } from '../net/PlayerHub';
import { hub } from '../net/hub';

interface TeamVote {
  options: StructureId[];
  /** playerId → structureId: один гравець — один голос */
  votes: Map<string, StructureId>;
  counters: Partial<Record<StructureId, Phaser.GameObjects.Text>>;
}

export class VoteScene extends Phaser.Scene {
  private teams!: Record<Team, TeamVote>;
  private timerText!: Phaser.GameObjects.Text;
  private timeLeft = ROUND.VOTE_SECONDS;
  private finalized = false;

  constructor() {
    super('VoteScene');
  }

  create(): void {
    this.timeLeft = ROUND.VOTE_SECONDS;
    this.finalized = false;
    this.teams = {
      cats: { options: this.pickRandom3(), votes: new Map(), counters: {} },
      dogs: { options: this.pickRandom3(), votes: new Map(), counters: {} },
    };

    this.drawBg();
    this.drawOptions();
    this.startTimer();

    const onMessage = (p: Player, msg: ControllerMessage) => this.onMessage(p, msg);
    hub.on('message', onMessage);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => hub.off('message', onMessage));

    for (const team of ['cats', 'dogs'] as const) {
      hub.sendToTeam(team, {
        type: 'structure_vote',
        options: this.teams[team].options,
        seconds: ROUND.VOTE_SECONDS,
      });
    }
  }

  private pickRandom3(): StructureId[] {
    return Phaser.Utils.Array.Shuffle([...STRUCTURES]).slice(0, 3);
  }

  private drawBg(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0d0a1e);
    g.fillRect(0, 0, VIEW.W, VIEW.H);
    g.fillStyle(0xffffff, 0.3);
    for (let i = 0; i < 60; i++) {
      g.fillRect(Phaser.Math.Between(0, VIEW.W), Phaser.Math.Between(0, VIEW.H * 0.7), 2, 2);
    }
  }

  private drawOptions(): void {
    this.add
      .text(VIEW.W / 2, 40, 'Оберіть базу!', { fontSize: '36px', fontFamily: 'Arial Black', color: '#fbbf24' })
      .setOrigin(0.5);
    this.add
      .text(VIEW.W / 2, VIEW.H / 2, 'VS', { fontSize: '48px', fontFamily: 'Arial Black', color: '#6b7280' })
      .setOrigin(0.5);

    this.timerText = this.add
      .text(VIEW.W / 2, VIEW.H - 50, `${this.timeLeft}`, {
        fontSize: '32px', fontFamily: 'Arial Black', color: '#fbbf24',
      })
      .setOrigin(0.5);

    const sides: { team: Team; cx: number; color: string; hex: number }[] = [
      { team: 'cats', cx: VIEW.W / 4, color: '#f97316', hex: 0xf97316 },
      { team: 'dogs', cx: (VIEW.W * 3) / 4, color: '#3b82f6', hex: 0x3b82f6 },
    ];

    for (const { team, cx, color, hex } of sides) {
      const label = team === 'cats' ? '🐱 Cats — голосують' : '🐶 Dogs — голосують';
      this.add.text(cx, 100, label, { fontSize: '18px', fontFamily: 'Arial', color }).setOrigin(0.5);

      this.teams[team].options.forEach((key, i) => {
        const y = 180 + i * 130;
        this.add.rectangle(cx, y, 240, 110, 0x1f2937).setStrokeStyle(2, hex);
        this.add
          .text(cx, y - 20, STRUCTURE_INFO[key].title, {
            fontSize: '18px', fontFamily: 'Arial Black', color: '#ffffff',
          })
          .setOrigin(0.5);
        this.add
          .text(cx, y + 10, STRUCTURE_INFO[key].desc, {
            fontSize: '12px', fontFamily: 'Arial', color: '#94a3b8', align: 'center',
          })
          .setOrigin(0.5);
        this.teams[team].counters[key] = this.add
          .text(cx, y + 38, '0 голосів', { fontSize: '14px', fontFamily: 'Arial', color })
          .setOrigin(0.5);
      });
    }
  }

  private startTimer(): void {
    this.time.addEvent({
      delay: 1000,
      repeat: ROUND.VOTE_SECONDS - 1,
      callback: () => {
        this.timeLeft--;
        this.timerText.setText(`${Math.max(0, this.timeLeft)}`);
        if (this.timeLeft <= 5) this.timerText.setColor('#ef4444');
        if (this.timeLeft <= 0) this.finalize();
      },
    });
  }

  private onMessage(player: Player, msg: ControllerMessage): void {
    if (msg.type !== 'structure_vote' || !player.team) return;

    const tv = this.teams[player.team];
    if (!tv.options.includes(msg.structureId)) return;

    tv.votes.set(player.id, msg.structureId); // повторний голос замінює попередній
    this.refreshCounters(player.team);
    this.checkAllVoted();
  }

  private refreshCounters(team: Team): void {
    const tv = this.teams[team];
    for (const key of tv.options) {
      const n = [...tv.votes.values()].filter((v) => v === key).length;
      tv.counters[key]?.setText(`${n} ${n === 1 ? 'голос' : 'голосів'}`);
    }
  }

  private checkAllVoted(): void {
    const allCats = hub.team('cats').every((p) => this.teams.cats.votes.has(p.id));
    const allDogs = hub.team('dogs').every((p) => this.teams.dogs.votes.has(p.id));
    if (allCats && allDogs && hub.count() > 0) this.finalize();
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;

    const catWinner = this.pickWinner(this.teams.cats);
    const dogWinner = this.pickWinner(this.teams.dogs);

    hub.broadcast({ type: 'vote_result', cats: catWinner, dogs: dogWinner });
    this.scene.start('GameScene', { catStructure: catWinner, dogStructure: dogWinner });
  }

  /** Найбільше голосів перемагає; нічия (включно з 0 голосів) — рандом серед лідерів */
  private pickWinner(tv: TeamVote): StructureId {
    const counts = new Map<StructureId, number>();
    for (const v of tv.votes.values()) counts.set(v, (counts.get(v) ?? 0) + 1);

    const max = Math.max(0, ...counts.values());
    const leaders = max === 0 ? tv.options : tv.options.filter((o) => (counts.get(o) ?? 0) === max);
    return leaders[Phaser.Math.Between(0, leaders.length - 1)];
  }
}
