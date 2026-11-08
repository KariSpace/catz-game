import Phaser from 'phaser';
import { STRUCTURES, VIEW } from '../../shared/config';
import type { ControllerMessage } from '../../shared/protocol';
import type { Player } from '../net/PlayerHub';
import { hub } from '../net/hub';

export class MenuScene extends Phaser.Scene {
  private playerList!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Container;
  private blinking = false;

  constructor() {
    super('MenuScene');
  }

  create(): void {
    this.drawBg();
    this.drawTitle();

    this.playerList = this.add
      .text(VIEW.W / 2, 380, '', { fontSize: '18px', fontFamily: 'Arial', color: '#ffffff', align: 'center' })
      .setOrigin(0.5);
    this.hint = this.add
      .text(VIEW.W / 2, VIEW.H - 50, '', { fontSize: '18px', fontFamily: 'Arial', color: '#4ade80' })
      .setOrigin(0.5);
    this.add
      .text(VIEW.W / 2, 280, 'Підключіть телефони для гри', {
        fontSize: '16px', fontFamily: 'Arial', color: '#94a3b8',
      })
      .setOrigin(0.5);
    this.buildStartButton();

    const onJoin = () => this.refresh();
    const onLeave = () => this.refresh();
    const onMessage = (_p: Player, msg: ControllerMessage) => {
      if (msg.type === 'team_select') this.refresh();
      if (msg.type === 'start') this.tryStart();
    };

    hub.on('join', onJoin);
    hub.on('leave', onLeave);
    hub.on('message', onMessage);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      hub.off('join', onJoin);
      hub.off('leave', onLeave);
      hub.off('message', onMessage);
    });

    this.input.keyboard?.on('keydown-SPACE', () => this.tryStart());
    this.input.keyboard?.on('keydown-ENTER', () => this.tryStart());

    this.refresh();
  }

  private buildStartButton(): void {
    const bg = this.add
      .rectangle(0, 0, 300, 68, 0x16a34a)
      .setStrokeStyle(3, 0x4ade80)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(0, 0, '▶  ПОЧАТИ ГРУ', { fontSize: '26px', fontFamily: 'Arial Black', color: '#ffffff' })
      .setOrigin(0.5);
    this.startBtn = this.add.container(VIEW.W / 2, 520, [bg, label]).setVisible(false);

    bg.on('pointerover', () => bg.setFillStyle(0x15803d));
    bg.on('pointerout', () => bg.setFillStyle(0x16a34a));
    bg.on('pointerdown', () => this.tryStart());
  }

  private drawBg(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0d0a1e);
    g.fillRect(0, 0, VIEW.W, VIEW.H);
    g.fillStyle(0xffffff, 0.4);
    for (let i = 0; i < 80; i++) {
      g.fillRect(Phaser.Math.Between(0, VIEW.W), Phaser.Math.Between(0, VIEW.H * 0.75), 2, 2);
    }
    g.fillStyle(0xfef9c3);
    g.fillCircle(VIEW.W - 110, 65, 32);
    g.fillStyle(0x0d0a1e);
    g.fillCircle(VIEW.W - 97, 57, 26);
  }

  private drawTitle(): void {
    this.add
      .text(VIEW.W / 2, 120, 'CATZ vs DOGZ', {
        fontSize: '88px', fontFamily: 'Arial Black', color: '#f97316',
        stroke: '#7c2d12', strokeThickness: 8,
      })
      .setOrigin(0.5);
    this.add
      .text(VIEW.W / 2, 210, 'NEIGHBOURHOOD BRAWL', {
        fontSize: '22px', fontFamily: 'Arial', color: '#fbbf24', letterSpacing: 5,
      })
      .setOrigin(0.5);
  }

  private refresh(): void {
    // Одна правда для всіх: контролери отримують той самий знімок лобі
    const lobby = hub.lobbyState();
    hub.broadcast({ type: 'lobby', ...lobby });

    const slot = (emoji: string, label: string, names: string[]) =>
      `${emoji} ${label}: ${names.length ? `✅ ${names.join(', ')}` : '⬜ вільно'}`;
    const lines = [
      slot('🐱', 'Cats', lobby.teams.cats),
      slot('🐶', 'Dogs', lobby.teams.dogs),
    ];
    if (lobby.unassigned > 0) lines.push(`📱 Обирають команду: ${lobby.unassigned}`);
    if (hub.count() === 0 && !hub.isSolo()) lines.push('Телефони не підключені');
    this.playerList.setText(lines.join('\n'));

    this.startBtn.setVisible(lobby.ready);
    this.hint.setText(
      lobby.ready
        ? 'Або Start на телефоні / SPACE'
        : hub.count() === 0
          ? 'Відкрийте controller.html на телефоні'
          : 'Старт — коли в обох командах є гравець',
    );

    if (lobby.ready && !this.blinking) {
      this.blinking = true;
      this.tweens.add({ targets: this.hint, alpha: 0.25, duration: 650, yoyo: true, repeat: -1 });
    }
  }

  private tryStart(): void {
    if (hub.team('cats').length < 1 || hub.team('dogs').length < 1) return;

    if (hub.isSolo()) {
      // Соло-розробка: голосувати нікому — рандомні бази,
      // або явні через ?struct=tower,bunker
      const pick = () => STRUCTURES[Phaser.Math.Between(0, STRUCTURES.length - 1)];
      const forced = new URLSearchParams(location.search).get('struct')?.split(',') ?? [];
      const valid = (s: string | undefined) =>
        STRUCTURES.includes(s as (typeof STRUCTURES)[number]) ? (s as (typeof STRUCTURES)[number]) : undefined;
      this.scene.start('GameScene', {
        catStructure: valid(forced[0]) ?? pick(),
        dogStructure: valid(forced[1]) ?? pick(),
      });
      return;
    }

    this.scene.start('VoteScene');
  }
}
