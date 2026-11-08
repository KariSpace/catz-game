import Phaser from 'phaser';
import { PHYSICS, TEAM_ROSTER, TEAMS, VIEW, WEAPONS } from '../../shared/config';
import type { ControllerMessage, StructureId, Team, WeaponKey } from '../../shared/protocol';
import { Building } from '../entities/Building';
import { CharacterUnit } from '../entities/CharacterUnit';
import { Ground } from '../entities/Ground';
import { ProjectileEntity } from '../entities/ProjectileEntity';
import { sampleArc, velocityFromAim } from '../physics/ballistics';
import { PhysicsWorld, type BodyRef } from '../physics/PhysicsWorld';
import { CombatSystem } from '../systems/CombatSystem';
import { FishingSystem } from '../systems/FishingSystem';
import { InputRouter } from '../systems/InputRouter';
import { TurnSystem } from '../systems/TurnSystem';
import { TurnStateMachine } from '../systems/TurnStateMachine';
import { opposite, resolveWinner, type MatchResult } from '../systems/matchResult';
import { HUD } from '../ui/HUD';
import { banner, damageNumber, explosionFx } from '../ui/fx';
import type { Player } from '../net/PlayerHub';
import { hub } from '../net/hub';

const CAT_BASE_X = VIEW.W * 0.18;
const DOG_BASE_X = VIEW.W * 0.82;

export class GameScene extends Phaser.Scene {
  private physics_!: PhysicsWorld;
  private ground!: Ground;
  private buildings!: Building[];
  private chars!: CharacterUnit[];
  private turns!: TurnSystem;
  private machine!: TurnStateMachine;
  private combat!: CombatSystem;
  private fishing!: FishingSystem;
  private hud!: HUD;

  private wind = 0;
  /** Для політики взаємознищення: чий був останній постріл і чи був він прямим */
  private lastShooterTeam: Team | null = null;
  private lastShotDirectHit = false;
  private projectiles: ProjectileEntity[] = [];
  private trajGfx!: Phaser.GameObjects.Graphics;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;

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
    this.machine = new TurnStateMachine({
      now: () => this.time.now,
      isPhysicsSettled: () => this.physics_.isSettled(),
      hasProjectilesInFlight: () => this.projectiles.some((p) => !p.finished && !this.fishing.isFloat(p)),
      onSettled: () => this.finishTurnResolve(),
      onTurnTimeout: () => {
        banner(this, '⏰ Час вийшов!', '#ef4444');
        this.clearAim();
      },
      onTimerTick: (left) => this.hud.setTimer(left),
    });
    this.combat = new CombatSystem({
      applyExplosion: (x, y, r, speed, skip) => this.physics_.applyExplosion(x, y, r, speed, skip),
      blocks: () => this.buildings.flatMap((b) => b.aliveBlocks()),
      teamBlocks: (team) => this.buildings[team === 'cats' ? 0 : 1].blocks,
      chars: () => this.chars,
      spawnFragment: (x, y, velX, velY, key, shooter) => {
        this.projectiles.push(
          new ProjectileEntity(this, this.physics_, x, y, velX, velY, key, this.wind, shooter, { isFragment: true }),
        );
      },
      fx: {
        explosion: (x, y, r) => explosionFx(this, x, y, r),
        damageNumber: (x, y, amount) => damageNumber(this, x, y, amount),
      },
      onHpChanged: () => this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs')),
    });
    this.fishing = new FishingSystem(this, this.machine, {
      explode: (x, y, key) => this.combat.explode(x, y, key),
      notifyPhase2: () => {
        if (this.turns.current) hub.sendToTeam(this.turns.current.team, { type: 'fish_phase2' });
      },
    });
    const router = new InputRouter(this.machine, () => this.turns.current, {
      aim: (angle, power) => {
        const c = this.turns.current;
        if (!c) return;
        c.setAim(angle, power);
        this.drawTrajectory(c);
      },
      fire: (angle, power) => this.fire(angle, power),
      selectWeapon: (key) => this.selectWeapon(key),
      tap: () => this.fishing.resolve(),
    });
    this.trajGfx = this.add.graphics().setDepth(5);

    this.hud.updateTeamHp(cats, dogs);

    router.attachKeyboard(this.input.keyboard);
    const detachPhone = router.attachPhone(hub);

    // Дисконект гравця = команда без телефона → пауза до повернення
    const onLeave = (player: Player) => {
      if (hub.isSolo() || !player.team) return;
      if (hub.team(player.team).length === 0) {
        this.pauseGame(`${TEAMS[player.team].label} Гравець команди ${TEAMS[player.team].name} відключився`);
      }
    };
    const onRejoin = (_player: Player, msg: ControllerMessage) => {
      if (msg.type === 'team_select') this.tryResume();
    };
    hub.on('leave', onLeave);
    hub.on('message', onRejoin);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      detachPhone();
      hub.off('leave', onLeave);
      hub.off('message', onRejoin);
      this.physics_.destroy();
    });

    hub.broadcast({ type: 'end_turn' });

    // Даємо будівлям досісти після спавну, потім перший хід
    this.machine.enterSettling();

    // Гравець міг відпасти ще в голосуванні (таймер фіналізує і без нього) —
    // бій без обох команд не починаємо
    if (!hub.isSolo() && !hub.lobbyState().ready) {
      this.pauseGame('Команда лишилась без гравця');
    }
  }

  // ─── Хід ─────────────────────────────────────────────────────────────

  private startTurn(): void {
    const current = this.turns.next();
    if (!current) {
      // Усі мертві — взаємознищення вирішує політика «все або нічого»
      const result = resolveWinner(true, true, this.lastShooterTeam, this.lastShotDirectHit);
      if (result) this.endMatch(result);
      return;
    }

    this.combat.impactDamageEnabled = true;
    this.machine.startAiming();
    this.wind = Phaser.Math.Between(-PHYSICS.WIND_MAX_PX, PHYSICS.WIND_MAX_PX);

    // Спешл вистріляно до нуля — інакше кнопка «ВОГОНЬ» мовчки не працює
    if ((current.ammo[current.selectedWeapon] ?? 0) <= 0) {
      current.selectedWeapon = current.baseWeapon;
    }

    // Стрілець «невидимий» для снарядів на час прицілювання (виліт з дула);
    // скидається в clearAim — після пострілу снаряд може влучити і в нього
    this.physics_.setShooter(current.ref, true);

    // База стрільця стає примарною — політика в CombatSystem
    this.combat.setActiveTeam(current.team);

    this.hud.setWind(this.wind);
    this.hud.setTurn(current);
    this.hud.setWeapon(current.selectedWeapon, current.ammo[current.selectedWeapon] ?? 0);
    this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs'));
    banner(this, `${TEAMS[current.team].label} ${current.name}`, '#fbbf24');

    hub.broadcast({ type: 'end_turn' });
    this.sendYourTurn(current);
  }

  private sendYourTurn(current: CharacterUnit): void {
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

  // ─── Пауза (гравець відключився) ─────────────────────────────────────

  private pauseGame(reason: string): void {
    if (this.machine.paused || this.machine.phase === 'ended') return;
    this.machine.pause();
    hub.broadcast({ type: 'pause', reason });

    const bg = this.add.rectangle(VIEW.W / 2, VIEW.H / 2, VIEW.W, VIEW.H, 0x000000, 0.55);
    const title = this.add
      .text(VIEW.W / 2, VIEW.H / 2 - 30, '⏸ ПАУЗА', { fontSize: '52px', fontFamily: 'Arial Black', color: '#fbbf24' })
      .setOrigin(0.5);
    const sub = this.add
      .text(VIEW.W / 2, VIEW.H / 2 + 30, `${reason}\nЧекаємо на повернення…`, {
        fontSize: '20px', fontFamily: 'Arial', color: '#ffffff', align: 'center', lineSpacing: 6,
      })
      .setOrigin(0.5);
    this.pauseOverlay = this.add.container(0, 0, [bg, title, sub]).setDepth(20);
  }

  private tryResume(): void {
    if (!this.machine.paused || !hub.lobbyState().ready) return;
    this.machine.resume();
    this.pauseOverlay?.destroy();
    this.pauseOverlay = null;
    hub.broadcast({ type: 'resume' });

    // Гравець повернувся з новим підключенням — повторюємо стан його ходу
    const current = this.turns.current;
    if (current && this.machine.phase === 'aiming') this.sendYourTurn(current);
    else if (this.machine.phase === 'fishing' && current) hub.sendToTeam(current.team, { type: 'fish_phase2' });
  }

  update(_time: number, delta: number): void {
    if (this.machine.paused) return; // світ заморожений до повернення гравця

    this.physics_.step(delta, {
      onProjectileContact: (proj, other) => this.onProjectileContact(proj, other),
      onImpact: (ref, dv) => this.combat.impact(ref, dv),
    });

    for (const b of this.buildings) b.sync();
    for (const c of this.chars) c.sync();
    for (const p of this.projectiles) p.sync();
    this.projectiles = this.projectiles.filter((p) => !p.finished || this.fishing.isFloat(p));

    this.machine.update();
    if (this.machine.phase === 'fishing') this.fishing.update(delta);
  }

  private finishTurnResolve(): void {
    this.hud.updateTeamHp(this.teamChars('cats'), this.teamChars('dogs'));

    const result = resolveWinner(
      this.turns.alive('cats').length === 0,
      this.turns.alive('dogs').length === 0,
      this.lastShooterTeam,
      this.lastShotDirectHit,
    );
    if (result) return this.endMatch(result);

    this.startTurn();
  }

  /** Кінець матчу за політикою matchResult (взаємознищення — «все або нічого») */
  private endMatch(result: MatchResult): void {
    if (this.machine.phase === 'ended') return;
    this.machine.end();

    const winner = result.winner;
    if (result.heroic) banner(this, '⚡ ВСЕ АБО НІЧОГО!', '#fbbf24');

    hub.sendToTeam(winner, { type: 'you_win' });
    hub.sendToTeam(opposite(winner), { type: 'you_lose' });
    this.time.delayedCall(result.heroic ? 1800 : 800, () => this.scene.start('VictoryScene', { winner }));
  }

  // ─── Команди вводу (маршрутизація і фільтри — в InputRouter) ─────────

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

    this.lastShooterTeam = current.team;
    this.lastShotDirectHit = false;

    current.setAim(angle, power);
    const origin = current.fireOrigin();
    this.projectiles.push(
      ProjectileEntity.fromAim(this, this.physics_, origin.x, origin.y, angle, power, key, this.wind, current),
    );

    this.clearAim();
    this.machine.startFlying();
    hub.broadcast({ type: 'end_turn' });
  }

  private clearAim(): void {
    this.trajGfx.clear();
    const current = this.turns.current;
    if (!current) return;
    current.setActive(false);
    if (!current.dead) this.physics_.setShooter(current.ref, false);
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
    if (proj.finished || this.fishing.isFloat(proj)) return;

    if (proj.weapon.behavior === 'fishing' && !proj.isFragment) {
      this.fishing.start(proj);
      return;
    }

    if (proj.weapon.behavior === 'cluster' && !proj.isFragment) {
      this.combat.splitCluster(proj);
      return;
    }

    // Снаряд вибухає безпосередньо на ворожому персонажі — «прямий постріл»
    // для політики взаємознищення (matchResult)
    if (otherRef?.tag.kind === 'character' && proj.shooter) {
      const target = otherRef.tag.owner as CharacterUnit;
      if (!target.dead && target.team !== proj.shooter.team) this.lastShotDirectHit = true;
    }

    this.combat.explode(proj.x, proj.y, proj.weaponKey);
    proj.destroy();
  }

  // ─── Дрібниці ────────────────────────────────────────────────────────

  private teamChars(team: Team): CharacterUnit[] {
    return this.chars.filter((c) => c.team === team);
  }
}
