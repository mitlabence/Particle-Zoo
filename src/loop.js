// src/loop.js
// The per-frame compute + render dispatch, plus FPS bookkeeping and the
// (rate-limited) pie chart readback trigger.

import { App } from './app.js';
import { state } from './config.js';
import { updatePieChart } from './pieChart.js';

export function startLoop() {
  App.lastT = performance.now();
  const fpsEl = document.getElementById('fps');

  function frame(t) {
    const rawDt = Math.min((t - App.lastT) / 1000, 1 / 30);
    // Compute effective dt scaled by speed multiplier
    const dt = rawDt * state.timeScale;
    App.lastT = t;
    App.frames++; App.fpsAcc += dt;
    if (App.fpsAcc >= 0.5) {
      fpsEl.textContent = Math.round(App.frames / App.fpsAcc);
      App.frames = 0; App.fpsAcc = 0;
    }

    if (!state.paused) {
      const {
        canvas, device, paramsData, paramsBuffer, computeBindGroup, renderBindGroup,
        velPipeline, posPipeline, decayPipeline, renderPipeline, context,
        numParticles, numTypes
      } = App;

      /*
      struct Params {
        width: f32,
        height: f32,
        rMax: f32,
        dt: f32,
        friction: f32,
        forceScale: f32,
        numParticles: f32,
        numTypes: f32,
        seed: f32,
        enableDecay: f32, // 1.0 = active decay, 0.0 = decay disabled
        fusionThreshold: f32, // Relative velocity threshold for kinetic fusion (in pixels/sec)
        fusionDistance: f32,  // Distance threshold for kinetic fusion (in pixels)
      };
      */
      paramsData[0] = canvas.width;
      paramsData[1] = canvas.height;
      paramsData[2] = state.rMax * (canvas.width / (canvas.clientWidth || canvas.width));
      paramsData[3] = dt;
      paramsData[4] = state.friction;
      paramsData[5] = state.forceScale;
      paramsData[6] = numParticles;
      paramsData[7] = numTypes;
      paramsData[8] = Math.random() * 10000.0;
      paramsData[9] = state.enableDecay ? 1.0 : 0.0;
      paramsData[10] = state.fusionThreshold; // fusionThreshold (relative speed in px/s)
      paramsData[11] = state.fusionDistance; // fusionDistance (collision radius in px)
      device.queue.writeBuffer(paramsBuffer, 0, paramsData);

      const encoder = device.createCommandEncoder();
      const workgroups = Math.ceil(numParticles / 64);

      const cpass = encoder.beginComputePass();
      cpass.setBindGroup(0, computeBindGroup);
      cpass.setPipeline(velPipeline);
      cpass.dispatchWorkgroups(workgroups);
      cpass.setPipeline(posPipeline);
      cpass.dispatchWorkgroups(workgroups);
      cpass.setPipeline(decayPipeline);
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
