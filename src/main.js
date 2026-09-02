// src/main.js
// Entry point. Sets initial state from CONFIG, initializes WebGPU, wires up
// the control panel, allocates the first set of buffers, and starts the
// render/compute loop.

import { CONFIG } from './config.js';
import { App } from './app.js';
import { initGPU } from './gpuSetup.js';
import { rebuildBuffers } from './buffers.js';
import { setupControls } from './ui/controls.js';
import { startLoop } from './loop.js';

App.numTypes = CONFIG.WORLD.DEFAULT_NUM_TYPES;
App.perType = CONFIG.WORLD.DEFAULT_PER_TYPE;
App.numParticles = App.numTypes * App.perType;

async function main() {
  const canvas = document.getElementById('gpuCanvas');

  const supported = await initGPU(canvas);
  if (!supported) {
    document.getElementById('unsupported').style.display = 'flex';
    return;
  }

  setupControls();
  rebuildBuffers();
  startLoop();
}

main();
