// --- CENTRAL SIMULATION CONFIGURATION ---
export const CONFIG = {
    // Mass Parameters
    MASS: {
        MIN: 0.5,
        MAX: 25.0,
    },

    // Decay Rate Parameters
    DECAY: {
        MIN_LAMBDA_RANGE: [0.0005, 0.0010], // [min, max] for random generation
        MAX_LAMBDA_RANGE: [0.0200, 0.0800],
        CURVE_POWER_RANGE: [1.2, 3.5],
        NOISE_RANGE: [0.9, 1.1],
        MIN_STEP: 0.0001,
    },

    // World Defaults
    WORLD: {
        // TODO: these need to agree with default value of sliders in HTML. Better solution: generate sliders from this config object?
        DEFAULT_NUM_TYPES: 5,
        DEFAULT_PER_TYPE: 1000,
        RMAX: 150,
        FORCE_SCALE: 1.00, // 100%
        FRICTION: 0.05,
        FUSION_THRESHOLD: 750.0, // Relative velocity threshold for kinetic fusion (in pixels/sec)
        FUSION_DISTANCE: 15.0,  // Distance threshold for kinetic fusion (in pixels)
    }
};

export const state = { rMax: CONFIG.WORLD.RMAX, forceScale: CONFIG.WORLD.FORCE_SCALE, friction: CONFIG.WORLD.FRICTION, fusionThreshold: CONFIG.WORLD.FUSION_THRESHOLD, fusionDistance: CONFIG.WORLD.FUSION_DISTANCE, paused: false };
