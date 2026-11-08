import Phaser from 'phaser';
import { TEAMS, VIEW } from '../../shared/config';
import type { ControllerMessage, Team } from '../../shared/protocol';
import type { Player } from '../net/PlayerHub';
import { hub } from '../net/hub';
import { banner } from '../ui/fx';

export class VictoryScene extends Phaser.Scene {
  private winner: Team = 'cats';

  constructor() {
    super('VictoryScene');
  }

  init(data: { winner: Team }): void {
    this.winner = data.winner;
  }

  create(): void {
    const team = TEAMS[this.winner];
    this.drawBg(team.color);

    this.add.text(VIEW.W / 2, 160, team.label, { fontSize: '120px' }).setOrigin(0.5);
    this.add
      .text(VIEW.W / 2, 290, `${team.name} ПЕРЕМОГЛИ!`, {
        fontSize: '60px', fontFamily: 'Arial Black',
        color: `#${team.color.toString(16).padStart(6, '0')}`,
        stroke: '#ffffff', strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.add
      .text(VIEW.W / 2, 450, '🔁 Реванш — на телефоні або SPACE     🏠 Меню — ESC', {
        fontSize: '20px', fontFamily: 'Arial', color: '#e5e7eb',
      })
      .setOrigin(0.5);

    const onMessage = (_p: Player, msg: ControllerMessage) => {
      if (msg.type === 'rematch') this.rematch();
    };
    hub.on('message', onMessage);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => hub.off('message', onMessage));

    this.input.keyboard?.on('keydown-SPACE', () => this.rematch());
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
  }

  private rematch(): void {
    if (hub.isSolo()) {
      this.scene.start('MenuScene');
      return;
    }
    // Реванш лише з обома командами — інакше голосування/бій без гравця
    if (!hub.lobbyState().ready) {
      banner(this, 'Чекаємо гравців обох команд…', '#ef4444');
      return;
    }
    this.scene.start('VoteScene');
  }

  private drawBg(color: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x0d0a1e);
    g.fillRect(0, 0, VIEW.W, VIEW.H);
    for (let i = 0; i < 60; i++) {
      g.fillStyle(Phaser.Utils.Array.GetRandom([color, 0xfbbf24, 0xffffff]), 0.7);
      g.fillRect(Phaser.Math.Between(0, VIEW.W), Phaser.Math.Between(0, VIEW.H), 8, 8);
    }
  }
}
