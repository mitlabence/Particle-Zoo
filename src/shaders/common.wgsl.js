export const commonShaderCode = /* wgsl */`
struct Particle {
    pos: vec2f,
    vel: vec2f,
    ptype: f32,
    lifetime: f32, // Time left (in seconds) before this particle decays
};

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
`;