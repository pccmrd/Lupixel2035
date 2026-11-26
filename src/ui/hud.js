import { clamp, formatDistance, formatTime, TAU } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { COMMODITIES } from '../world/materials.js';
import { EVA_TUNING } from '../game/eva.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function percent(value) {
  return `${Math.round(clamp(value, 0, 100))}%`;
}

export class UI {
  constructor() {
    this.el = {
      credits: $('credits'), sector: $('sector'), simRate: $('sim-rate'), clock: $('clock'), mode: $('mode'),
      hullBar: $('hull-bar'), hullVal: $('hull-val'), fuelBar: $('fuel-bar'), fuelVal: $('fuel-val'),
      energyBar: $('energy-bar'), energyVal: $('energy-val'), heatBar: $('heat-bar'), heatVal: $('heat-val'),
      cargoUsed: $('cargo-used'), cargoList: $('cargo-list'), objective: $('objective'),
      targetName: $('target-name'), altitude: $('altitude'), speed: $('speed'), verticalSpeed: $('vertical-speed'),
      gravity: $('gravity'), alignment: $('alignment'), landingState: $('landing-state'), orbitState: $('orbit-state'),
      evaReadout: $('eva-readout'), evaMode: $('eva-mode'), oxygenBar: $('oxygen-bar'), oxygenVal: $('oxygen-val'),
      tetherState: $('tether-state'), evaLocation: $('eva-location'),
      toolName: $('tool-name'), gearState: $('gear-state'), scoopState: $('scoop-state'), threatCount: $('threat-count'),
      discovered: $('discovered'), landingGuide: $('landing-guide'), guideVs: $('guide-vs'), guideHs: $('guide-hs'),
      guideAlign: $('guide-align'), guideVerdict: $('guide-verdict'), log: $('log'), hint: $('hint'),
      trade: $('trade'), help: $('help'), map: $('map'), pause: $('pause-banner'),
      marketName: $('market-name'), marketCopy: $('market-copy'), marketGrid: $('market-grid'), marketActions: $('market-actions'),
      mapCanvas: $('map-canvas')
    };
    this.mapCtx = this.el.mapCanvas.getContext('2d');
    this.mapCtx.imageSmoothingEnabled = false;
    const starRng = new Rng(0x5727);
    this.mapStars = Array.from({ length: 130 }, () => ({
      x: starRng.range(0, this.el.mapCanvas.width),
      y: starRng.range(0, this.el.mapCanvas.height),
      a: starRng.range(0.15, 0.8),
      p: starRng.range(0, TAU)
    }));
    this.helpOpen = false;
    this.mapOpen = false;
    this.tradeOpen = false;
    this.logEntries = [];
    this.logDirty = true;
    this.updateTimer = 0;
    this.mapTimer = 0;
    this.hintTimer = 20;
    this.audio = null;
    this.bindClosers();
  }

  bind(trade, audio) {
    this.trade = trade;
    this.audio = audio;
    this.el.marketActions.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button || button.disabled || !this.trade) return;
      this.trade.action(button.dataset.action);
    });
  }

  bindClosers() {
    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.close;
        this.audio?.play('ui');
        if (target === 'trade') this.trade?.close();
        else if (target === 'help') this.toggleHelp(false);
        else if (target === 'map') this.toggleMap(false);
      });
    });
  }

  toggleHelp(force) {
    this.helpOpen = force ?? !this.helpOpen;
    this.el.help.classList.toggle('hidden', !this.helpOpen);
  }

  toggleMap(force) {
    this.mapOpen = force ?? !this.mapOpen;
    this.el.map.classList.toggle('hidden', !this.mapOpen);
    this.mapTimer = 0;
  }

  showTrade(open) {
    this.tradeOpen = open;
    this.el.trade.classList.toggle('hidden', !open);
  }

  log(text, tone = '') {
    this.logEntries.push({ text, tone, life: 7.5 });
    if (this.logEntries.length > 7) this.logEntries.shift();
    this.logDirty = true;
    this.renderLog();
  }

  renderLog() {
    this.el.log.innerHTML = this.logEntries.map((entry) => `<div class="${escapeHtml(entry.tone)}">${escapeHtml(entry.text)}</div>`).join('');
    this.logDirty = false;
  }

  setText(id, value) {
    const el = this.el[id];
    if (el && el.textContent !== value) el.textContent = value;
  }

  setBar(barId, valueId, value, danger = false) {
    const bar = this.el[barId];
    if (!bar) return;
    bar.style.width = percent(value);
    bar.classList.toggle('danger', danger);
    this.setText(valueId, percent(value));
  }

  renderTrade(trade) {
    const data = trade.getMarketData();
    const body = data.dock?.body;
    this.setText('marketName', body?.name || 'NO MARKET LINK');
    if (this.el.marketCopy) {
      this.el.marketCopy.textContent = `${body?.description || ''}  ·  STRUCTURAL INTEGRITY ${(data.integrity * 100).toFixed(0)}%  ·  ${data.credits} CR AVAILABLE`;
    }
    this.el.marketGrid.innerHTML = data.commodities.map((c) => `
      <div class="market-cell">
        <span style="color:${c.color}">${escapeHtml(c.name)}</span>
        <b>${c.units.toFixed(1)} u <em>@ ${c.price} CR</em></b>
        <span>VALUE ${c.value} CR</span>
      </div>
    `).join('');
    this.el.marketActions.innerHTML = data.actions.map((a) => `
      <button data-action="${a.id}" ${a.enabled ? '' : 'disabled'}>
        ${escapeHtml(a.label)}
        <small>${escapeHtml(a.detail)}</small>
      </button>
    `).join('');
  }

  drawMap(world, ship, combat, renderer, time, eva = null) {
    const ctx = this.mapCtx;
    const W = this.el.mapCanvas.width;
    const H = this.el.mapCanvas.height;
    const pad = 20;
    const scale = Math.min((W - pad * 2) / (world.bounds.maxX - world.bounds.minX), (H - pad * 2) / (world.bounds.maxY - world.bounds.minY));
    const sx = (x) => W / 2 + x * scale;
    const sy = (y) => H / 2 + y * scale;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#030814';
    ctx.fillRect(0, 0, W, H);

    for (const s of this.mapStars) {
      ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(time * 0.8 + s.p));
      ctx.fillStyle = '#b7eaff';
      ctx.fillRect(s.x | 0, s.y | 0, 1, 1);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(90, 160, 190, 0.12)';
    ctx.lineWidth = 1;
    for (let x = -7000; x <= 7000; x += 1000) {
      ctx.beginPath(); ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), H); ctx.stroke();
    }
    for (let y = -7000; y <= 7000; y += 1000) {
      ctx.beginPath(); ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)); ctx.stroke();
    }

    ctx.fillStyle = '#8ab7c8';
    ctx.font = '9px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('← EARTH · 384,400 KM', 12, H - 12);
    ctx.textAlign = 'right';
    ctx.fillText('LUNA ORBIT · 2035', W - 12, H - 12);

    for (const body of world.bodies) {
      const x = sx(body.x);
      const y = sy(body.y);
      const known = body.discovered;
      const r = Math.max(known ? 4 : 1.5, body.radius * scale);
      ctx.save();
      ctx.globalAlpha = known ? 1 : 0.35;
      ctx.strokeStyle = body.glow;
      ctx.lineWidth = 1;
      if (known) {
        ctx.setLineDash([3, 5]);
        for (let ring = 1; ring <= 2; ring++) {
          ctx.globalAlpha = 0.2 / ring;
          ctx.beginPath();
          ctx.arc(x, y, r * (1.3 + ring * 0.55), 0, TAU);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = known ? 0.95 : 0.28;
      ctx.fillStyle = known ? body.glow : '#405263';
      if (body.type === 'station') {
        ctx.strokeRect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
        ctx.fillRect(x - r * 0.42, y - r * 0.42, r * 0.84, r * 0.84);
      } else if (body.type === 'comet') {
        const tail = world.tailDirectionFor(body);
        ctx.beginPath();
        ctx.moveTo(x + tail.x * r * 2.6, y + tail.y * r * 2.6);
        ctx.lineTo(x - tail.y * r * 0.7, y + tail.x * r * 0.7);
        ctx.lineTo(x + tail.y * r * 0.7, y - tail.x * r * 0.7);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.65, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = known ? 1 : 0.4;
      ctx.fillStyle = known ? '#dff8ff' : '#7a94a4';
      ctx.font = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      if (known) ctx.fillText(body.name, x, y + r + 15);
      ctx.restore();
    }

    for (const a of world.anomalies) {
      const x = sx(a.x);
      const y = sy(a.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = a.found ? '#8affc1' : '#526b78';
      ctx.fillStyle = a.found ? 'rgba(138,255,193,0.35)' : 'rgba(82,107,120,0.15)';
      ctx.lineWidth = 1.4;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.restore();
      ctx.fillStyle = a.found ? '#8affc1' : '#526b78';
      ctx.font = '9px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(a.found ? a.name : '?', x, y - 9);
    }

    for (const enemy of combat.enemies) {
      const x = sx(enemy.x);
      const y = sy(enemy.y);
      ctx.strokeStyle = 'rgba(255, 105, 140, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3);
      ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3);
      ctx.stroke();
    }

    if (renderer?.camera) {
      const viewW = renderer.canvas.width / renderer.camera.zoom;
      const viewH = renderer.canvas.height / renderer.camera.zoom;
      ctx.strokeStyle = 'rgba(140,234,255,0.28)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx(renderer.camera.x - viewW / 2), sy(renderer.camera.y - viewH / 2), viewW * scale, viewH * scale);
      ctx.setLineDash([]);
    }

    const px = sx(ship.x);
    const py = sy(ship.y);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ship.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-9, -8); ctx.lineTo(-4, 0); ctx.lineTo(-9, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#8ceaff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + ship.vx * 0.32 * scale, py + ship.vy * 0.32 * scale);
    ctx.stroke();
    if (eva?.active) {
      const ex = sx(eva.x);
      const ey = sy(eva.y);
      ctx.strokeStyle = 'rgba(140,234,255,0.45)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#8ceaff';
      ctx.fillRect(ex - 2, ey - 2, 4, 4);
    }
  }

  updateLandingGuide(game) {
    const { ship } = game;
    const m = ship.metrics;
    const show = m && m.altitude < 250 && !game.eva?.active && !this.tradeOpen && !game.orbit?.active;
    this.el.landingGuide.classList.toggle('hidden', !show);
    if (!show || !m) return;
    this.setText('guideVs', `${m.vertical >= 0 ? '+' : ''}${m.vertical.toFixed(1)} m/s`);
    this.setText('guideHs', `${m.horizontal.toFixed(1)} m/s`);
    this.setText('guideAlign', percent(Math.max(0, m.align) * 100));
    let verdict = 'LANDING WINDOW';
    let tone = 'good';
    if (ship.landed) {
      verdict = 'SURFACE HOLD';
    } else if (m.vertical > 6) {
      verdict = 'DESCENT TOO FAST';
      tone = 'bad';
    } else if (m.horizontal > 5) {
      verdict = 'KILL LATERAL DRIFT';
      tone = 'warn';
    } else if (m.align < 0.65) {
      verdict = 'ROTATE LEGS TO SURFACE';
      tone = 'warn';
    } else if (m.vertical > 2.8) {
      verdict = 'REDUCE DESCENT RATE';
      tone = 'warn';
    }
    this.setText('guideVerdict', verdict);
    this.el.guideVerdict.className = `guide-verdict ${tone === 'good' ? '' : tone}`;
  }

  updateEvaTelemetry(game, nav) {
    const { eva, world } = game;
    const gravity = world.gravityAt(eva.x, eva.y);
    const oxygen = eva.oxygen / EVA_TUNING.oxygenCapacity * 100;
    this.el.evaReadout.classList.remove('hidden');
    this.setText('evaMode', eva.returning ? 'RETURN' : 'TETHERED');
    this.setBar('oxygenBar', 'oxygenVal', oxygen, oxygen < 25);
    this.setText('tetherState', `${eva.tetherDistance.toFixed(0)} / ${EVA_TUNING.tetherMax} m`);
    this.setText('evaLocation', eva.caveBody ? `CAVE · ${eva.caveBody.name}` : 'CISLUNAR VACUUM');
    this.setText('targetName', eva.caveBody?.name || nav?.body?.name || 'CISLUNAR VACUUM');
    const altitude = nav?.body ? Math.max(0, nav.distance - nav.body.radius) : 0;
    this.setText('altitude', formatDistance(altitude));
    this.setText('speed', `${Math.hypot(eva.vx, eva.vy).toFixed(1)} m/s`);
    this.setText('verticalSpeed', eva.contact ? 'CONTACT' : 'VACUUM');
    this.setText('gravity', `${(gravity.magnitude / 9.81).toFixed(2)} g`);
    this.setText('alignment', '—');
    const lowAir = oxygen < 25;
    this.setText('landingState', eva.returning ? 'SUIT RETURN · THRUSTERS GUIDING TO AIRLOCK' : eva.caveBody ? 'CAVE EXPLORATION · MATERIAL COLLISION ACTIVE' : 'FREE EVA · PHYSICAL TETHER ATTACHED');
    this.el.landingState.className = `state-line ${lowAir ? 'bad' : eva.returning ? 'warn' : 'good'}`;
    this.setText('orbitState', 'I SCAN · J RECOVER SITE · G RETURN / AIRLOCK');
    this.el.orbitState.className = 'state-line dim';
    this.setText('toolName', 'SUIT TOOL');
    this.setText('gearState', 'TETHERED');
    this.setText('scoopState', 'N/A');
  }

  render(dt, game) {
    const { world, ship, combat, renderer, paused, simRate } = game;
    for (const entry of this.logEntries) entry.life -= dt;
    if (this.logEntries.some((e) => e.life <= 0)) {
      this.logEntries = this.logEntries.filter((e) => e.life > 0);
      this.logDirty = true;
    }
    if (this.logDirty && (this.logTimer ?? 0) <= 0) {
      this.renderLog();
      this.logTimer = 0.2;
    }
    this.logTimer = Math.max(0, (this.logTimer ?? 0) - dt);
    this.hintTimer -= dt;
    if (this.hintTimer < 0) this.el.hint.style.opacity = '0';

    this.el.pause.classList.toggle('hidden', !paused);
    this.mapTimer -= dt;
    if (this.mapOpen && this.mapTimer <= 0) {
      this.drawMap(world, ship, combat, renderer, game.time, game.eva);
      this.mapTimer = 0.12;
    }

    this.updateTimer -= dt;
    if (this.updateTimer > 0) return;
    this.updateTimer = 0.075;

    this.setText('credits', `${Math.floor(ship.credits)}`);
    this.setText('clock', formatTime(game.time));
    this.setText('simRate', `${Math.round(simRate)} Hz`);
    const actor = game.eva?.active ? game.eva : ship;
    const nav = ship.metrics?.body || world.nearestBody(actor.x, actor.y).body;
    this.setText('sector', nav?.name || 'CISLUNAR DRIFT');
    this.el.evaReadout.classList.toggle('hidden', !game.eva?.active);
    this.setText('mode', game.eva?.active ? 'EVA' : game.orbit?.active ? 'ORBIT ASSIST' : ship.docked?.ready ? 'DOCKED' : ship.landed ? 'SURFACE' : ship.scoop ? 'SCOOP' : 'MANUAL');

    this.setBar('hullBar', 'hullVal', ship.hull, ship.hull < 30);
    this.setBar('fuelBar', 'fuelVal', ship.fuel, ship.fuel < 18);
    this.setBar('energyBar', 'energyVal', ship.energy, ship.energy < 15);
    this.setBar('heatBar', 'heatVal', ship.heat, ship.heat > 80);

    const used = ship.cargoUsed();
    this.setText('cargoUsed', `${used.toFixed(1)} / ${ship.capacity}`);
    const cargoEntries = Object.entries(ship.cargo)
      .filter(([, units]) => units > 0.01)
      .sort((a, b) => b[1] - a[1]);
    this.el.cargoList.innerHTML = cargoEntries.length
      ? cargoEntries.map(([id, units]) => `<span>${escapeHtml(COMMODITIES[id]?.name || id)} <b>${units.toFixed(1)}u</b></span>`).join('')
      : '<span class="dim">ballast only</span>';
    if (this.el.objective) this.el.objective.textContent = game.objectiveText || 'Explore, mine, trade and survive.';

    if (game.eva?.active) {
      const navState = world.nearestBody(actor.x, actor.y);
      this.updateEvaTelemetry(game, navState);
      this.setText('threatCount', `${combat.threatsNear(actor, 1000)}`);
      const discovery = world.discoveryCount();
      this.setText('discovered', `SURVEY ${discovery.total} / ${discovery.max}`);
      this.updateLandingGuide(game);
      return;
    }

    const m = ship.metrics;
    this.setText('targetName', m?.body?.name || 'DEEP SPACE');
    this.setText('altitude', m ? formatDistance(m.altitude) : '—');
    this.setText('speed', m ? `${m.speed.toFixed(1)} m/s` : '0.0 m/s');
    this.setText('verticalSpeed', m ? `${m.vertical >= 0 ? '+' : ''}${m.vertical.toFixed(1)}` : '0.0');
    this.setText('gravity', m ? `${m.gravity.toFixed(2)} g` : '0.00');
    this.setText('alignment', m ? percent(Math.max(0, m.align) * 100) : '—');

    let state = 'NO CONTACT';
    let stateTone = 'dim';
    if (game.docking?.phase === 'capturing') {
      state = 'PAD CAPTURE · CLAMPS ALIGNING';
      stateTone = 'good';
    } else if (ship.docked?.ready) {
      state = `CLAMPED · ${ship.docked.body.name} · PRESS T TO TRADE`;
      stateTone = 'good';
    } else if (ship.landed && ship.landedBody) {
      state = `LANDED · ${ship.landedBody.name} · ${ship.lastLanding?.quality?.toFixed(0) || 0}% QUALITY`;
      stateTone = 'good';
    } else if (ship.contact) {
      state = 'SURFACE CONTACT · MANUAL HOLD REQUIRED';
      stateTone = 'warn';
    } else if (m?.altitude < 120 && m.vertical > 7) {
      state = 'HIGH DESCENT RATE';
      stateTone = 'bad';
    } else if (m?.altitude < 220) {
      state = 'APPROACHING MATERIAL FIELD';
      stateTone = '';
    }
    this.setText('landingState', state);
    this.el.landingState.className = `state-line ${stateTone}`;

    const orbit = game.orbit?.active ? game.orbit.snapshot() : null;
    if (orbit) {
      this.setText('orbitState', `${orbit.label} · ΔV ${orbit.error.toFixed(1)} m/s`);
      this.el.orbitState.className = 'state-line good';
    } else if (ship.landed || ship.docked?.ready) {
      this.setText('orbitState', 'LIFT OFF TO ENABLE ORBIT ASSIST');
      this.el.orbitState.className = 'state-line dim';
    } else {
      const target = game.orbit?.target;
      const range = game.orbit?.targetDistance() ?? Infinity;
      const check = target ? game.orbit.engagementCheck() : null;
      const label = target && range < 1250 ? `O ${target.name} · ${formatDistance(range)}` : 'O SLOW ORBIT · APPROACH A TARGET';
      this.setText('orbitState', check && !check.ok ? `${label} · ${check.reason}` : label);
      this.el.orbitState.className = check?.ok ? 'state-line good' : 'state-line dim';
    }

    this.setText('toolName', ship.tool.toUpperCase());
    this.setText('gearState', ship.gear ? 'DOWN' : 'UP');
    this.setText('scoopState', ship.scoop ? `ON · MAG ${ship.magnetLevel}` : 'OFF');
    this.setText('threatCount', `${combat.threatsNear(ship, 1000)}`);
    const discovery = world.discoveryCount();
    this.setText('discovered', `SURVEY ${discovery.total} / ${discovery.max}`);
    this.updateLandingGuide(game);
  }
}
