// ==========================================
// WGSL SHADERS (Compute & Render Pipeline)
// ==========================================
export const physicsShaderCode = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> matrix: array<f32>;
@group(0) @binding(3) var<storage, read> masses: array<f32>;
@group(0) @binding(4) var<storage, read> decayRates: array<f32>;

// --- Uniform grid, rebuilt every frame (count -> prefix sum -> scatter) ---
// cellCounts is atomic because countGrid/scatterGrid write to it from many
// threads at once; by the time updateVelocity reads it, its per-cell values
// have settled back to "particles in this cell" (see scatterGrid below).
@group(0) @binding(5) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> cellOffsets: array<u32>;
@group(0) @binding(7) var<storage, read_write> sortedIndices: array<u32>;

// Converts a world-space position into a clamped 1D grid cell index.
fn getCellCoord(pos: vec2f, rMax: f32, gridSize: vec2<u32>) -> vec2<u32> {
    let gx = clamp(u32(pos.x / rMax), 0u, gridSize.x - 1u);
    let gy = clamp(u32(pos.y / rMax), 0u, gridSize.y - 1u);
    return vec2<u32>(gx, gy);
}
fn getCellIndex(pos: vec2f, rMax: f32, gridSize: vec2<u32>) -> u32 {
    let c = getCellCoord(pos, rMax, gridSize);
    return c.x + c.y * gridSize.x;
}

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

// --- GRID STAGE 0: count how many particles land in each cell ---
@compute @workgroup_size(64)
fn countGrid(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= params.numParticles) { return; }
    let cell = getCellIndex(particles[idx].pos, params.rMax, params.gridSize);
    atomicAdd(&cellCounts[cell], 1u);
}

// --- GRID STAGE 1: exclusive prefix sum over cell counts -> cellOffsets ---
// Deliberately single-threaded: with grid cells scaling with canvas size /
// rMax^2 this is normally a few thousand cells, so a serial scan is cheap
// relative to the particle work. If rMax is pushed very small on a large
// canvas (tens of thousands of cells) this pass can start to dominate frame
// time - a parallel (e.g. Blelloch) scan would remove that ceiling.
// Also resets cellCounts back to 0 so scatterGrid can reuse it as a
// per-cell write cursor.
@compute @workgroup_size(1)
fn prefixSum(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let totalCells = params.gridSize.x * params.gridSize.y;
    var running: u32 = 0u;
    for (var c = 0u; c < totalCells; c = c + 1u) {
        let count = atomicLoad(&cellCounts[c]);
        cellOffsets[c] = running;
        running = running + count;
        atomicStore(&cellCounts[c], 0u);
    }
}

// --- GRID STAGE 2: scatter particle indices into contiguous per-cell ranges ---
// cellCounts (reset to 0 by prefixSum) is reused as an atomic write-cursor:
// atomicAdd returns the old value, giving each particle a unique slot
// within its cell's [offset, offset+count) range. Once every particle has
// been scattered, cellCounts[c] again equals cell c's particle count -
// which is exactly what updateVelocity needs to know how far to walk
// sortedIndices for a given cell.
@compute @workgroup_size(64)
fn scatterGrid(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= params.numParticles) { return; }
    let cell = getCellIndex(particles[idx].pos, params.rMax, params.gridSize);
    let slot = cellOffsets[cell] + atomicAdd(&cellCounts[cell], 1u);
    sortedIndices[slot] = idx;
}

// --- COMPUTE STAGE: Calculate forces and update velocity, grid-accelerated ---
@compute @workgroup_size(64)
fn updateVelocity(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= params.numParticles) { return; }

    let p1 = particles[idx];
    let pType = u32(p1.ptype);
    let pMass = masses[pType];
    let cellCoord = getCellCoord(p1.pos, params.rMax, params.gridSize);
    let cellX = i32(cellCoord.x);
    let cellY = i32(cellCoord.y);
    let gw = i32(params.gridSize.x);
    let gh = i32(params.gridSize.y);

    var totalForce = vec2<f32>(0.0);

    // Loop over the 3x3 neighborhood of grid cells. Cell coordinates wrap
    // (modulo) rather than clip at 0/gridSize, to match the toroidal
    // position wrap done in updatePosition - otherwise particles near the
    // canvas edge would miss neighbors that wrapped around.
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let nx = u32((cellX + dx + gw) % gw);
            let ny = u32((cellY + dy + gh) % gh);
            let neighborCellIndex = nx + ny * params.gridSize.x;

            let startOffset = cellOffsets[neighborCellIndex];
            let count = atomicLoad(&cellCounts[neighborCellIndex]);

            for (var k = 0u; k < count; k = k + 1u) {
                let otherIdx = sortedIndices[startOffset + k];
                if (otherIdx == idx) { continue; } // avoid self-interaction

                let p2 = particles[otherIdx];
                // Calculate toroidal distance
                var ddx = p2.pos.x - p1.pos.x;
                var ddy = p2.pos.y - p1.pos.y;
                if (ddx > params.width * 0.5) { ddx -= params.width; }
                else if (ddx < -params.width * 0.5) { ddx += params.width; }
                if (ddy > params.height * 0.5) { ddy -= params.height; }
                else if (ddy < -params.height * 0.5) { ddy += params.height; }

                let dist2 = ddx * ddx + ddy * ddy;
                let dist = sqrt(dist2);
                if (dist < 1e-4) { continue; } // guard against div-by-zero for coincident particles
                let r = dist / params.rMax;
                let p2Mass = masses[u32(p2.ptype)];
                // Look up force matrix coefficient: matrix[row * numTypes + col]
                let a = matrix[pType * params.numTypes + u32(p2.ptype)];
                let f = particleForce(r, a) * p2Mass;
                totalForce.x = totalForce.x + (ddx / dist) * f;
                totalForce.y = totalForce.y + (ddy / dist) * f;
            }
        }
    }

    // Calculate final velocity update for this particle based on total force
    var vel = p1.vel;
    vel.x = (vel.x + (totalForce.x / pMass) * params.forceScale * params.dt) * (1.0 - params.friction);
    vel.y = (vel.y + (totalForce.y / pMass) * params.forceScale * params.dt) * (1.0 - params.friction);
    particles[idx].vel = vel;
}

// --- COMPUTE STAGE: Update position based on velocity ---
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

// NOTE: kinetic fusion below is still an O(N^2) all-pairs scan per particle
// (unlike updateVelocity, it doesn't use the grid yet). It only runs when
// decay is enabled and pType < maxType, but it's the next obvious target if
// decay mode turns out to be the new bottleneck.
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