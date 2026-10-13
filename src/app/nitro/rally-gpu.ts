import { Canvas, GPU, GPUBufferUsage, GPUShaderStage } from '@nativescript/canvas';
import type {
  GPUBindGroup,
  GPUBuffer,
  GPUCanvasContext,
  GPUDevice,
  GPURenderPipeline,
} from '@nativescript/canvas';

export const RALLY_PARTICLE_COUNT = 96;

/**
 * Uniform buffer layout (16 floats = 64 bytes, 16-byte aligned vec4s):
 * - u.view:   vec4<f32>(width, height, timeSec, flybyProgress)
 * - u.car:    vec4<f32>(carX, carY, carPitchRad, boostEnergy)
 * - u.fx:     vec4<f32>(speedupRatio, dustIntensity, shockwaveTime, hingeOpenness)
 * - u.sun:    vec4<f32>(sunX, sunY, sunRadius, cameraShake)
 */
const UNIFORM_FLOATS = 16;

const RALLY_WGSL = /* wgsl */ `
struct RallyUniforms {
  view : vec4<f32>,
  car  : vec4<f32>,
  fx   : vec4<f32>,
  sun  : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : RallyUniforms;

struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv        : vec2<f32>,
};

fn hash21(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise2(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  let a = hash21(i + vec2<f32>(0.0, 0.0));
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}

fn fbm(p_in : vec2<f32>) -> f32 {
  var p = p_in;
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 4; i = i + 1) {
    v += a * noise2(p);
    p = p * 2.04 + vec2<f32>(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

@vertex
fn backdropVs(@builtin(vertex_index) vid : u32) -> VsOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  let c = corners[vid];
  var out : VsOut;
  out.pos = vec4<f32>(c, 0.0, 1.0);
  out.uv = vec2<f32>(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  return out;
}

@fragment
fn backdropFs(in : VsOut) -> @location(0) vec4<f32> {
  let w = max(1.0, u.view.x);
  let h = max(1.0, u.view.y);
  let aspect = w / h;
  let t = u.view.z;
  let boost = u.car.w;
  let dust = u.fx.y;

  // Subtle camera shake during peak flyby
  let shake = u.sun.w * 0.008 * vec2<f32>(sin(t * 62.0), cos(t * 79.0));
  let uv = in.uv + shake;

  // 1. Synthwave Sunset Sky Gradient (Violet -> Neon Magenta -> Fiery Orange -> Gold)
  let zenith   = vec3<f32>(0.20, 0.03, 0.42);
  let midSky   = vec3<f32>(0.92, 0.09, 0.50);
  let lowSky   = vec3<f32>(1.00, 0.34, 0.18);
  let horizon  = vec3<f32>(1.00, 0.76, 0.22);

  var col = mix(zenith, midSky, smoothstep(0.0, 0.34, uv.y));
  col = mix(col, lowSky, smoothstep(0.28, 0.54, uv.y));
  col = mix(col, horizon, smoothstep(0.46, 0.66, uv.y));

  // Sweeping magenta/gold sunset cloud bands in upper sky
  if (uv.y < 0.64) {
    let cloudUv = vec2<f32>(uv.x * 3.4 - t * (0.08 + boost * 0.25), uv.y * 9.0);
    let cNoise = fbm(cloudUv);
    let cloudMask = smoothstep(0.42, 0.78, cNoise) * (1.0 - smoothstep(0.48, 0.64, uv.y));
    let cloudTint = mix(vec3<f32>(1.0, 0.22, 0.62), vec3<f32>(1.0, 0.82, 0.30), uv.y * 1.6);
    col = mix(col, cloudTint, cloudMask * 0.55);
  }

  // 2. Retro Sliced Synthwave Sun on the Right Horizon (matching racecar.jpeg)
  let sunCenter = vec2<f32>(u.sun.x, u.sun.y);
  let sunDelta = vec2<f32>((uv.x - sunCenter.x) * aspect, uv.y - sunCenter.y);
  let sunDist = length(sunDelta);
  let sunRad = u.sun.z;

  // Solar corona glow
  let sunGlow = exp(-sunDist * 4.2) * 0.72 + exp(-sunDist * 11.0) * 0.45;
  col += vec3<f32>(1.0, 0.58, 0.16) * sunGlow;

  if (sunDist < sunRad) {
    let sunGrad = clamp((uv.y - (sunCenter.y - sunRad)) / (2.0 * sunRad), 0.0, 1.0);
    // Horizontal retro scanline slices in the lower half of the sun
    let sliceFreq = 38.0;
    let sliceWave = sin(uv.y * sliceFreq * 3.14159 - t * 1.8);
    let sliceCut = step(sunGrad * 1.35 - 0.52, sliceWave);
    let sunDiscCol = mix(vec3<f32>(1.0, 0.96, 0.55), vec3<f32>(1.0, 0.36, 0.22), sunGrad);
    let edgeSoft = 1.0 - smoothstep(sunRad * 0.93, sunRad, sunDist);
    col = mix(col, sunDiscCol, edgeSoft * sliceCut);
  }

  // 3. Distant Purple/Magenta Mountain Ranges + Valley Lake Sun Reflection
  let m1 = 0.54 + 0.055 * sin(uv.x * 5.2 + 0.5) + 0.025 * cos(uv.x * 13.0);
  let m2 = 0.60 + 0.048 * sin(uv.x * 4.1 + 2.1) + 0.022 * sin(uv.x * 11.3);
  if (uv.y > m1) {
    let mDepth = clamp((uv.y - m1) / 0.18, 0.0, 1.0);
    let farMtn = mix(vec3<f32>(0.68, 0.12, 0.48), vec3<f32>(0.34, 0.06, 0.36), mDepth);
    col = mix(col, farMtn, 0.82);
  }
  if (uv.y > m2) {
    let midMtn = vec3<f32>(0.26, 0.04, 0.30);
    col = mix(col, midMtn, 0.88);
  }

  // Shimmering golden lake reflection below the sun (x ~ sunCenter.x, y ~ 0.61..0.72)
  if (uv.y > 0.58 && uv.y < 0.74) {
    let lakeDx = abs(uv.x - sunCenter.x) * aspect;
    let ripple = 0.014 * sin(uv.y * 190.0 - t * 6.0);
    let reflMask = exp(-pow((lakeDx + ripple) * 9.5, 2.0)) * smoothstep(0.58, 0.62, uv.y) * (1.0 - smoothstep(0.68, 0.74, uv.y));
    col += vec3<f32>(1.0, 0.74, 0.24) * reflMask * 0.85;
  }

  // 4. Rooster-Tail Dust Plume Behind the Jumping Quattro
  let carUv = vec2<f32>(u.car.x / w, u.car.y / h);
  let plumeCenter = carUv + vec2<f32>(0.16, 0.11);
  let plumeDelta = vec2<f32>((uv.x - plumeCenter.x) * aspect * 0.75, uv.y - plumeCenter.y);
  let plumeNoise = fbm(uv * 7.5 - vec2<f32>(t * 1.4, -t * 0.6));
  let plumeDist = length(plumeDelta) - plumeNoise * 0.12;
  let plumeGlow = exp(-max(0.0, plumeDist) * 5.8) * (0.45 + dust * 0.85);
  col += vec3<f32>(1.0, 0.22, 0.38) * plumeGlow;

  // 5. Foreground Sloped Rally Dirt Ridge (rising from left to right crest)
  let ridgeY = 0.64 + 0.23 * uv.x + 0.022 * sin(uv.x * 8.5 - 1.1) + 0.008 * fbm(vec2<f32>(uv.x * 24.0, uv.y * 12.0));
  if (uv.y > ridgeY) {
    let dirtDepth = clamp((uv.y - ridgeY) / 0.28, 0.0, 1.0);
    let grit = fbm(vec2<f32>(uv.x * 48.0 - t * (0.4 + boost * 3.2), uv.y * 36.0));
    var dirtCol = mix(vec3<f32>(0.42, 0.07, 0.24), vec3<f32>(0.11, 0.02, 0.12), dirtDepth);
    dirtCol += vec3<f32>(0.65, 0.14, 0.34) * (1.0 - dirtDepth) * grit * 0.55;
    // Rim highlight along the dirt crest
    let crestRim = exp(-abs(uv.y - ridgeY) * 95.0);
    dirtCol += vec3<f32>(1.0, 0.32, 0.55) * crestRim * 0.65;
    col = dirtCol;
  }

  // 6. Volumetric Twin Headlight Beams & Underbody Neon Bounce
  let toFront = uv - (carUv + vec2<f32>(-0.12, 0.01));
  let beamDist = length(vec2<f32>(toFront.x * aspect, toFront.y));
  let beamAngle = dot(normalize(vec2<f32>(toFront.x * aspect, toFront.y + 0.0001)), normalize(vec2<f32>(-0.92, 0.38)));
  let cone = smoothstep(0.76, 0.99, beamAngle) * exp(-beamDist * 3.4) * (0.55 + boost * 0.65);
  col += vec3<f32>(1.0, 0.78, 0.32) * cone;

  // Shockwave ring on benchmark trigger
  let ringAge = t - u.fx.z;
  if (ringAge > 0.0 && ringAge < 1.15) {
    let ringR = ringAge * 0.85;
    let dCar = length(vec2<f32>((uv.x - carUv.x) * aspect, uv.y - carUv.y));
    let ringBand = exp(-pow((dCar - ringR) * 28.0, 2.0)) * (1.0 - ringAge / 1.15);
    col += vec3<f32>(1.0, 0.55, 0.85) * ringBand * 0.65;
  }

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

struct ParticleOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) localUv   : vec2<f32>,
  @location(1) color     : vec4<f32>,
};

@vertex
fn particleVs(
  @builtin(vertex_index) vid : u32,
  @builtin(instance_index) iid : u32
) -> ParticleOut {
  var quad = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  let q = quad[vid];
  let w = max(1.0, u.view.x);
  let h = max(1.0, u.view.y);
  let t = u.view.z;
  let boost = u.car.w;

  let fi = f32(iid);
  let seed = vec2<f32>(fi * 1.17, fi * 3.71);
  let r1 = hash21(seed);
  let r2 = hash21(seed + vec2<f32>(7.3, 2.9));
  let r3 = hash21(seed + vec2<f32>(13.1, 5.7));

  let cycle = fract(t * (0.9 + r1 * 1.4 + boost * 1.2) + r2);
  // Spawn behind the rear tires of the Quattro and spray up/right in a rooster tail
  let origin = vec2<f32>(u.car.x + 42.0 + r3 * 45.0, u.car.y + 30.0 + (r1 - 0.5) * 22.0);
  let vel = vec2<f32>(
    (95.0 + r1 * 190.0) * (0.65 + boost * 0.95),
    (-35.0 - r2 * 115.0) * (0.55 + boost * 0.85) + cycle * 95.0
  );
  let pPos = origin + vel * cycle;
  let radius = mix(3.5, 16.0, r3) * (1.0 + boost * 0.7) * sin(cycle * 3.14159);

  let world = pPos + q * radius;
  let ndc = vec2<f32>((world.x / w) * 2.0 - 1.0, 1.0 - (world.y / h) * 2.0);

  var out : ParticleOut;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  out.localUv = q;

  // Alternate between glowing amber turbo sparks and magenta/orange rally dust
  let isSpark = step(0.68, r1);
  let dustCol = vec3<f32>(1.0, 0.25 + r2 * 0.3, 0.45);
  let sparkCol = vec3<f32>(1.0, 0.84, 0.32);
  let rgb = mix(dustCol, sparkCol, isSpark);
  let alpha = (1.0 - cycle) * (0.35 + u.fx.y * 0.65);
  out.color = vec4<f32>(rgb * alpha, alpha);
  return out;
}

@fragment
fn particleFs(in : ParticleOut) -> @location(0) vec4<f32> {
  let d = length(in.localUv);
  let soft = exp(-d * d * 3.2) * smoothstep(1.0, 0.2, d);
  return vec4<f32>(in.color.rgb * soft, in.color.a * soft);
}
`;

const ADDITIVE_BLEND = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
};

export interface RallyGpuState {
  width: number;
  height: number;
  timeSec: number;
  flybyProgress: number;
  carX: number;
  carY: number;
  carPitchRad: number;
  boostEnergy: number;
  speedupRatio: number;
  dustIntensity: number;
  shockwaveTime: number;
  hingeOpenness: number;
  cameraShake: number;
}

const LOST_AFTER_FRAMES = 90;
const STALLED_FRAME_MS = 250;
const LOST_AFTER_STALLS = 2;

export class RallyGpuField {
  private readonly uniformsData = new Float32Array(UNIFORM_FLOATS);
  private configured = false;
  private missedFrames = 0;
  private stalledFrames = 0;
  private readonly nativeViewRef: unknown;

  private constructor(
    private readonly canvas: Canvas,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: string,
    private readonly uniformBuffer: GPUBuffer,
    private readonly bindGroup: GPUBindGroup,
    private readonly backdropPipeline: GPURenderPipeline,
    private readonly particlePipeline: GPURenderPipeline,
  ) {
    this.nativeViewRef = canvas.nativeView;
    if (__ANDROID__) {
      canvas.on('surfaceCreated', () => this.configure());
      canvas.on('surfaceResize', () => this.configure());
      canvas.on('surfaceDestroyed', () => {
        this.configured = false;
      });
    }
  }

  static async create(canvas: Canvas): Promise<RallyGpuField | null> {
    try {
      const scope = globalThis as any;
      scope.navigator ??= {};
      scope.navigator.gpu ??= new GPU();
      const gpu = scope.navigator.gpu as GPU;

      const adapter = await gpu.requestAdapter();
      const device = (await adapter?.requestDevice()) as unknown as GPUDevice;
      const context = canvas.getContext('webgpu');
      if (!device || !context) {
        return null;
      }
      const format = gpu.getPreferredCanvasFormat();
      const module = device.createShaderModule({ code: RALLY_WGSL });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      } as any);

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      const uniformBuffer = device.createBuffer({
        size: UNIFORM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      } as any);

      const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      } as any);

      const backdropPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'backdropVs' },
        fragment: { module, entryPoint: 'backdropFs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      } as any);

      const particlePipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'particleVs' },
        fragment: {
          module,
          entryPoint: 'particleFs',
          targets: [{ format, blend: ADDITIVE_BLEND }],
        },
        primitive: { topology: 'triangle-strip' },
      } as any);

      return new RallyGpuField(
        canvas,
        device,
        context,
        format,
        uniformBuffer,
        bindGroup,
        backdropPipeline,
        particlePipeline,
      );
    } catch (err) {
      console.warn('RallyGpuField WebGPU init fallback to 2D:', err);
      return null;
    }
  }

  get alive(): boolean {
    return !!this.nativeViewRef && this.canvas.nativeView === this.nativeViewRef;
  }

  get lost(): boolean {
    return this.missedFrames >= LOST_AFTER_FRAMES || this.stalledFrames >= LOST_AFTER_STALLS;
  }

  resize(width: number, height: number, scale: number): void {
    if (!this.alive || width <= 0 || height <= 0) {
      return;
    }
    this.canvas.width = Math.round(width * scale);
    this.canvas.height = Math.round(height * scale);
    this.uniformsData[0] = width;
    this.uniformsData[1] = height;
    this.configure();
  }

  private configure(): void {
    if (!this.alive || this.uniformsData[0] <= 0 || this.uniformsData[1] <= 0) {
      return;
    }
    const options: Record<string, unknown> = {
      device: this.device,
      format: this.format,
      alphaMode: __ANDROID__ ? 'inherit' : 'opaque',
      presentMode: 'fifo',
    };
    if (__ANDROID__) {
      options.size = [this.canvas.width, this.canvas.height];
    }
    this.context.configure(options as any);
    this.configured = true;
  }

  render(state: RallyGpuState): boolean {
    if (!this.configured || !this.alive || this.lost) {
      return false;
    }
    const u = this.uniformsData;
    u[0] = state.width;
    u[1] = state.height;
    u[2] = state.timeSec;
    u[3] = state.flybyProgress;

    u[4] = state.carX;
    u[5] = state.carY;
    u[6] = state.carPitchRad;
    u[7] = state.boostEnergy;

    u[8] = state.speedupRatio;
    u[9] = state.dustIntensity;
    u[10] = state.shockwaveTime;
    u[11] = state.hingeOpenness;

    u[12] = 0.80; // sunX
    u[13] = 0.44; // sunY
    u[14] = 0.16; // sunRadius
    u[15] = state.cameraShake;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, u.buffer, 0, u.byteLength);

    const began = Date.now();
    const texture = (this.context as any).getCurrentTexture?.();
    const view = texture?.createView?.();
    if (!view) {
      this.missedFrames++;
      this.stall(began);
      return false;
    }
    this.missedFrames = 0;

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.14, g: 0.02, b: 0.25, a: 1 },
        },
      ],
    } as any);

    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.backdropPipeline);
    pass.draw(6);

    pass.setPipeline(this.particlePipeline);
    pass.draw(4, RALLY_PARTICLE_COUNT);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    (this.context as any).presentSurface?.();
    this.stall(began);
    return true;
  }

  private stall(began: number): void {
    this.stalledFrames = Date.now() - began > STALLED_FRAME_MS ? this.stalledFrames + 1 : 0;
  }

  dispose(): void {
    this.configured = false;
    if (!this.alive) {
      return;
    }
    try {
      (this.context as any).unconfigure?.();
      this.uniformBuffer.destroy();
    } catch {}
  }
}
