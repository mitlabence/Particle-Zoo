// ==========================================
// WGSL SHADERS (Compute & Render Pipeline)
// ==========================================
export const physicsShaderCode = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> matrix: array<f32>;
@group(0) @binding(3) var<storage, read> masses: array<f32>;
@group(0) @binding(4) var<storage, read> decayRates: array<f32>;

/**
 * Calculates half-linear particle interactions:
 * Repulsion for short distances (r < beta), attraction/repulsion curve for (beta <= r < 1.0)
 */
// TODO: other interaction types?
    fn particleForce(r: f32, a: f32) -> f32 {
    let beta = 0.3;
    if (r < beta) {
    return r / beta - 1.0;
    } else if (r < 1.0) {
    return a * (1.0 - abs(2.0 * r - 1.0 - beta) / (1.0 - beta));
    }
    return 0.0;
}

// --- COMPUTE STAGE 1: Calculate forces and update velocity ---
@compute @workgroup_size(64)
fn updateVelocity(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u32(params.numParticles)) { return; }
    let p = particles[i];
    var fx = 0.0;
    var fy = 0.0;
    let n = u32(params.numParticles);
    let numTypes = u32(params.numTypes);
    let halfW = params.width * 0.5;
    let halfH = params.height * 0.5;
    let pType = u32(p.ptype);
    let pMass = masses[pType];

    // N^2 interaction loop with periodic boundary (toroidal wrap)
    for (var j: u32 = 0u; j < n; j = j + 1u) {
    if (j == i) { continue; }
    let q = particles[j];
    var dx = q.pos.x - p.pos.x;
    var dy = q.pos.y - p.pos.y;
    
    // Toroidal shortest path wrapped distance calculation
    if (dx > halfW) { dx = dx - params.width; }
    else if (dx < -halfW) { dx = dx + params.width; }
    if (dy > halfH) { dy = dy - params.height; }
    else if (dy < -halfH) { dy = dy + params.height; }

    let dist2 = dx * dx + dy * dy;
    if (dist2 > 0.0001 && dist2 < params.rMax * params.rMax) {
        let dist = sqrt(dist2);
        let r = dist / params.rMax;
        let qMass = masses[u32(q.ptype)];
        // Look up force matrix coefficient: matrix[row * numTypes + col]
        let a = matrix[pType * numTypes + u32(q.ptype)];
        let f = particleForce(r, a) * qMass;
        fx = fx + (dx / dist) * f;
        fy = fy + (dy / dist) * f;
    }
    }

    // Apply forces and damp velocity via friction
    var vel = p.vel;
    vel.x = (vel.x + (fx / pMass) * params.forceScale * params.dt) * (1-params.friction);
    vel.y = (vel.y + (fy / pMass) * params.forceScale * params.dt) * (1-params.friction);
    particles[i].vel = vel;
}

// --- COMPUTE STAGE 2: Update position based on velocity ---
@compute @workgroup_size(64)
fn updatePosition(@builtin(global_invocation_id) gid: vec3u) {
    let i = gid.x;
    if (i >= u32(params.numParticles)) { return; }
    var pos = particles[i].pos;
    let vel = particles[i].vel;
    pos.x = pos.x + vel.x * params.dt;
    pos.y = pos.y + vel.y * params.dt;

    // Wrap coordinates around screen boundaries
    if (pos.x < 0.0) { pos.x = pos.x + params.width; }
    if (pos.x >= params.width) { pos.x = pos.x - params.width; }
    if (pos.y < 0.0) { pos.y = pos.y + params.height; }
    if (pos.y >= params.height) { pos.y = pos.y - params.height; }
    particles[i].pos = pos;
}

// Extremely fast, stateless 32-bit integer hash for uniform [0, 1) floats
fn hashFloat(seed: u32) -> f32 {
    var state = seed * 747796405u + 2891336453u;
    var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    word = (word >> 22u) ^ word;
    return f32(word) / 4294967296.0;
}

@compute @workgroup_size(64)
fn updateDecay(@builtin(global_invocation_id) gid: vec3u) {
    if (params.enableDecay < 0.5) { return; }  

    let i = gid.x;
    if (i >= u32(params.numParticles)) { return; }

    var p = particles[i];
    let pType = u32(p.ptype);
    let numTypes = u32(params.numTypes);
    let maxType = numTypes - 1u;
    let halfW = params.width * 0.5;
    let halfH = params.height * 0.5;

    var tLeft = p.lifetime - params.dt;

    // FIXME: kinetic fusion: relative velocity does not take into account the time speed-up factor, so at high timeScale values, more likely to trigger fusion.
    // --- 1. KINETIC FUSION: kinetic energy of one particle fuels "upgrade" of another (in proximity) into higher mass state
    // (Symmetric thread-safe proximity check) ---
    if (pType < maxType) {
    for (var j = 0u; j < u32(params.numParticles); j = j + 1u) {
        if (j == i) { continue; }
        let q = particles[j];
        
        // Calculate wrapped toroidal distance
        var dx = q.pos.x - p.pos.x;
        var dy = q.pos.y - p.pos.y;
        if (dx > halfW) { dx = dx - params.width; }
        else if (dx < -halfW) { dx = dx + params.width; }
        if (dy > halfH) { dy = dy - params.height; }
        else if (dy < -halfH) { dy = dy + params.height; }

        let dist2 = dx * dx + dy * dy;

        // Fusion distance check
        if (dist2 < params.fusionDistance * params.fusionDistance) {
        let relVel = length(p.vel - q.vel);
        
        // Check relative velocity threshold
        if (relVel > params.fusionThreshold) {
            // Rule: The particle with LOWER type gets upgraded
            let qType = u32(q.ptype);
            if (pType <= qType) {
            // step up into random particle type
            //let nextType = pType + 1u;
            // Roll a random float between 0.0 and 1.0
            let randTarget = hashFloat(i + u32(params.seed) + 42u);
            // Power-law transformation: mapping r^n biases values strongly toward 0.0 (unlikely multiple jumps in particle hierarchy)
            let biasedRandTarget = pow(randTarget, 5.0);
            let availableTiers = f32(maxType - pType);
            let stepUp = 1u + u32(floor(biasedRandTarget * availableTiers));
            let nextType = min(maxType, pType + stepUp);

            p.ptype = f32(nextType);
            
            // Apply kinetic damping / momentum conservation to self
            let mP = masses[pType];
            let mQ = masses[qType];
            let deltaVel = q.vel * (mQ / (mP + mQ));
            p.vel = p.vel * 0.5 + deltaVel * 0.5;

            // Re-roll lifetime for upgraded state
            let lambda = decayRates[nextType];
            let u = clamp(hashFloat(i + u32(params.seed)), 1e-6, 0.999999);
            tLeft = select(1e9, -log(1.0 - u) / lambda, lambda > 0.0);
            break;
            }
        }
        }
    }
    }

    // --- 2. MULTI-STEP FISSION / DECAY ---
    if (tLeft <= 0.0) {
    if (pType > 0u) {
        // 1. Pick a decay target. Heavy particles can split deeply (e.g. down to ground state 0)
        // Roll a random float between 0.0 and 1.0
        let randTarget = hashFloat(i + u32(params.seed) + 42u);
        
        // Choose a target type strictly lower than pType
        // Squaring randTarget biases decays toward lower ground states (deep fission)
        let nextType = u32(floor(randTarget * randTarget * f32(pType)));

        let oldMass = masses[pType];
        let newMass = masses[nextType];
        p.ptype = f32(nextType);

        // 2. Mass-energy conversion: larger deltaMass creates high-velocity escape kicks
        let deltaMass = max(0.5, oldMass - newMass);
        let randomAngle = hashFloat(i + u32(params.seed) * 17u) * 6.2831853;
        let kickDir = vec2f(cos(randomAngle), sin(randomAngle));
        
        // High kinetic impulse boost (adjust multiplier as needed)
        let kickSpeed = 40.0 * sqrt(deltaMass); 
        p.vel = p.vel + kickDir * kickSpeed;

        // 3. Reset lifetime for the new lower state
        let lambda = decayRates[nextType];
        let u = clamp(hashFloat(i + u32(params.seed) + 1337u), 1e-6, 0.999999);
        tLeft = select(1e9, -log(1.0 - u) / lambda, lambda > 0.0);
    } else {
        tLeft = 1e9; // Ground state is stable
    }
    }

    // Write modified local particle state back to storage buffer
    p.lifetime = tLeft;
    particles[i] = p;
}
`;