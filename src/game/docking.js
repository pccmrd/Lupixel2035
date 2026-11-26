import { TAU, dot, wrap } from '../core/math.js';
import { attachShip, shipUp, surfaceVelocity } from './shipConfig.js';

const CLAMP_TIME = 0.32;

function slotPose(body, slot) {
  const angle = (body.rotation || 0) + (slot.angle || 0);
  return {
    x: slot.x,
    y: slot.y,
    angle,
    up: shipUp(angle),
    right: { x: Math.cos(angle), y: Math.sin(angle) }
  };
}

function slotError(ship, body, slot) {
  const pose = slotPose(body, slot);
  const point = body.localToWorld(pose.x, pose.y);
  const dx = ship.x - point.x;
  const dy = ship.y - point.y;
  const angleError = Math.abs(wrap(ship.angle - pose.angle + Math.PI, 0, TAU) - Math.PI);
  const velocity = surfaceVelocity(body, pose.x, pose.y);
  const rvx = ship.vx - velocity.x;
  const rvy = ship.vy - velocity.y;
  const normalSpeed = Math.abs(dot(rvx, rvy, pose.up.x, pose.up.y));
  const tangentSpeed = Math.abs(dot(rvx, rvy, pose.right.x, pose.right.y));
  return {
    distance: Math.hypot(dx, dy),
    lateral: Math.abs(dot(dx, dy, pose.right.x, pose.right.y)),
    normal: Math.abs(dot(dx, dy, pose.up.x, pose.up.y)),
    angleError,
    speed: Math.hypot(rvx, rvy),
    normalSpeed,
    tangentSpeed,
    pose,
    point,
    velocity
  };
}

function dockingEligibility(ship, slot, error) {
  if (!ship.gear || ship.landedBody !== slot.body || ship.orbitControl?.active) return false;
  if (slot.body.integrity() < 0.28) return false;
  return error.distance < slot.captureRadius
    && error.lateral < slot.width * 0.34
    && error.normal < 5.5
    && error.angleError < 0.18
    && error.normalSpeed < 1.8
    && error.tangentSpeed < 2.2
    && Math.abs(ship.omega) < 0.35;
}

export class DockingController {
  constructor(world, ship) {
    this.world = world;
    this.ship = ship;
    this.slot = null;
    this.phase = 'released';
    this.timer = 0;
    this.dock = null;
    this.engaged = false;
  }

  slots() {
    const slots = [];
    for (const body of this.world.bodies) {
      if (!body.dock || !body.market || body.integrity() < 0.28) continue;
      slots.push({
        id: `${body.id}:main`,
        body,
        x: body.dock.x,
        y: body.dock.y,
        angle: body.dock.angle || 0,
        width: body.dock.width,
        height: body.dock.height,
        captureRadius: body.dock.captureRadius || Math.max(22, body.dock.width * 0.3)
      });
    }
    return slots;
  }

  nearestSlot() {
    let best = null;
    for (const slot of this.slots()) {
      const error = slotError(this.ship, slot.body, slot);
      if (!best || error.distance < best.error.distance) best = { slot, error };
    }
    return best && best.error.distance < 100 ? best : null;
  }

  beginClamp(slot, error) {
    this.slot = slot;
    this.phase = 'capturing';
    this.timer = CLAMP_TIME;
    this.dock = { body: slot.body, slot, point: error.point, distance: error.distance, speed: error.speed, ready: false };
    this.engaged = false;
    this.ship.notify('PAD CAPTURE · CLAMPS ALIGNING', '', { type: 'dockCapture' });
    this.world.pushEvent({ type: 'dockCapture', x: error.point.x, y: error.point.y, body: slot.body });
  }

  engage(slot) {
    attachShip(this.ship, slot.body, slot.x, slot.y, slot.angle || 0, this.world);
    const velocity = surfaceVelocity(slot.body, slot.x, slot.y);
    this.ship.vx = velocity.x;
    this.ship.vy = velocity.y;
    this.ship.omega = slot.body.omega || 0;
    this.engaged = true;
    this.phase = 'clamped';
    this.timer = 0;
    const point = slot.body.localToWorld(slot.x, slot.y);
    this.dock = { body: slot.body, slot, point, distance: 0, speed: 0, ready: true };
    this.ship.lastLanding = {
      body: slot.body, quality: 100, vertical: 0, horizontal: 0, align: 1, time: this.world.time
    };
    this.ship.notify(`CLAMPS SECURED · ${slot.body.name} · T TO TRADE`, 'good', { type: 'docked' });
    this.world.pushEvent({ type: 'docked', x: point.x, y: point.y, body: slot.body });
  }

  release(reason = 'CLAMPS RELEASED') {
    if (!this.slot) return;
    const slot = this.slot;
    this.slot = null;
    this.dock = null;
    this.engaged = false;
    this.phase = 'released';
    this.timer = 0;
    if (this.ship.landedBody === slot.body) {
      const velocity = surfaceVelocity(slot.body, this.ship.surfaceAnchor?.x, this.ship.surfaceAnchor?.y);
      this.ship.vx = velocity.x;
      this.ship.vy = velocity.y;
      this.ship.landed = false;
      this.ship.landedBody = null;
      this.ship.surfaceAnchor = null;
      this.ship.touchdownCooldown = 1;
      this.ship.requestingLaunch = true;
    }
    this.ship.notify(reason, '', { type: 'undock' });
    this.world.pushEvent({ type: 'undock', x: this.ship.x, y: this.ship.y });
  }

  update(dt) {
    if (this.phase === 'clamped') {
      const { body } = this.slot;
      const slot = this.slot;
      attachShip(this.ship, body, slot.x, slot.y, slot.angle || 0, this.world);
      this.ship.contact = true;
      this.ship.contactBody = body;
      this.ship.contactNormal = shipUp(this.ship.angle);
      const point = body.localToWorld(slot.x, slot.y);
      this.dock.point = point;
      this.dock.distance = 0;
      this.dock.speed = 0;
      return this.dock;
    }

    if (this.phase === 'capturing') {
      this.timer -= dt;
      const error = slotError(this.ship, this.slot.body, this.slot);
      this.dock = { body: this.slot.body, slot: this.slot, point: error.point, distance: error.distance, speed: error.speed, ready: false };
      if (error.distance > this.slot.captureRadius * 1.5 || !this.ship.landed) {
        this.release('PAD CAPTURE LOST');
      } else if (this.timer <= 0) {
        this.engage(this.slot);
      }
      return this.dock;
    }

    if (this.ship.orbitControl?.active) return null;
    const nearest = this.nearestSlot();
    if (!nearest) return null;
    const { slot, error } = nearest;
    this.dock = { body: slot.body, slot, point: error.point, distance: error.distance, speed: error.speed, ready: false };
    if (dockingEligibility(this.ship, slot, error)) this.beginClamp(slot, error);
    return this.dock;
  }
}
