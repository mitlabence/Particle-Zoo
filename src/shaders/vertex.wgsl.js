export const vertexShaderCode = /* wgsl */`
@group(0) @binding(0) var<storage, read> rParticles: array<Particle>;
@group(0) @binding(1) var<uniform> rParams: Params;
@group(0) @binding(2) var<storage, read> colors: array<vec4f>;
@group(0) @binding(3) var<storage, read> rMasses: array<f32>;

// --- RENDER STAGE: Instanced Quad Billboards ---
struct VSOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec3f,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
    var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let corner = corners[vid];
    let p = rParticles[iid];

    const MIN_RADIUS: f32 = 1.5;
    const MAX_RADIUS: f32 = 10.0;
    const MIN_MASS: f32 = 0.1;
    const MAX_MASS: f32 = 10.0;

    let typeIdx = u32(p.ptype);
    let pMass = rMasses[typeIdx];

    // Linear interpolation: radius = MIN_RADIUS * (1 - t) + MAX_RADIUS * t
    let t = clamp((pMass - MIN_MASS) / (MAX_MASS - MIN_MASS), 0.0, 1.0);
    // Calculate the radius based on the particle's mass
    let radius = mix(MIN_RADIUS, MAX_RADIUS, t);
    let worldPos = p.pos + corner * radius;

    var out: VSOut;
    var ndc: vec2f;
    // Convert canvas pixel coordinates to Normalized Device Coordinates (-1.0 to 1.0)
    ndc.x = (worldPos.x / rParams.width) * 2.0 - 1.0;
    ndc.y = 1.0 - (worldPos.y / rParams.height) * 2.0;
    out.pos = vec4f(ndc, 0.0, 1.0);
    out.uv = corner;
    out.color = colors[u32(p.ptype)].rgb;
    return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
    let d = length(in.uv);
    if (d > 1.0) { discard; } // Anti-aliased circle boundary clipping
    let alpha = smoothstep(1.0, 0.55, d);
    return vec4f(in.color, alpha);
}`;