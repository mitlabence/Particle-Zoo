// src/loop.js
// The per-frame grid rebuild + compute + render dispatch, plus FPS
// bookkeeping and the (rate-limited) pie chart readback trigger.

import { App } from './app.js';
import { state, getEffectiveRMax } from './config.js';
import { syncGridIfNeeded } from './buffers.js';
import { updatePieChart } from './pieChart.js';

export function startLoop() {
  App.lastT = performance.now();
  const fpsEl = document.getElementById('fps');

  function frame(t) {
    const rawDt = Math.min((t - App.lastT) / 1000, 1 / 30);
    // Compute effective dt scaled by speed multiplier
    const dt = rawDt * state.timeScale;
    App.lastT = t;
    App.frames++; 
    App.fpsAcc += rawDt;
    if (App.fpsAcc >= 0.5) {
      if (fpsEl) fpsEl.textContent = Math.round(App.frames / App.fpsAcc);
      App.frames = 0; 
      App.fpsAcc = 0;
    }

    if (!state.paused) {
      const {
        canvas, device, paramsData, paramsUint, paramsBuffer, computeBindGroup, renderBindGroup,
        countGridPipeline, prefixSumPipeline, scatterGridPipeline,
        velPipeline, posPipeline, decayPipeline, renderPipeline, context,
        numParticles, numTypes
      } = App;

      // Re-allocate the grid buffers if rMax or canvas size changed since
      // last frame (also runs the first time, allocating them initially).
      syncGridIfNeeded();

      const effRMax = getEffectiveRMax(canvas);

      // u32: gridSize.x, gridSize.y (must match what ensureGridBuffers just sized)
      paramsUint[0] = App.gridWidth;
      paramsUint[1] = App.gridHeight;
      // f32: scalars
      paramsData[2] = canvas.width;
      paramsData[3] = canvas.height;
      paramsData[4] = effRMax;
      paramsData[5] = dt;
      paramsData[6] = state.friction;
      paramsData[7] = state.forceScale;
      // u32: numParticles, numTypes
      paramsUint[8] = numParticles;
      paramsUint[9] = numTypes;
      // f32: remaining parameters & padding
      paramsData[10] = Math.random() * 10000.0;
      paramsData[11] = state.enableDecay ? 1.0 : 0.0;
      paramsData[12] = state.fusionThreshold; // fusionThreshold (relative speed in px/s)
      paramsData[13] = state.fusionDistance; // fusionDistance (collision radius in px)
      paramsData[14] = 0.0; // _pad1
      paramsData[15] = 0.0; // _pad2

      device.queue.writeBuffer(paramsBuffer, 0, paramsData);
      // Clear per-cell counters before rebuilding the grid this frame.
      device.queue.writeBuffer(App.cellCountsBuffer, 0, App.zeroCellCounts);

      const encoder = device.createCommandEncoder();
      const workgroups = Math.ceil(numParticles / 64);

      const cpass = encoder.beginComputePass();
      cpass.setBindGroup(0, computeBindGroup);

      // Rebuild the uniform grid: count particles per cell, prefix-sum into
      // offsets, then scatter particle indices into contiguous per-cell
      // ranges. Must run before updateVelocity, which reads the result.
      cpass.setPipeline(countGridPipeline);
      cpass.dispatchWorkgroups(workgroups);
      cpass.setPipeline(prefixSumPipeline);
      cpass.dispatchWorkgroups(1); // single-threaded scan, see physics.wgsl.js
      cpass.setPipeline(scatterGridPipeline);
      cpass.dispatchWorkgroups(workgroups);

      // Physics: updateVelocity and updateDecay (kinetic fusion) both only
      // scan neighboring grid cells now instead of every other particle.
      // decayPipeline runs *before* posPipeline so its neighbor search sees
      // the same positions the grid above was built from - if it ran after
      // the position update, particles could have drifted into different
      // cells than the ones cellOffsets/cellCounts/sortedIndices describe.
      // Any velocity change from fusion/fission then still gets applied to
      // this frame's position update, so nothing is lost by the reorder.
      cpass.setPipeline(velPipeline);
      cpass.dispatchWorkgroups(workgroups);
      cpass.setPipeline(decayPipeline);
      cpass.dispatchWorkgroups(workgroups);
      cpass.setPipeline(posPipeline);
      cpass.dispatchWorkgroups(workgroups);
      cpass.end();

      const view = context.getCurrentTexture().createView();
      const rpass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.03, g: 0.03, b: 0.047, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }]
      });
      rpass.setPipeline(renderPipeline);
      rpass.setBindGroup(0, renderBindGroup);
      rpass.draw(6, numParticles);
      rpass.end();

      device.queue.submit([encoder.finish()]);
    }

    updatePieChart(t);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
