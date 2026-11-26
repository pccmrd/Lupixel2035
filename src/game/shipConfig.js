import { TAU, wrap } from '../core/math.js';

export const SHIP_SCALE = Object.freeze({
  length: 76,
  beam: 42,
  hullRadius: 36,
  gearHeight: 25,
  mainThrust: 78,
  rcsThrust: 31,
  torqueThrust: 2.25,
  landing: Object.freeze({
    maxVertical: 2.8,
    maxLateral: 2.4,
    maxAngular: 0.42,
    minAlign: 0.76
  })
});

export const HULL_POINTS = [
  [34, 0], [21, -11], [0, -15], [-23, -12], [-34, -3],
  [-34, 3], [-23, 12], [0, 15], [21, 11]
];

export const GEAR_POINTS = [
  [-18, 23], [0, 25], [18, 23]
];

export function transformShipPoint(ship, ox, oy, px, py) {
  const c = Math.cos(ship.angle);
  const s = Math.sin(ship.angle);
  return { x: ox + px * c - py * s, y: oy + px * s + py * c };
}

export function shipUp(angle) {
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

export function attachShip(ship, body, localX, localY, angle, world) {
  ship.landed = true;
  ship.landedBody = body;
  ship.surfaceAnchor = { x: localX, y: localY, angle };
  ship.angle = wrap((body.rotation || 0) + angle, 0, TAU);
  const velocity = surfaceVelocity(body, localX, localY);
  ship.vx = velocity.x;
  ship.vy = velocity.y;
  ship.omega = body.omega || 0;
  const point = body.localToWorld(localX, localY);
  ship.x = point.x;
  ship.y = point.y;
  ship.prevX = point.x;
  ship.prevY = point.y;
}

export function surfaceVelocity(body, localX, localY) {
  const dx = localX - body.w / 2;
  const dy = localY - body.h / 2;
  const omega = body.omega || 0;
  return {
    x: (body.vx || 0) - dy * omega,
    y: (body.vy || 0) + dx * omega
  };
}
