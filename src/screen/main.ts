import Phaser from 'phaser';
import { VIEW } from '../shared/config';
import { initRapier } from './physics/PhysicsWorld';
import './net/hub'; // транспорт створюється одразу, щоб не пропустити onConnect
import { PreloadScene } from './scenes/PreloadScene';
import { MenuScene } from './scenes/MenuScene';
import { VoteScene } from './scenes/VoteScene';
import { GameScene } from './scenes/GameScene';
import { VictoryScene } from './scenes/VictoryScene';

async function boot(): Promise<void> {
  await initRapier();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: VIEW.W,
    height: VIEW.H,
    backgroundColor: '#0d0a1e',
    scene: [PreloadScene, MenuScene, VoteScene, GameScene, VictoryScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });

  // Дев-хук для дебага і автотестів
  (window as unknown as { __game: Phaser.Game }).__game = game;
}

void boot();
