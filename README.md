# Particle Zoo

## Introduction

Particle Zoo is a real-time WebGPU particle simulation based on Particle Life that models a population of moving particles divided into multiple particle types. Each type has its own color, mass, and behavior (for now, optional decay with type-specific lifetime; the lowest mass particle type is stable).

Each type interacts with all the rest asymmetrically: while particle A may attract B, B might repel A. These coefficients are illustrated in a matrix. Positive entries mean attraction, negative repulsion; in column for type A, the values mean whether A attracts or repels the type of the row (B). For example, column A, type B = -0.93 means A strongly repels B.

## Adjustable parameters

The following parameters can be controlled:

- Particle types: 1 to 10, default 5
  - Sets how many distinct particle species are present.
- Particles / type: 500 to 10000, default 1000
  - Sets how many particles are spawned (randomly spatially distributed) for each type initially.
- Sim Speed: 0.1x to 10.0x, default 1.0x
  - Scales the simulation speed.
- Interaction radius: 20 to 400, default 150
  - Controls how far particles can influence one another.
- Force scale: 0 to 500, default 100
  - Adjusts the strength of the interaction forces.
- Friction: 0 to 100%, default 5%
  - Dampens velocity and stabilizes motion. A higher value leads to more dynamic systems (and possibly runaway kinetic fusion), while a lower value leads to more static, geometric patterns (where the optional fission dominates). 
- Turn decay on/off
  - Enable change of particle types by introducing "kinetic fusion" (two particles close by with enough relative speed can trigger the sacrifice of kinetic energy to propel the lighter of them into a higher-mass state)‚ and fission (spontaneous decay with the converted mass changing into velocity, characterized by the type-specific lambda parameter, randomly generated).