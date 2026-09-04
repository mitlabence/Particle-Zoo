// src/buffers.js
// Allocation/rebuilding of all per-particle and per-type GPU buffers, plus
// the "randomize" and "reset" actions exposed by the control panel.

import { App } from './app.js';
import { state, getEffectiveRMax } from './config.js';
import { generatePaletteAndMasses, sortAndSyncMassHierarchy, sampleLifetime } from './palette.js';
import { renderMatrixUI, renderLegendUI } from './ui/render.js';

export function createReadbackBuffer() {
  if (App.readbackBuffer) App.readbackBuffer.destroy();
  App.readbackBuffer = App.device.createBuffer({
    size: App.particleData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
}

/**
 * Grid resolution for the current canvas size + rMax. Uses the same
 * device-pixel-scaled rMax that gets sent to the shader (see
 * config.js:getEffectiveRMax) so the CPU-allocated grid and the grid the
 * shader walks always agree on dimensions.
 */
export function computeGridDims() {
  const rMax = getEffectiveRMax(App.canvas);
  const gridWidth = Math.max(1, Math.ceil(App.canvas.width / rMax));
  const gridHeight = Math.max(1, Math.ceil(App.canvas.height / rMax));
  return { gridWidth, gridHeight, totalCells: gridWidth * gridHeight };
}

/**
 * (Re)allocates the uniform-grid buffers whose size depends on grid
 * resolution (cellCounts / cellOffsets), whenever rMax or the canvas size
 * changes. sortedIndices is allocated in rebuildBuffers() instead, since
 * its size depends on particle count, not grid resolution.
 * Returns true if a reallocation happened (caller must rebuild the bind
 * group referencing these buffers).
 */
export function ensureGridBuffers() {
  const { device } = App;
  const { gridWidth, gridHeight, totalCells } = computeGridDims();

  if (totalCells === App.totalCells && App.cellCountsBuffer && App.cellOffsetsBuffer) {
    return false; // grid resolution unchanged, nothing to do
  }

  App.gridWidth = gridWidth;
  App.gridHeight = gridHeight;
  App.totalCells = totalCells;

  if (App.cellCountsBuffer) App.cellCountsBuffer.destroy();
  App.cellCountsBuffer = device.createBuffer({
    size: totalCells * 4, // atomic<u32> per cell
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  // Reused every frame to clear cellCounts before the grid rebuild passes.
  App.zeroCellCounts = new Uint32Array(totalCells);

  if (App.cellOffsetsBuffer) App.cellOffsetsBuffer.destroy();
  App.cellOffsetsBuffer = device.createBuffer({
    size: totalCells * 4, // u32 per cell
    usage: GPUBufferUsage.STORAGE,
  });

  return true;
}

/**
 * Recreates App.computeBindGroup from whatever buffers currently live on
 * App. Call this any time one of the bound buffers has been reallocated
 * (particle count changed, or the grid was resized).
 */
function rebuildComputeBindGroup() {
  App.computeBindGroup = App.device.createBindGroup({
    layout: App.computeBGL,
    entries: [
      { binding: 0, resource: { buffer: App.particleBuffer } },
      { binding: 1, resource: { buffer: App.paramsBuffer } },
      { binding: 2, resource: { buffer: App.matrixBuffer } },
      { binding: 3, resource: { buffer: App.massBuffer } },
      { binding: 4, resource: { buffer: App.decayBuffer } },
      { binding: 5, resource: { buffer: App.cellCountsBuffer } },
      { binding: 6, resource: { buffer: App.cellOffsetsBuffer } },
      { binding: 7, resource: { buffer: App.sortedIndicesBuffer } },
    ]
  });
}

/**
 * Called once per frame from the render loop. Re-syncs the grid buffers if
 * rMax or canvas size changed since the last frame (e.g. window resize, or
 * the "Interaction radius" slider), and rebuilds the compute bind group if
 * so. Cheap no-op most frames.
 */
export function syncGridIfNeeded() {
  if (ensureGridBuffers()) {
    rebuildComputeBindGroup();
  }
}

/**
 * (Re)initializes all GPU memory buffers based on current numTypes/perType,
 * and rebuilds the bind groups + UI that depend on them.
 */
export function rebuildBuffers() {
  const { device, canvas, renderBGL } = App;
  App.numParticles = App.numTypes * App.perType;
  generatePaletteAndMasses(App.numTypes);

  // 1. Particle Buffer Creation
  App.particleData = new Float32Array(App.numParticles * 6); // 6 floats per struct (pos, vel, type, pad)
  for (let i = 0; i < App.numParticles; i++) {
    const type = i % App.numTypes;
    const lambda = App.typeDecayRates[type]; // Poisson decay rate for this particle type
    const o = i * 6;
    App.particleData[o + 0] = Math.random() * canvas.width;
    App.particleData[o + 1] = Math.random() * canvas.height;
    App.particleData[o + 2] = 0; // vel x
    App.particleData[o + 3] = 0; // vel y
    App.particleData[o + 4] = type;
    App.particleData[o + 5] = sampleLifetime(lambda); // Initial pre-rolled lifetime
  }

  if (App.particleBuffer) App.particleBuffer.destroy();
  App.particleBuffer = device.createBuffer({
    size: App.particleData.byteLength,
    // CRITICAL: COPY_SRC must be enabled to copy particleBuffer -> readbackBuffer
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(App.particleBuffer, 0, App.particleData);

  // 2. Interaction Matrix Buffer Creation
  App.matrixData = new Float32Array(App.numTypes * App.numTypes);
  for (let i = 0; i < App.matrixData.length; i++) {
    App.matrixData[i] = (Math.random() * 2 - 1);
  }
  if (App.matrixBuffer) App.matrixBuffer.destroy();
  App.matrixBuffer = device.createBuffer({
    size: App.matrixData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(App.matrixBuffer, 0, App.matrixData);

  // 3. Color and Mass Buffer Creation
  App.colorData = new Float32Array(App.numTypes * 4);
  App.typeColors.forEach((c, i) => {
    App.colorData[i * 4 + 0] = c[0];
    App.colorData[i * 4 + 1] = c[1];
    App.colorData[i * 4 + 2] = c[2];
    App.colorData[i * 4 + 3] = 1.0;
  });
  if (App.colorBuffer) App.colorBuffer.destroy();
  App.colorBuffer = device.createBuffer({
    size: App.colorData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(App.colorBuffer, 0, App.colorData);

  // Ensure massData float array length is padded to a multiple of 4 (16 bytes)
  const paddedTypeCount = Math.ceil(App.numTypes / 4) * 4;
  App.massData = new Float32Array(paddedTypeCount);
  App.decayRates = new Float32Array(paddedTypeCount);

  App.typeMasses.forEach((m, i) => { App.massData[i] = m; });
  App.typeDecayRates.forEach((r, i) => { App.decayRates[i] = r; });

  if (App.massBuffer) App.massBuffer.destroy();
  App.massBuffer = device.createBuffer({
    size: App.massData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(App.massBuffer, 0, App.massData);

  if (App.decayBuffer) App.decayBuffer.destroy();
  App.decayBuffer = device.createBuffer({
    size: App.decayRates.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(App.decayBuffer, 0, App.decayRates);

  // 4. Sorted-indices buffer: one u32 slot per particle, filled in by the
  // scatterGrid compute pass every frame. Sized by particle count, so it's
  // rebuilt here rather than in ensureGridBuffers().
  if (App.sortedIndicesBuffer) App.sortedIndicesBuffer.destroy();
  App.sortedIndicesBuffer = device.createBuffer({
    size: App.numParticles * 4,
    usage: GPUBufferUsage.STORAGE,
  });

  // 5. Grid buffers (cellCounts / cellOffsets) sized by grid resolution.
  ensureGridBuffers();

  createReadbackBuffer(); // for pie chart readback

  // 6. Re-bind GPU resources to Bind Groups
  rebuildComputeBindGroup();
  App.renderBindGroup = device.createBindGroup({
    layout: renderBGL,
    entries: [
      { binding: 0, resource: { buffer: App.particleBuffer } },
      { binding: 1, resource: { buffer: App.paramsBuffer } },
      { binding: 2, resource: { buffer: App.colorBuffer } },
      { binding: 3, resource: { buffer: App.massBuffer } },
    ]
  });

  // Update HUD & UI Grid
  document.getElementById('hudParticles').textContent = App.numParticles.toLocaleString();
  document.getElementById('hudTypes').textContent = App.numTypes;
  renderMatrixUI();
  renderLegendUI();
}

export function randomizeMatrix() {
  for (let i = 0; i < App.matrixData.length; i++) {
    App.matrixData[i] = (Math.random() * 2 - 1);
  }
  App.device.queue.writeBuffer(App.matrixBuffer, 0, App.matrixData);
  renderMatrixUI();
}

export function randomizeMasses() {
  let raw = [];
  for (let i = 0; i < App.numTypes; i++) {
    const randomMass = 0.5 + Math.random() * 9.5;
    raw.push({
      color: App.typeColors[i],
      mass: parseFloat(randomMass.toFixed(2))
    });
  }

  sortAndSyncMassHierarchy(raw);

  renderMatrixUI();
  renderLegendUI();
}

export function resetPositions() {
  const { canvas, particleData, particleBuffer, device, numParticles } = App;
  for (let i = 0; i < numParticles; i++) {
    const o = i * 6;
    particleData[o + 0] = Math.random() * canvas.width;
    particleData[o + 1] = Math.random() * canvas.height;
    particleData[o + 2] = 0;
    particleData[o + 3] = 0;
  }
  device.queue.writeBuffer(particleBuffer, 0, particleData);
}
