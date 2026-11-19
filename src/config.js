import * as THREE from 'three';

export const GRID_SIZE = 100;
export const CELL_SIZE = 0.86;
export const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;
export const SIM_TICK_RATE = 75;

export const EMITTER_POS = { x: 20, y: 50 };
export const RECEIVER_POS = { x: 80, y: 50 };

export const STATE_EMPTY = 0;
export const STATE_WIRE = 1;
export const STATE_HEAD = 2;
export const STATE_TAIL = 3;
export const STATE_CRATER = 4;
export const STATE_HEALING = 5;
export const STATE_EMITTER = 6;
export const STATE_RECEIVER = 7;

export const STATE_LABELS = {
    [STATE_EMPTY]: 'TERRAIN',
    [STATE_WIRE]: 'CORRIDOR',
    [STATE_HEAD]: 'PACKET',
    [STATE_TAIL]: 'DECAY',
    [STATE_CRATER]: 'ATTENUATE',
    [STATE_HEALING]: 'REROUTE',
    [STATE_EMITTER]: 'DOWNLINK TX',
    [STATE_RECEIVER]: 'GROUND RX'
};

export const COLORS = {
    [STATE_EMPTY]: new THREE.Color(0x0a0a0d),
    [STATE_WIRE]: new THREE.Color(0x44403c),
    [STATE_HEAD]: new THREE.Color(0xfde047),
    [STATE_TAIL]: new THREE.Color(0xea580c),
    [STATE_CRATER]: new THREE.Color(0x3b0712),
    [STATE_HEALING]: new THREE.Color(0xc084fc),
    [STATE_EMITTER]: new THREE.Color(0xffffff),
    [STATE_RECEIVER]: new THREE.Color(0x34d399)
};

export const LOW_TERRAIN_COLOR = new THREE.Color(0x14141a);
export const HIGH_TERRAIN_COLOR = new THREE.Color(0x3a3a46);
export const SHOCK_COLOR = new THREE.Color(0xe11d48);

export const TERRAIN_PRESETS = {
    synthetic: {
        elevScale: 420,
        maxZ: 2.3,
        fn: (x, y) => {
            const nx = x * 0.075;
            const ny = y * 0.075;
            const ridge1 = Math.sin(nx) * Math.cos(ny * 0.9);
            const ridge2 = Math.sin(nx * 2.1 + 1.4) * Math.sin(ny * 1.8 - 0.7) * 0.45;
            const basin = Math.cos((x - 50) * 0.05) * Math.cos((y - 50) * 0.05) * 0.35;
            const norm = Math.max(0, Math.min(1, (ridge1 + ridge2 + basin + 1.4) / 2.8));
            return 0.18 + Math.pow(norm, 1.35) * 2.1;
        }
    },
    canyon: {
        elevScale: 820,
        maxZ: 2.4,
        fn: (x, y) => {
            const riverCenterY = 50 + Math.sin(x * 0.085) * 14 + Math.cos(x * 0.19) * 4;
            const distFromRiver = Math.abs(y - riverCenterY);
            const rimNoise = Math.sin(x * 0.14) * Math.cos(y * 0.14) * 0.18;
            const innerGorge = Math.min(1, Math.max(0, (distFromRiver - 4.5) / 10));
            const upperTerrace = Math.min(1, Math.max(0, (distFromRiver - 16) / 11));
            const z = 0.2 + innerGorge * 1.15 + upperTerrace * 0.95 + rimNoise;
            return Math.max(0.16, Math.min(2.45, z));
        }
    },
    rainier: {
        elevScale: 1320,
        maxZ: 3.3,
        fn: (x, y) => {
            const dx = x - 50;
            const dy = y - 50;
            const dist = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            const cone = Math.exp(-(dist * dist) / 520) * 2.85;
            const glacialRidges = (Math.sin(angle * 7 + dist * 0.08) * 0.5 + 0.5) * Math.exp(-dist / 36) * 0.55;
            const foothills = (Math.sin(x * 0.09) * Math.cos(y * 0.09) + 1) * 0.22;
            return 0.18 + cone + glacialRidges + foothills;
        }
    },
    basin: {
        elevScale: 560,
        maxZ: 2.5,
        fn: (x, y) => {
            const coastalRidge = Math.max(0, (y - 38) / 62);
            const peaks = Math.pow(coastalRidge, 1.55) * 2.1;
            const spurs = Math.sin(x * 0.11 + y * 0.05) * coastalRidge * 0.48;
            const valleyChannel = Math.exp(-Math.pow((x - 50 + Math.sin(y * 0.1) * 12) / 9, 2)) * 0.45;
            return Math.max(0.16, 0.22 + peaks + spurs - valleyChannel);
        }
    }
};