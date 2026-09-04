// src/app.js
// Centralized mutable state shared across modules. Every module that needs
// GPU handles, buffers, or per-type data reads/writes through this object
// instead of relying on closures, so responsibilities can live in separate
// files without a tangle of function arguments.

const paramsArrayBuffer = new ArrayBuffer(64); // 64 bytes total

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
  // Shared 64-byte views for Params Uniforms (u32 and f32)
  paramsData: new Float32Array(paramsArrayBuffer),
  paramsUint: new Uint32Array(paramsArrayBuffer),

  // --- Uniform spatial grid (neighbor search) ---
  // Resolution of the grid, recomputed whenever rMax or the canvas size
  // changes (see buffers.js: computeGridDims / ensureGridBuffers).
  gridWidth: 0,
  gridHeight: 0,
  totalCells: 0,
  // atomic<u32> per cell: particle count (built each frame by countGrid,
  // consumed as write-cursor by scatterGrid, read as neighbor count by
  // updateVelocity).
  cellCountsBuffer: null,
  // u32 per cell: start index of that cell's range inside sortedIndices,
  // computed once per frame by the single-threaded prefixSum pass.
  cellOffsetsBuffer: null,
  // u32 per particle: particle indices grouped contiguously by cell.
  sortedIndicesBuffer: null,
  // Cached zeroed array used to clear cellCountsBuffer every frame.
  zeroCellCounts: null,

  // Bind group layouts / pipelines (created once in gpuSetup.js)
  computeBGL: null,
  renderBGL: null,
  countGridPipeline: null,
  prefixSumPipeline: null,
  scatterGridPipeline: null,
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
