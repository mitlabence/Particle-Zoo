// src/app.js
// Centralized mutable state shared across modules. Every module that needs
// GPU handles, buffers, or per-type data reads/writes through this object
// instead of relying on closures, so responsibilities can live in separate
// files without a tangle of function arguments.

export const App = {
  // Canvas / GPU core
  canvas: null,
  device: null,
  context: null,
  format: null,

  // Particle configuration
  numTypes: 0,
  perType: 0,
  numParticles: 0,

  // Per-type data (parallel arrays, index = type id)
  typeColors: [],
  typeMasses: [],
  typeDecayRates: [],

  // CPU-side typed arrays mirrored to GPU buffers
  particleData: null,
  matrixData: null,
  colorData: null,
  massData: null,
  decayRates: null,

  // GPU buffers
  particleBuffer: null,
  matrixBuffer: null,
  colorBuffer: null,
  massBuffer: null,
  decayBuffer: null,
  readbackBuffer: null,
  paramsBuffer: null,
  paramsData: new Float32Array(12),

  // Bind group layouts / pipelines (created once in gpuSetup.js)
  computeBGL: null,
  renderBGL: null,
  velPipeline: null,
  posPipeline: null,
  decayPipeline: null,
  renderPipeline: null,

  // Bind groups (recreated whenever buffers are rebuilt)
  computeBindGroup: null,
  renderBindGroup: null,

  // Pie chart readback bookkeeping
  lastPieUpdate: 0,
  isMapping: false,

  // FPS bookkeeping
  lastT: 0,
  frames: 0,
  fpsAcc: 0,
};
