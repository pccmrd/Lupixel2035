import { TAU, clamp, dot, lerp, norm, wrap } from '../core/math.js';
import {
  GEAR_POINTS,
  HULL_POINTS,
  SHIP_SCALE,
  attachShip,
  shipUp,
  surfaceVelocity,
  transformShipPoint
} from './shipConfig.js';

function gearContacts(ship, world, body = ship.landedBody) {
  const samples = [];
  for (const [px, py] of GEAR_POINTS) {
    const up = shipUp(ship.angle);
    const foot = transformShipPoint(ship, ship.x, ship.y, px, py);
    const probe = transformShipPoint(ship, ship.x, ship.y, px, py - 2);
    const sample = world.sampleMaterial(probe.x, probe.y, true);
    if (!sample || sample.body !== body) continue;
    const supportDistance = dot(foot.x - sample.x, foot.y - sample.y, up.x, up.y);
    if (supportDistance < -2 || supportDistance > 6) continue;
    samples.push({ ...sample, footX: foot.x, footY: foot.y, distance: supportDistance });
  }
  return samples;
}

export function holdSurface(ship, world) {
  const body = ship.landedBody;
  const anchor = ship.surfaceAnchor;
  if (!body || !anchor) return false;

  const point = body.localToWorld(anchor.x, anchor.y);
  ship.angle = wrap((body.rotation || 0) + anchor.angle, 0, TAU);
  const up = shipUp(ship.angle);
  let deepest = 0;
  let supported = false;
  for (const [px, py] of GEAR_POINTS) {
    const probe = transformShipPoint(ship, point.x, point.y, px, py - 1);
    const sample = world.sampleMaterial(probe.x, probe.y, true);
    if (sample?.body !== body) continue;
    supported = true;
    const foot = transformShipPoint(ship, point.x, point.y, px, py);
    const distance = dot(foot.x - sample.x, foot.y - sample.y, up.x, up.y);
    deepest = Math.max(deepest, distance);
  }
  if (!supported || deepest > 6) return false;

  ship.x = point.x;
  ship.y = point.y;
  ship.prevX = point.x;
  ship.prevY = point.y;
  const velocity = surfaceVelocity(body, anchor.x, anchor.y);
  ship.vx = velocity.x;
  ship.vy = velocity.y;
  ship.omega = body.omega || 0;
  ship.contact = true;
  ship.contactBody = body;
  ship.contactNormal = up;
  ship.thrustLevel = 0;
  ship.thrustVector = { x: 0, y: 0 };
  return true;
}

export function releaseSurface(ship, world, reason = 'MANUAL LIFT-OFF') {
  const body = ship.landedBody;
  if (!body) return;
  const velocity = surfaceVelocity(body, ship.surfaceAnchor?.x, ship.surfaceAnchor?.y);
  ship.vx = velocity.x;
  ship.vy = velocity.y;
  ship.landed = false;
  ship.landedBody = null;
  ship.surfaceAnchor = null;
  ship.contact = false;
  ship.touchdownCooldown = 0.35;
  ship.notify(reason, '', { type: 'launch' });
  world?.pushEvent({ type: 'launch', x: ship.x, y: ship.y });
}

export function resolveTerrainCollision(ship, world) {
  if (ship.landed && ship.gear && !ship.requestingLaunch && holdSurface(ship, world)) return true;

  ship.contact = false;
  ship.contactBody = null;
  ship.contactNormal = null;

  const startX = ship.prevX;
  const startY = ship.prevY;
  const endX = ship.x;
  const endY = ship.y;
  const distance = Math.hypot(endX - startX, endY - startY);
  const steps = clamp(Math.ceil(distance / Math.max(2, SHIP_SCALE.gearHeight * 0.25)), 1, 16);
  const points = ship.gear ? HULL_POINTS.concat(GEAR_POINTS) : HULL_POINTS;
  let supportX = 0;
  let supportY = 0;
  let normalX = 0;
  let normalY = 0;
  let contacts = 0;
  let contactBody = null;
  let contactMaterial = null;
  let contactX = 0;
  let contactY = 0;

  outer:
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const ox = lerp(startX, endX, t);
    const oy = lerp(startY, endY, t);
    let subHit = false;
    for (const [px, py] of points) {
      const p = transformShipPoint(ship, ox, oy, px, py);
      const sample = world.sampleMaterial(p.x, p.y, true);
      if (!sample) continue;
      if (!subHit) {
        contactBody = sample.body;
        subHit = true;
      }
      normalX += sample.normal.x;
      normalY += sample.normal.y;
      supportX += sample.x;
      supportY += sample.y;
      contactX += p.x;
      contactY += p.y;
      contactMaterial = sample.material;
      contacts++;
    }
    if (subHit) break outer;
  }

  if (!contacts || !contactBody) return false;

  let n = norm(normalX, normalY, 0, -1);
  const away = norm(ship.x - contactBody.x, ship.y - contactBody.y, 0, -1);
  if (n.l < 0.05) n = away;
  contactX /= contacts;
  contactY /= contacts;
  supportX /= contacts;
  supportY /= contacts;

  const contactOmega = contactBody.omega || 0;
  const impactLocal = contactBody.worldToLocal(contactX, contactY);
  const contactSurface = surfaceVelocity(contactBody, impactLocal.x, impactLocal.y);
  const rvx = ship.vx - contactSurface.x;
  const rvy = ship.vy - contactSurface.y;
  const vn = dot(rvx, rvy, n.x, n.y);
  const impactSpeed = Math.max(0, -vn);
  const preImpactVX = rvx;
  const preImpactVY = rvy;
  const tx = rvx - vn * n.x;
  const ty = rvy - vn * n.y;
  const horizontal = Math.hypot(tx, ty);
  const restitution = ship.gear ? 0.035 : 0.18;
  const friction = ship.gear ? 0.32 : 0.86;

  if (vn < 0) {
    const newVX = tx * friction - vn * restitution * n.x;
    const newVY = ty * friction - vn * restitution * n.y;
    ship.vx = contactSurface.x + newVX;
    ship.vy = contactSurface.y + newVY;
  } else {
    ship.vx = contactSurface.x + tx * friction + vn * n.x;
    ship.vy = contactSurface.y + ty * friction + vn * n.y;
  }

  const up = shipUp(ship.angle);
  const gearFoot = transformShipPoint(ship, ship.x, ship.y, 0, SHIP_SCALE.gearHeight);
  const supportDistance = dot(supportX - gearFoot.x, supportY - gearFoot.y, n.x, n.y);
  const correction = Math.max(0, 1.5 - supportDistance);
  ship.x += n.x * correction;
  ship.y += n.y * correction;
  ship.contact = true;
  ship.contactBody = contactBody;
  ship.contactNormal = n;
  const contactAngularSpeed = ship.omega - contactOmega;
  if (ship.gear) ship.omega -= contactAngularSpeed * 0.32;

  if (impactSpeed > 9 && ship.invulnerable <= 0) {
    const damage = (impactSpeed - 9) * 2.1;
    ship.hull = clamp(ship.hull - damage, 0, 100);
    ship.heat = Math.min(100, ship.heat + damage * 0.22);
    const local = impactLocal;
    contactBody.grindArea(
      local.x,
      local.y,
      (5 + impactSpeed * 0.045) / contactBody.cellScale,
      impactSpeed * 2.4
    );
    world.pushEvent({
      type: 'impact', x: contactX, y: contactY,
      normalX: n.x, normalY: n.y,
      power: impactSpeed, material: contactMaterial, body: contactBody
    });
    ship.notify(`HULL IMPACT ${impactSpeed.toFixed(1)} m/s  -${damage.toFixed(0)}%`, 'bad', { type: 'impact', power: impactSpeed });
  } else if (impactSpeed > 1.2) {
    world.pushEvent({ type: 'contactDust', x: contactX, y: contactY, normalX: n.x, normalY: n.y, power: impactSpeed });
  }

  if (!ship.gear || ship.touchdownCooldown > 0 || ship.landed) return true;

  const landingContacts = gearContacts(ship, world, contactBody);
  if (landingContacts.length < 2) return true;
  const align = dot(up.x, up.y, n.x, n.y);
  const landingVertical = Math.min(impactSpeed, Math.max(0, -dot(preImpactVX, preImpactVY, n.x, n.y)));
  const landingHorizontal = Math.hypot(
    preImpactVX - dot(preImpactVX, preImpactVY, n.x, n.y) * n.x,
    preImpactVY - dot(preImpactVX, preImpactVY, n.x, n.y) * n.y
  );
  const canLand = landingVertical < SHIP_SCALE.landing.maxVertical
    && landingHorizontal < SHIP_SCALE.landing.maxLateral
    && Math.abs(ship.omega) < SHIP_SCALE.landing.maxAngular
    && align > SHIP_SCALE.landing.minAlign;
  if (!canLand) return true;

  const anchorLocal = contactBody.worldToLocal(ship.x, ship.y);
  attachShip(ship, contactBody, anchorLocal.x, anchorLocal.y, ship.angle - (contactBody.rotation || 0), world);
  const velocity = surfaceVelocity(contactBody, anchorLocal.x, anchorLocal.y);
  ship.vx = velocity.x;
  ship.vy = velocity.y;
  ship.omega = contactBody.omega || 0;
  ship.touchdownCooldown = 1.15;
  const quality = clamp(100 - landingVertical * 24 - landingHorizontal * 14 - (1 - align) * 72, 0, 100);
  ship.lastLanding = { body: contactBody, quality, vertical: landingVertical, horizontal: landingHorizontal, align, time: world.time };
  world.pushEvent({ type: 'touchdown', x: ship.x, y: ship.y, body: contactBody, quality, vertical: landingVertical, horizontal: landingHorizontal });
  const label = quality > 86 ? 'PRECISION TOUCHDOWN' : 'SAFE TOUCHDOWN';
  ship.notify(`${label}  ${landingVertical.toFixed(1)} m/s  ${quality.toFixed(0)}%`, 'good', {
    type: 'landing', body: contactBody, quality, vertical: landingVertical, horizontal: landingHorizontal
  });
  return true;
}
