import { TAU, clamp, norm } from '../core/math.js';
import { Rng, angularNoise, craterField, fbm, hash2, ridged } from '../core/rng.js';
import { MAT, isSolid } from './materials.js';
import { PixelBody } from './pixelBody.js';
import { SHIP_SCALE } from '../game/shipConfig.js';

function paintRect(body, x0, y0, x1, y1, material, options = {}) {
  const ax = Math.min(x0, x1);
  const bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1);
  const by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) body.put(x, y, material, options);
  }
}

function paintBlock(body, x, y, size, material, options = {}) {
  const r = Math.floor(size / 2);
  paintRect(body, Math.round(x) - r, Math.round(y) - r, Math.round(x) + r, Math.round(y) + r, material, options);
}

function paintLine(body, x0, y0, x1, y1, material, thickness = 1, options = {}) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    if (thickness <= 1) body.put(x, y, material, options);
    else paintBlock(body, x, y, thickness, material, options);
  }
}

function anchorCore(body, radius) {
  const cx = body.w / 2;
  const cy = body.h / 2;
  const r = Math.ceil(radius);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      const i = body.index(x, y);
      if (i >= 0 && isSolid(body.mat[i])) body.anchors.push(i);
    }
  }
}

function buildMoonOutpost(body) {
  const cx = body.w / 2;
  const cy = body.h / 2;
  const dockY = Math.round(cy - body.radius - 5);

  paintRect(body, cx - 46, dockY, cx + 46, dockY + 5, MAT.METAL);
  paintRect(body, cx - 42, dockY + 1, cx + 42, dockY + 3, MAT.SLAG);
  for (let x = cx - 40; x <= cx + 40; x += 10) body.put(x, dockY - 1, MAT.LAMP);

  // A compact exchange tower is offset from the clear landing lane.
  paintRect(body, cx + 27, dockY - 10, cx + 43, dockY - 1, MAT.METAL);
  paintRect(body, cx + 30, dockY - 8, cx + 40, dockY - 4, MAT.GLASS);
  paintRect(body, cx + 31, dockY - 3, cx + 39, dockY - 2, MAT.LAMP);
  paintRect(body, cx - 41, dockY - 5, cx - 34, dockY - 1, MAT.METAL);
  body.put(cx - 38, dockY - 4, MAT.LAMP);

  // Struts visually tie the platform to the regolith and act as structural anchors.
  for (const sx of [cx - 34, cx - 18, cx + 18, cx + 34]) {
    paintRect(body, sx - 1, dockY + 5, sx + 1, dockY + 22, MAT.METAL);
  }
  for (let x = cx - 44; x <= cx + 44; x += 4) {
    const i = body.index(x, dockY + 2);
    if (i >= 0) body.anchors.push(i);
  }
  for (let y = dockY - 10; y < dockY; y++) {
    const i = body.index(cx + 35, y);
    if (i >= 0) body.anchors.push(i);
  }

  body.dock = { x: cx, y: dockY - SHIP_SCALE.gearHeight, width: 76, height: 16, captureRadius: 24 };
}

function generateMoon(body) {
  const rng = new Rng(body.seed ^ 0x51ce1e);
  const craters = Array.from({ length: 9 }, () => ({
    angle: rng.range(0, TAU),
    width: rng.range(0.10, 0.27),
    depth: rng.range(0.035, 0.11),
    rim: rng.range(0.015, 0.045)
  }));
  const cx = body.w / 2;
  const cy = body.h / 2;
  const R = body.radius;

  const edgeAt = (angle) => clamp(
    0.93 + (angularNoise(angle, body.seed + 11, 2.1, 3) - 0.5) * 0.13
      + (angularNoise(angle, body.seed + 31, 6.4, 3) - 0.5) * 0.065
      + craterField(angle, craters),
    0.79,
    1.04
  );

  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const nx = (x + 0.5 - cx) / R;
      const ny = (y + 0.5 - cy) / R;
      const r = Math.hypot(nx, ny);
      const angle = Math.atan2(ny, nx);
      const edge = edgeAt(angle);
      if (r > edge) continue;
      const depth = (edge - r) * R;

      if (r < 0.105) {
        body.put(x, y, MAT.CORE, { heat: 14 });
        continue;
      }

      const strata = fbm(x * 0.018 - 12, y * 0.018 + 19, body.seed + 131, 3);
      if (depth < 4 + strata * 5) {
        body.put(x, y, MAT.REGOLITH, { heat: 8 });
        continue;
      }
      const cave = depth < 105 ? fbm(x * 0.031 + 4.2, y * 0.031 - 7.1, body.seed + 101, 3) : -1;
      if (cave > 0.685 && depth > 18) {
        if (hash2(x, y, body.seed + 401) > 0.985) body.put(x, y, MAT.REGOLITH, { heat: 10 });
        else if (ny > 0.18 && hash2(x, y, body.seed + 419) > 0.963) body.put(x, y, MAT.WATER, { heat: 8 });
        continue;
      }

      const vein = depth > 14 ? ridged(x * 0.028 + 7, y * 0.028 - 3, body.seed + 173, 3) : -1;
      const mag = depth > 26 ? fbm(x * 0.021 - 21, y * 0.021 + 8, body.seed + 211, 3) : -1;
      const ice = ((ny < -0.24 && depth < 55) || (depth > 30 && cave < 0.62))
        ? fbm(x * 0.026 + 31, y * 0.026 + 15, body.seed + 257, 3) : -1;
      if (vein > 0.79) {
        body.put(x, y, MAT.ORE);
      } else if (mag > 0.735 && depth > 26) {
        body.put(x, y, MAT.MAGNETITE);
      } else if (ny < -0.24 && ice > 0.70 && depth < 55) {
        body.put(x, y, MAT.ICE);
      } else if (ice > 0.79 && depth > 30 && cave < 0.62) {
        body.put(x, y, MAT.WATER);
      } else if (strata > 0.76 && depth > 55) {
        body.put(x, y, MAT.SLAG);
      } else {
        body.put(x, y, MAT.ROCK);
      }
    }
  }

  buildMoonOutpost(body);
  anchorCore(body, Math.min(22, R * 0.16));
}

function generateAsteroid(body) {
  const cx = body.w / 2;
  const cy = body.h / 2;
  const R = body.radius;
  const variant = body.type === 'cinder' ? 1.13 : 1;
  const edgeAt = (angle) => clamp(
    0.77
      + (angularNoise(angle, body.seed + 17, 3.1, 5) - 0.5) * 0.34
      + (angularNoise(angle, body.seed + 47, 8.0, 3) - 0.5) * 0.12
      + Math.sin(angle * 5 + (body.seed % 17)) * 0.045,
    0.52,
    1.08
  );

  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const nx = (x + 0.5 - cx) / (R * 0.92);
      const ny = (y + 0.5 - cy) / (R * 1.03);
      const r = Math.hypot(nx, ny);
      const angle = Math.atan2(ny, nx);
      const edge = edgeAt(angle);
      if (r > edge) continue;
      const depth = (edge - r) * R;
      const cave = fbm(x * 0.046 + 2, y * 0.046 - 6, body.seed + 307, 3);
      const vein = ridged(x * 0.035 - 11, y * 0.035 + 4, body.seed + 353, 3);
      const mag = fbm(x * 0.031 + 17, y * 0.031 + 23, body.seed + 397, 3);
      const ice = fbm(x * 0.037 - 19, y * 0.037 - 5, body.seed + 433, 3);
      const geode = r < 0.22 + (cave - 0.5) * 0.09;

      if (geode) {
        if (r > 0.16 && vein > 0.61) body.put(x, y, MAT.EXOTIC);
        else if (cave > 0.70) body.put(x, y, MAT.ORE_DUST);
        continue;
      }
      if (cave > 0.69 && depth > 10) {
        if (hash2(x, y, body.seed + 503) > 0.975) body.put(x, y, MAT.REGOLITH);
        else if (hash2(x, y, body.seed + 521) > 0.987) body.put(x, y, MAT.MAGNET_DUST);
        continue;
      }
      if (depth < 3) {
        body.put(x, y, hash2(x, y, body.seed + 541) > 0.6 ? MAT.REGOLITH : MAT.SLAG);
      } else if (vein > (0.755 / variant) && depth > 8) {
        body.put(x, y, MAT.ORE);
      } else if (mag > 0.725 && depth > 12) {
        body.put(x, y, MAT.MAGNETITE);
      } else if (ice > 0.765 && ny < 0) {
        body.put(x, y, MAT.ICE);
      } else if (variant > 1 && cave > 0.62 && depth > 20 && hash2(x, y, body.seed + 577) > 0.92) {
        body.put(x, y, MAT.MOLTEN_ROCK, { heat: 180 });
      } else {
        body.put(x, y, MAT.ROCK);
      }
    }
  }

  // A thin dense shell around the geode gives the flood-fill structure solver a stable root.
  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > R * 0.235 && d < R * 0.275) body.put(x, y, MAT.CORE, { heat: 12 });
    }
  }
  anchorCore(body, R * 0.29);
}

function generateComet(body, config) {
  const cx = body.w / 2;
  const cy = body.h / 2;
  const R = body.radius;
  const edgeAt = (angle) => clamp(
    0.90
      + (angularNoise(angle, body.seed + 61, 2.6, 3) - 0.5) * 0.22
      + (angularNoise(angle, body.seed + 89, 7.5, 3) - 0.5) * 0.12,
    0.72,
    1.07
  );

  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const nx = (x + 0.5 - cx) / (R * 0.86);
      const ny = (y + 0.5 - cy) / (R * 1.08);
      const r = Math.hypot(nx, ny);
      const angle = Math.atan2(ny, nx);
      const edge = edgeAt(angle);
      if (r > edge) continue;
      const depth = (edge - r) * R;
      const crust = fbm(x * 0.042 + 6, y * 0.042 - 9, body.seed + 601, 3);
      const volatile = fbm(x * 0.029 - 15, y * 0.029 + 24, body.seed + 641, 3);
      const voids = fbm(x * 0.055 + 12, y * 0.055 + 4, body.seed + 677, 3);
      const crystal = ridged(x * 0.032 - 3, y * 0.032 - 12, body.seed + 701, 3);

      if (r < 0.075) {
        body.put(x, y, MAT.EXOTIC, { heat: 10 });
        continue;
      }
      if (volatile > 0.71 && depth > 8 && voids > 0.54) {
        if (hash2(x, y, body.seed + 733) > 0.84) body.put(x, y, MAT.FUEL, { heat: 12 });
        else body.put(x, y, MAT.WATER, { heat: 8 });
        continue;
      }
      if (voids > 0.73 && depth > 10) {
        if (hash2(x, y, body.seed + 751) > 0.965) body.put(x, y, MAT.STEAM, { heat: 65 });
        continue;
      }
      if (crystal > 0.84 && depth > 14) {
        body.put(x, y, MAT.EXOTIC);
      } else if (depth < 5 + crust * 7) {
        body.put(x, y, crust > 0.57 ? MAT.ICE_DUST : MAT.ICE, { heat: 8 });
      } else if (crust > 0.69) {
        body.put(x, y, MAT.ROCK);
      } else {
        body.put(x, y, MAT.ICE);
      }
    }
  }

  const tail = norm(config.tailDirection?.x ?? 0.93, config.tailDirection?.y ?? 0.36, 0.93, 0.36);
  const sunward = Math.atan2(-tail.y, -tail.x);
  const rng = new Rng(body.seed ^ 0xc0ffee);
  for (let k = 0; k < 10; k++) {
    const angle = sunward + rng.range(-0.62, 0.62);
    const edge = edgeAt(angle);
    const rr = R * edge * rng.range(0.87, 0.98);
    body.jetSources.push({ x: cx + Math.cos(angle) * rr * 0.86, y: cy + Math.sin(angle) * rr * 1.08 });
  }
  anchorCore(body, R * 0.11);
}

function generateStation(body, config) {
  const cx = body.w / 2;
  const cy = body.h / 2;
  const R = body.radius;
  const ringR = R * 0.78;
  const ringThick = Math.max(3, R * 0.032);
  const hubR = R * 0.33;
  const hubWall = Math.max(3, R * 0.035);
  const dockY = Math.round(cy - R + 7);
  const foundry = config.variant === 'foundry';

  for (let y = 0; y < body.h; y++) {
    for (let x = 0; x < body.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);

      // Central pressure hub: a hollow, gridded, destructible shell.
      if (r < hubR) {
        if (r > hubR - hubWall) {
          const window = Math.abs(Math.sin(a * 4)) > 0.72 && hash2(x >> 1, y >> 1, body.seed + 811) > 0.45;
          body.put(x, y, window ? MAT.GLASS : MAT.METAL);
        } else if (Math.abs((dy % (R * 0.13)) | 0) < 1 && Math.abs(dx) < hubR * 0.8) {
          body.put(x, y, MAT.SLAG);
        } else if (foundry && dy > hubR * 0.25 && Math.abs(dx) < hubR * 0.42 && hash2(x, y, body.seed + 829) > 0.72) {
          body.put(x, y, MAT.MOLTEN_METAL, { heat: 205 });
        }
      }

      // Outer ring and corridor.
      if (Math.abs(r - ringR) < ringThick) {
        const window = Math.abs(Math.sin(a * 8)) > 0.78 && r < ringR;
        body.put(x, y, window ? MAT.GLASS : MAT.METAL);
      }

      // Four radial spokes join the hub, ring, and docking spine.
      for (let s = 0; s < 4; s++) {
        const sa = s * Math.PI / 2;
        const along = dx * Math.cos(sa) + dy * Math.sin(sa);
        const across = -dx * Math.sin(sa) + dy * Math.cos(sa);
        if (along > hubR && along < ringR && Math.abs(across) < ringThick + 1 && Math.abs(across) > 1.2) {
          body.put(x, y, MAT.METAL);
        }
      }
    }
  }

  // Docking platform and a central spine down into the hub. No structure blocks the landing lane.
  paintRect(body, cx - 48, dockY, cx + 48, dockY + 6, MAT.METAL);
  paintRect(body, cx - 44, dockY + 1, cx + 44, dockY + 3, MAT.SLAG);
  for (let x = cx - 40; x <= cx + 40; x += 10) body.put(x, dockY - 1, MAT.LAMP);
  for (let y = dockY + 6; y < cy - hubR + 3; y++) {
    body.put(cx - 8, y, MAT.METAL);
    body.put(cx + 8, y, MAT.METAL);
    if (y % 9 === 0) paintRect(body, cx - 8, y, cx + 8, y, MAT.SLAG);
  }

  // Solar wings: brittle glass cells in destructible metal frames.
  const panelW = R * 0.43;
  const panelH = R * 0.25;
  for (const side of [-1, 1]) {
    const near = cx + side * (ringR + 8);
    const far = near + side * panelW;
    const x0 = Math.round(Math.min(near, far));
    const x1 = Math.round(Math.max(near, far));
    const y0 = Math.round(cy - panelH / 2);
    const y1 = Math.round(cy + panelH / 2);
    paintLine(body, cx + side * (ringR - 3), cy, near, cy, MAT.METAL, 2);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1 || Math.abs((x - x0) % 11) < 1;
        body.put(x, y, edge ? MAT.METAL : MAT.GLASS);
      }
    }
  }

  // Electromagnet nodes and navigation lamps create material-scale magnetic fields.
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + Math.PI / 8;
    const mx = cx + Math.cos(a) * ringR;
    const my = cy + Math.sin(a) * ringR;
    paintBlock(body, mx, my, 3, MAT.MAGNET_BLOCK);
  }
  for (let k = 0; k < 16; k++) {
    const a = k * TAU / 16;
    body.put(Math.round(cx + Math.cos(a) * (ringR + ringThick + 2)), Math.round(cy + Math.sin(a) * (ringR + ringThick + 2)), MAT.LAMP);
  }
  if (foundry) {
    paintRect(body, cx - 18, cy + hubR * 0.45, cx + 18, cy + hubR * 0.52, MAT.MOLTEN_METAL, { heat: 220 });
    paintRect(body, cx - 21, cy + hubR * 0.42, cx + 21, cy + hubR * 0.43, MAT.METAL);
  }

  body.dock = { x: cx, y: dockY - SHIP_SCALE.gearHeight, width: 88, height: 16, captureRadius: 28 };
  body.structural = false;
}

const SITE_TYPES = [
  { type: 'derelict', name: 'WRECKED TRANSIT VESSEL', materials: [MAT.METAL, MAT.SLAG, MAT.LAMP], reward: MAT.ALLOY, count: 26, credits: 420 },
  { type: 'biome', name: 'SUBSURFACE CRYPTIC BIOME', materials: [MAT.EXOTIC, MAT.WATER, MAT.ICE], reward: MAT.EXOTIC, count: 18, credits: 650 },
  { type: 'mineral', name: 'CONCENTRATED ORE CHAMBER', materials: [MAT.ORE, MAT.MAGNETITE, MAT.CORE], reward: MAT.ORE, count: 34, credits: 280 },
  { type: 'substance', name: 'VOLATILE DEPOSIT', materials: [MAT.FUEL, MAT.WATER, MAT.STEAM], reward: MAT.FUEL, count: 28, credits: 360 }
];

function populateSites(body) {
  const candidates = [];
  for (let y = 22; y < body.h - 22; y += 17) {
    for (let x = 22; x < body.w - 22; x += 17) {
      if (body.cellAt(x, y) !== MAT.VACUUM) continue;
      const d = Math.hypot(x - body.w / 2, y - body.h / 2);
      if (d > body.radius * 0.8 || d < 24) continue;
      let walls = 0;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          if (Math.abs(ox) + Math.abs(oy) < 2) continue;
          if (isSolid(body.cellAt(x + ox, y + oy))) walls++;
        }
      }
      if (walls >= 9) candidates.push({ x, y, d });
    }
  }
  const limit = Math.min(4, Math.max(2, Math.floor(body.radius / 55)));
  for (let k = 0; k < limit && candidates.length; k++) {
    const pick = Math.floor(body.rand() * candidates.length);
    const cell = candidates.splice(pick, 1)[0];
    const template = SITE_TYPES[(k + body.seed) % SITE_TYPES.length];
    for (let oy = -7; oy <= 7; oy++) {
      for (let ox = -7; ox <= 7; ox++) {
        if (Math.hypot(ox, oy) > 7) continue;
        body.clearCell(body.index(cell.x + ox, cell.y + oy), false);
      }
    }
    for (let n = 0; n < template.count; n++) {
      const a = body.rand() * TAU;
      const r = 4 + body.rand() * 3;
      const material = template.materials[n % template.materials.length];
      body.put(cell.x + Math.round(Math.cos(a) * r), cell.y + Math.round(Math.sin(a) * r), material, material === MAT.LAMP ? { heat: 90 } : undefined);
    }
    body.sites.push({
      id: `${body.id}-site-${k + 1}`,
      type: template.type,
      name: template.name,
      x: cell.x,
      y: cell.y,
      reward: template.reward,
      count: template.count,
      credits: template.credits,
      scanned: body.catalogued,
      visited: false
    });
  }
}

export function createBody(config) {
  return new PixelBody(config);
}

export function materializeBody(body) {
  if (body.generated) return body;
  body.beginDenseGeneration();
  try {
    switch (body.type) {
      case 'moon':
        generateMoon(body);
        break;
      case 'comet':
        generateComet(body, { tailDirection: body.tailDirection });
        break;
      case 'station':
        generateStation(body, { variant: body.variant });
        break;
      default:
        generateAsteroid(body);
        break;
    }
    populateSites(body);
  } finally {
    body.endDenseGeneration();
  }
  body.finishGeneration();
  return body;
}

export function generateBody(config) {
  return materializeBody(createBody(config));
}
