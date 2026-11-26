const CONTROL_CODES = Object.freeze({
  thrust: 'KeyW', reverse: 'KeyS', rotateLeft: 'KeyA', rotateRight: 'KeyD',
  strafeLeft: 'KeyQ', strafeRight: 'KeyE', damp: 'KeyX', boost: 'ShiftLeft',
  gear: 'KeyV', scoop: 'KeyR', fire: 'Space', useTool: 'KeyF'
});
const TOOL_NAMES = new Set(['grinder', 'laser', 'cannon']);
const now = () => globalThis.performance?.now?.() ?? Date.now();

/** Structured, screenshot-free automation and telemetry facade for the live game. */
export class AgentInterface {
  constructor(game) {
    this.game = game;
    this.createdAt = now();
    this.controls = new Set();
    this.history = [];
    this.lastSample = 0;
    this.performance = { frameMs: 0, simulationMs: 0, physicsMs: 0, worldMs: 0, cameraUpdateMs: 0, renderMs: 0, fixedSteps: 0, droppedTimeMs: 0 };
    this.errors = [];
  }

  capabilities() {
    return {
      schema: 'lupixel.agent.capabilities.v1',
      controls: Object.keys(CONTROL_CODES),
      tools: [...TOOL_NAMES],
      actions: ['scan', 'start_eva', 'return_eva', 'stop_eva', 'eva_scan', 'eva_interact', 'toggle_orbit', 'dock', 'undock', 'trade', 'market_action', 'mine', 'spawn_enemy', 'set_enemy_state', 'damage_enemy', 'set_story_stage', 'set_parameter'],
      parameters: ['gravityScale', 'simulationRate', 'shipFuel', 'shipHull'],
      telemetry: ['player', 'eva', 'environment', 'mission', 'bodies', 'enemies', 'projectiles', 'camera', 'performance', 'history']
    };
  }

  setControls(controls = {}) {
    const input = this.game.input;
    const next = new Set();
    for (const [name, value] of Object.entries(controls)) {
      const code = CONTROL_CODES[name];
      if (!code) throw new Error(`Unknown control: ${name}`);
      if (value) next.add(code);
    }
    for (const code of this.controls) if (!next.has(code)) input.pressed.delete(code);
    for (const code of next) {
      if (!this.controls.has(code) && ['KeyV', 'KeyR'].includes(code)) input.justPressed.add(code);
      input.pressed.add(code);
    }
    this.controls = next;
    return { controls: [...next] };
  }

  releaseControls() { return this.setControls({}); }

  setAim(x, y, worldCoordinates = true) {
    const point = worldCoordinates
      ? this.game.renderer.worldToScreen(Number(x), Number(y))
      : { x: Number(x), y: Number(y) };
    const p = this.game.input.pointer;
    p.x = point.x; p.y = point.y; p.inside = true; p.movedAt = now();
    return { screen: { x: p.x, y: p.y }, world: worldCoordinates ? { x: Number(x), y: Number(y) } : this.game.renderer.screenToWorld(p.x, p.y) };
  }

  selectTool(tool) {
    if (!TOOL_NAMES.has(tool)) throw new Error(`Tool must be one of: ${[...TOOL_NAMES].join(', ')}`);
    this.game.ship.tool = tool;
    return { tool };
  }

  action(name, args = {}) {
    const g = this.game;
    switch (name) {
      case 'scan': return { discoveries: g.world.scan(g.ship.x, g.ship.y, args.range ?? 920).map((b) => b.id) };
      case 'start_eva': return { started: g.eva.start() };
      case 'return_eva': if (!g.eva.active) return { started: false }; g.eva.returning = true; return { started: true };
      case 'stop_eva': g.eva.stop(Boolean(args.emergency)); return { active: g.eva.active };
      case 'eva_scan': return { scanned: g.eva.scan() };
      case 'eva_interact': return { interacted: g.eva.interact() };
      case 'toggle_orbit': if (g.orbit.active) { g.orbit.cancel(); return { active: false }; } return { active: g.orbit.engage() };
      case 'dock': g.docking.update(0); return { phase: g.docking.phase, engaged: Boolean(g.docking.dock) };
      case 'trade': return { opened: g.trade.tryOpen() };
      case 'spawn_enemy': {
        if (!g.world.bodyById.has(args.bodyId)) throw new Error('Unknown bodyId');
        g.combat.spawnEnemyAt(args.bodyId, args.rank ?? 'scout', args.angle ?? null);
        return { enemyCount: g.combat.enemies.length };
      }
      case 'damage_enemy': {
        const enemy = g.combat.enemies.find((item) => item.id === args.id && !item.dead);
        if (!enemy) throw new Error('No living enemy with that id');
        g.combat.damageEnemy(enemy, Math.max(0, Number(args.amount) || 0), g.ship.x, g.ship.y);
        return { id: enemy.id, hp: Math.max(0, enemy.hp), dead: enemy.dead };
      }
      case 'set_story_stage': {
        const stage = Number(args.stage);
        if (!Number.isInteger(stage) || stage < 0 || stage >= g.objectiveTexts.length) throw new Error('Invalid story stage');
        g.mission.stage = stage; g.objectiveText = g.objectiveTexts[stage];
        return { stage, objective: g.objectiveText };
      }
      case 'mine': {
        const x = Number(args.x); const y = Number(args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('mine requires finite world x/y');
        const dx = x - g.ship.x; const dy = y - g.ship.y; const distance = Math.hypot(dx, dy);
        const range = Math.min(Number(args.range ?? 110), 220);
        if (distance > range) return { hit: false, reason: 'target out of range', distance };
        const dir = { x: dx / (distance || 1), y: dy / (distance || 1) };
        const hit = g.world.raycast(g.ship.x, g.ship.y, dir.x, dir.y, range);
        if (!hit) return { hit: false, reason: 'no solid material on ray' };
        const tool = args.tool ?? g.ship.tool;
        if (tool === 'grinder') g.world.grindHit(hit, 2.2, Number(args.power ?? 18));
        else if (tool === 'laser') g.world.heatHit(hit, 2.6, Number(args.heat ?? 28), Number(args.damage ?? 5));
        else if (tool === 'cannon') return { hit: Boolean(g.combat.fireCannon(dir)), weapon: 'cannon' };
        else throw new Error('Unknown mining tool');
        return { hit: true, bodyId: hit.body.id, materialId: hit.material, x: hit.x, y: hit.y, tool };
      }
      case 'set_enemy_state': {
        const enemy = g.combat.enemies.find((item) => item.id === args.id && !item.dead);
        if (!enemy) throw new Error('No living enemy with that id');
        if (args.alerted !== undefined) enemy.alerted = Boolean(args.alerted);
        if (args.homeId !== undefined) {
          if (!g.world.bodyById.has(args.homeId)) throw new Error('Unknown homeId');
          enemy.homeId = args.homeId;
        }
        if (args.health !== undefined) enemy.hp = Math.max(1, Math.min(enemy.maxHp, Number(args.health)));
        return { id: enemy.id, alerted: enemy.alerted, homeId: enemy.homeId, hp: enemy.hp };
      }
      case 'market_action': {
        if (!g.trade.open && !g.trade.tryOpen()) return { completed: false, reason: 'trade link unavailable' };
        const completed = g.trade.action(String(args.id));
        return { completed: Boolean(completed), market: g.trade.getMarketData() };
      }
      case 'undock': g.docking.release(); return { docked: Boolean(g.docking.dock) };
      case 'set_parameter': return this.setParameter(args.name, args.value);
      default: throw new Error(`Unknown action: ${name}`);
    }
  }

  setParameter(name, value) {
    const g = this.game;
    const allowed = {
      gravityScale: [g.world, 'gravityScale', 0, 10],
      simulationRate: [g, 'agentTimeScale', 0.1, 4],
      shipFuel: [g.ship, 'fuel', 0, 100],
      shipHull: [g.ship, 'hull', 0, 100]
    };
    const target = allowed[name];
    if (!target) throw new Error(`Unsupported parameter: ${name}`);
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('Parameter value must be finite');
    const bounded = Math.max(target[2], Math.min(target[3], n));
    target[0][target[1]] = bounded;
    return { name, value: bounded };
  }

  recordTimings(values) {
    Object.assign(this.performance, values);
  }

  snapshot(options = {}) {
    const g = this.game;
    const s = g.ship;
    const range = Math.max(0, Math.min(100000, Number(options.range ?? 5000)));
    const bodies = g.world.bodies.map((b) => ({
      id: b.id, name: b.name, type: b.type, x: b.x, y: b.y, vx: b.vx || 0, vy: b.vy || 0,
      radius: b.radius, distance: Math.hypot(b.x - s.x, b.y - s.y), generated: Boolean(b.generated),
      discovered: Boolean(b.discovered), solidCount: b.solidCount ?? null, orbitLane: b.orbital?.lane ?? null
    })).filter((b) => b.distance <= range + b.radius).sort((a, b) => a.distance - b.distance);
    const gravity = g.world.gravityAt(s.x, s.y);
    const nearest = g.world.nearestBody(s.x, s.y);
    const enemies = g.combat.enemies.filter((e) => !e.dead).map((e) => ({
      id: e.id, rank: e.rank, x: e.x, y: e.y, vx: e.vx, vy: e.vy, hp: e.hp,
      alerted: e.alerted, homeId: e.homeId, distance: Math.hypot(e.x - s.x, e.y - s.y)
    }));
    const telemetry = {
      schema: 'lupixel.agent.telemetry.v1', timestamp: Date.now(), simTime: g.time, paused: g.paused,
      player: {
        mode: g.eva.active ? 'eva' : 'ship', x: s.x, y: s.y, vx: s.vx, vy: s.vy, speed: Math.hypot(s.vx, s.vy),
        angle: s.angle, angularVelocity: s.omega, hull: s.hull, fuel: s.fuel, fuelCapacity: 100,
        energy: s.energy, cargo: { ...s.cargo }, cargoCapacity: s.cargoCapacity, credits: s.credits,
        landed: Boolean(s.landed), landedBody: s.landedBody?.id ?? null, docked: Boolean(s.docked),
        tool: s.tool, gear: Boolean(s.gear), scoop: Boolean(s.scoop)
      },
      eva: { active: g.eva.active, x: g.eva.x, y: g.eva.y, vx: g.eva.vx, vy: g.eva.vy, oxygen: g.eva.oxygen, tetherDistance: g.eva.tetherDistance, returning: g.eva.returning },
      environment: { gravity: { x: gravity.x, y: gravity.y, magnitude: gravity.magnitude, dominantBodyId: gravity.dominant?.id ?? null },
        nearestBody: nearest ? { id: nearest.body.id, distance: nearest.distance, altitude: nearest.altitude } : null },
      mission: { stage: g.mission.stage, objective: g.objectiveText, alteredCells: g.mission.alteredCells, totalCollected: g.mission.totalCollected, launched: g.mission.launched, landed: g.mission.landed, sold: g.mission.sold },
      bodies, enemies, projectiles: g.combat.projectiles.map((p) => ({ owner: p.owner, x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life })),
      world: { seed: g.world.seed, bodyCount: g.world.bodies.length, time: g.world.time, anomalyCount: g.world.anomalies.length },
      camera: { x: g.renderer.camera.x, y: g.renderer.camera.y, zoom: g.renderer.camera.zoom, targetZoom: g.renderer.camera.targetZoom, shake: g.renderer.camera.shake, errorX: g.renderer.camera.x - s.x, errorY: g.renderer.camera.y - s.y },
      performance: { ...this.performance, fps: this.performance.frameMs > 0 ? 1000 / this.performance.frameMs : 0 },
      controls: [...this.controls]
    };
    if (options.history) telemetry.history = this.history.slice(-Math.max(1, Math.min(500, options.history)));
    return telemetry;
  }

  analyzeMotion(windowSize = 300) {
    const samples = this.history.slice(-Math.max(2, Math.min(600, windowSize)));
    if (samples.length < 3) return { sampleCount: samples.length, ready: false, message: 'Need at least three motion samples; allow telemetry to run for a few frames.' };
    const sorted = (key) => samples.map((s) => s[key]).sort((a, b) => a - b);
    const percentile = (values, p) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
    const frameTimes = sorted('frameMs');
    const cameraResidual = samples.slice(1).map((s, i) => Math.hypot(s.cameraDelta[0] - s.shipDelta[0], s.cameraDelta[1] - s.shipDelta[1]));
    const shakePeak = Math.max(...samples.map((s) => s.shake));
    const dropped = samples.filter((s) => s.droppedTimeMs > 0).length;
    return {
      ready: true, sampleCount: samples.length,
      frameMs: { median: percentile(frameTimes, 0.5), p95: percentile(frameTimes, 0.95), p99: percentile(frameTimes, 0.99), max: frameTimes.at(-1) },
      cameraRelativeMotion: { medianPerFrame: cameraResidual.sort((a, b) => a - b)[Math.floor(cameraResidual.length / 2)] || 0, maxPerFrame: Math.max(...cameraResidual) },
      shakePeak, droppedSimulationFrames: dropped,
      likelyIssue: shakePeak > 0.15 ? 'camera-shake feedback is active' : dropped > 0 || percentile(frameTimes, 0.95) > 40 ? 'frame/simulation stalls are present' : 'no sustained shake or major frame stalls in the sampled interval; inspect ship/camera relative motion series',
      samples
    };
  }

  sampleFrame(frameMs) {
    if (now() - this.lastSample < 16) return;
    this.lastSample = now();
    const ship = this.game.ship;
    const camera = this.game.renderer.camera;
    const previous = this.history[this.history.length - 1];
    const sample = {
      t: this.game.time, frameMs,
      ship: [ship.x, ship.y], shipVelocity: [ship.vx, ship.vy],
      shipDelta: previous ? [ship.x - previous.ship[0], ship.y - previous.ship[1]] : [0, 0],
      camera: [camera.x, camera.y],
      cameraDelta: previous ? [camera.x - previous.camera[0], camera.y - previous.camera[1]] : [0, 0],
      cameraError: [camera.x - ship.x, camera.y - ship.y], zoom: camera.zoom, shake: camera.shake, droppedTimeMs: this.performance.droppedTimeMs
    };
    this.history.push(sample);
    if (this.history.length > 600) this.history.shift();
  }
}
