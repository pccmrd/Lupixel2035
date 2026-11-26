import { TAU, clamp, formatDistance, lerp, norm } from '../core/math.js';
import { MAT, info } from '../world/materials.js';
import { GEAR_POINTS, HULL_POINTS, SHIP_SCALE } from '../game/shipConfig.js';
import { Background } from './background.js';

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function createShipSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 36;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(36, 18);

  // A restrained graphite hull keeps the silhouette integrated with the scene;
  // avoid the near-black/navy outer plate that reads as a cutout at game scale.
  ctx.beginPath();
  ctx.moveTo(HULL_POINTS[0][0], HULL_POINTS[0][1]);
  for (let i = 1; i < HULL_POINTS.length; i++) ctx.lineTo(HULL_POINTS[i][0], HULL_POINTS[i][1]);
  ctx.closePath();
  ctx.fillStyle = '#263542';
  ctx.fill();
  ctx.strokeStyle = '#8295a2';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#405a73';
  ctx.beginPath();
  ctx.moveTo(-19, -2); ctx.lineTo(-11, -6); ctx.lineTo(5, -7); ctx.lineTo(17, -4);
  ctx.lineTo(20, 0); ctx.lineTo(17, 4); ctx.lineTo(5, 7); ctx.lineTo(-11, 6); ctx.lineTo(-19, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8aa5b8';
  ctx.fillRect(-15, -4, 25, 1);
  ctx.fillRect(-13, 4, 23, 1);
  ctx.fillRect(-9, -6, 13, 1);
  ctx.fillRect(-9, 6, 13, 1);

  ctx.fillStyle = '#243c53';
  ctx.fillRect(-22, -4, 7, 8);
  ctx.fillRect(-19, -6, 5, 12);
  ctx.fillStyle = '#101d2c';
  ctx.fillRect(-24, -3, 4, 6);
  ctx.fillStyle = '#5b7890';
  ctx.fillRect(-23, -3, 2, 6);
  ctx.fillStyle = '#ffc66d';
  ctx.fillRect(-24, -2, 1, 1);
  ctx.fillRect(-24, 2, 1, 1);

  ctx.fillStyle = '#172b40';
  ctx.fillRect(4, -5, 14, 10);
  ctx.fillStyle = '#62dfff';
  ctx.fillRect(8, -4, 10, 8);
  ctx.fillStyle = '#d7fbff';
  ctx.fillRect(9, -4, 7, 2);
  ctx.fillRect(12, 3, 6, 1);
  ctx.fillStyle = '#173248';
  ctx.fillRect(15, -4, 1, 8);
  ctx.fillStyle = '#ffc66d';
  ctx.fillRect(19, -1, 4, 2);

  ctx.fillStyle = '#738da0';
  ctx.fillRect(-8, -8, 3, 3);
  ctx.fillRect(-8, 5, 3, 3);
  ctx.fillStyle = '#20364a';
  ctx.fillRect(-12, -8, 4, 2);
  ctx.fillRect(-12, 6, 4, 2);
  ctx.fillStyle = '#8ceaff';
  ctx.fillRect(-6, -10, 3, 1);
  ctx.fillRect(-6, 9, 3, 1);
  ctx.fillStyle = '#ff7a45';
  ctx.fillRect(-25, -2, 1, 2);
  ctx.fillRect(-25, 1, 1, 2);
  ctx.fillStyle = '#e7f7ff';
  ctx.fillRect(20, -6, 2, 1);
  ctx.fillRect(20, 5, 2, 1);
  ctx.restore();
  return canvas;
}

function arrow(ctx, x1, y1, x2, y2, color, label) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - Math.cos(a - 0.5) * 5, y2 - Math.sin(a - 0.5) * 5);
  ctx.lineTo(x2 - Math.cos(a + 0.5) * 5, y2 - Math.sin(a + 0.5) * 5);
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = '8px "Courier New", monospace';
    ctx.fillText(label, x2 + 4, y2 - 3);
  }
}

function createBodyProxy(body) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < 64; y += 2) {
    for (let x = 0; x < 64; x += 2) {
      const dx = (x - 31.5) / 29;
      const dy = (y - 31.5) / 27;
      let inside = dx * dx + dy * dy < 1;
      if (body.type === 'station') inside = Math.abs(Math.hypot(dx, dy) - 0.68) < 0.2 || Math.hypot(dx, dy) < 0.28;
      if (!inside) continue;
      let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ body.seed;
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
      const shade = (hash >>> 24) % 4;
      const palette = body.type === 'station'
        ? ['#273e50', '#3f6476', '#69a1ae', '#b4e8e6']
        : body.type === 'cinder'
          ? ['#3b2424', '#65352b', '#955341', '#c27a57']
          : body.type === 'comet'
            ? ['#264453', '#477888', '#7db9c4', '#d2f4ef']
            : ['#2d3037', '#494a48', '#68665e', '#898273'];
      ctx.fillStyle = palette[shade];
      ctx.fillRect(x, y, 2, 2);
    }
  }
  return canvas;
}

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.world = world;
    this.background = new Background();
    this.shipSprite = createShipSprite();
    this.bodyProxies = new Map();
    this.camera = {
      x: 0, y: -360, zoom: 0.24, targetZoom: 0.24,
      manualTimer: 0, shake: 0
    };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const cssW = Math.max(320, window.innerWidth);
    const cssH = Math.max(240, window.innerHeight);
    const W = clamp(Math.round(cssW / 2), 640, 960);
    const H = clamp(Math.round(W * cssH / cssW), 340, 640);
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.background.resize(W, H);
  }

  addShake(amount) {
    this.camera.shake = Math.min(14, this.camera.shake + amount);
  }

  screenToWorld(sx, sy) {
    return {
      x: this.camera.x + (sx - this.canvas.width / 2) / this.camera.zoom,
      y: this.camera.y + (sy - this.canvas.height / 2) / this.camera.zoom
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: this.canvas.width / 2 + (wx - this.camera.x) * this.camera.zoom,
      y: this.canvas.height / 2 + (wy - this.camera.y) * this.camera.zoom
    };
  }

  applyWorldTransform(ctx) {
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  autoZoomFor(ship) {
    const altitude = ship.metrics?.altitude ?? 1200;
    const a = clamp(altitude, 0, 1800);
    let z;
    if (a > 1200) z = 0.13;
    else if (a > 700) z = 0.20;
    else if (a > 380) z = 0.34;
    else if (a > 190) z = 0.58;
    else if (a > 80) z = 0.95;
    else z = 1.65;
    if (ship.landed) z = Math.max(z, 2.05);
    return z;
  }

  updateCamera(dt, ship, input) {
    const wheel = input.takeWheel();
    if (Math.abs(wheel) > 0.0001) {
      this.camera.targetZoom *= Math.exp(wheel * 1.45);
      this.camera.manualTimer = 7;
    }
    if (input.isDown('KeyZ')) {
      this.camera.targetZoom *= Math.exp(-dt * 1.4);
      this.camera.manualTimer = 7;
    }
    if (input.isDown('KeyC')) {
      this.camera.targetZoom *= Math.exp(dt * 1.4);
      this.camera.manualTimer = 7;
    }
    if (input.consumePress('Digit0')) {
      this.camera.manualTimer = 0;
    }
    this.camera.manualTimer = Math.max(0, this.camera.manualTimer - dt);
    if (this.camera.manualTimer <= 0) {
      const desired = this.autoZoomFor(ship);
      this.camera.targetZoom = lerp(this.camera.targetZoom, desired, 1 - Math.exp(-dt * 1.8));
    }
    this.camera.targetZoom = clamp(this.camera.targetZoom, 0.10, 3.2);
    this.camera.zoom = lerp(this.camera.zoom, this.camera.targetZoom, 1 - Math.exp(-dt * 5.2));

    const speed = Math.hypot(ship.vx, ship.vy);
    const lead = clamp(speed * 0.13, 0, 55);
    const dir = norm(ship.vx, ship.vy, 0, 0);
    const targetX = ship.x + dir.x * lead;
    const targetY = ship.y + dir.y * lead;
    const follow = 1 - Math.exp(-dt * 4.2);
    this.camera.x = lerp(this.camera.x, targetX, follow);
    this.camera.y = lerp(this.camera.y, targetY, follow);
    this.camera.shake = Math.max(0, this.camera.shake - dt * 9);
  }

  bodyVisible(body, margin = 1.4) {
    const halfW = this.canvas.width / (2 * this.camera.zoom);
    const halfH = this.canvas.height / (2 * this.camera.zoom);
    const r = Math.hypot(body.w, body.h) / 2 * margin;
    return body.x + r > this.camera.x - halfW && body.x - r < this.camera.x + halfW
      && body.y + r > this.camera.y - halfH && body.y - r < this.camera.y + halfH;
  }

  drawCometTails(ctx, world, time) {
    for (const body of world.bodies) {
      if (body.type !== 'comet' || !this.bodyVisible(body, 6)) continue;
      const tail = world.tailDirectionFor(body);
      const angle = Math.atan2(tail.y, tail.x);
      const len = body.radius * 6.2;
      const width = body.radius * 1.15;
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(angle);
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createLinearGradient(-body.radius * 0.6, 0, len, 0);
      grad.addColorStop(0, 'rgba(180,245,255,0.22)');
      grad.addColorStop(0.18, 'rgba(110,215,255,0.13)');
      grad.addColorStop(0.65, 'rgba(80,160,220,0.045)');
      grad.addColorStop(1, 'rgba(80,120,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-body.radius * 0.6, -width * 0.23);
      ctx.lineTo(len, -width);
      ctx.lineTo(len, width);
      ctx.lineTo(-body.radius * 0.6, width * 0.23);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, 1 / this.camera.zoom);
      for (let k = -3; k <= 3; k++) {
        const y = k * width * 0.22 + Math.sin(time * 0.7 + k) * 2;
        ctx.strokeStyle = `rgba(160,230,255,${0.08 - Math.abs(k) * 0.008})`;
        ctx.beginPath();
        ctx.moveTo(-body.radius * 0.2, y * 0.2);
        ctx.lineTo(len * (0.7 + k * 0.025), y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawGravityRings(ctx, game) {
    if (this.camera.zoom > 0.62 && !game.gravityOverlay) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(0.6, 1 / this.camera.zoom);
    ctx.setLineDash([4 / this.camera.zoom, 9 / this.camera.zoom]);
    for (const body of this.world.bodies) {
      if (!body.discovered || !this.bodyVisible(body, 4)) continue;
      for (let k = 1; k <= 3; k++) {
        ctx.strokeStyle = hexToRgba(body.glow, 0.055 / k);
        ctx.beginPath();
        ctx.arc(body.x, body.y, body.radius * (1.35 + k * 0.65), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawGravityField(ctx, game) {
    if (!game.gravityOverlay) return;
    const zoom = this.camera.zoom;
    const halfW = this.canvas.width / (2 * zoom);
    const halfH = this.canvas.height / (2 * zoom);
    const step = Math.max(85, 150 / Math.sqrt(zoom));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(0.5, 1 / zoom);
    for (let x = Math.floor((this.camera.x - halfW) / step) * step; x < this.camera.x + halfW + step; x += step) {
      for (let y = Math.floor((this.camera.y - halfH) / step) * step; y < this.camera.y + halfH + step; y += step) {
        const g = this.world.gravityAt(x, y);
        const mag = g.magnitude;
        if (mag < 0.08) continue;
        const d = norm(g.x, g.y, 1, 0);
        const screenLen = clamp(mag * 1.2, 3, 23);
        const l = screenLen / zoom;
        const ex = x + d.x * l;
        const ey = y + d.y * l;
        ctx.strokeStyle = `rgba(255,198,109,${clamp(0.08 + mag * 0.007, 0.08, 0.22)})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const a = Math.atan2(d.y, d.x);
        const ah = 3 / zoom;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a - 0.5) * ah, ey - Math.sin(a - 0.5) * ah);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a + 0.5) * ah, ey - Math.sin(a + 0.5) * ah);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawBodyGlows(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const body of this.world.bodies) {
      if (!this.bodyVisible(body, 2.5)) continue;
      const r = body.radius * 2.4;
      const grad = ctx.createRadialGradient(body.x, body.y, body.radius * 0.2, body.x, body.y, r);
      grad.addColorStop(0, hexToRgba(body.glow, body.type === 'station' ? 0.10 : 0.07));
      grad.addColorStop(0.35, hexToRgba(body.glow, 0.035));
      grad.addColorStop(1, hexToRgba(body.glow, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(body.x - r, body.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  drawBodies(ctx) {
    ctx.imageSmoothingEnabled = false;
    for (const body of this.world.bodies) {
      if (!this.bodyVisible(body, 1.2)) continue;
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(body.rotation);
      const surfaceNear = Math.hypot(body.x - this.camera.x, body.y - this.camera.y) < body.radius + 1800;
      if (body.generated && !body.surface && surfaceNear && Math.max(body.w, body.h) * this.camera.zoom > 3) body.prepareSurface();
      if (body.surface) body.flushSurface();
      if (body.surface && !body.surfaceDirty) {
        ctx.drawImage(body.surface.canvas, -body.w / 2, -body.h / 2);
      } else {
        let proxy = this.bodyProxies.get(body.id);
        if (!proxy) {
          proxy = createBodyProxy(body);
          this.bodyProxies.set(body.id, proxy);
        }
        ctx.drawImage(proxy, -body.w / 2, -body.h / 2, body.w, body.h);
      }
      ctx.restore();
    }
  }

  drawHaulers(ctx, game) {
    for (const hauler of this.world.haulers) {
      const state = hauler.state;
      if (!state || !this.bodyVisible({ x: state.x, y: state.y, w: 20, h: 20 }, 2)) continue;
      const angle = Math.atan2(state.vy, state.vx);
      ctx.save();
      ctx.translate(state.x, state.y);
      ctx.rotate(angle);
      ctx.fillStyle = '#30485b';
      ctx.fillRect(-7, -3, 11, 6);
      ctx.fillRect(4, -1, 8, 2);
      ctx.fillStyle = '#9beaff';
      ctx.fillRect(-11, -2, 4, 4);
      ctx.globalAlpha = 0.6 + Math.sin(game.time * 7 + state.x) * 0.2;
      ctx.fillRect(-16, -1, 5, 2);
      ctx.restore();
    }
  }

  drawAstronaut(ctx, game) {
    const eva = game.eva;
    if (!eva?.active) return;
    const zoom = this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(140,234,255,0.38)';
    ctx.lineWidth = Math.max(0.6, 0.8 / zoom);
    ctx.setLineDash([4 / zoom, 5 / zoom]);
    ctx.beginPath();
    ctx.moveTo(game.ship.x, game.ship.y);
    ctx.lineTo(eva.x, eva.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.translate(eva.x, eva.y);
    ctx.rotate(eva.angle);
    if (eva.thrustLevel > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#8ceaff';
      ctx.fillRect(-8 - eva.thrustLevel * 8, -2, eva.thrustLevel * 8, 4);
      ctx.restore();
    }
    ctx.fillStyle = '#d9f6ff';
    ctx.fillRect(-3, -4, 6, 8);
    ctx.fillStyle = '#5ccbe5';
    ctx.fillRect(1, -3, 3, 5);
    ctx.fillStyle = '#263b4d';
    ctx.fillRect(-5, -2, 2, 4);
    ctx.fillRect(3, -2, 2, 4);
    ctx.fillRect(-2, 4, 2, 4);
    ctx.fillRect(1, 4, 2, 4);
    ctx.restore();
  }

  drawScanPulses(ctx, game) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pulse of this.world.scanPulses) {
      ctx.globalAlpha = pulse.life * 0.5;
      ctx.strokeStyle = '#8ceaff';
      ctx.lineWidth = Math.max(0.7, 1.5 / this.camera.zoom);
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.range * (1 - pulse.life), 0, TAU);
      ctx.stroke();
    }
    const eva = game.eva;
    if (eva?.active && eva.scanPulse > 0) {
      ctx.globalAlpha = eva.scanPulse * 0.65;
      ctx.beginPath();
      ctx.arc(eva.x, eva.y, 45 + (1 - eva.scanPulse) * 30, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHotCells(ctx, game) {
    const zoom = this.camera.zoom;
    if (zoom < 0.62) return;
    const body = game.ship.metrics?.body;
    if (!body || !this.bodyVisible(body, 1.3)) return;
    const step = zoom > 1.2 ? 2 : 3;
    const size = Math.max(1.2, 2.1 / zoom);
    let count = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let y = 0; y < body.h && count < 800; y += step) {
      for (let x = 0; x < body.w && count < 800; x += step) {
        const i = body.index(x, y);
        const m = body.mat[i];
        const hot = body.heat[i] > 118;
        const emissive = info(m).emissive || m === MAT.MAGNET_BLOCK || m === MAT.LAMP;
        if (!hot && !emissive) continue;
        const p = body.localToWorld(x + 0.5, y + 0.5);
        const color = hot ? '#ff9a4a' : (info(m).color || '#8ceaff');
        ctx.globalAlpha = clamp(0.16 + (body.heat[i] - 60) / 320, 0.14, 0.6);
        ctx.fillStyle = color;
        ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
        count++;
      }
    }
    ctx.restore();
  }

  drawDocksAndLights(ctx, game) {
    if (this.camera.zoom < 0.3) return;
    const time = game.time;
    const zoom = this.camera.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const body of this.world.bodies) {
      if (!this.bodyVisible(body, 1.2)) continue;
      for (const light of body.dockLights) {
        const p = body.localToWorld(light.x, light.y);
        const pulse = 0.6 + 0.4 * Math.sin(time * 3 + light.phase);
        const s = Math.max(1.2, 2.2 / zoom);
        ctx.globalAlpha = 0.35 + pulse * 0.55;
        ctx.fillStyle = '#ffd47a';
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      for (const mag of body.magnets) {
        const p = body.localToWorld(mag.x, mag.y);
        const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + mag.phase);
        ctx.globalAlpha = 0.12 + pulse * 0.18;
        ctx.strokeStyle = '#cf7bff';
        ctx.lineWidth = Math.max(0.6, 1 / zoom);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 + pulse * 5, 0, TAU);
        ctx.stroke();
      }
      if (body.dock && this.camera.zoom > 0.55) {
        ctx.save();
        ctx.translate(body.x, body.y);
        ctx.rotate(body.rotation);
        ctx.translate(-body.w / 2, -body.h / 2);
        const d = body.dock;
        ctx.globalAlpha = 0.45 + Math.sin(time * 2) * 0.12;
        ctx.strokeStyle = '#8ceaff';
        ctx.lineWidth = Math.max(0.7, 1 / zoom);
        ctx.strokeRect(d.x - d.width / 2, d.y + 5, d.width, 10);
        ctx.strokeStyle = game.docking?.engaged ? '#8affc1' : '#8ceaff';
        ctx.strokeRect(d.x - d.width * 0.34, d.y + 3, d.width * 0.68, 4);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawAnomalies(ctx, world, time) {
    const zoom = this.camera.zoom;
    const size = Math.max(4, 5 / zoom);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const a of world.anomalies) {
      const dx = a.x - this.camera.x;
      const dy = a.y - this.camera.y;
      if (Math.abs(dx) * zoom > this.canvas.width / 2 + 60 || Math.abs(dy) * zoom > this.canvas.height / 2 + 60) continue;
      const color = a.found ? '#8affc1' : '#557c8f';
      const pulse = 0.5 + 0.5 * Math.sin(time * 2 + a.x * 0.01);
      ctx.globalAlpha = a.found ? 0.6 : 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.6, 1 / zoom);
      ctx.beginPath();
      ctx.arc(a.x, a.y, size * (1.6 + pulse * 0.5), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = a.found ? 0.9 : 0.4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - size);
      ctx.lineTo(a.x + size, a.y);
      ctx.lineTo(a.x, a.y + size);
      ctx.lineTo(a.x - size, a.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawAimLine(ctx, game) {
    if (game.eva?.active || !game.aimPoint || game.beam?.active || game.trade.open) return;
    const ship = game.ship;
    const d = norm(game.aimPoint.x - ship.x, game.aimPoint.y - ship.y, Math.cos(ship.angle), Math.sin(ship.angle));
    const maxLen = ship.tool === 'laser' ? 110 : ship.tool === 'grinder' ? 42 : 240;
    const ex = ship.x + d.x * maxLen;
    const ey = ship.y + d.y * maxLen;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = ship.tool === 'laser' ? 'rgba(255,180,90,0.18)' : 'rgba(140,234,255,0.14)';
    ctx.lineWidth = Math.max(0.5, 1 / this.camera.zoom);
    ctx.setLineDash([2 / this.camera.zoom, 7 / this.camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(ship.x + d.x * 12, ship.y + d.y * 12);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawBeam(ctx, game) {
    const beam = game.beam;
    if (!beam?.active) return;
    const zoom = this.camera.zoom;
    const laser = beam.tool === 'laser';
    const color = laser ? '#ff9d45' : '#8ceaff';
    const core = laser ? '#fff1b0' : '#e7fbff';
    const wobble = Math.sin(game.time * 34) * (laser ? 0.8 : 0.35) / zoom;
    const nx = -(beam.y2 - beam.y1);
    const ny = beam.x2 - beam.x1;
    const n = norm(nx, ny, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = (laser ? 8 : 5) / zoom;
    ctx.beginPath();
    ctx.moveTo(beam.x1, beam.y1);
    ctx.lineTo(beam.x2 + n.x * wobble, beam.y2 + n.y * wobble);
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = core;
    ctx.lineWidth = (laser ? 2 : 1.4) / zoom;
    ctx.beginPath();
    ctx.moveTo(beam.x1, beam.y1);
    ctx.lineTo(beam.x2 - n.x * wobble, beam.y2 - n.y * wobble);
    ctx.stroke();
    if (beam.hit) {
      const r = (laser ? 4.5 : 2.5) / zoom;
      ctx.fillStyle = core;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(beam.x2, beam.y2, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawProjectiles(ctx, combat) {
    const zoom = this.camera.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of combat.projectiles) {
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      ctx.lineWidth = Math.max(0.8, 1.4 / zoom);
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      const s = Math.max(1.4, 2.4 / zoom);
      ctx.globalAlpha = 1;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  drawEnemies(ctx, combat) {
    const zoom = this.camera.zoom;
    for (const enemy of combat.enemies) {
      const r = Math.max(enemy.radius, 4 / zoom);
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.rotate(enemy.angle);
      ctx.fillStyle = '#221525';
      ctx.fillRect(-r, -r * 0.55, r * 2.1, r * 1.1);
      ctx.fillRect(-r * 0.35, -r, r * 0.8, r * 2);
      ctx.fillStyle = enemy.flash > 0 ? '#ffffff' : enemy.color;
      ctx.fillRect(-r * 0.55, -r * 0.35, r * 1.3, r * 0.7);
      ctx.fillRect(r * 0.55, -r * 0.18, r * 0.45, r * 0.36);
      ctx.fillStyle = '#ffd6e7';
      ctx.fillRect(r * 0.25, -1 / zoom, Math.max(1.5, 3 / zoom), Math.max(1, 2 / zoom));
      ctx.restore();
      if (zoom > 0.8 && enemy.hp < enemy.maxHp) {
        const w = r * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(enemy.x - w / 2, enemy.y - r - 5 / zoom, w, 2 / zoom);
        ctx.fillStyle = '#ff7aa8';
        ctx.fillRect(enemy.x - w / 2, enemy.y - r - 5 / zoom, w * clamp(enemy.hp / enemy.maxHp, 0, 1), 2 / zoom);
      }
    }
  }

  drawShip(ctx, ship, time, rcs = false) {
    const zoom = this.camera.zoom;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    if (ship.scoop) {
      const radius = 82 + ship.scoopRangeBonus;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#c47bff';
      ctx.globalAlpha = 0.13 + Math.sin(time * 3) * 0.035;
      ctx.lineWidth = Math.max(0.5, 1 / zoom);
      ctx.setLineDash([3 / zoom, 7 / zoom]);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.45 + Math.sin(time * 1.7) * 3, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (ship.thrustLevel > 0.02) {
      const flame = ship.thrustLevel * (ship.boosting ? 34 : 24);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + ship.thrustLevel * 0.45;
      ctx.fillStyle = ship.boosting ? '#ffd27a' : '#75e5ff';
      ctx.fillRect(-SHIP_SCALE.length * 0.47 - flame, -5, flame, 4);
      ctx.fillRect(-SHIP_SCALE.length * 0.47 - flame * 0.75, 3, flame * 0.75, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-SHIP_SCALE.length * 0.47 - flame * 0.35, -2, flame * 0.35, 4);
      ctx.restore();
    }

    if (rcs) {
      const burn = ship.orbitControl?.burn;
      const angle = burn ? Math.atan2(-burn.y, -burn.x) : Math.PI;
      ctx.save();
      ctx.rotate(angle);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#a8f5ff';
      ctx.fillRect(SHIP_SCALE.length * 0.3, -3, 13, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(SHIP_SCALE.length * 0.3 + 2, -2, 7, 4);
      ctx.restore();
    }

    if (ship.gear) {
      ctx.strokeStyle = '#9edff0';
      ctx.lineWidth = Math.max(0.8, 1.8 / zoom);
      ctx.beginPath();
      for (const [x, y] of GEAR_POINTS) {
        ctx.moveTo(x * 0.72, 10);
        ctx.lineTo(x, y - 1);
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#d2f6ff';
      for (const [x, y] of GEAR_POINTS) ctx.fillRect(x - 4, y - 1, 8, 1);
    }

    ctx.drawImage(this.shipSprite, -SHIP_SCALE.length / 2, -SHIP_SCALE.beam / 2, SHIP_SCALE.length, SHIP_SCALE.beam);
    if (ship.invulnerable > 0 && Math.sin(time * 18) > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(140,234,255,0.55)';
      ctx.lineWidth = Math.max(0.7, 1 / zoom);
      ctx.beginPath();
      ctx.arc(0, 0, SHIP_SCALE.hullRadius + 4, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBodyLabels(ctx, game) {
    if (this.camera.zoom > 0.92) return;
    ctx.save();
    ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = 'left';
    for (const body of this.world.bodies) {
      const p = this.worldToScreen(body.x, body.y);
      if (p.x < -80 || p.x > this.canvas.width + 80 || p.y < -40 || p.y > this.canvas.height + 40) continue;
      const known = body.discovered;
      const distance = Math.hypot(game.ship.x - body.x, game.ship.y - body.y) - body.radius;
      if (!known && distance > 1450) continue;
      const label = known ? body.name : 'UNSURVEYED MASS';
      const sub = known ? `${body.type.toUpperCase()} · ${formatDistance(distance)}` : 'GRAVITY SIGNATURE';
      ctx.globalAlpha = known ? 0.85 : 0.42;
      ctx.strokeStyle = known ? body.glow : '#60798c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x + 10, p.y - 12);
      ctx.lineTo(p.x + 4, p.y - 4);
      ctx.stroke();
      ctx.fillStyle = known ? '#dff8ff' : '#7e98a8';
      ctx.fillText(label, p.x + 13, p.y - 14);
      ctx.fillStyle = known ? '#7fb2c6' : '#526b78';
      ctx.fillText(sub, p.x + 13, p.y - 4);
    }
    ctx.restore();
  }

  drawNavVectors(ctx, ship) {
    const p = this.worldToScreen(ship.x, ship.y);
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > 0.7) {
      const l = clamp(speed * 0.24, 8, 72);
      const d = norm(ship.vx, ship.vy, 1, 0);
      arrow(ctx, p.x, p.y, p.x + d.x * l, p.y + d.y * l, 'rgba(140,234,255,0.72)', 'V');
    }
    const g = ship.metrics?.gravityVector;
    if (g && g.magnitude > 0.15) {
      const l = clamp(g.magnitude * 1.9, 8, 48);
      const d = norm(g.x, g.y, 0, 1);
      arrow(ctx, p.x, p.y, p.x + d.x * l, p.y + d.y * l, 'rgba(255,198,109,0.62)', 'G');
    }
  }

  drawDockCue(ctx, game) {
    const dock = game.ship.docked;
    if (!dock || game.eva?.active || game.trade.open) return;
    const p = this.worldToScreen(dock.point.x, dock.point.y);
    ctx.save();
    ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = dock.ready ? '#8affc1' : '#ffc66d';
    ctx.fillStyle = dock.ready ? '#8affc1' : '#ffc66d';
    ctx.lineWidth = 1;
    const w = 34;
    const h = 12;
    ctx.beginPath();
    ctx.moveTo(p.x - w, p.y - h + 5); ctx.lineTo(p.x - w, p.y - h); ctx.lineTo(p.x - w + 8, p.y - h);
    ctx.moveTo(p.x + w - 8, p.y - h); ctx.lineTo(p.x + w, p.y - h); ctx.lineTo(p.x + w, p.y - h + 5);
    ctx.moveTo(p.x - w, p.y + h - 5); ctx.lineTo(p.x - w, p.y + h); ctx.lineTo(p.x - w + 8, p.y + h);
    ctx.moveTo(p.x + w - 8, p.y + h); ctx.lineTo(p.x + w, p.y + h); ctx.lineTo(p.x + w, p.y + h - 5);
    ctx.stroke();
    const label = dock.ready ? 'CLAMPS SECURED · T'
      : game.docking?.phase === 'capturing' ? 'CLAMP CAPTURE IN PROGRESS'
        : `PAD SLOT · ${dock.distance.toFixed(0)} m · ${dock.speed.toFixed(1)} m/s`;
    ctx.fillText(label, p.x, p.y - 18);
    ctx.restore();
  }

  drawOrbitOverlay(ctx, game) {
    if (game.eva?.active) return;
    const orbit = game.orbit?.snapshot();
    if (!orbit) return;
    const zoom = this.camera.zoom;
    const ship = game.ship;
    const body = orbit.body;
    const dx = ship.x - body.x;
    const dy = ship.y - body.y;
    const distance = Math.hypot(dx, dy) || 1;
    const target = this.worldToScreen(orbit.targetX, orbit.targetY);
    const center = this.worldToScreen(body.x, body.y);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(0.7, 1 / zoom);
    ctx.strokeStyle = 'rgba(140,234,255,0.26)';
    ctx.setLineDash([4 / zoom, 8 / zoom]);
    ctx.beginPath();
    ctx.moveTo(ship.x, ship.y);
    ctx.lineTo(orbit.targetX, orbit.targetY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(138,255,193,0.38)';
    ctx.beginPath();
    ctx.arc(body.x, body.y, orbit.radius, 0, TAU);
    ctx.stroke();

    const radialX = dx / distance;
    const radialY = dy / distance;
    const tangentX = -radialY * orbit.direction;
    const tangentY = radialX * orbit.direction;
    const ahead = {
      x: orbit.targetX + tangentX * orbit.radius * 0.28,
      y: orbit.targetY + tangentY * orbit.radius * 0.28
    };
    arrow(ctx, orbit.targetX, orbit.targetY, ahead.x, ahead.y, 'rgba(138,255,193,0.75)');
    ctx.strokeStyle = orbit.phase === 'correction' ? '#8affc1' : '#8ceaff';
    ctx.fillStyle = orbit.phase === 'correction' ? '#8affc1' : '#8ceaff';
    const r = 5 / zoom;
    ctx.beginPath();
    ctx.arc(orbit.targetX, orbit.targetY, r, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(orbit.targetX, orbit.targetY - r * 1.8);
    ctx.lineTo(orbit.targetX + r * 1.8, orbit.targetY);
    ctx.lineTo(orbit.targetX, orbit.targetY + r * 1.8);
    ctx.lineTo(orbit.targetX - r * 1.8, orbit.targetY);
    ctx.closePath();
    ctx.fill();

    ctx.font = `${Math.max(8, 9 / zoom)}px "Courier New", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#bff7ff';
    ctx.fillText(`${orbit.label} · ΔV ${orbit.error.toFixed(1)} m/s`, target.x + 9, target.y - 9);
    ctx.fillStyle = '#789aad';
    ctx.fillText(`${orbit.direction > 0 ? 'PROGRADE' : 'RETROGRADE'} · ${(orbit.radius - body.radius).toFixed(0)} m CLEARANCE`, target.x + 9, target.y + 2);
    ctx.fillStyle = 'rgba(140,234,255,0.6)';
    ctx.fillText(`TARGET ${center.x > this.canvas.width / 2 ? '←' : '→'}`, this.canvas.width / 2 + 16, this.canvas.height / 2 - 18);
    ctx.restore();
  }

  drawReticle(ctx, game) {
    if (!game.input?.pointer.inside || game.trade.open) return;
    const x = Math.round(game.input.pointer.x);
    const y = Math.round(game.input.pointer.y);
    const color = game.ship.tool === 'laser' ? '#ffc66d' : game.ship.tool === 'cannon' ? '#ff9ab8' : '#8ceaff';
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 8, y); ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y); ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8); ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 8);
    ctx.stroke();
    ctx.fillRect(x, y, 1, 1);
    ctx.restore();
  }

  drawScreenOverlays(ctx, game) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawBodyLabels(ctx, game);
    this.drawNavVectors(ctx, game.ship);
    this.drawDockCue(ctx, game);
    this.drawReticle(ctx, game);
    if (this.camera.zoom < 0.34) {
      const p = this.worldToScreen(game.ship.x, game.ship.y);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
      ctx.strokeStyle = 'rgba(140,234,255,0.45)';
      ctx.strokeRect(Math.round(p.x) - 4.5, Math.round(p.y) - 4.5, 9, 9);
    }
    ctx.restore();
  }

  render(game) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.background.draw(ctx, this.camera, this.canvas.width, this.canvas.height, game.time, this.world);

    const shakeX = (Math.random() - 0.5) * this.camera.shake;
    const shakeY = (Math.random() - 0.5) * this.camera.shake;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.applyWorldTransform(ctx);
    this.drawCometTails(ctx, this.world, game.time);
    this.drawGravityRings(ctx, game);
    this.drawGravityField(ctx, game);
    this.drawBodyGlows(ctx);
    this.drawBodies(ctx);
    this.drawHaulers(ctx, game);
    this.drawHotCells(ctx, game);
    this.drawDocksAndLights(ctx, game);
    this.drawScanPulses(ctx, game);
    this.drawOrbitOverlay(ctx, game);
    this.drawAnomalies(ctx, this.world, game.time);
    this.drawAimLine(ctx, game);
    this.drawBeam(ctx, game);
    game.particles.draw(ctx, this.camera.zoom);
    this.drawProjectiles(ctx, game.combat);
    this.drawEnemies(ctx, game.combat);
    this.drawShip(ctx, game.ship, game.time, game.ship.rcsActive);
    this.drawAstronaut(ctx, game);
    ctx.restore();

    this.drawScreenOverlays(ctx, game);
  }
}
