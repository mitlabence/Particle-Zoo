// src/ui/controls.js
// Wires up every interactive control in the panel: sliders, buttons, and
// the decay checkbox. Delegates actual state changes to buffers.js / App /
// the shared `state` object from config.js.

import { App } from '../app.js';
import { state } from '../config.js';
import { rebuildBuffers, randomizeMatrix, randomizeMasses, resetPositions } from '../buffers.js';
import { renderLegendUI } from './render.js';

export function setupControls() {
  const panel = document.getElementById('panel');
  const panelToggle = document.getElementById('panelToggle');

  panelToggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');

    const isCollapsed = panel.classList.contains('collapsed');
    panelToggle.textContent = isCollapsed ? '<<' : 'Hide Controls';
  });

  const numTypesEl = document.getElementById('numTypes');
  const numTypesVal = document.getElementById('numTypesVal');
  numTypesEl.addEventListener('input', () => {
    App.numTypes = parseInt(numTypesEl.value, 10);
    numTypesVal.textContent = App.numTypes;
    rebuildBuffers();
  });

  const perTypeEl = document.getElementById('perType');
  const perTypeVal = document.getElementById('perTypeVal');
  perTypeEl.addEventListener('input', () => {
    App.perType = parseInt(perTypeEl.value, 10);
    perTypeVal.textContent = App.perType;
    rebuildBuffers();
  });

  state.timeScale = 1.0;
  const speedSlider = document.getElementById('timeScaleSlider');
  const speedVal = document.getElementById('timeScaleVal');
  speedSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.timeScale = val;
    speedVal.textContent = val.toFixed(1) + 'x';

    // Recalculate UI legend to reflect effective wall-clock half-life
    renderLegendUI();
  });

  const rMaxEl = document.getElementById('rMax');
  const rMaxVal = document.getElementById('rMaxVal');
  rMaxEl.addEventListener('input', () => { state.rMax = +rMaxEl.value; rMaxVal.textContent = state.rMax; });

  const forceEl = document.getElementById('force');
  const forceVal = document.getElementById('forceVal');
  forceEl.addEventListener('input', () => { state.forceScale = +forceEl.value / 100; forceVal.textContent = state.forceScale.toFixed(2); });

  const frictionEl = document.getElementById('friction');
  const frictionVal = document.getElementById('frictionVal');
  frictionEl.addEventListener('input', () => { state.friction = +frictionEl.value / 100; frictionVal.textContent = state.friction.toFixed(2); });

  // Decay toggle listener
  const decayToggleEl = document.getElementById('decayToggle');
  if (decayToggleEl) {
    decayToggleEl.addEventListener('change', () => {
      state.enableDecay = decayToggleEl.checked;
    });
  }

  document.getElementById('btnMatrix').addEventListener('click', randomizeMatrix);
  document.getElementById('btnMasses').addEventListener('click', randomizeMasses);
  document.getElementById('btnReset').addEventListener('click', resetPositions);

  const btnPause = document.getElementById('btnPause');
  btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? 'Resume' : 'Pause';
  });
}
