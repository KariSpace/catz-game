import Phaser from 'phaser';
import { DAMAGE, PHYSICS, ROUND, TEAM_ROSTER, TEAMS, VIEW, WEAPONS } from '../../shared/config';
import type { ControllerMessage, StructureId, Team, WeaponKey } from '../../shared/protocol';
import { Building } from '../entities/Building';
import { CharacterUnit } from '../entities/CharacterUnit';
import { Ground } from '../entities/Ground';
import { ProjectileEntity } from '../entities/ProjectileEntity';
import { sampleArc, velocityFromAim } from '../physics/ballistics';
import { PhysicsWorld, type BodyRef } from '../physics/PhysicsWorld';
import { TurnSystem } from '../systems/TurnSystem';
import { FishMinigame } from '../ui/FishMinigame';
import { HUD } from '../ui/HUD';
import { banner, damageNumber, explosionFx } from '../ui/fx';
import type { Player } from '../net/PlayerHub';
import { hub } from '../net/hub';
import { Block } from '../entities/Block';

type TurnState = 'settling' | 'aiming' | 'flying' | 'fish2' | 'ended';

const CAT_BASE_X = VIEW.W * 0.18;
const DOG_BASE_X = VIEW.W * 0.82;

export class GameScene extends Phaser.Scene {
  private physics_!: PhysicsWorld;
  private ground!: Ground;
  private buildings!: Building[];
  private chars!: CharacterUnit[];
  private turns!: TurnSystem;
  private hud!: HUD;

  private state: TurnState = 'settling';
  private wind = 0;
  private turnDeadline = 0;
  private settleStart = 0;
  /** Шкода від ударів вмикається з першого ходу — початкове осідання безболісне */
  private matchStarted = false;
  private projectiles: ProjectileEntity[] = [];
  private fish: FishMinigame | null = null;
  private floatProj: ProjectileEntity | null = null;
  private trajGfx!: Phaser.GameObjects.Graphics;

  private catStructure: StructureId = 'tower';
  private dogStructure: StructureId = 'bunker';

  constructor() {
    super('GameScene');
  }

  init(data: { catStructure?: StructureId; dogStructure?: StructureId }): void {
    this.catStructure = data.catStructure ?? 'tower';
    this.dogStructure = data.dogStructure ?? 'bunker';
  }

  create(): void {
    // WASM Rapier уже ініціалізовано в main.ts до старту Phaser
    this.physics_ = new PhysicsWorld();
    this.projectiles = [];
    this.fish = null;
    this.floatProj = null;

    this.ground = new Ground(this, this.physics_, [CAT_BASE_X, DOG_BASE_X]);

    const catBuilding = new Building(this, this.physics_, this.catStructure, CAT_BASE_X, this.ground.getYAt(CAT_BASE_X));
    const dogBuilding = new Building(this, this.physics_, this.dogStructure, DOG_BASE_X, this.ground.getYAt(DOG_BASE_X));
    this.buildings = [catBuilding, dogBuilding];

    const spawnTeam = (team: Team, building: Building) =>
      TEAM_ROSTER[team].map((key, i) => {
        const p = building.spawnPoints[i % building.spawnPoints.length];
        return new CharacterUnit(this, this.physics_, key, p.x, p.y - 2);
      });
    const cats = spawnTeam('cats', catBuilding);
    const dogs = spawnTeam('dogs', dogBuilding);
    this.chars = [...cats, ...dogs];

    this.turns = new TurnSystem(cats, dogs);
    this.hud = new HUD(this);
    this.trajGfx = this.add.graphics().setDepth(5);

    this.hud.updateTeamHp(cats, dogs);

    const onMessage = (p: Player, msg: ControllerMessage) => this.onPhoneMessage(p, msg);
    hub.on('message', onMessage);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      hub.off('message', onMessage);
      this.physics_.destroy();
    });

    this.bindKeyboard();
    hub.broadcast({ type: 'end_turn' });

    // Даємо будівлям досісти після спавну, потім перший хід
    this.enterSettling();
  }

  // ─── Стейт-машина ходу ───────────────────────────────────────────────

  private enterSettling(): void {
    this.state = 'settling';
    this.settleStart = this.time.now;
  }

  private startTurn(): void {
    const current = this.turns.next();
    if (!current) return this.endMatch();

    this.matchStarted = true;
    this.state = 'aiming';
    this.wind = Phaser.Math.Between(-PHYSICS.WIND_MAX_PX, PHYSICS.WIND_MAX_PX);
    this.turnDeadline = this.time.now + ROUND.TURN_SECONDS * 1000;

    // База стрільця — «примарна»: прозора, снаряд пролітає крізь неї
    const [catB, dogB] = this.buildings;
    catB.setGhost(current.team === 'cats');
    dogB.setGhost(current.team === 'dogs');

    this.hud.setWind(this.wind);
    this.hud.setTurn(current);
    this.hud.setWeapon(current.selectedWeapon, current.ammo[current.selectedWeapon] ?? 0);
    this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs'));
    banner(this, `${TEAMS[current.team].label} ${current.name}`, '#fbbf24');

    hub.broadcast({ type: 'end_turn' });
    const toAmmo = (a: number | undefined) => (a === Infinity ? -1 : a ?? 0);
    hub.sendToTeam(current.team, {
      type: 'your_turn',
      characterName: current.name,
      active: current.selectedWeapon,
      angle: Math.round(current.aimAngle),
      power: Math.round(current.aimPower),
      weapons: [
        { key: current.baseWeapon, name: WEAPONS[current.baseWeapon].name, ammo: toAmmo(current.ammo[current.baseWeapon]) },
        { key: current.special, name: WEAPONS[current.special].name, ammo: toAmmo(current.ammo[current.special]) },
      ],
    });
  }

  update(_time: number, delta: number): void {
    this.physics_.step(delta, {
      onProjectileContact: (proj, other) => this.onProjectileContact(proj, other),
      onImpact: (ref, dv) => this.onImpact(ref, dv),
    });

    for (const b of this.buildings) b.sync();
    for (const c of this.chars) c.sync();
    for (const p of this.projectiles) p.sync();
    this.projectiles = this.projectiles.filter((p) => !p.finished || p === this.floatProj);

    switch (this.state) {
      case 'aiming': {
        const left = Math.ceil((this.turnDeadline - this.time.now) / 1000);
        this.hud.setTimer(left);
        if (left <= 0) {
          banner(this, '⏰ Час вийшов!', '#ef4444');
          this.clearAim();
          this.enterSettling();
        }
        break;
      }
      case 'flying': {
        const inFlight = this.projectiles.some((p) => !p.finished && p !== this.floatProj);
        if (!inFlight) this.enterSettling();
        break;
      }
      case 'fish2': {
        this.fish?.update(delta);
        if (this.fish?.isTimedOut()) this.resolveFish();
        break;
      }
      case 'settling': {
        const elapsed = this.time.now - this.settleStart;
        if (elapsed > 1200 && (this.physics_.isSettled() || elapsed > PHYSICS.SETTLE_TIMEOUT_MS)) {
          this.finishTurnResolve();
        }
        break;
      }
      case 'ended':
        break;
    }
  }

  private finishTurnResolve(): void {
    this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs'));

    const defeated = this.turns.defeatedTeam();
    if (defeated) return this.endMatch(defeated);

    this.startTurn();
  }

  /** Кінець матчу. Якщо мертві обидві команди, перемагають dogs (cats перевіряються першими) */
  private endMatch(defeated?: Team | null): void {
    if (this.state === 'ended') return;
    this.state = 'ended';

    const loser: Team = defeated ?? this.turns.defeatedTeam() ?? 'cats';
    const winner: Team = loser === 'cats' ? 'dogs' : 'cats';

    hub.sendToTeam(winner, { type: 'you_win' });
    hub.sendToTeam(loser, { type: 'you_lose' });
    this.time.delayedCall(800, () => this.scene.start('VictoryScene', { winner }));
  }

  // ─── Ввід ────────────────────────────────────────────────────────────

  private onPhoneMessage(player: Player, msg: ControllerMessage): void {
    const current = this.turns.current;
    if (!current || player.team !== current.team) return;

    switch (msg.type) {
      case 'aim':
        if (this.state === 'aiming') {
          current.setAim(msg.angle, msg.power);
          this.drawTrajectory(current);
        }
        break;
      case 'fire':
        if (this.state === 'aiming') this.fire(msg.angle, msg.power);
        break;
      case 'weapon':
        if (this.state === 'aiming') this.selectWeapon(msg.weaponKey);
        break;
      case 'tap':
        if (this.state === 'fish2') this.resolveFish();
        break;
      default:
        break;
    }
  }

  private bindKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const cur = () => this.turns.current;

    kb.on('keydown-A', () => { const c = cur(); if (c && this.state === 'aiming') { c.setAim(c.aimAngle + 4, c.aimPower); this.drawTrajectory(c); } });
    kb.on('keydown-D', () => { const c = cur(); if (c && this.state === 'aiming') { c.setAim(c.aimAngle - 4, c.aimPower); this.drawTrajectory(c); } });
    kb.on('keydown-W', () => { const c = cur(); if (c && this.state === 'aiming') { c.setAim(c.aimAngle, Math.min(100, c.aimPower + 5)); this.drawTrajectory(c); } });
    kb.on('keydown-S', () => { const c = cur(); if (c && this.state === 'aiming') { c.setAim(c.aimAngle, Math.max(10, c.aimPower - 5)); this.drawTrajectory(c); } });
    kb.on('keydown-ONE', () => { const c = cur(); if (c && this.state === 'aiming') this.selectWeapon(c.baseWeapon); });
    kb.on('keydown-TWO', () => { const c = cur(); if (c && this.state === 'aiming') this.selectWeapon(c.special); });
    kb.on('keydown-SPACE', () => {
      const c = cur();
      if (this.state === 'aiming' && c) this.fire(c.aimAngle, c.aimPower);
      else if (this.state === 'fish2') this.resolveFish();
    });
  }

  private selectWeapon(key: WeaponKey | undefined): void {
    const current = this.turns.current;
    if (!key || !current || (current.ammo[key] ?? 0) <= 0) return;
    current.selectedWeapon = key;
    this.hud.setWeapon(key, current.ammo[key] ?? 0);
  }

  // ─── Постріл і траєкторія ────────────────────────────────────────────

  private fire(angle: number, power: number): void {
    const current = this.turns.current;
    if (!current) return;
    const key = current.selectedWeapon;
    if ((current.ammo[key] ?? 0) <= 0) return;
    if (current.ammo[key] !== Infinity) current.ammo[key] = (current.ammo[key] ?? 1) - 1;

    current.setAim(angle, power);
    const origin = current.fireOrigin();
    this.projectiles.push(
      ProjectileEntity.fromAim(this, this.physics_, origin.x, origin.y, angle, power, key, this.wind, current),
    );

    this.clearAim();
    this.state = 'flying';
    hub.broadcast({ type: 'end_turn' });
  }

  private clearAim(): void {
    this.trajGfx.clear();
    this.turns.current?.setActive(false);
  }

  /** Пунктирне прев'ю дуги: балістика СПІЛЬНА з реальним польотом (ballistics.ts) */
  private drawTrajectory(char: CharacterUnit): void {
    const vel = velocityFromAim(char.aimAngle, char.aimPower, char.selectedWeapon);
    const pts = sampleArc(char.fireOrigin(), vel, this.wind);

    this.trajGfx.clear();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.y > VIEW.H || p.x < 0 || p.x > VIEW.W) break;
      this.trajGfx.fillStyle(0xfbbf24, Math.max(0.1, 0.5 - (i + 1) * 0.025));
      this.trajGfx.fillCircle(p.x, p.y, 3);
    }
  }

  // ─── Фізичні події ───────────────────────────────────────────────────

  private onProjectileContact(projRef: BodyRef, otherRef: BodyRef | null): void {
    const proj = projRef.tag.owner as ProjectileEntity;
    if (proj.finished || proj === this.floatProj) return;
    if (proj.ignoresContactWith(otherRef?.tag.owner, this.time.now)) return;

    if (proj.weapon.behavior === 'fishing' && !proj.isFragment) {
      this.enterFishPhase(proj);
      return;
    }

    if (proj.weapon.behavior === 'cluster' && !proj.isFragment) {
      this.splitCluster(proj);
      return;
    }

    this.explode(proj.x, proj.y, proj.weaponKey);
    proj.destroy();
  }

  /** Furball за GDD не вибухає сам — розбивається на 3 осколки при ударі */
  private splitCluster(proj: ProjectileEntity): void {
    const { x, y } = proj;
    proj.destroy();
    for (const angle of [65, 90, 115]) {
      const rad = Phaser.Math.DegToRad(angle);
      const speed = 260;
      this.projectiles.push(
        new ProjectileEntity(
          this, this.physics_,
          x, y - 6,
          Math.cos(rad) * speed, -Math.sin(rad) * speed,
          proj.weaponKey, this.wind, proj.shooter,
          { isFragment: true },
        ),
      );
    }
  }

  private explode(x: number, y: number, weaponKey: WeaponKey): void {
    const def = WEAPONS[weaponKey];
    explosionFx(this, x, y, def.blastRadiusPx);
    // Примарну базу стрільця вибух не чіпає — ані імпульсом, ані шкодою
    this.physics_.applyExplosion(
      x, y, def.blastRadiusPx, def.blastSpeed,
      (ref) => ref.tag.kind === 'block' && (ref.tag.owner as Block).ghosted,
    );

    const reach = def.blastRadiusPx * 1.2;

    for (const building of this.buildings) {
      for (const block of building.aliveBlocks()) {
        if (block.ghosted) continue;
        const dmg = this.falloffDamage(def.damage, Math.hypot(block.x - x, block.y - y), reach);
        block.takeDamage(dmg);
      }
    }

    for (const char of this.chars) {
      if (char.dead) continue;
      const dmg = this.falloffDamage(def.damage, Math.hypot(char.x - x, char.y - y) - 18, reach);
      if (dmg > 0) {
        damageNumber(this, char.x, char.y - 30, dmg);
        char.takeDamage(dmg);
      }
    }

    this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs'));
  }

  private falloffDamage(base: number, dist: number, reach: number): number {
    if (dist >= reach) return 0;
    return Math.round(base * (1 - Math.max(0, dist) / reach));
  }

  /** Удари (падіння, приліт блока): однакова формула для блоків і персонажів */
  private onImpact(ref: BodyRef, dv: number): void {
    if (!this.matchStarted) return;
    const over = dv - DAMAGE.IMPACT_MIN_DV;
    if (over <= 0) return;

    if (ref.tag.kind === 'character') {
      const char = ref.tag.owner as CharacterUnit;
      if (char.dead) return;
      const dmg = Math.min(DAMAGE.IMPACT_MAX, Math.round(over * DAMAGE.IMPACT_DMG_PER_DV));
      if (dmg > 0) {
        damageNumber(this, char.x, char.y - 30, dmg);
        char.takeDamage(dmg);
        this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs'));
      }
    } else if (ref.tag.kind === 'block') {
      const block = ref.tag.owner as Block;
      const dmg = Math.min(DAMAGE.IMPACT_MAX, Math.round(over * DAMAGE.IMPACT_DMG_PER_DV * DAMAGE.BLOCK_IMPACT_SCALE));
      block.takeDamage(dmg);
    }
  }

  // ─── Фішинг-бомба, фаза 2 ────────────────────────────────────────────

  private enterFishPhase(proj: ProjectileEntity): void {
    proj.freezeAsFloat();
    this.floatProj = proj;
    this.fish = new FishMinigame(this, proj.x, proj.y);
    this.state = 'fish2';
    if (this.turns.current) hub.sendToTeam(this.turns.current.team, { type: 'fish_phase2' });
  }

  private resolveFish(): void {
    if (!this.fish || this.state !== 'fish2') return;
    const x = this.fish.resolveX();
    const y = this.fish.floatY;

    this.fish.destroy();
    this.fish = null;
    this.floatProj?.destroy();
    this.floatProj = null;

    // Рибка вистрибує і вибухає
    const fishGfx = this.add.circle(x, y, 10, 0x60a5fa).setDepth(7);
    this.tweens.add({
      targets: fishGfx,
      y: y - 50,
      duration: 300,
      ease: 'Back.Out',
      onComplete: () => {
        fishGfx.destroy();
        this.explode(x, y - 50, 'fishingBomb');
        this.enterSettling();
      },
    });
    this.state = 'settling'; // фактичний перехід після вибуху, але ввід уже блокуємо
    this.settleStart = this.time.now + 400;
  }

  // ─── Дрібниці ────────────────────────────────────────────────────────

  private teamChars(team: Team): CharacterUnit[] {
    return this.chars.filter((c) => c.team === team);
  }
}
