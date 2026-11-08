import type Phaser from 'phaser';
import { BLUEPRINTS } from '../../shared/blueprints';
import type { StructureId } from '../../shared/protocol';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Block } from './Block';

/** Будівля = купа блоків, заспавнених із блупринта на землі */
export class Building {
  readonly blocks: Block[] = [];
  /** Світові точки, де стоятимуть персонажі (позиція ніг) */
  readonly spawnPoints: { x: number; y: number }[];

  constructor(
    scene: Phaser.Scene,
    physics: PhysicsWorld,
    type: StructureId,
    centerX: number,
    groundY: number,
  ) {
    const bp = BLUEPRINTS[type]();

    for (const spec of bp.blocks) {
      this.blocks.push(new Block(scene, physics, centerX + spec.x, groundY - spec.y, spec));
    }

    this.spawnPoints = bp.spawns.map((s) => ({ x: centerX + s.x, y: groundY - s.y }));
  }

  sync(): void {
    for (const b of this.blocks) b.sync();
  }

  aliveBlocks(): Block[] {
    return this.blocks.filter((b) => !b.destroyed);
  }
}
