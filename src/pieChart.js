// src/pieChart.js
// Async GPU data readback used to drive the type-distribution pie chart
// and the ensemble temperature readout in the HUD.

import { App } from './app.js';

export async function updatePieChart(t) {
  // Rate-limit updates to every 400ms and ensure previous readback finished
  if (t - App.lastPieUpdate < 400 || App.isMapping || !App.readbackBuffer) return;
  App.lastPieUpdate = t;
  App.isMapping = true;

  try {
    const { device, particleBuffer, readbackBuffer, particleData, numTypes, numParticles, typeMasses, typeColors } = App;

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(particleBuffer, 0, readbackBuffer, 0, particleData.byteLength);
    device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = readbackBuffer.getMappedRange();
    const readData = new Float32Array(arrayBuffer);

    const counts = new Array(numTypes).fill(0);
    let totalKineticEnergy = 0;

    for (let i = 0; i < numParticles; i++) {
      const o = i * 6;
      const vx = readData[o + 2];
      const vy = readData[o + 3];
      const pType = Math.min(Math.max(0, Math.floor(readData[o + 4] + 0.5)), numTypes - 1);

      counts[pType]++;

      // Fetch mass of particle type (falls back to 1.0 if mass array isn't populated)
      const m = (typeof typeMasses !== 'undefined' && typeMasses[pType]) ? typeMasses[pType] : 1.0;

      // Accumulate Kinetic Energy: 0.5 * m * (vx^2 + vy^2)
      totalKineticEnergy += 0.5 * m * (vx * vx + vy * vy);
    }
    readbackBuffer.unmap();

    // 2D Ensemble Temperature: T = Total KE / N
    const systemTemp = totalKineticEnergy / numParticles;

    // Update HUD element
    const tempEl = document.getElementById('hudTemp');
    if (tempEl) tempEl.textContent = systemTemp.toFixed(2);

    // Render SVG Pie Chart
    const svg = document.getElementById('pieGraph');
    const legend = document.getElementById('pieLegend');

    // Base dark background ring
    svg.innerHTML = '<circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#1f1f2e" stroke-width="6" />';
    legend.innerHTML = '';

    let cumulativePercent = 0;

    for (let i = 0; i < numTypes; i++) {
      const fraction = counts[i] / numParticles;
      const percent = fraction * 100;

      // Skip 0% slices
      if (percent > 0) {
        const color = typeColors[i];
        const rgbStr = `rgb(${color[0] * 255 | 0},${color[1] * 255 | 0},${color[2] * 255 | 0})`;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '21');
        circle.setAttribute('cy', '21');
        circle.setAttribute('r', '15.91549430918954');
        circle.setAttribute('fill', 'transparent');
        circle.setAttribute('stroke', rgbStr);
        circle.setAttribute('stroke-width', '6');
        circle.setAttribute('stroke-dasharray', `${percent} ${100 - percent}`);
        circle.setAttribute('stroke-dashoffset', `${-cumulativePercent}`);
        svg.appendChild(circle);

        cumulativePercent += percent;

        // Add legend entry
        const row = document.createElement('div');
        row.style.color = rgbStr;
        row.textContent = `Type ${String.fromCharCode(65 + i)}: ${percent.toFixed(1)}%`;
        legend.appendChild(row);
      }
    }
  } catch (err) {
    console.warn("GPU Readback warning:", err);
  } finally {
    App.isMapping = false;
  }
}
