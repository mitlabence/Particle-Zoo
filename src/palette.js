// src/palette.js
// Color palette generation and the mass -> decay-rate hierarchy.

import { CONFIG } from './config.js';
import { App } from './app.js';

/**
 * Samples a lifetime from an exponential distribution: T = -ln(1 - U) / lambda
 */
export function sampleLifetime(lambda) {
  if (lambda <= 0) return 1e9; // Ground state / stable particles live effectively forever
  const u = Math.random();
  return -Math.log(1 - u) / lambda;
}

/**
 * Sorts type entries by mass ascending, recomputes decay rates (lambda) from
 * the resulting mass hierarchy, and pushes mass/color/decay data to the GPU
 * if buffers already exist.
 */
export function sortAndSyncMassHierarchy(raw) {
  raw.sort((a, b) => a.mass - b.mass);
  App.typeColors = raw.map(item => item.color);
  App.typeMasses = raw.map(item => item.mass);

  App.typeDecayRates = [];
  const minMass = App.typeMasses[0];
  const maxMass = App.typeMasses[App.typeMasses.length - 1];
  const [minL_low, minL_high] = CONFIG.DECAY.MIN_LAMBDA_RANGE;
  const [maxL_low, maxL_high] = CONFIG.DECAY.MAX_LAMBDA_RANGE;
  const [powerMin, powerMax] = CONFIG.DECAY.CURVE_POWER_RANGE;
  const [noiseMin, noiseMax] = CONFIG.DECAY.NOISE_RANGE;

  const minLambda = minL_low + Math.random() * (minL_high - minL_low);
  const maxLambda = maxL_low + Math.random() * (maxL_high - maxL_low);
  const curvePower = powerMin + Math.random() * (powerMax - powerMin);

  for (let i = 0; i < App.numTypes; i++) {
    if (i === 0 || maxMass === minMass) {
      App.typeDecayRates.push(0.0); // Lightest/base type is stable
    } else {
      const norm = (App.typeMasses[i] - minMass) / (maxMass - minMass);
      // Bias the normalization with random curve power
      const biasedNorm = Math.pow(norm, curvePower);
      // Exponential interpolation across order of magnitude
      let lambda = minLambda * Math.pow(maxLambda / minLambda, biasedNorm);
      // Add some noise to the decay rate
      const noise = noiseMin + Math.random() * (noiseMax - noiseMin);
      lambda *= noise;
      App.typeDecayRates.push(lambda);
    }
  }

  // Only sync to GPU if buffers have already been allocated
  if (App.massBuffer && App.colorBuffer && App.decayBuffer) {
    App.typeMasses.forEach((m, i) => { App.massData[i] = m; });
    App.typeColors.forEach((c, i) => {
      App.colorData[i * 4 + 0] = c[0];
      App.colorData[i * 4 + 1] = c[1];
      App.colorData[i * 4 + 2] = c[2];
      App.colorData[i * 4 + 3] = 1.0;
    });
    App.typeDecayRates.forEach((r, i) => { App.decayRates[i] = r; });

    App.device.queue.writeBuffer(App.massBuffer, 0, App.massData);
    App.device.queue.writeBuffer(App.colorBuffer, 0, App.colorData);
    App.device.queue.writeBuffer(App.decayBuffer, 0, App.decayRates);
  }
}

/**
 * Generates an evenly hue-spaced color palette plus random masses for
 * `count` particle types, then derives the decay-rate hierarchy from it.
 */
export function generatePaletteAndMasses(count) {
  let raw = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * (360 / count)) % 360;
    const c = 0.85, x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; }
    else if (hue < 120) { r = x; g = c; }
    else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; }
    else if (hue < 300) { r = x; b = c; }
    else { r = c; b = x; }
    const m = 0.15;
    const randomMass = 0.5 + Math.random() * 9.5;
    raw.push({ color: [r + m, g + m, b + m], mass: parseFloat(randomMass.toFixed(2)) });
  }
  sortAndSyncMassHierarchy(raw);
}
