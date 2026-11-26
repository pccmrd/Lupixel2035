import { TAU, clamp, norm, wrap } from '../core/math.js';

export const EVA_TUNING = Object.freeze({
  radius: 5,
  thrust: 26,
  boostThrust: 42,
  torqueThrust: 2.8,
  oxygenCapacity: 240,
  tetherSoft: 145,
  tetherMax: 185,
  scanRange: 920,
  scanCost: 18,
  scanCooldown: 4,
  interactRange: 38
});

function emptyInput() {
  return { anyDown: () => false, isDown: () => false };
}

export class Astronaut {
  constructor(world, ship) {
    this.world = world;
    this.ship = ship;
    this.active = false;
    this.returning = false;
    this.x = ship.x;
    this.y = ship.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.angle = ship.angle;
    this.omega = 0;
    this.oxygen = EVA_TUNING.oxygenCapacity;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.thrustLevel = 0;
    this.contact = false;
    this.contactBody = null;
    this.contactNormal = null;
    this.returnWaypoint = null;
    this.returnPathTimer = 0;
    this.caveBody = null;
    this.tool = 'grinder';
  }

  get tetherDistance() {
    return Math.hypot(this.x - this.ship.x, this.y - this.ship.y);
  }

  get location() {
    return this.caveBody ? `CAVE · ${this.caveBody.name}` : 'CISLUNAR VACUUM';
  }

  start() {
    if (this.active) return true;
    if (!this.ship.landed || !this.ship.landedBody) return false;
    this.active = true;
    this.returning = false;
    this.returnWaypoint = null;
    this.returnPathTimer = 0;
    this.oxygen = EVA_TUNING.oxygenCapacity;
    this.scanCooldown = 0;
    this.scanPulse = 0;
    this.angle = this.ship.angle;
    this.omega = 0;
    const up = this.ship.upVector();
    const base = {
      x: this.ship.x + up.x * 48,
      y: this.ship.y + up.y * 48
    };
    let spawn = base;
    for (let ring = 0; ring < 7; ring++) {
      for (let step = 0; step < 12; step++) {
        const angle = step * TAU / 12;
        const candidate = {
          x: base.x + Math.cos(angle) * ring * 8,
          y: base.y + Math.sin(angle) * ring * 8
        };
        if (!this.world.sampleMaterial(candidate.x, candidate.y, true)) {
          spawn = candidate;
          ring = 7;
          break;
        }
      }
    }
    this.x = spawn.x;
    this.y = spawn.y;
    this.prevX = spawn.x;
    this.prevY = spawn.y;
    this.vx = this.ship.vx;
    this.vy = this.ship.vy;
    this.ship.notify('AIRLOCK OPEN · EVA TETHER SECURED', 'good', { type: 'evaStart' });
    this.world.pushEvent({ type: 'evaStart', x: this.x, y: this.y });
    return true;
  }

  stop(emergency = false) {
    if (!this.active) return;
    this.active = false;
    this.returning = false;
    this.scanPulse = 0;
    this.thrustLevel = 0;
    this.ship.notify(emergency ? 'EMERGENCY TETHER RECOVERY' : 'AIRLOCK SEALED · SUIT RECHARGING', emergency ? 'warn' : 'good', { type: 'evaEnd' });
    this.world.pushEvent({ type: 'evaEnd', x: this.ship.x, y: this.ship.y });
  }

  toggle() {
    if (this.active) {
      if (this.tetherDistance < 30) this.stop();
      else {
        this.returning = !this.returning;
        this.returnWaypoint = null;
        this.returnPathTimer = 0;
        this.ship.notify(this.returning ? 'TETHER RETURN ENGAGED' : 'TETHER RETURN RELEASED', '', { type: 'evaReturn' });
      }
      return;
    }
    if (!this.start()) this.ship.notify('LAND OR DOCK BEFORE EVA', 'warn', { type: 'evaRejected' });
  }

  forwardVector() {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  scan() {
    if (!this.active || this.scanCooldown > 0 || this.ship.energy < EVA_TUNING.scanCost) return false;
    this.ship.consumeEnergy(EVA_TUNING.scanCost);
    this.scanCooldown = EVA_TUNING.scanCooldown;
    this.scanPulse = 1;
    const discovered = this.world.scan(this.x, this.y, EVA_TUNING.scanRange);
    this.ship.notify(discovered.length ? `SCAN RETURN · ${discovered.length} NEW SIGNATURE${discovered.length === 1 ? '' : 'S'}` : 'SCAN RETURN · NO NEW SIGNATURES', discovered.length ? 'good' : '', { type: 'scan' });
    this.world.pushEvent({ type: 'scan', x: this.x, y: this.y, radius: EVA_TUNING.scanRange });
    return true;
  }

  interact() {
    if (!this.active) return false;
    return this.world.interact(this.x, this.y, EVA_TUNING.interactRange, this.ship);
  }

  pathClear(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return true;
    const sideX = -dy / distance * 4.5;
    const sideY = dx / distance * 4.5;
    const steps = Math.max(1, Math.ceil(distance / 5));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;
      if (this.world.sampleMaterial(x, y, true)
        || this.world.sampleMaterial(x + sideX, y + sideY, true)
        || this.world.sampleMaterial(x - sideX, y - sideY, true)) return false;
    }
    return true;
  }

  planReturnPath() {
    const dx = this.ship.x - this.x;
    const dy = this.ship.y - this.y;
    const distance = Math.hypot(dx, dy) || 1;
    const towardX = dx / distance;
    const towardY = dy / distance;
    const approach = {
      x: this.ship.x - towardX * 20,
      y: this.ship.y - towardY * 20
    };
    if (this.pathClear(this.x, this.y, approach.x, approach.y)) return null;

    let normal = this.contactNormal;
    if (!normal || towardX * normal.x + towardY * normal.y > -0.05) {
      normal = null;
      const sideX = -towardY * 4.5;
      const sideY = towardX * 4.5;
      const probeDistance = Math.min(90, Math.max(12, distance - 20));
      for (let offset = 7; offset <= probeDistance && !normal; offset += 7) {
        const x = this.x + towardX * offset;
        const y = this.y + towardY * offset;
        const hit = this.world.sampleMaterial(x, y, true)
          || this.world.sampleMaterial(x + sideX, y + sideY, true)
          || this.world.sampleMaterial(x - sideX, y - sideY, true);
        if (hit) normal = hit.normal;
      }
    }
    if (!normal) normal = { x: -towardX, y: -towardY };
    const tangentX = -normal.y;
    const tangentY = normal.x;
    const side = tangentX * towardX + tangentY * towardY >= 0 ? 1 : -1;
    for (const detour of [52, 70, 88]) {
      for (const direction of [side, -side]) {
        let waypoint = {
          x: this.x + tangentX * direction * detour + normal.x * 9,
          y: this.y + tangentY * direction * detour + normal.y * 9
        };
        const fromShipX = waypoint.x - this.ship.x;
        const fromShipY = waypoint.y - this.ship.y;
        const fromShip = Math.hypot(fromShipX, fromShipY);
        if (fromShip > EVA_TUNING.tetherMax - 12) {
          const scale = (EVA_TUNING.tetherMax - 12) / fromShip;
          waypoint = {
            x: this.ship.x + fromShipX * scale,
            y: this.ship.y + fromShipY * scale
          };
        }
        if (!this.world.sampleMaterial(waypoint.x, waypoint.y, true)
          && this.pathClear(this.x, this.y, waypoint.x, waypoint.y)
          && this.pathClear(waypoint.x, waypoint.y, approach.x, approach.y)) return waypoint;
      }
    }
    return null;
  }

  update(dt, input) {
    if (!this.active) return;
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevAngle = this.angle;
    this.scanCooldown = Math.max(0, this.scanCooldown - dt);
    this.scanPulse = Math.max(0, this.scanPulse - dt * 0.8);
    this.oxygen = Math.max(0, this.oxygen - dt);
    if (this.oxygen <= 0) this.returning = true;

    const controls = input || emptyInput();
    const forward = (controls.anyDown('KeyW', 'ArrowUp') ? 1 : 0) - (controls.anyDown('KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (controls.anyDown('KeyD', 'ArrowRight') ? 1 : 0) - (controls.anyDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const torque = (controls.anyDown('KeyE') ? 1 : 0) - (controls.anyDown('KeyQ') ? 1 : 0);
    const boost = controls.anyDown('ShiftLeft', 'ShiftRight');
    const thrust = boost ? EVA_TUNING.boostThrust : EVA_TUNING.thrust;
    const f = this.forwardVector();
    const r = { x: -f.y, y: f.x };
    let ax = (f.x * forward + r.x * strafe) * thrust;
    let ay = (f.y * forward + r.y * strafe) * thrust;

    if (this.returning || this.oxygen <= 0) {
      const shipDX = this.ship.x - this.x;
      const shipDY = this.ship.y - this.y;
      const shipDistance = Math.hypot(shipDX, shipDY) || 1;
      const shipTowardX = shipDX / shipDistance;
      const shipTowardY = shipDY / shipDistance;
      const approach = {
        x: this.ship.x - shipTowardX * 20,
        y: this.ship.y - shipTowardY * 20
      };
      this.returnPathTimer -= dt;
      if (this.returnPathTimer <= 0) {
        this.returnPathTimer = 0.2;
        if (this.returnWaypoint && (Math.hypot(this.returnWaypoint.x - this.x, this.returnWaypoint.y - this.y) < 12
          || this.pathClear(this.x, this.y, approach.x, approach.y))) this.returnWaypoint = null;
        if (!this.returnWaypoint) this.returnWaypoint = this.planReturnPath();
      }
      const target = this.returnWaypoint || this.ship;
      const toward = norm(target.x - this.x, target.y - this.y, 0, 0);
      const desiredSpeed = Math.min(32, toward.l * 0.45);
      ax += (toward.x * desiredSpeed - this.vx) * 1.8;
      ay += (toward.y * desiredSpeed - this.vy) * 1.8;
      if (shipDistance < 26 && this.pathClear(this.x, this.y, approach.x, approach.y)) {
        this.stop(this.oxygen <= 0);
        return;
      }
    }

    const tether = norm(this.x - this.ship.x, this.y - this.ship.y, 0, 0);
    if (tether.l > EVA_TUNING.tetherSoft) {
      const stretch = clamp((tether.l - EVA_TUNING.tetherSoft) / (EVA_TUNING.tetherMax - EVA_TUNING.tetherSoft), 0, 1);
      ax -= tether.x * stretch * 58;
      ay -= tether.y * stretch * 58;
    }

    const gravity = this.world.gravityAt(this.x, this.y);
    this.vx += (gravity.x + ax) * dt;
    this.vy += (gravity.y + ay) * dt;
    this.omega += torque * EVA_TUNING.torqueThrust * dt;
    if (controls.anyDown('KeyX')) {
      this.vx *= Math.max(0, 1 - 5 * dt);
      this.vy *= Math.max(0, 1 - 5 * dt);
      this.omega *= Math.max(0, 1 - 5 * dt);
      this.ship.consumeEnergy(0.8 * dt);
    }
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 150) {
      this.vx *= 150 / speed;
      this.vy *= 150 / speed;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = wrap(this.angle + this.omega * dt, 0, TAU);
    this.thrustLevel = Math.hypot(ax, ay) / EVA_TUNING.boostThrust;
    this.resolveCollision();

    if (this.tetherDistance > EVA_TUNING.tetherMax) {
      const direction = norm(this.x - this.ship.x, this.y - this.ship.y, 0, -1);
      this.x = this.ship.x + direction.x * EVA_TUNING.tetherMax;
      this.y = this.ship.y + direction.y * EVA_TUNING.tetherMax;
      const outward = this.vx * direction.x + this.vy * direction.y;
      if (outward > 0) {
        this.vx -= direction.x * outward;
        this.vy -= direction.y * outward;
      }
    }
  }

  resolveCollision() {
    this.contact = false;
    this.contactBody = null;
    this.contactNormal = null;
    let normalX = 0;
    let normalY = 0;
    let hits = 0;
    const steps = clamp(Math.ceil(Math.hypot(this.x - this.prevX, this.y - this.prevY) / 2), 1, 12);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const x = this.prevX + (this.x - this.prevX) * t;
      const y = this.prevY + (this.y - this.prevY) * t;
      normalX = 0;
      normalY = 0;
      hits = 0;
      this.contactBody = null;
      for (let k = 0; k < 8; k++) {
        const angle = k * TAU / 8;
        const sample = this.world.sampleMaterial(
          x + Math.cos(angle) * EVA_TUNING.radius,
          y + Math.sin(angle) * EVA_TUNING.radius,
          true
        );
        if (!sample) continue;
        normalX += sample.normal.x;
        normalY += sample.normal.y;
        this.contactBody = sample.body;
        hits++;
      }
      if (hits) {
        this.x = x;
        this.y = y;
        break;
      }
    }
    if (!hits) {
      const nav = this.world.nearestBody(this.x, this.y);
      this.caveBody = nav.body && nav.distance < nav.body.radius * 0.94 ? nav.body : null;
      return;
    }
    const normal = norm(normalX, normalY, 0, -1);
    this.contactNormal = normal;
    this.x += normal.x * 1.2;
    this.y += normal.y * 1.2;
    const inward = this.vx * normal.x + this.vy * normal.y;
    if (inward < 0) {
      this.vx -= normal.x * inward * 1.04;
      this.vy -= normal.y * inward * 1.04;
      this.vx *= 0.94;
      this.vy *= 0.94;
    }
    this.omega *= 0.9;
    this.contact = true;
    this.caveBody = this.contactBody;
  }
}
