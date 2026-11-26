import { TAU, clamp } from '../core/math.js';
import { Rng } from '../core/rng.js';

export const ORBITAL_CONTEXT = Object.freeze({
  year: 2035,
  earthMoonDistanceKm: 384400,
  moonRadiusKm: 1737.4,
  moonMu: 4902.800066,
  worldUnitsPerKm: 230 / 1737.4,
  timeScale: 1100
});

const BUNDLE_NAMES = ['BASALT', 'COBALT', 'DUSK', 'FERROUS', 'GLACIER', 'IRIDIUM', 'KILN', 'LACUNA', 'MICA', 'NACRE', 'OBSIDIAN', 'QUARRY', 'RIME', 'SINTER', 'TUNGSTEN'];
const BUNDLE_SUFFIX = ['VEIN', 'SHARD', 'CORE', 'DRIFT', 'REACH', 'CLUSTER', 'FRAGMENT', 'TRACE'];

function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let eccentricAnomaly = meanAnomaly;
  for (let i = 0; i < 6; i++) {
    eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly)
      / (1 - eccentricity * Math.cos(eccentricAnomaly));
  }
  return eccentricAnomaly;
}

export class OrbitalLayer {
  constructor(seed = 0x51a7) {
    this.seed = seed;
    this.rng = new Rng(seed ^ 0x2035c15);
    this.time = 0;
    this.elements = new Map();
  }

  createElements(options = {}) {
    const radiusKm = options.a || 14000;
    const eccentricity = clamp(options.e ?? this.rng.range(0.015, 0.16), 0, 0.28);
    const inclination = options.inclination ?? this.rng.range(-0.34, 0.34);
    const ascendingNode = options.node ?? this.rng.range(0, TAU);
    const periapsis = options.periapsis ?? this.rng.range(0, TAU);
    const meanAnomaly = options.meanAnomaly ?? this.rng.range(0, TAU);
    const meanMotion = Math.sqrt(ORBITAL_CONTEXT.moonMu / Math.pow(radiusKm, 3))
      * ORBITAL_CONTEXT.timeScale;
    return {
      a: radiusKm,
      e: eccentricity,
      inclination,
      node: ascendingNode,
      periapsis,
      meanAnomaly,
      meanMotion,
      direction: options.direction || (this.rng.chance(0.5) ? 1 : -1)
    };
  }

  sample(elements, time = this.time) {
    const meanAnomaly = elements.meanAnomaly + elements.meanMotion * time * elements.direction;
    const eccentricAnomaly = solveEccentricAnomaly(meanAnomaly, elements.e);
    const cosE = Math.cos(eccentricAnomaly);
    const sinE = Math.sin(eccentricAnomaly);
    const root = Math.sqrt(1 - elements.e * elements.e);
    const orbitalX = elements.a * (cosE - elements.e);
    const orbitalY = elements.a * root * sinE;
    const eccentricRate = elements.meanMotion * elements.direction / (1 - elements.e * cosE);
    const velocityX = -elements.a * sinE * eccentricRate;
    const velocityY = elements.a * root * cosE * eccentricRate;

    const cosPeriapsis = Math.cos(elements.periapsis);
    const sinPeriapsis = Math.sin(elements.periapsis);
    const cosNode = Math.cos(elements.node);
    const sinNode = Math.sin(elements.node);
    const cosInclination = Math.cos(elements.inclination);
    const sinInclination = Math.sin(elements.inclination);
    const planeX = orbitalX * cosPeriapsis - orbitalY * sinPeriapsis;
    const planeY = orbitalX * sinPeriapsis + orbitalY * cosPeriapsis;
    const planeVX = velocityX * cosPeriapsis - velocityY * sinPeriapsis;
    const planeVY = velocityX * sinPeriapsis + velocityY * cosPeriapsis;
    const scale = ORBITAL_CONTEXT.worldUnitsPerKm;
    return {
      x: (planeX * cosNode - planeY * cosInclination * sinNode) * scale,
      y: (planeX * sinNode + planeY * cosInclination * cosNode) * scale,
      z: planeY * sinInclination,
      vx: (planeVX * cosNode - planeVY * cosInclination * sinNode) * scale,
      vy: (planeVX * sinNode + planeVY * cosInclination * cosNode) * scale,
      vz: planeVY * sinInclination
    };
  }

  register(body, options = {}) {
    const elements = options.orbital || this.createElements({
      a: Math.hypot(body.x, body.y) / ORBITAL_CONTEXT.worldUnitsPerKm,
      e: 0,
      inclination: 0,
      node: 0,
      periapsis: 0,
      meanAnomaly: Math.atan2(body.y, body.x),
      ...options
    });
    if (!options.orbital && !options.preservePose) {
      elements.meanAnomaly -= elements.meanMotion * this.time * elements.direction;
    }
    this.elements.set(body.id, elements);
    body.orbital = elements;
    const state = this.sample(elements, this.time);
    if (options.preservePose) {
      body.vx = state.vx;
      body.vy = state.vy;
      body.hiddenPosition = { x: body.x / ORBITAL_CONTEXT.worldUnitsPerKm, y: body.y / ORBITAL_CONTEXT.worldUnitsPerKm, z: state.z };
      body.hiddenVelocity = { x: state.vx / ORBITAL_CONTEXT.worldUnitsPerKm, y: state.vy / ORBITAL_CONTEXT.worldUnitsPerKm, z: state.vz };
    } else {
      this.sync(body);
    }
    return elements;
  }

  sync(body, time = this.time) {
    const elements = this.elements.get(body.id);
    if (!elements) return null;
    const state = this.sample(elements, time);
    body.x = state.x;
    body.y = state.y;
    body.vx = state.vx;
    body.vy = state.vy;
    body.hiddenPosition = { x: state.x / ORBITAL_CONTEXT.worldUnitsPerKm, y: state.y / ORBITAL_CONTEXT.worldUnitsPerKm, z: state.z };
    body.hiddenVelocity = { x: state.vx / ORBITAL_CONTEXT.worldUnitsPerKm, y: state.vy / ORBITAL_CONTEXT.worldUnitsPerKm, z: state.vz };
    return state;
  }

  update(dt, bodies) {
    this.time += dt;
    for (const body of bodies) this.sync(body);
  }

  createPopulation(count = 288, options = {}) {
    const configs = [];
    const startIndex = options.startIndex || 0;
    const cataloguedCount = options.cataloguedCount ?? Math.ceil(count * 0.05);
    for (let i = 0; i < count; i++) {
      const serial = startIndex + i;
      const catalogued = i < cataloguedCount;
      const typeRoll = this.rng.next();
      const type = typeRoll < 0.1 ? 'comet' : typeRoll < 0.19 ? 'cinder' : typeRoll < 0.235 ? 'station' : 'asteroid';
      const radius = type === 'station'
        ? this.rng.range(95, 120)
        : this.rng.chance(0.07)
          ? this.rng.range(95, 115)
          : this.rng.chance(0.34)
            ? this.rng.range(75, 95)
            : this.rng.range(65, 75);
      // Keep the haul field in widely separated, near-circular lunar lanes.
      // Its apolune stays inside the Moon's Hill sphere, while the wider radial
      // spread leaves long quiet stretches between active asteroid clusters.
      const elements = this.createElements({
        a: this.rng.range(18000, 52000),
        e: this.rng.range(0.008, 0.035)
      });
      const state = this.sample(elements, 0);
      const designation = String(serial + 1).padStart(4, '0');
      const name = catalogued
        ? `${this.rng.pick(BUNDLE_NAMES)} ${this.rng.pick(BUNDLE_SUFFIX)}`
        : 'UNSURVEYED MASS';
      configs.push({
        id: `bundle-${designation}`,
        designation: `BX-${designation}`,
        name,
        type,
        x: state.x,
        y: state.y,
        w: Math.round(radius * 2.15),
        h: Math.round(radius * 2.05),
        radius,
        g0: clamp(0.5 + radius * 0.007, 0.65, 4.2),
        seed: this.rng.int(1, 0xffffffff),
        glow: type === 'comet' ? '#8beaff' : type === 'cinder' ? '#ff9366' : type === 'station' ? '#a6f7df' : '#d5c39b',
        structural: type !== 'station',
        catalogued,
        market: type === 'station' && catalogued,
        variant: type === 'station' ? (this.rng.chance(0.5) ? 'ring' : 'foundry') : undefined,
        hue: this.rng.range(0, 1),
        tailDirection: { x: 0.9, y: 0.35 },
        description: catalogued
          ? 'A relocated body in the 2035 cislunar haul corridor.'
          : 'An uncatalogued mass with an unresolved composition signature.',
        orbital: elements
      });
    }
    return configs;
  }
}
