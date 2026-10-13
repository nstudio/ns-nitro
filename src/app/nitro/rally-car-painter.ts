export interface CarPose {
  /** Center X in stage points */
  x: number;
  /** Center Y in stage points */
  y: number;
  /** Nose-up pitch in radians (negative = nose up) */
  pitch: number;
  /** Scale factor (1.0 = base size) */
  scale: number;
  /** Suspension droop (0 = compressed on ground, 1 = full airborne hang) */
  suspensionDroop: number;
  /** Wheel spin phase in radians */
  wheelPhase: number;
  /** 0..1 turbo boost / afterburner flame intensity */
  boost: number;
  /** Current benchmark speedup badge text (e.g. "14.2x") */
  speedupLabel: string;
  /** Current time in seconds */
  timeSec: number;
  /** Whether WebGPU backdrop is active underneath */
  hasWebGpuBackdrop: boolean;
}

interface GravelClod {
  vx: number;
  vy: number;
  size: number;
  seed: number;
  isSpark: boolean;
}

const CLODS: GravelClod[] = Array.from({ length: 42 }, (_, i) => ({
  vx: 90 + ((i * 53) % 180),
  vy: -25 - ((i * 37) % 110),
  size: 2.2 + ((i * 19) % 6.5),
  seed: (i * 0.173) % 1,
  isSpark: i % 3 === 0,
}));

export function drawRallyOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  pose: CarPose,
): void {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  // If WebGPU hasn't initialized yet, draw a rich 2D synthwave sunset fallback
  if (!pose.hasWebGpuBackdrop) {
    drawFallbackSynthwaveBackdrop(ctx, width, height, pose.timeSec);
  }

  // Draw the flying gravel clods & sparks behind the rear tires
  drawRoosterTailDebris(ctx, pose);

  // Draw the airborne Group B Audi Quattro S1
  drawGroupBQuattro(ctx, pose);

  // Draw the foreground rocky dirt ridge & staked "quattro / NITRO" banner on bottom-right
  drawForegroundCrestAndBanner(ctx, width, height, pose);

  ctx.restore();
}

function drawFallbackSynthwaveBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0.0, '#2b0958');
  sky.addColorStop(0.35, '#e81978');
  sky.addColorStop(0.68, '#ff5126');
  sky.addColorStop(1.0, '#ffc838');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Sliced Synthwave Sun
  const sunX = w * 0.80;
  const sunY = h * 0.44;
  const sunR = Math.min(w, h) * 0.16;

  const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 2.4);
  halo.addColorStop(0, 'rgba(255, 230, 110, 0.85)');
  halo.addColorStop(0.5, 'rgba(255, 90, 40, 0.35)');
  halo.addColorStop(1, 'rgba(232, 25, 120, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR * 2.4, 0, Math.PI * 2);
  ctx.fill();

  const sunGrad = ctx.createLinearGradient(sunX, sunY - sunR, sunX, sunY + sunR);
  sunGrad.addColorStop(0, '#fff78c');
  sunGrad.addColorStop(0.6, '#ff9a2e');
  sunGrad.addColorStop(1, '#ff2a55');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Horizontal scanline cutouts on lower half of sun
  ctx.fillStyle = '#c41e68';
  for (let i = 0; i < 7; i++) {
    const sliceY = sunY + sunR * (0.12 + i * 0.13);
    const sliceH = 1.5 + i * 1.1;
    ctx.fillRect(sunX - sunR, sliceY, sunR * 2, sliceH);
  }

  // Distant mountain silhouette
  ctx.fillStyle = '#470a42';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.56);
  ctx.lineTo(w * 0.28, h * 0.49);
  ctx.lineTo(w * 0.58, h * 0.58);
  ctx.lineTo(w * 0.85, h * 0.54);
  ctx.lineTo(w, h * 0.59);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // Sloped rally dirt ridge
  const dirt = ctx.createLinearGradient(0, h * 0.62, 0, h);
  dirt.addColorStop(0, '#7a1244');
  dirt.addColorStop(0.4, '#3d0726');
  dirt.addColorStop(1, '#140210');
  ctx.fillStyle = dirt;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.63);
  ctx.quadraticCurveTo(w * 0.45, h * 0.74, w, h * 0.89);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  void t;
}

function drawRoosterTailDebris(ctx: CanvasRenderingContext2D, pose: CarPose): void {
  const { x, y, scale, boost, timeSec } = pose;
  ctx.save();
  ctx.translate(x + 48 * scale, y + 28 * scale);

  // Soft volumetric magenta/amber dust puffs behind rear tires
  const puffCount = 9;
  for (let i = 0; i < puffCount; i++) {
    const cycle = (timeSec * (0.85 + i * 0.11) + i * 0.17) % 1;
    const px = cycle * (120 + i * 14) * scale * (0.75 + boost * 0.6);
    const py = (-12 - cycle * 38 + Math.sin(i * 2.1) * 18) * scale;
    const rad = (16 + cycle * 38) * scale * (0.7 + boost * 0.5);
    const alpha = (1 - cycle) * (0.26 + boost * 0.28);

    const grad = ctx.createRadialGradient(px, py, rad * 0.1, px, py, rad);
    grad.addColorStop(0, `rgba(255, 98, 56, ${alpha})`);
    grad.addColorStop(0.55, `rgba(232, 28, 118, ${alpha * 0.65})`);
    grad.addColorStop(1, 'rgba(120, 10, 75, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sharp flying dirt clods & glowing turbo sparks
  for (const c of CLODS) {
    const cycle = (timeSec * (1.2 + c.seed * 0.9) + c.seed) % 1;
    const cx = c.vx * cycle * scale * (0.7 + boost * 0.75);
    const cy = (c.vy * cycle + 95 * cycle * cycle) * scale;
    const r = c.size * (1 - cycle * 0.65) * scale;

    if (c.isSpark) {
      ctx.fillStyle = `rgba(255, 220, 95, ${(1 - cycle) * (0.55 + boost * 0.45)})`;
    } else {
      ctx.fillStyle = `rgba(42, 6, 28, ${(1 - cycle) * 0.85})`;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.8, r), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawGroupBQuattro(ctx: CanvasRenderingContext2D, pose: CarPose): void {
  const { x, y, pitch, scale, suspensionDroop, wheelPhase, boost } = pose;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pitch);
  ctx.scale(scale, scale);

  // =========================================================================
  // 0. TURBO AFTERBURNER EXHAUST FLAME (behind rear right bumper)
  // =========================================================================
  if (boost > 0.08) {
    const flicker = 0.8 + 0.35 * Math.sin(pose.timeSec * 65);
    const flameLen = (34 + boost * 58) * flicker;
    const flameGrad = ctx.createLinearGradient(96, 20, 96 + flameLen, 24);
    flameGrad.addColorStop(0, 'rgba(255, 250, 190, 0.95)');
    flameGrad.addColorStop(0.4, 'rgba(255, 120, 30, 0.85)');
    flameGrad.addColorStop(1, 'rgba(255, 20, 100, 0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(92, 16);
    ctx.lineTo(96 + flameLen, 12);
    ctx.lineTo(92 + flameLen * 0.85, 25);
    ctx.lineTo(96 + flameLen, 31);
    ctx.lineTo(90, 26);
    ctx.closePath();
    ctx.fill();
  }

  const droop = suspensionDroop * 9;

  // =========================================================================
  // 1. FAR-SIDE (LEFT/PASSENGER) SUSPENDED TIRES & DARK UNDERCARRIAGE
  // =========================================================================
  // Dark chassis underbody pan + exhaust/diffuser shadow (key to airborne look!)
  ctx.fillStyle = '#0c0410';
  ctx.beginPath();
  ctx.moveTo(-102, 10);
  ctx.lineTo(8, 14);
  ctx.lineTo(92, 22);
  ctx.lineTo(74, 34);
  ctx.lineTo(-82, 28);
  ctx.closePath();
  ctx.fill();

  // Far-left front tire (hanging below left bumper)
  drawFarTire(ctx, -82, 26 + droop, 21, 30);
  // Far-left rear tire (hanging below mid-underbody)
  drawFarTire(ctx, -18, 30 + droop, 19, 27);

  // =========================================================================
  // 2. MAIN WIDEBODY SHELL (3/4 Front-Left + Right Side Profile)
  // =========================================================================
  // Greenhouse / Cabin Roof & Pillars
  ctx.fillStyle = '#f8f5fa';
  ctx.beginPath();
  ctx.moveTo(-64, -22); // Left A-pillar base
  ctx.lineTo(-36, -54); // Left A-pillar top
  ctx.lineTo(24, -55);  // Roofline front-right
  ctx.lineTo(66, -47);  // Roofline rear-right
  ctx.lineTo(90, -14);  // C-pillar base rear
  ctx.lineTo(14, -18);  // Right door beltline
  ctx.closePath();
  ctx.fill();

  // Group B Rear Rally Wing (behind C-pillar)
  ctx.fillStyle = '#f2eef5';
  ctx.beginPath();
  ctx.moveTo(76, -36);
  ctx.lineTo(98, -42);
  ctx.lineTo(100, -24);
  ctx.lineTo(84, -20);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c4356e';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Windshield (Dark purple-charcoal glass with sunset reflection)
  const glassGrad = ctx.createLinearGradient(-55, -52, 5, -18);
  glassGrad.addColorStop(0, '#140924');
  glassGrad.addColorStop(0.55, '#2b1244');
  glassGrad.addColorStop(1, '#4c1854');
  ctx.fillStyle = glassGrad;
  ctx.beginPath();
  ctx.moveTo(-60, -21);
  ctx.lineTo(-34, -50);
  ctx.lineTo(18, -50);
  ctx.lineTo(5, -19);
  ctx.closePath();
  ctx.fill();

  // Interior Roll Cage & Driver Helmet Silhouette inside Windshield
  ctx.strokeStyle = 'rgba(255, 160, 210, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-28, -46);
  ctx.lineTo(-15, -21);
  ctx.moveTo(8, -46);
  ctx.lineTo(-4, -20);
  ctx.stroke();

  // Helmet silhouette
  ctx.fillStyle = 'rgba(240, 235, 255, 0.42)';
  ctx.beginPath();
  ctx.arc(-8, -32, 6.5, 0, Math.PI * 2);
  ctx.fill();

  // Windshield Sun-Strip Banner ("Audi quattro")
  ctx.fillStyle = '#120822';
  ctx.beginPath();
  ctx.moveTo(-36, -50);
  ctx.lineTo(18, -50);
  ctx.lineTo(15, -42);
  ctx.lineTo(-41, -42);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold italic 7.5px -apple-system, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Audi quattro', -10, -43.5);
  ctx.restore();

  // Right Side Windows (Driver Door + Rear Quarter Window)
  ctx.fillStyle = '#1c0b30';
  // Front door glass
  ctx.beginPath();
  ctx.moveTo(10, -19);
  ctx.lineTo(22, -49);
  ctx.lineTo(48, -46);
  ctx.lineTo(46, -16);
  ctx.closePath();
  ctx.fill();
  // Rear quarter glass
  ctx.beginPath();
  ctx.moveTo(50, -16);
  ctx.lineTo(52, -45);
  ctx.lineTo(65, -43);
  ctx.lineTo(84, -15);
  ctx.closePath();
  ctx.fill();

  // Hood / Bonnet (Sloping forward from windshield to front grille)
  const hoodGrad = ctx.createLinearGradient(-50, -25, -15, -5);
  hoodGrad.addColorStop(0, '#ffffff');
  hoodGrad.addColorStop(0.6, '#f6e8f2');
  hoodGrad.addColorStop(1, '#e8d0e2');
  ctx.fillStyle = hoodGrad;
  ctx.beginPath();
  ctx.moveTo(-64, -21);
  ctx.lineTo(6, -19);
  ctx.lineTo(-10, -5);
  ctx.lineTo(-106, -9);
  ctx.closePath();
  ctx.fill();

  // Hood Cooling Louvers / Vents
  ctx.fillStyle = '#1d0b28';
  ctx.fillRect(-78, -16, 26, 2.2);
  ctx.fillRect(-44, -16, 24, 2.2);

  // Right Side Widebody Fender & Door Panel
  const sideGrad = ctx.createLinearGradient(-10, -18, 95, 22);
  sideGrad.addColorStop(0, '#faf2f7');
  sideGrad.addColorStop(0.6, '#edd8e6');
  sideGrad.addColorStop(1, '#d4b4cb');
  ctx.fillStyle = sideGrad;
  ctx.beginPath();
  ctx.moveTo(-10, -6);
  ctx.lineTo(6, -19);
  ctx.lineTo(90, -14);
  ctx.lineTo(95, 16);
  ctx.lineTo(6, 12);
  ctx.lineTo(-12, 8);
  ctx.closePath();
  ctx.fill();

  // =========================================================================
  // 3. GROUP B RALLY LIVERY STRIPES (Red / Gold / Charcoal + Door #1)
  // =========================================================================
  // Red diagonal rally stripe on front-right fender & rear quarter
  ctx.fillStyle = '#d91e36';
  ctx.beginPath();
  ctx.moveTo(-4, -6);
  ctx.lineTo(14, -18);
  ctx.lineTo(28, -17);
  ctx.lineTo(12, -4);
  ctx.closePath();
  ctx.fill();

  // Gold/Ochre stripe next to red
  ctx.fillStyle = '#e59524';
  ctx.beginPath();
  ctx.moveTo(13, -4);
  ctx.lineTo(29, -17);
  ctx.lineTo(38, -16);
  ctx.lineTo(24, -3);
  ctx.closePath();
  ctx.fill();

  // White Door Number Plate with "#1"
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(34, -14);
  ctx.lineTo(62, -12);
  ctx.lineTo(60, 10);
  ctx.lineTo(32, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#1c0b2b';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  ctx.fillStyle = '#12061c';
  ctx.font = '900 16px -apple-system, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('1', 47, 5);
  ctx.restore();

  // Side Mirror (Black rally mirror at A-pillar base)
  ctx.fillStyle = '#14081e';
  ctx.beginPath();
  ctx.roundRect(4, -24, 12, 7, 2);
  ctx.fill();

  // =========================================================================
  // 4. FRONT FASCIA, GRILLE, FOUR RINGS & TWIN BLAZING HEADLIGHTS
  // =========================================================================
  // Black Front Grille Box
  ctx.fillStyle = '#11071a';
  ctx.beginPath();
  ctx.roundRect(-106, -9, 95, 16, 2);
  ctx.fill();

  // Subtle horizontal grille slats
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 0.8;
  for (let gy = -6; gy <= 4; gy += 3.2) {
    ctx.beginPath();
    ctx.moveTo(-102, gy);
    ctx.lineTo(-14, gy);
    ctx.stroke();
  }

  // Iconic 4 Interlocking Silver Rings in Center of Grille
  ctx.strokeStyle = '#e8e4f0';
  ctx.lineWidth = 1.6;
  const ringCenters = [-69, -62, -55, -48];
  for (const rx of ringCenters) {
    ctx.beginPath();
    ctx.arc(rx, -1, 4.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Twin Rectangular Rally Headlights (Left: -102..-84, Right: -36..-16)
  drawHeadlight(ctx, -102, -7.5, 18, 12.5, boost);
  drawHeadlight(ctx, -35, -7.5, 19, 12.5, boost);

  // =========================================================================
  // 5. FRONT BUMPER, SPOILER LIP & "MICHELIN" STENCILS
  // =========================================================================
  // Upper Bumper Bar
  ctx.fillStyle = '#e8d8e6';
  ctx.beginPath();
  ctx.roundRect(-110, 6, 102, 7, 1.5);
  ctx.fill();

  // Black Rub-Strip & Amber Turn Signals in Bumper
  ctx.fillStyle = '#160920';
  ctx.fillRect(-108, 8, 98, 3.5);
  // Left & Right Amber Turn Indicators
  ctx.fillStyle = '#ff7b1c';
  ctx.fillRect(-105, 8, 11, 3.5);
  ctx.fillRect(-25, 8, 12, 3.5);

  // Lower Front Valance / Splitter with Cooling Ducts + "MICHELIN" Stencils
  const lipGrad = ctx.createLinearGradient(-108, 13, -10, 24);
  lipGrad.addColorStop(0, '#d8c0d4');
  lipGrad.addColorStop(0.5, '#f2e4f0');
  lipGrad.addColorStop(1, '#c4a6be');
  ctx.fillStyle = lipGrad;
  ctx.beginPath();
  ctx.moveTo(-108, 13);
  ctx.lineTo(-8, 13);
  ctx.lineTo(-12, 23);
  ctx.lineTo(-104, 22);
  ctx.closePath();
  ctx.fill();

  // Three Black Cooling Slots in Lower Valance
  ctx.fillStyle = '#12061c';
  ctx.fillRect(-94, 14, 16, 3.5);
  ctx.fillRect(-68, 14, 20, 3.5);
  ctx.fillRect(-38, 14, 16, 3.5);

  // "MICHELIN" Sponsor Stencils on Lower Spoiler Lip
  ctx.save();
  ctx.fillStyle = '#14061e';
  ctx.font = '900 5.4px -apple-system, Helvetica, sans-serif';
  ctx.fillText('MICHELIN', -101, 21.2);
  ctx.fillText('MICHELIN', -45, 21.2);
  ctx.restore();

  // =========================================================================
  // 6. NEAR-SIDE (RIGHT) SUSPENDED RALLY WHEELS & MULTI-SPOKE WHITE RIMS
  // =========================================================================
  // Dark wheel arch cutouts
  ctx.fillStyle = '#09020e';
  ctx.beginPath();
  ctx.arc(10, 14, 22, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(74, 18, 19, Math.PI, 0);
  ctx.fill();

  // Front-Right Rally Wheel (Closest to camera — large 3D angled wheel)
  drawRallyWheel(ctx, 10, 19 + droop, 19, 25, wheelPhase);
  // Rear-Right Rally Wheel
  drawRallyWheel(ctx, 74, 22 + droop * 0.85, 16, 22, wheelPhase);

  // Red Rally Mudflaps behind wheels
  ctx.fillStyle = '#b81432';
  ctx.fillRect(24, 16, 5, 12);
  ctx.fillRect(86, 18, 5, 11);

  ctx.restore();
}

function drawHeadlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  boost: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Warm amber-gold outer bloom
  const glowR = (28 + boost * 18);
  const bloom = ctx.createRadialGradient(cx, cy, 2, cx, cy, glowR);
  bloom.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
  bloom.addColorStop(0.35, 'rgba(255, 168, 48, 0.62)');
  bloom.addColorStop(1, 'rgba(255, 80, 120, 0)');
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fill();

  // Headlight housing & blazing warm halogen reflector
  ctx.fillStyle = '#ff9d2e';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 2);
  ctx.fill();

  ctx.fillStyle = '#fff9d6';
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, w - 4, h - 4, 1.5);
  ctx.fill();

  // Horizontal anamorphic lens flare streak
  ctx.strokeStyle = `rgba(255, 232, 160, ${0.65 + boost * 0.35})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - 26 - boost * 14, cy);
  ctx.lineTo(cx + 26 + boost * 14, cy);
  ctx.stroke();
}

function drawFarTire(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#120618';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 90, 140, 0.22)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function drawRallyWheel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  wheelPhase: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Tire tread depth cylinder (3D width)
  ctx.fillStyle = '#14071c';
  ctx.beginPath();
  ctx.ellipse(-6, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer gravel tire carcass
  const tireGrad = ctx.createRadialGradient(2, -4, rx * 0.2, 0, 0, ry);
  tireGrad.addColorStop(0, '#2a1236');
  tireGrad.addColorStop(0.75, '#190822');
  tireGrad.addColorStop(1, '#0d0312');
  ctx.fillStyle = tireGrad;
  ctx.beginPath();
  ctx.ellipse(2, 0, rx * 0.86, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // White multi-spoke Speedline/Ronal Group B rally rim
  ctx.fillStyle = '#f2e8f2';
  ctx.beginPath();
  ctx.ellipse(3, 0, rx * 0.56, ry * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // Spinning rally rim spokes / cooling fins
  ctx.strokeStyle = '#3b1c4a';
  ctx.lineWidth = 1.5;
  const spokeCount = 8;
  for (let s = 0; s < spokeCount; s++) {
    const a = wheelPhase + (s * Math.PI * 2) / spokeCount;
    ctx.beginPath();
    ctx.moveTo(3 + Math.cos(a) * rx * 0.18, Math.sin(a) * ry * 0.20);
    ctx.lineTo(3 + Math.cos(a) * rx * 0.52, Math.sin(a) * ry * 0.56);
    ctx.stroke();
  }

  // Center hubcap
  ctx.fillStyle = '#1f0b2c';
  ctx.beginPath();
  ctx.ellipse(3, 0, rx * 0.16, ry * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawForegroundCrestAndBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pose: CarPose,
): void {
  // Foreground rocky gravel silhouette along the bottom-right crest
  ctx.save();
  const bannerW = Math.min(132, Math.max(92, width * 0.22));
  const bannerH = bannerW * 0.52;
  const bx = width - bannerW - 18;
  const by = height - bannerH - 26;

  // Wind flutter from passing Quattro
  const flutter = Math.sin(pose.timeSec * 14) * (1.5 + pose.boost * 4.5);

  // Two wooden/metal stakes holding the banner
  ctx.strokeStyle = '#2d0b28';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bx, by - 6);
  ctx.lineTo(bx - 3, by + bannerH + 18);
  ctx.moveTo(bx + bannerW, by + 2);
  ctx.lineTo(bx + bannerW - 3, by + bannerH + 22);
  ctx.stroke();

  // Dark navy/indigo "quattro // NITRO" cloth banner (matching bottom-right of racecar.jpeg!)
  ctx.fillStyle = 'rgba(18, 8, 36, 0.92)';
  ctx.strokeStyle = 'rgba(255, 92, 168, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(bx + bannerW * 0.5, by + 4 + flutter, bx + bannerW, by + 6);
  ctx.lineTo(bx + bannerW - 2, by + bannerH + 6);
  ctx.quadraticCurveTo(bx + bannerW * 0.5, by + bannerH + 2 + flutter, bx - 2, by + bannerH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // "quattro" bold retro typography on banner
  ctx.fillStyle = '#e8c4ec';
  ctx.font = `900 ${Math.round(bannerW * 0.16)}px -apple-system, Helvetica, sans-serif`;
  ctx.fillText('quattro', bx + 10, by + bannerH * 0.42);

  // Speed stripes + 4 rings on lower banner
  ctx.strokeStyle = '#b98bc4';
  ctx.lineWidth = 1.1;
  for (let s = 0; s < 3; s++) {
    const sy = by + bannerH * 0.58 + s * 4.2;
    ctx.beginPath();
    ctx.moveTo(bx + 10, sy);
    ctx.lineTo(bx + bannerW * 0.54, sy + 2);
    ctx.stroke();
  }

  // 4 mini rings on bottom-right of banner
  const rStart = bx + bannerW * 0.63;
  const rY = by + bannerH * 0.68;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(rStart + i * 7.2, rY + i * 0.4, 4.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
