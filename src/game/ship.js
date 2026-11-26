import { TAU, clamp, dot, lerp, norm, wrap } from '../core/math.js';
import { cargoForMaterial } from '../world/materials.js';
import { holdSurface, releaseSurface, resolveTerrainCollision } from './physics.js';
import { SHIP_SCALE, attachShip } from './shipConfig.js';

export class Ship {
  constructor(world) {
    this.world = world;
    this.name = 'PEREGRINE';
    this.x = 0;
    this.y = -420;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 44;
    this.vy = 0;
    this.angle = 0;
    this.omega = 0;
    this.radius = SHIP_SCALE.hullRadius;
    this.surfaceAnchor = null;

    this.hull = 100;
    this.fuel = 100;
    this.energy = 100;
    this.heat = 0;
    this.credits = 850;
    this.capacity = 100;
    this.magnetLevel = 0;
    this.scoopRangeBonus = 0;
    this.cargo = Object.create(null);

    this.gear = true;
    this.scoop = false;
    this.tool = 'grinder';
    this.landed = false;
    this.landedBody = null;
    this.requestingLaunch = false;
    this.contact = false;
    this.contactBody = null;
    this.contactNormal = null;
    this.docked = null;
    this.invulnerable = 1.6;
    this.touchdownCooldown = 0;
    this.cargoWarnCooldown = 0;
    this.weaponCooldown = 0;
    this.thrustLevel = 0;
    this.thrustVector = { x: 0, y: 0 };
    this.boosting = false;
    this.metrics = null;
    this.lastLanding = null;
    this.orbitControl = null;
    this.rcsActive = false;
    this.notifications = [];
  }

  notify(text, tone = '', meta = {}) {
    this.notifications.push({ text, tone, ...meta });
    if (this.notifications.length > 32) this.notifications.splice(0, this.notifications.length - 32);
  }

  takeNotifications() {
    if (!this.notifications.length) return [];
    const out = this.notifications;
    this.notifications = [];
    return out;
  }

  forwardVector() {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  rightVector() {
    return { x: -Math.sin(this.angle), y: Math.cos(this.angle) };
  }

  upVector() {
    return { x: Math.sin(this.angle), y: -Math.cos(this.angle) };
  }

  cargoUsed() {
    let total = 0;
    for (const value of Object.values(this.cargo)) total += value;
    return total;
  }

  addCargo(commodity, units) {
    if (!commodity || units <= 0) return false;
    const remaining = this.capacity - this.cargoUsed();
    if (remaining <= 0.001) {
      if (this.cargoWarnCooldown <= 0) {
        this.notify('CARGO HOLD FULL — SELL OR JETTISON', 'warn', { type: 'cargoFull' });
        this.cargoWarnCooldown = 2.2;
      }
      return false;
    }
    const accepted = Math.min(units, remaining);
    this.cargo[commodity] = (this.cargo[commodity] || 0) + accepted;
    return true;
  }

  addMaterial(material) {
    const cargo = cargoForMaterial(material);
    if (!cargo) return false;
    return this.addCargo(cargo.commodity, cargo.units);
  }

  sellCargo(commodity, price) {
    const units = this.cargo[commodity] || 0;
    if (units <= 0) return null;
    const revenue = Math.max(1, Math.floor(units * price));
    this.cargo[commodity] = 0;
    this.credits += revenue;
    return { units, revenue };
  }

  jettison(commodity) {
    const units = this.cargo[commodity] || 0;
    if (units <= 0) return 0;
    this.cargo[commodity] = 0;
    return units;
  }

  spendCredits(amount) {
    if (this.credits < amount) return false;
    this.credits -= amount;
    return true;
  }

  refuel(amount = 100) {
    const before = this.fuel;
    this.fuel = clamp(this.fuel + amount, 0, 100);
    return this.fuel - before;
  }

  repair(amount = 100) {
    const before = this.hull;
    this.hull = clamp(this.hull + amount, 0, 100);
    this.heat = Math.max(0, this.heat - 30);
    return this.hull - before;
  }

  consumeEnergy(amount) {
    if (this.energy < amount) return false;
    this.energy -= amount;
    return true;
  }

  damage(amount, reason, world = this.world) {
    if (this.invulnerable > 0 || amount <= 0) return;
    this.hull = clamp(this.hull - amount, 0, 100);
    this.heat = clamp(this.heat + amount * 0.18, 0, 100);
    this.notify(`${reason.toUpperCase()}  -${amount.toFixed(0)}% HULL`, 'bad', { type: 'damage', reason });
    world?.pushEvent({ type: 'shipDamage', x: this.x, y: this.y, amount, reason });
  }

  respawnAt(body) {
    const p = body.localToWorld(body.dock.x, body.dock.y);
    this.x = p.x;
    this.y = p.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = body.vx || 0;
    this.vy = body.vy || 0;
    this.angle = 0;
    this.omega = 0;
    this.hull = 72;
    this.fuel = 80;
    this.energy = 100;
    this.heat = 0;
    this.invulnerable = 2.4;
    this.gear = true;
    this.scoop = false;
    const dock = body.dock;
    const localX = dock?.x ?? body.w / 2;
    const localY = dock?.y ?? Math.max(1, body.h / 2 - body.radius);
    const localAngle = -Math.atan2(localY - body.h / 2, localX - body.w / 2) - Math.PI / 2;
    attachShip(this, body, localX, localY, localAngle, this.world);
    this.contact = true;
    this.notify(`RECONSTRUCTED AT ${body.name}`, 'warn', { type: 'respawn', body });
  }

  update(dt, input, world) {
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.landed && this.landedBody && this.gear && !this.requestingLaunch) {
      this.angle = wrap((this.landedBody.rotation || 0) + this.surfaceAnchor.angle, 0, TAU);
    }
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.touchdownCooldown = Math.max(0, this.touchdownCooldown - dt);
    this.cargoWarnCooldown = Math.max(0, this.cargoWarnCooldown - dt);
    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.heat = Math.max(0, this.heat - 8.5 * dt);
    if (this.heat > 82) this.hull = clamp(this.hull - (this.heat - 82) * 0.11 * dt, 0, 100);

    if (this.scoop) {
      this.energy = Math.max(0, this.energy - 4.2 * dt);
      if (this.energy <= 0) {
        this.scoop = false;
        this.notify('SCOOP OFFLINE — ENERGY DEPLETED', 'warn', { type: 'energy' });
      }
    } else {
      this.energy = clamp(this.energy + 6.5 * dt, 0, 100);
    }

    const forward = (input.anyDown('KeyW', 'ArrowUp') ? 1 : 0) - (input.anyDown('KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (input.anyDown('KeyE') ? 1 : 0) - (input.anyDown('KeyQ') ? 1 : 0);
    const torque = (input.anyDown('KeyD', 'ArrowRight') ? 1 : 0) - (input.anyDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const boost = input.anyDown('ShiftLeft', 'ShiftRight') ? 1.8 : 1;
    const stabilizer = input.anyDown('KeyX');
    const manualIntent = Math.abs(forward) + Math.abs(strafe) + Math.abs(torque) > 0 || !this.gear;
    const launchIntent = manualIntent || Boolean(this.orbitControl?.burn) || this.requestingLaunch;
    this.requestingLaunch = false;

    if (this.docking?.engaged && !launchIntent) {
      this.rcsActive = false;
      this.thrustLevel = lerp(this.thrustLevel, 0, Math.min(1, dt * 8));
      this.thrustVector = { x: 0, y: 0 };
      this.contact = true;
      this.contactBody = this.docking.dock?.body || this.landedBody;
      this.contactNormal = this.upVector();
      this.updateMetrics(world);
      return;
    }

    if (this.landed && this.landedBody && this.gear && !launchIntent) {
      this.rcsActive = false;
      this.thrustLevel = lerp(this.thrustLevel, 0, Math.min(1, dt * 8));
      this.thrustVector = { x: 0, y: 0 };
      if (!holdSurface(this, world)) releaseSurface(this, world, 'SURFACE SUPPORT LOST');
      this.updateMetrics(world);
      return;
    }

    if (this.landed && launchIntent) {
      if (this.docking?.engaged) this.docking.release();
      else releaseSurface(this, world);
      this.requestingLaunch = true;
    }

    this.rcsActive = Boolean(this.orbitControl?.burn);
    let ax = 0;
    let ay = 0;
    const f = this.forwardVector();
    const r = this.rightVector();
    const mainPower = SHIP_SCALE.mainThrust * boost;
    if ((forward || strafe) && this.fuel > 0) {
      ax = (f.x * forward + r.x * strafe) * mainPower;
      ay = (f.y * forward + r.y * strafe) * mainPower;
      const consumption = (Math.abs(forward) * 1.35 + Math.abs(strafe) * 0.78) * boost * dt;
      this.fuel = Math.max(0, this.fuel - consumption);
      const thrustScale = this.fuel > 0 ? 1 : 0;
      ax *= thrustScale;
      ay *= thrustScale;
      const exhaustX = this.x - f.x * SHIP_SCALE.length * 0.47 * Math.sign(forward || 1) - r.x * 12 * Math.sign(strafe || 0);
      const exhaustY = this.y - f.y * SHIP_SCALE.length * 0.47 * Math.sign(forward || 1) - r.y * 12 * Math.sign(strafe || 0);
      world.pushEvent({
        type: 'thrust', x: exhaustX, y: exhaustY,
        vx: -ax * 0.22, vy: -ay * 0.22,
        strength: Math.min(1, Math.hypot(ax, ay) / mainPower), boost: boost > 1,
        directionX: f.x * Math.sign(forward || 1) + r.x * Math.sign(strafe || 0),
        directionY: f.y * Math.sign(forward || 1) + r.y * Math.sign(strafe || 0),
        rcs: false
      });
    }

    if (this.orbitControl?.burn && this.fuel > 0) {
      const burn = this.orbitControl.burn;
      const availableThrust = Math.min(1, this.fuel / Math.max(1e-8, burn.cost * dt));
      ax += burn.x * burn.magnitude * availableThrust;
      ay += burn.y * burn.magnitude * availableThrust;
      this.fuel = Math.max(0, this.fuel - burn.cost * dt);
      const direction = norm(burn.x, burn.y, 1, 0);
      world.pushEvent({
        type: 'thrust', x: this.x - direction.x * SHIP_SCALE.length * 0.3, y: this.y - direction.y * SHIP_SCALE.length * 0.3,
        vx: -burn.x * 8, vy: -burn.y * 8,
        strength: burn.throttle * availableThrust || 1, boost: false, rcs: true,
        directionX: direction.x, directionY: direction.y
      });
    }

    if (torque && this.fuel > 0) {
      const availableThrust = this.fuel > 0.22 * dt ? 1 : 0;
      this.omega += torque * SHIP_SCALE.torqueThrust * dt * availableThrust;
      this.fuel = Math.max(0, this.fuel - 0.22 * dt);
    }
    if (stabilizer && this.energy > 0) {
      this.omega *= Math.max(0, 1 - 4.2 * dt);
      this.energy = Math.max(0, this.energy - 1.1 * dt);
    }

    const gravity = world.gravityAt(this.x, this.y);
    this.gravity = gravity;
    this.vx += (gravity.x + ax) * dt;
    this.vy += (gravity.y + ay) * dt;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 850) {
      this.vx *= 850 / speed;
      this.vy *= 850 / speed;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = wrap(this.angle + this.omega * dt, 0, TAU);

    const totalThrust = Math.hypot(ax, ay);
    this.thrustLevel = lerp(this.thrustLevel, Math.min(1, totalThrust / SHIP_SCALE.mainThrust), Math.min(1, dt * 10));
    this.thrustVector = { x: ax, y: ay };
    this.boosting = boost > 1 && (forward || strafe) !== 0;

    resolveTerrainCollision(this, world);
    this.updateMetrics(world);
  }

  updateMetrics(world) {
    const nav = world.nearestBody(this.x, this.y);
    if (!nav.body) return;
    const body = nav.body;
    const toward = norm(body.x - this.x, body.y - this.y, 0, 1);
    const away = { x: -toward.x, y: -toward.y };
    const surfaceNormal = this.contact && this.contactNormal ? this.contactNormal : away;
    const rvx = this.vx - (body.vx || 0);
    const rvy = this.vy - (body.vy || 0);
    const gravitySpeed = dot(rvx, rvy, toward.x, toward.y);
    const surfaceSpeed = -dot(rvx, rvy, surfaceNormal.x, surfaceNormal.y);
    const tangent = Math.hypot(rvx - gravitySpeed * toward.x, rvy - gravitySpeed * toward.y);
    const up = this.upVector();
    const align = clamp(dot(up.x, up.y, surfaceNormal.x, surfaceNormal.y), -1, 1);
    this.metrics = {
      body,
      altitude: nav.altitude,
      distance: nav.distance,
      speed: Math.hypot(rvx, rvy),
      vertical: this.contact ? surfaceSpeed : gravitySpeed,
      horizontal: tangent,
      align,
      gravity: nav.gravity.magnitude,
      gravityVector: nav.gravity,
      toward,
      away,
      contact: this.contact,
      landed: this.landed,
      docked: Boolean(this.docked?.ready)
    };
  }
}
