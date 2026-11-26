import { clamp } from '../core/math.js';
import { SHIP_SCALE } from './shipConfig.js';

export const ORBIT_TUNING = Object.freeze({
  maxRange: 1250,
  maxRelativeSpeed: 34,
  minAltitude: 90,
  orbitClearance: 125,
  correctionRange: 0.65,
  captureRange: 0.035,
  captureSpeed: 2.2,
  radialTolerance: 8,
  transferTolerance: 6,
  maxThrust: SHIP_SCALE.mainThrust * 0.62,
  maxCorrectionThrust: SHIP_SCALE.rcsThrust,
  captureThrust: SHIP_SCALE.mainThrust * 0.42,
  correctionDeadband: 0.002,
  phaseLabels: Object.freeze({
    approach: 'MATCHING TARGET VELOCITY',
    transfer: 'THRUSTER TRANSFER',
    circularize: 'CIRCULARIZING',
    correction: 'ORBIT HOLD · O TO DISENGAGE'
  })
});

function clampVector(x, y, max) {
  const length = Math.hypot(x, y);
  if (length <= max || length < 1e-8) return { x, y };
  const scale = max / length;
  return { x: x * scale, y: y * scale };
}

function gravitySoftening(body) {
  return Math.pow(body.radius * 0.22, 2);
}

function circularSpeed(body, radius) {
  const eps2 = gravitySoftening(body);
  return Math.sqrt(body.mu) * radius / Math.pow(radius * radius + eps2, 0.75);
}

function orbitVelocity(body, x, y, radius, direction, mu = body.mu) {
  const dx = x - body.x;
  const dy = y - body.y;
  const distance = Math.hypot(dx, dy) || 1;
  const eps2 = gravitySoftening(body);
  const speed = Math.sqrt(mu) * radius / Math.pow(radius * radius + eps2, 0.75);
  return {
    x: (body.vx || 0) - dy / distance * speed * direction,
    y: (body.vy || 0) + dx / distance * speed * direction
  };
}

export function desiredOrbitVelocity(body, x, y, radius, direction, mu = body.mu) {
  return orbitVelocity(body, x, y, radius, direction, mu);
}

export class OrbitController {
  constructor(world, ship) {
    this.world = world;
    this.ship = ship;
    this.target = null;
    this.active = false;
    this.phase = 'idle';
    this.lastRejection = '';
    this.radius = 0;
    this.direction = 1;
    this.burn = null;
    this.time = 0;
    this.captureTime = 0;
    this.error = null;
    this.desiredVelocity = null;
  }

  selectTarget(body = null) {
    if (this.active) return this.target;
    if (body) {
      this.target = body;
      return body;
    }
    const nav = this.world.nearestBody(this.ship.x, this.ship.y);
    if (!nav?.body) return null;
    this.target = nav.body;
    return this.target;
  }

  targetDistance() {
    return this.target ? Math.hypot(this.ship.x - this.target.x, this.ship.y - this.target.y) : Infinity;
  }

  engagementCheck() {
    if (!this.target) return { ok: false, reason: 'SELECT AN ASTEROID OR STATION' };
    if (this.ship.landed || this.ship.docking?.engaged) return { ok: false, reason: 'LIFT OFF BEFORE ORBIT CAPTURE' };
    if (this.ship.fuel < 1) return { ok: false, reason: 'INSUFFICIENT FUEL FOR CAPTURE' };
    const dx = this.ship.x - this.target.x;
    const dy = this.ship.y - this.target.y;
    const distance = Math.hypot(dx, dy);
    const altitude = distance - this.target.radius;
    if (distance > ORBIT_TUNING.maxRange) return { ok: false, reason: `TARGET OUTSIDE ${ORBIT_TUNING.maxRange} m RANGE` };
    if (altitude < ORBIT_TUNING.minAltitude) return { ok: false, reason: 'MOVE CLEAR OF THE SURFACE' };
    const rvx = this.ship.vx - (this.target.vx || 0);
    const rvy = this.ship.vy - (this.target.vy || 0);
    const speed = Math.hypot(rvx, rvy);
    if (speed > ORBIT_TUNING.maxRelativeSpeed) return { ok: false, reason: `SLOW TO TARGET · ${speed.toFixed(1)} / ${ORBIT_TUNING.maxRelativeSpeed} m/s` };
    return { ok: true, reason: 'RENDEZVOUS WINDOW OPEN' };
  }

  toggle() {
    if (this.active) {
      this.cancel('ORBIT ASSIST DISENGAGED');
      return false;
    }
    if (!this.target) this.selectTarget();
    else if (!this.active && this.targetDistance() > ORBIT_TUNING.maxRange * 2) this.selectTarget();
    const check = this.engagementCheck();
    if (!check.ok) {
      this.target = null;
      this.ship.notify(check.reason, 'warn', { type: 'orbitRejected' });
      this.lastRejection = check.reason;
      return false;
    }
    const dx = this.ship.x - this.target.x;
    const dy = this.ship.y - this.target.y;
    const distance = Math.hypot(dx, dy);
    const rvx = this.ship.vx - (this.target.vx || 0);
    const rvy = this.ship.vy - (this.target.vy || 0);
    const tangentX = -dy / distance;
    const tangentY = dx / distance;
    const tangentSpeed = rvx * tangentX + rvy * tangentY;
    this.radius = Math.max(this.target.radius + ORBIT_TUNING.orbitClearance, distance);
    this.direction = tangentSpeed < 0 ? -1 : 1;
    this.error = null;
    this.desiredVelocity = desiredOrbitVelocity(this.target, this.ship.x, this.ship.y, this.radius, this.direction);
    this.active = true;
    this.phase = 'approach';
    this.time = 0;
    this.captureTime = 0;
    this.burn = null;
    this.ship.notify(`ORBIT ASSIST · ${this.target.name} · PROGRADE MATCH`, 'good', { type: 'orbitEngaged' });
    this.world.pushEvent({ type: 'orbitEngaged', x: this.ship.x, y: this.ship.y, body: this.target });
    return true;
  }

  cancel(reason = 'ORBIT ASSIST CANCELLED') {
    if (!this.active) return;
    this.active = false;
    this.phase = 'idle';
    this.burn = null;
    this.ship.notify(reason, '', { type: 'orbitCancelled' });
    this.world.pushEvent({ type: 'orbitCancelled', x: this.ship.x, y: this.ship.y, body: this.target });
  }

  command(dx, dy, maxThrust = ORBIT_TUNING.maxThrust) {
    const vector = clampVector(dx, dy, maxThrust);
    const magnitude = Math.hypot(vector.x, vector.y);
    const throttle = Math.min(1, magnitude / maxThrust);
    const direction = magnitude > 1e-8 ? { x: vector.x / magnitude, y: vector.y / magnitude } : { x: 0, y: 0 };
    return {
      ...direction,
      magnitude,
      cost: (0.12 + throttle * 0.38) * throttle,
      throttle
    };
  }

  update(dt, input = null) {
    if (!this.active || !this.target) return null;
    const manual = input && (
      input.anyDown('KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight')
    );
    if (manual) {
      this.cancel('MANUAL CONTROL · ORBIT ASSIST DISENGAGED');
      return null;
    }
    if (this.ship.fuel <= 0) {
      this.cancel('ORBIT ASSIST OFFLINE · FUEL DEPLETED');
      return null;
    }
    if (this.ship.landed || this.ship.docking?.engaged) {
      this.cancel('ORBIT ASSIST RELEASED FOR SURFACE CONTACT');
      return null;
    }

    this.time += dt;
    const body = this.target;
    const dx = this.ship.x - body.x;
    const dy = this.ship.y - body.y;
    const distance = Math.hypot(dx, dy) || 1;
    const radialX = dx / distance;
    const radialY = dy / distance;
    const tangentX = -radialY * this.direction;
    const tangentY = radialX * this.direction;
    const rvx = this.ship.vx - (body.vx || 0);
    const rvy = this.ship.vy - (body.vy || 0);
    const radialSpeed = rvx * radialX + rvy * radialY;
    const tangentSpeed = rvx * tangentX + rvy * tangentY;
    const radialError = distance - this.radius;
    const desired = desiredOrbitVelocity(body, this.ship.x, this.ship.y, this.radius, this.direction);
    const desiredRVX = desired.x - (body.vx || 0);
    const desiredRVY = desired.y - (body.vy || 0);
    const speedError = Math.hypot(rvx - desiredRVX, rvy - desiredRVY);
    const eps2 = gravitySoftening(body);
    const gravityScale = body.mu / Math.pow(distance * distance + eps2, 1.5);
    const naturalRadialAcceleration = -tangentSpeed * tangentSpeed / distance + dx * gravityScale * radialX;
    const desiredTangentialSpeed = circularSpeed(body, this.radius);
    const targetAcceleration = {
      x: -radialX * desiredTangentialSpeed * desiredTangentialSpeed / this.radius,
      y: -radialY * desiredTangentialSpeed * desiredTangentialSpeed / this.radius
    };
    const centripetalX = -tangentY * rvy * tangentSpeed / distance;
    const centripetalY = tangentX * rvx * tangentSpeed / distance;
    const requiredAcceleration = {
      x: centripetalX + dx * gravityScale,
      y: centripetalY + dy * gravityScale
    };
    this.error = speedError + Math.hypot(requiredAcceleration.x - targetAcceleration.x, requiredAcceleration.y - targetAcceleration.y) * 0.25;
    this.desiredVelocity = desired;

    if (distance > ORBIT_TUNING.maxRange * 1.35) {
      this.cancel('ORBIT ASSIST ABORTED · TARGET RANGE LOST');
      return null;
    }
    let ax = 0;
    let ay = 0;
    let maxThrust = ORBIT_TUNING.maxThrust;
    if (distance < body.radius + SHIP_SCALE.hullRadius + 22) {
      this.cancel('ORBIT ASSIST ABORTED · TERRAIN CLEARANCE');
      return null;
    }

    if (this.phase === 'approach') {
      const match = 4;
      const closingSpeed = -(rvx * radialX + rvy * radialY);
      if (closingSpeed > 8) ax -= radialX * closingSpeed * 1.8;
      ax += (desiredRVX - rvx) * 0.72;
      ay += (desiredRVY - rvy) * 0.72;
      if (speedError < match && Math.abs(radialError) < 28) {
        this.phase = 'transfer';
        this.ship.notify('TRANSFER BURN · HOLDING ORBIT PLANE', '', { type: 'orbitPhase' });
      }
      const desiredDistance = this.radius;
      if (desiredDistance > body.radius + ORBIT_TUNING.orbitClearance + 180) {
        const approachSpeed = Math.max(4, Math.min(18, (desiredDistance - distance) * 0.08));
        const radialCorrection = clamp((approachSpeed - radialSpeed) * 0.9, -12, 12);
        ax += radialX * radialCorrection;
        ay += radialY * radialCorrection;
      }
    } else if (this.phase === 'transfer') {
      const targetRadialSpeed = Math.max(-18, Math.min(18, -radialError * 0.12));
      ax += (targetRadialSpeed - radialSpeed) * 1.2;
      ay += (targetRadialSpeed - radialSpeed) * 1.2;
      const desiredTransferSpeed = circularSpeed(body, this.radius);
      ax += tangentX * (desiredTransferSpeed - tangentSpeed) * 0.72;
      ay += tangentY * (desiredTransferSpeed - tangentSpeed) * 0.72;
      if (Math.abs(radialError) < ORBIT_TUNING.radialTolerance && speedError < ORBIT_TUNING.transferTolerance) {
        this.phase = 'circularize';
        this.ship.notify('CIRCULARIZATION BURN', '', { type: 'orbitPhase' });
      }
    } else if (this.phase === 'circularize') {
      ax += (desiredRVX - rvx) * 1.25;
      ay += (desiredRVY - rvy) * 1.25;
      maxThrust = ORBIT_TUNING.captureThrust;
      if (speedError < ORBIT_TUNING.captureSpeed && Math.abs(radialError) < ORBIT_TUNING.radialTolerance
        && this.error < ORBIT_TUNING.captureSpeed) {
        this.phase = 'correction';
        this.captureTime = 0;
        this.ship.notify('SLOW ORBIT ACQUIRED · O TO DISENGAGE', 'good', { type: 'orbitAcquired' });
        this.world.pushEvent({ type: 'orbitAcquired', x: this.ship.x, y: this.ship.y, body });
      }
    } else {
      maxThrust = ORBIT_TUNING.maxCorrectionThrust;
      const radialAcceleration = clamp(
        -radialError * 2 - radialSpeed * 4,
        -ORBIT_TUNING.correctionRange,
        ORBIT_TUNING.correctionRange
      );
      const speedAcceleration = clamp((desiredTangentialSpeed - tangentSpeed) * 0.8, -ORBIT_TUNING.correctionRange, ORBIT_TUNING.correctionRange);
      ax = radialX * radialAcceleration + tangentX * speedAcceleration;
      ay = radialY * radialAcceleration + tangentY * speedAcceleration;
      if (speedError < ORBIT_TUNING.captureSpeed && Math.abs(radialError) < ORBIT_TUNING.radialTolerance
        && this.error < ORBIT_TUNING.captureSpeed) {
        this.captureTime += dt;
      } else {
        this.captureTime = 0;
      }
    }

    const magnitude = Math.hypot(ax, ay);
    this.burn = magnitude > ORBIT_TUNING.correctionDeadband ? this.command(ax, ay, maxThrust) : null;
    return this.burn;
  }

  snapshot() {
    if (!this.active) return null;
    const body = this.target;
    const dx = this.ship.x - body.x;
    const dy = this.ship.y - body.y;
    const distance = Math.hypot(dx, dy);
    const radialX = distance > 0 ? dx / distance : 1;
    const radialY = distance > 0 ? dy / distance : 0;
    return {
      body,
      phase: this.phase,
      label: ORBIT_TUNING.phaseLabels[this.phase],
      radius: this.radius,
      direction: this.direction,
      error: this.error || 0,
      distance,
      radialError: distance - this.radius,
      targetX: body.x + radialX * this.radius,
      targetY: body.y + radialY * this.radius,
      desiredVelocity: this.desiredVelocity,
      burn: this.burn,
      time: this.time
    };
  }
}
