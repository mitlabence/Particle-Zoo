// src/gpuSetup.js
// One-time WebGPU setup: adapter/device/context, canvas resize handling,
// shader module compilation, bind group layouts, and pipelines. None of
// this needs to be redone when particle counts/types change at runtime.

import { App } from './app.js';
import { commonShaderCode } from './shaders/common.wgsl.js';
import { physicsShaderCode } from './shaders/physics.wgsl.js';
import { vertexShaderCode } from './shaders/vertex.wgsl.js';

/**
 * Initializes the WebGPU device/context and builds pipelines.
 * Returns false if WebGPU isn't available so the caller can show the
 * "unsupported" message.
 */
export async function initGPU(canvas) {
  if (!navigator.gpu) return false;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return false;

  App.canvas = canvas;
  App.device = await adapter.requestDevice();
  App.context = canvas.getContext('webgpu');
  App.format = navigator.gpu.getPreferredCanvasFormat();

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  App.paramsBuffer = App.device.createBuffer({
    size: App.paramsData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const computeModule = App.device.createShaderModule({
    label: "Physics Compute Module",
    code: commonShaderCode + '\n' + physicsShaderCode
  });
  console.log("Successful compile of compute shader module");

  const renderModule = App.device.createShaderModule({
    label: "Render Shader Module",
    code: commonShaderCode + '\n' + vertexShaderCode
  });
  console.log("Successful compile of render shader module");

  // Bind Group Layouts
  App.computeBGL = App.device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      // Uniform grid buffers (neighbor search). All three need read_write
      // (i.e. 'storage', not 'read-only-storage') because different passes
      // in the count -> prefix sum -> scatter -> force pipeline write to
      // them - even though a single pass like updateVelocity only reads.
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // cellCounts (atomic)
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // cellOffsets
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // sortedIndices
    ]
  });
  App.renderBGL = App.device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ]
  });

  // Pipelines
  const computeLayout = App.device.createPipelineLayout({ bindGroupLayouts: [App.computeBGL] });

  // Grid rebuild pipeline (runs once per frame, before the physics passes)
  App.countGridPipeline = App.device.createComputePipeline({
    layout: computeLayout,
    compute: { module: computeModule, entryPoint: 'countGrid' }
  });
  App.prefixSumPipeline = App.device.createComputePipeline({
    layout: computeLayout,
    compute: { module: computeModule, entryPoint: 'prefixSum' }
  });
  App.scatterGridPipeline = App.device.createComputePipeline({
    layout: computeLayout,
    compute: { module: computeModule, entryPoint: 'scatterGrid' }
  });

  // Physics pipelines
  App.velPipeline = App.device.createComputePipeline({
    layout: computeLayout,
    compute: { module: computeModule, entryPoint: 'updateVelocity' }
  });
  App.posPipeline = App.device.createComputePipeline({
    layout: computeLayout,
    compute: { module: computeModule, entryPoint: 'updatePosition' }
  });
  App.decayPipeline = App.device.createComputePipeline({
    layout: computeLayout,
    compute: { module: computeModule, entryPoint: 'updateDecay' }
  });
  App.renderPipeline = App.device.createRenderPipeline({
    layout: App.device.createPipelineLayout({ bindGroupLayouts: [App.renderBGL] }),
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: {
      module: renderModule, entryPoint: 'fs',
      targets: [{
        format: App.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        }
      }]
    },
    primitive: { topology: 'triangle-list' },
  });

  return true;
}

export function resizeCanvas() {
  const { canvas, device, context, format } = App;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  context.configure({ device, format, alphaMode: 'opaque' });
}
