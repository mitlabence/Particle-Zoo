// src/ui/render.js
// Read-only UI rendering: the interaction matrix grid and the per-type
// legend cards. These only read from App/state and touch the DOM, so they
// have no dependency on buffers.js or controls.js (avoids circular imports).

import { App } from '../app.js';
import { state } from '../config.js';

export function renderMatrixUI() {
  const grid = document.getElementById('matrix');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `16px repeat(${App.numTypes}, 1fr)`;
  const labelColors = App.typeColors.map(c => `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`);

  grid.appendChild(Object.assign(document.createElement('div'), { className: 'corner' }));

  for (let c = 0; c < App.numTypes; c++) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = labelColors[c];
    grid.appendChild(sw);
  }

  for (let r = 0; r < App.numTypes; r++) {
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = labelColors[r];
    grid.appendChild(sw);
    for (let c = 0; c < App.numTypes; c++) {
      const v = App.matrixData[r * App.numTypes + c];
      const cell = document.createElement('div');
      cell.className = 'cell';
      const mag = Math.min(Math.abs(v), 1);
      cell.style.background = v >= 0
        ? `rgba(124,158,255,${0.25 + 0.55 * mag})`
        : `rgba(255,107,107,${0.25 + 0.55 * mag})`;
      cell.textContent = v.toFixed(2);
      grid.appendChild(cell);
    }
  }
}

export function renderLegendUI() {
  const legend = document.getElementById('legend');
  legend.innerHTML = '';

  // Get active speed multiplier
  const speed = state.timeScale || 1.0;

  // Container styling for a compact, readable grid/table
  legend.style.display = 'flex';
  legend.style.flexDirection = 'column';
  legend.style.gap = '6px';
  legend.style.marginTop = '12px';

  App.typeColors.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'type-card';
    row.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #14141d;
      border: 1px solid var(--panel-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 11px;
    `;

    const rgbStr = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
    const mass = App.typeMasses[i] !== undefined ? App.typeMasses[i].toFixed(2) : '1.00';
    const lambda = App.typeDecayRates[i] !== undefined ? App.typeDecayRates[i] : 0;

    // Calculate half-life tau (t1/2) for intuitive physical meaning
    const halfLife = lambda > 0 ? (0.693 / (lambda * speed)).toFixed(0) + 's' : '∞';
    const lambdaText = lambda > 0 ? lambda.toFixed(4) : '0.0000 (stable)';

    row.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <i style="width: 10px; height: 10px; border-radius: 50%; background: ${rgbStr}; display: inline-block; flex-shrink: 0;"></i>
        <span style="font-weight: 600; color: var(--text);">Type ${String.fromCharCode(65 + i)}</span>
      </div>
      <div style="display: flex; gap: 12px; font-variant-numeric: tabular-nums;">
        <span style="color: var(--text-dim);">m: <b style="color: var(--accent);">${mass}</b></span>
        <span style="color: var(--text-dim);">&lambda;: <b style="color: var(--text);">${lambdaText}</b></span>
        <span style="color: var(--text-dim);">&tau;<sub>&frac12; eff</sub>: <b style="color: #ffb74d;">${halfLife}</b></span>
      </div>
    `;

    legend.appendChild(row);
  });
}
