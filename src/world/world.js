import { clamp, norm } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { MAT, COMMODITIES, cargoForMaterial, isCollidable, isGas } from './materials.js';
import { createBody, materializeBody } from './generation.js';
import { OrbitalLayer, ORBITAL_CONTEXT } from './orbital.js';

const BODY_CONFIGS = [
  {
    id: 'selene', name: 'LUNA', type: 'moon', x: 0, y: 0,
    w: 840, h: 840, radius: 380, g0: 60, seed: 0x5e1e, glow: '#9bd8ff',
    market: true, structural: true, hue: 0.57,
    description: 'Airless regolith, lava tubes, ice shadow traps and a surface exchange.'
  },
  {
    id: 'kestrel', name: 'KESTREL SHARD', type: 'asteroid', x: -2382.870956601819, y: 0, orbitLane: 0,
    w: 260, h: 260, radius: 120, g0: 4, seed: 0x8a57, glow: '#ffb36b',
    structural: true, hue: 0.08,
    description: 'A fractured ore body with a crystalline geode and low gravity caves.'
  },
  {
    id: 'vela', name: 'VELA', type: 'comet', x: 0, y: -4500.978473581214, orbitLane: 4,
    w: 240, h: 240, radius: 110, g0: 1.7, seed: 0x7e1a, glow: '#8beaff',
    structural: true, hue: 0.52,
    description: 'Volatile ice, cryo vaults and an active sunward jet.'
  },
  {
    id: 'halcyon', name: 'HALCYON RING', type: 'station', x: 3441.924715091516, y: 0, orbitLane: 2,
    w: 300, h: 300, radius: 120, g0: 2.5, seed: 0x1ac0, glow: '#8ef7ff',
    market: true, structural: false, variant: 'ring', hue: 0.5,
    description: 'A destructible trading ring with electromagnetic material rails.'
  },
  {
    id: 'cinder', name: 'CINDER', type: 'cinder', x: 7148.612869805456, y: 0, orbitLane: 9,
    w: 250, h: 250, radius: 115, g0: 4, seed: 0xc1de, glow: '#ff8055',
    structural: true, hue: 0.03,
    description: 'A hot carbonaceous asteroid with molten pockets and dense ores.'
  },
  {
    id: 'vesper', name: 'VESPER FOUNDRY', type: 'station', x: -6089.55911131576, y: 0, orbitLane: 7,
    w: 300, h: 300, radius: 115, g0: 2.2, seed: 0xfe5a, glow: '#ffb86b',
    market: true, structural: false, variant: 'foundry', hue: 0.1,
    description: 'An automated foundry that still contains flowing molten alloy.'
  }
];

export class World {
  constructor(seed = 0x51a7) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.time = 0;
    this.events = [];
    this.star = { x: -6500, y: -4300, name: 'SOL', color: '#ffd38a' };
    this.sunDirection = norm(-this.star.x, -this.star.y, 0.8, 0.6);
    this.bounds = { minX: -7600, maxX: 7600, minY: -7600, maxY: 7600 };
    this.tailAccumulator = 0;
    this.orbital = new OrbitalLayer(seed);
    this.bodies = BODY_CONFIGS.map((config) => {
      const tailDirection = norm(config.x - this.star.x, config.y - this.star.y, 0.9, 0.35);
      const body = createBody({ ...config, tailDirection, catalogued: true });
      if (body.type === 'moon' || body.id === 'halcyon') materializeBody(body);
      if (body.type !== 'moon') {
        this.orbital.register(body, { preservePose: true, e: 0, inclination: 0, node: 0, periapsis: 0, lane: config.orbitLane });
      } else {
        body.hiddenPosition = { x: 0, y: 0, z: 0 };
        body.hiddenVelocity = { x: 0, y: 0, z: 0 };
      }
      return body;
    });
    this.bodyById = new Map(this.bodies.map((b) => [b.id, b]));
    const population = this.orbital.createPopulation(288, { cataloguedCount: 9 });
    for (const config of population) {
      const body = createBody(config);
      this.orbital.register(body, { orbital: config.orbital, preservePose: true });
      this.bodies.push(body);
      this.bodyById.set(body.id, body);
    }
    this.deliverySerial = 288;
    this.haulers = Array.from({ length: 7 }, (_, i) => ({
      id: `hauler-${i + 1}`,
      name: `AHA-${String(i + 1).padStart(2, '0')} AUTONOMOUS HAULER`,
      orbital: this.orbital.createLaneElements(this.orbital.laneForType('hauler')),
      nextArrival: 34 + i * 19,
      state: null
    }));
    this.scanPulses = [];
    this.anomalies = [
      { id: 'echo', name: 'ECHO CACHE', x: 1260, y: -960, found: false, reward: 350, loot: { commodity: 'exotic', units: 2 } },
      { id: 'derelict', name: 'DERELICT POD', x: -1190, y: -850, found: false, reward: 220, loot: { commodity: 'alloy', units: 5 } },
      { id: 'cryo', name: 'CRYO VAULT', x: 1160, y: -510, found: false, reward: 500, loot: { commodity: 'volatiles', units: 8 } }
    ];
  }

  pushEvent(event) {
    this.events.push(event);
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  takeEvents() {
    if (!this.events.length) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  tailDirectionFor(body) {
    return norm(body.x - this.star.x, body.y - this.star.y, 0.9, 0.35);
  }

  materializeNear(ship) {
    let closest = null;
    let closestDistance = Infinity;
    for (const body of this.bodies) {
      if (body.generated) continue;
      const d = Math.hypot(ship.x - body.x, ship.y - body.y);
      const clearance = d - body.radius;
      if (clearance < 620 && clearance < closestDistance) {
        closest = body;
        closestDistance = clearance;
      }
    }
    if (!closest) return null;
    materializeBody(closest);
    this.pushEvent({ type: 'survey', text: `LOCAL MATERIAL MODEL ONLINE: ${closest.name}`, tone: '', body: closest, x: closest.x, y: closest.y });
    return closest;
  }

  releaseDistantSurfaces(ship) {
    for (const body of this.bodies) {
      if (!body.generated || !body.surface) continue;
      if (Math.hypot(ship.x - body.x, ship.y - body.y) > body.radius + 2400) body.releaseSurface();
    }
  }

  scan(x, y, range = 920) {
    const discoveries = [];
    for (const body of this.bodies) {
      const d = Math.hypot(x - body.x, y - body.y);
      if (d > range + body.radius) continue;
      if (d < body.radius + 520) materializeBody(body);
      if (!body.discovered) {
        body.discovered = true;
        body.name = body.designation || body.name;
        discoveries.push(body);
        this.pushEvent({ type: 'discover', text: `SURVEY LOCK: ${body.name}`, tone: 'good', x: body.x, y: body.y });
      }
      for (const site of body.sites) site.scanned = true;
    }
    this.scanPulses.push({ x, y, range, life: 1 });
    return discoveries;
  }

  interact(x, y, range = 38, ship) {
    let closest = null;
    let closestDistance = Infinity;
    for (const body of this.bodies) {
      if (!body.generated) continue;
      for (const site of body.sites) {
        if (!site.scanned || site.visited) continue;
        const point = body.localToWorld(site.x, site.y);
        const d = Math.hypot(x - point.x, y - point.y);
        if (d < range && d < closestDistance) {
          closest = { body, site, point };
          closestDistance = d;
        }
      }
    }
    if (!closest) return null;
    const { body, site, point } = closest;
    site.visited = true;
    ship.credits += site.credits;
    const commodity = cargoForMaterial(site.reward)?.commodity || 'exotic';
    ship.addCargo(commodity, site.count);
    this.pushEvent({ type: 'anomaly', text: `${site.name} DOCUMENTED  +${site.credits} CR`, tone: 'good', x: point.x, y: point.y, radius: 42 });
    return { ...site, x: point.x, y: point.y, commodity, oxygen: site.type === 'biome' ? 48 : 0 };
  }

  releaseDelivery(hauler) {
    if (this.bodies.length >= 420) {
      hauler.nextArrival += 90;
      return;
    }
    const config = this.orbital.createPopulation(1, { startIndex: this.deliverySerial++, cataloguedCount: 0 })[0];
    const state = this.orbital.sample(config.orbital, this.time);
    config.x = state.x;
    config.y = state.y;
    config.vx = state.vx;
    config.vy = state.vy;
    const body = createBody(config);
    this.orbital.register(body, { orbital: config.orbital, preservePose: true });
    this.bodies.push(body);
    this.bodyById.set(body.id, body);
    hauler.nextArrival = this.time + this.rng.range(75, 135);
    this.pushEvent({ type: 'hauler', text: `${hauler.name} DELIVERED ${body.designation}`, tone: 'good', x: body.x, y: body.y });
  }

  advance(dt) {
    this.time += dt;
    this.orbital.update(dt, this.bodies.filter((body) => body.type !== 'moon'));
    for (const hauler of this.haulers) {
      hauler.state = this.orbital.sample(hauler.orbital, this.time);
      if (this.time >= hauler.nextArrival) this.releaseDelivery(hauler);
    }
    for (const pulse of this.scanPulses) pulse.life -= dt * 0.55;
    this.scanPulses = this.scanPulses.filter((pulse) => pulse.life > 0);
  }

  gravityAt(x, y) {
    let ax = 0;
    let ay = 0;
    let dominant = null;
    let dominantMag = 0;
    for (const body of this.bodies) {
      const dx = body.x - x;
      const dy = body.y - y;
      const r2 = dx * dx + dy * dy;
      const eps2 = (body.radius * 0.22) ** 2;
      const denom = Math.pow(r2 + eps2, 1.5);
      const f = body.mu / denom;
      const gx = dx * f;
      const gy = dy * f;
      ax += gx;
      ay += gy;
      const mag = Math.hypot(gx, gy);
      if (mag > dominantMag) {
        dominantMag = mag;
        dominant = body;
      }
    }
    // A distant photogravitational star gives the whole sector a faint drift.
    const sdx = this.star.x - x;
    const sdy = this.star.y - y;
    const sr2 = sdx * sdx + sdy * sdy + 900000;
    const sf = 2.7e6 / Math.pow(sr2, 1.5);
    ax += sdx * sf;
    ay += sdy * sf;

    const mag = Math.hypot(ax, ay);
    if (mag > 180) {
      const s = 180 / mag;
      ax *= s;
      ay *= s;
    }
    return { x: ax, y: ay, magnitude: Math.hypot(ax, ay), dominant, dominantMagnitude: dominantMag };
  }

  nearestBody(x, y) {
    let best = null;
    for (const body of this.bodies) {
      const dx = body.x - x;
      const dy = body.y - y;
      const distance = Math.hypot(dx, dy);
      const altitude = distance - body.radius;
      if (!best || altitude < best.altitude) best = { body, distance, altitude, dx, dy };
    }
    const g = this.gravityAt(x, y);
    const away = best ? norm(-best.dx, -best.dy, 0, -1) : norm(0, -1, 0, -1);
    return { ...best, gravity: g, away };
  }

  sampleMaterial(wx, wy, skipGas = true) {
    for (const body of this.bodies) {
      if (!body.generated) continue;
      const p = body.worldToLocal(wx, wy);
      if (p.x < 0 || p.y < 0 || p.x >= body.w || p.y >= body.h) continue;
      const material = body.cellAtContinuous(p.x, p.y);
      if (material === MAT.VACUUM) continue;
      if (skipGas && isGas(material)) continue;
      if (!skipGas || isCollidable(material)) {
        return { body, material, x: wx, y: wy, localX: p.x, localY: p.y, normal: body.normalAtWorld(wx, wy) };
      }
    }
    return null;
  }

  raycast(x, y, dirX, dirY, maxDist) {
    let best = null;
    for (const body of this.bodies) {
      if (!body.generated) continue;
      const centerDist = Math.hypot(body.x - x, body.y - y);
      const bound = Math.hypot(body.w, body.h) / 2;
      if (centerDist > maxDist + bound) continue;
      const start = body.worldToLocal(x, y);
      const localDirX = dirX * body.cos + dirY * body.sin;
      const localDirY = -dirX * body.sin + dirY * body.cos;
      const hit = body.raycastLocal(start.x, start.y, localDirX, localDirY, maxDist, true);
      if (!hit || (best && hit.t >= best.distance)) continue;
      const point = body.localToWorld(hit.localX, hit.localY);
      best = {
        body,
        i: hit.i,
        distance: hit.t,
        x: point.x,
        y: point.y,
        localX: hit.localX,
        localY: hit.localY,
        material: hit.mat,
        dirX,
        dirY
      };
    }
    return best;
  }

  grindHit(hit, radius = 2.2, power = 18) {
    if (!hit) return 0;
    hit.body.grindArea(hit.localX, hit.localY, radius, power);
    return 1;
  }

  heatHit(hit, radius = 2.6, heat = 28, damage = 5) {
    if (!hit) return 0;
    hit.body.applyHeatArea(hit.localX, hit.localY, radius, heat, damage, 'laser');
    return 1;
  }

  explode(wx, wy, radius, power = 95) {
    let touched = 0;
    for (const body of this.bodies) {
      if (!body.generated) continue;
      const p = body.worldToLocal(wx, wy);
      if (p.x < -radius || p.y < -radius || p.x > body.w + radius || p.y > body.h + radius) continue;
      body.explode(p.x, p.y, radius, power);
      touched++;
    }
    this.pushEvent({ type: 'shockwave', x: wx, y: wy, radius, power });
    return touched;
  }

  collectAtShip(ship) {
    if (!ship.scoop || ship.energy <= 0) return 0;
    let total = 0;
    for (const body of this.bodies) {
      if (!body.generated) continue;
      const p = body.worldToLocal(ship.x, ship.y);
      if (p.x < -12 || p.y < -12 || p.x > body.w + 12 || p.y > body.h + 12) continue;
      total += body.collectLocal(p.x, p.y, (i, material) => {
        const ok = ship.addMaterial(material);
        if (ok && i >= 0 && this.rng.chance(0.16)) {
          const cargo = cargoForMaterial(material);
          const point = body.worldPointForCell(i);
          this.pushEvent({ type: 'collect', x: point.x, y: point.y, commodity: cargo?.commodity || 'ore' });
        }
        return ok;
      });
    }
    return total;
  }

  findDock(ship) {
    return ship.docking?.dock || null;
  }

  priceFor(body, commodity) {
    const base = COMMODITIES[commodity]?.price ?? 1;
    const scarcity = 0.86 + (1 - body.integrity()) * 0.34;
    const local = body.type === 'station' ? 1 : 0.92;
    return Math.max(1, Math.round(base * scarcity * local));
  }

  updateDiscovery(ship) {
    for (const body of this.bodies) {
      const d = Math.hypot(ship.x - body.x, ship.y - body.y);
      if (!body.visited && d < body.radius + 45) {
        body.visited = true;
        this.pushEvent({ type: 'visit', text: `ENTERED ${body.name} GRAVITY WELL`, tone: '', body, x: ship.x, y: ship.y });
      }
    }
    for (const anomaly of this.anomalies) {
      if (anomaly.found) continue;
      const d = Math.hypot(ship.x - anomaly.x, ship.y - anomaly.y);
      if (d < 72) {
        anomaly.found = true;
        ship.credits += anomaly.reward;
        if (anomaly.loot) ship.addCargo(anomaly.loot.commodity, anomaly.loot.units);
        this.pushEvent({ type: 'anomaly', text: `${anomaly.name} RECOVERED  +${anomaly.reward} CR`, tone: 'good', x: anomaly.x, y: anomaly.y, radius: 42 });
      }
    }
  }

  emitAmbientTails(ship) {
    for (const body of this.bodies) {
      if (body.type !== 'comet' || !body.generated) continue;
      if (Math.hypot(ship.x - body.x, ship.y - body.y) > body.radius + 1500) continue;
      const tail = this.tailDirectionFor(body);
      const perp = { x: -tail.y, y: tail.x };
      for (let k = 0; k < 2; k++) {
        const offset = this.rng.range(-body.radius * 0.55, body.radius * 0.55);
        const along = -body.radius * this.rng.range(0.72, 0.98);
        const x = body.x + tail.x * along + perp.x * offset;
        const y = body.y + tail.y * along + perp.y * offset;
        this.pushEvent({
          type: 'tail', x, y,
          vx: tail.x * this.rng.range(38, 88) + perp.x * this.rng.range(-7, 7),
          vy: tail.y * this.rng.range(38, 88) + perp.y * this.rng.range(-7, 7),
          material: MAT.STEAM,
          life: this.rng.range(1.8, 4.4)
        });
      }
    }
  }

  update(dt, ship, options = {}) {
    if (options.orbitalAdvanced !== true) this.advance(dt);
    this.materializeNear(ship);
    for (const body of this.bodies) {
      if (!body.generated) continue;
      const d = Math.hypot(ship.x - body.x, ship.y - body.y);
      const near = d < body.radius + 540;
      // Only simulate pixel materials in the local encounter bubble. Distant
      // bodies keep their analytical lunar orbits, but sleeping their granular
      // fields avoids thousands of needless cell updates per frame.
      if (d >= body.radius + 1800) continue;
      const shipLocal = near ? body.worldToLocal(ship.x, ship.y) : null;
      const context = {
        time: this.time,
        far: !near,
        shipLocal,
        scoop: near && ship.scoop && ship.energy > 1,
        scoopRange: 62 + (ship.scoopRangeBonus || 0),
        collect: (i, material) => {
          const ok = ship.addMaterial(material);
          if (ok && i >= 0 && this.rng.chance(0.10)) {
            const cargo = cargoForMaterial(material);
            const point = body.worldPointForCell(i);
            this.pushEvent({ type: 'collect', x: point.x, y: point.y, commodity: cargo?.commodity || 'ore' });
          }
          return ok;
        },
        tailDirection: this.tailDirectionFor(body)
      };
      body.step(dt, context, near ? 12000 : 1500, near ? 1 : 0.12);
      for (const event of body.takeEvents()) this.pushEvent(event);
    }

    this.updateDiscovery(ship);
    this.tailAccumulator += dt;
    while (this.tailAccumulator >= 0.045) {
      this.tailAccumulator -= 0.045;
      this.emitAmbientTails(ship);
    }
    this.releaseTimer = (this.releaseTimer || 0) + dt;
    if (this.releaseTimer > 2.5) {
      this.releaseTimer = 0;
      this.releaseDistantSurfaces(ship);
    }
    if (options.collect !== false) this.collectAtShip(ship);
  }

  discoveryCount() {
    const bodies = this.bodies.reduce((n, b) => n + (b.discovered ? 1 : 0), 0);
    const anomalies = this.anomalies.reduce((n, a) => n + (a.found ? 1 : 0), 0);
    return { bodies, anomalies, total: bodies + anomalies, max: this.bodies.length + this.anomalies.length };
  }
}
