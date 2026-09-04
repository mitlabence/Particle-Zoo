export const commonShaderCode = /* wgsl */`
struct Particle {
    pos: vec2f,
    vel: vec2f,
    ptype: f32,
    lifetime: f32, // Time left (in seconds) before this particle decays
};

struct Params {
  // 8-byte aligned vector (offset 0 .. 7)
  gridSize: vec2<u32>,     // offset 0  (8 bytes)

  // 4-byte scalars (offset 8 .. 51)
  width: f32,              // offset 8
  height: f32,             // offset 12
  rMax: f32,               // offset 16
  dt: f32,                 // offset 20
  friction: f32,           // offset 24
  forceScale: f32,         // offset 28
  numParticles: u32,       // offset 32 (u32)
  numTypes: u32,           // offset 36 (u32)
  seed: f32,               // offset 40
  enableDecay: f32,        // offset 44
  fusionThreshold: f32,    // offset 48
  fusionDistance: f32,     // offset 52

  // Padding to reach 64 bytes (4 * 16-byte boundary)
  _pad1: f32,              // offset 56
  _pad2: f32,              // offset 60
};                         // Total size = 64 bytes
`;