import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
    GRID_SIZE,
    CELL_SIZE,
    TOTAL_CELLS,
    SIM_TICK_RATE,
    COLORS,
    LOW_TERRAIN_COLOR,
    HIGH_TERRAIN_COLOR,
    SHOCK_COLOR,
    STATE_EMPTY,
    STATE_WIRE,
    STATE_HEAD,
    STATE_TAIL,
    STATE_CRATER,
    STATE_HEALING,
    STATE_EMITTER,
    STATE_RECEIVER,
    STATE_LABELS,
    TERRAIN_PRESETS
} from './src/config.js';
import { SpatialSimulation } from './src/simulation.js';

// 1. SCENE, CAMERA & RENDERER
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060608);

const camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.up.set(0, 0, 1); // Tell OrbitControls that Z is up
const ISO_CAM_POS = new THREE.Vector3(0, -70, 62);
const TOP_CAM_POS = new THREE.Vector3(0, -0.01, 115);
camera.position.copy(ISO_CAM_POS);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// 2. DAMPED RIGHT-CLICK ORBIT, SHIFT+DRAG ORBIT & SCROLL ZOOM
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 28;
controls.maxDistance = 165;
controls.maxPolarAngle = Math.PI * 0.46;
controls.target.set(0, 1, 0);
controls.mouseButtons = {
    LEFT: null,                // Left-click draws (unless holding Shift)
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE  // Right-click drag orbits
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift' || e.key === 'Alt') {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        container.style.cursor = 'grab';
    }
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key === 'Alt') {
        controls.mouseButtons.LEFT = null;
        container.style.cursor = 'crosshair';
    }
});
window.addEventListener('blur', () => {
    controls.mouseButtons.LEFT = null;
    container.style.cursor = 'crosshair';
});
controls.update();

let isTilted = true;
let isCameraTransitioning = false;
const targetCamPos = ISO_CAM_POS.clone();
const targetLookAt = new THREE.Vector3(0, 1, 0);

controls.addEventListener('start', () => {
    isCameraTransitioning = false;
});

// 3. UNREAL BLOOM POST-PROCESSING (r170 Linear Pipeline + OutputPass)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.4, 0.25)
);
composer.addPass(new OutputPass());

// 4. NEUTRAL STUDIO LIGHTING (Calibrated for Three.js r170 physical lights)
scene.add(new THREE.AmbientLight(0xffffff, 1.6));
const dirLight = new THREE.DirectionalLight(0xf4f4f5, 2.6);
dirLight.position.set(30, -50, 65);
scene.add(dirLight);
const rimLight = new THREE.DirectionalLight(0xa1a1aa, 1.2);
rimLight.position.set(-45, 55, 35);
scene.add(rimLight);

// 5. INSTANCED VOXEL MESH
const geometry = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, 1.0);
const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.22
});
const mesh = new THREE.InstancedMesh(geometry, material, TOTAL_CELLS);
scene.add(mesh);

const dummy = new THREE.Object3D();
const scratchColor = new THREE.Color();
const tempColor = new THREE.Color();

// DOM HUD References
const hudCoords = document.getElementById('hud-coords');
const hudElev = document.getElementById('hud-elev');
const hudState = document.getElementById('hud-state');
const hudAstar = document.getElementById('hud-astar');
const statusEl = document.getElementById('telemetry-status');
const ringEl = document.getElementById('telemetry-ring');
const ledEl = document.getElementById('hud-led');
const RING_CIRCUMFERENCE = 201.06;

function getCellBaseColor(index, outColor) {
    const state = sim.cellState[index];
    if (state === STATE_EMPTY) {
        const maxZ = TERRAIN_PRESETS[sim.currentTerrainKey].maxZ;
        const elevNorm = Math.min(1, Math.max(0, (sim.terrainHeight[index] - 0.16) / (maxZ - 0.16)));
        outColor.copy(LOW_TERRAIN_COLOR).lerp(HIGH_TERRAIN_COLOR, elevNorm * 0.9);
    } else {
        outColor.copy(COLORS[state]);
    }
}

function updateCellColor(index) {
    getCellBaseColor(index, scratchColor);
    mesh.setColorAt(index, scratchColor);
}

// 6. INITIALIZE SIMULATION ENGINE
const sim = new SpatialSimulation({
    onCellColorDirty: (i) => updateCellColor(i),
    onFlushColors: () => {
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    onSolverUpdate: (text) => {
        if (hudAstar) hudAstar.textContent = text;
    },
    onTelemetryUpdate: (integrity) => {
        if (!ringEl || !ledEl) return;
        ringEl.style.strokeDashoffset = RING_CIRCUMFERENCE - (integrity / 100) * RING_CIRCUMFERENCE;
        const accent = integrity > 60 ? '#f59e0b' : integrity > 0 ? '#c084fc' : '#e11d48';
        ringEl.style.stroke = accent;
        ledEl.style.background = accent;
    }
});

// Initialize Voxel Matrices
sim.applyTerrain('synthetic');

const cellScaleXY = new Float32Array(TOTAL_CELLS).fill(1.0);
const cellHeightZ = new Float32Array(sim.terrainHeight);

for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
        const i = y * GRID_SIZE + x;
        const z = sim.terrainHeight[i];
        dummy.position.set(x - GRID_SIZE / 2 + 0.5, y - GRID_SIZE / 2 + 0.5, z * 0.5);
        dummy.scale.set(1, 1, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        updateCellColor(i);
    }
}
mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;

// 7. 60 FPS VISUAL PHYSICS LOOP
function getTargetXY(state) {
    if (state === STATE_HEAD) return 1.22;
    if (state === STATE_TAIL) return 1.08;
    if (state === STATE_HEALING) return 1.18;
    if (state === STATE_EMITTER || state === STATE_RECEIVER) return 1.35;
    if (state === STATE_CRATER) return 0.58;
    return 1.0;
}

function getTargetZ(index, state) {
    const baseZ = sim.terrainHeight[index];
    if (state === STATE_HEAD) return baseZ + 2.4;
    if (state === STATE_TAIL) return baseZ + 1.25;
    if (state === STATE_HEALING) return baseZ + 1.95;
    if (state === STATE_EMITTER || state === STATE_RECEIVER) return baseZ + 3.6;
    if (state === STATE_WIRE) return baseZ + 0.45;
    if (state === STATE_CRATER) return Math.max(0.1, baseZ * 0.35);
    return baseZ;
}

function updateVisualPhysics() {
    let matrixDirty = false;
    let colorDirty = false;

    if (isCameraTransitioning) {
        camera.position.lerp(targetCamPos, 0.09);
        controls.target.lerp(targetLookAt, 0.09);
        if (camera.position.distanceTo(targetCamPos) < 0.15) {
            isCameraTransitioning = false;
        }
    }
    controls.update();

    for (let s = sim.shockwaves.length - 1; s >= 0; s--) {
        sim.shockwaves[s].radius += 0.85;
        sim.shockwaves[s].strength *= 0.92;
        if (sim.shockwaves[s].radius > sim.shockwaves[s].maxRadius) {
            sim.shockwaves.splice(s, 1);
        }
    }

    const corePulse = Math.sin(performance.now() * 0.008) * 0.45;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const i = y * GRID_SIZE + x;
            const state = sim.cellState[i];
            let targetXY = getTargetXY(state);
            let targetZ = getTargetZ(i, state);

            if (state === STATE_EMITTER || state === STATE_RECEIVER) {
                targetZ += corePulse;
            }

            let waveBoost = 0;
            for (let s = 0; s < sim.shockwaves.length; s++) {
                const sw = sim.shockwaves[s];
                const dist = Math.hypot(x - sw.x, y - sw.y);
                const ringDelta = Math.abs(dist - sw.radius);
                if (ringDelta < 1.8) {
                    const factor = (1.0 - ringDelta / 1.8) * sw.strength;
                    if (factor > waveBoost) waveBoost = factor;
                }
            }

            targetXY += waveBoost * 0.35;
            targetZ += waveBoost * 3.0;

            const currXY = cellScaleXY[i];
            const currZ = cellHeightZ[i];

            if (Math.abs(targetXY - currXY) > 0.003 || Math.abs(targetZ - currZ) > 0.005 || waveBoost > 0.01) {
                const nextXY = currXY + (targetXY - currXY) * 0.22;
                const nextZ = currZ + (targetZ - currZ) * 0.22;
                cellScaleXY[i] = nextXY;
                cellHeightZ[i] = nextZ;

                dummy.position.set(x - GRID_SIZE / 2 + 0.5, y - GRID_SIZE / 2 + 0.5, nextZ * 0.5);
                dummy.scale.set(nextXY, nextXY, nextZ);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                matrixDirty = true;

                if (waveBoost > 0.02) {
                    getCellBaseColor(i, tempColor);
                    tempColor.lerp(SHOCK_COLOR, Math.min(0.85, waveBoost));
                    mesh.setColorAt(i, tempColor);
                    colorDirty = true;
                } else {
                    updateCellColor(i);
                    colorDirty = true;
                }
            }
        }
    }

    if (matrixDirty) mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty) mesh.instanceColor.needsUpdate = true;
}

let isRunning = true;
let lastSimTime = 0;
let currentTool = STATE_WIRE;

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    if (isRunning && now - lastSimTime > SIM_TICK_RATE) {
        sim.step();
        lastSimTime = now;
    }
    updateVisualPhysics();
    composer.render();
}
animate();

// 8. POINTER PICKING (LEFT-CLICK DRAW, RIGHT-CLICK ORBIT)
let isDrawing = false;
let lastX = null;
let lastY = null;
const raycaster = new THREE.Raycaster();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const planeHit = new THREE.Vector3();

function isUIElement(target) {
    return target.closest && (
        target.closest('.voxel-dock-assembly') ||
        target.closest('#arch-drawer') ||
        target.closest('#btn-arch-toggle') ||
        target.closest('#terrain-switcher')
    );
}

function updateInspectorHUD(x, y) {
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
        const idx = y * GRID_SIZE + x;
        const scale = TERRAIN_PRESETS[sim.currentTerrainKey].elevScale;
        const meters = Math.round(sim.terrainHeight[idx] * scale);
        hudCoords.textContent = `[${String(x).padStart(2, '0')}, ${String(y).padStart(2, '0')}]`;
        hudElev.textContent = `${meters} m`;
        hudState.textContent = STATE_LABELS[sim.cellState[idx]] || 'UNKNOWN';
    }
}

function handlePointer(event) {
    if (isUIElement(event.target)) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    if (!raycaster.ray.intersectPlane(boardPlane, planeHit)) return;

    const targetX = Math.round(planeHit.x + GRID_SIZE / 2 - 0.5);
    const targetY = Math.round(planeHit.y + GRID_SIZE / 2 - 0.5);
    updateInspectorHUD(targetX, targetY);

    if (!isDrawing) return;

    if (targetX >= 0 && targetX < GRID_SIZE && targetY >= 0 && targetY < GRID_SIZE) {
        if (lastX === null || lastY === null) {
            lastX = targetX;
            lastY = targetY;
        }
        sim.drawLine(lastX, lastY, targetX, targetY, currentTool);
        lastX = targetX;
        lastY = targetY;
    }
}

container.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.shiftKey || e.altKey) return;
    if (isUIElement(e.target)) return;
    isDrawing = true;
    lastX = null;
    lastY = null;
    handlePointer(e);
});
window.addEventListener('mousemove', handlePointer);
window.addEventListener('mouseup', () => {
    isDrawing = false;
    lastX = null;
    lastY = null;
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

// 9. UI BINDINGS
function flashClickAnimation(btn) {
    btn.classList.remove('just-clicked');
    void btn.offsetWidth;
    btn.classList.add('just-clicked');
    setTimeout(() => btn.classList.remove('just-clicked'), 420);
}

document.querySelectorAll('.terrain-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        document.querySelectorAll('.terrain-btn').forEach((b) => b.classList.remove('active'));
        button.classList.add('active');
        sim.applyTerrain(button.dataset.terrain);
    });
});

const archDrawer = document.getElementById('arch-drawer');
const archToggleBtn = document.getElementById('btn-arch-toggle');
const archCloseBtn = document.getElementById('btn-arch-close');

function toggleArchDrawer(forceState) {
    const willOpen = typeof forceState === 'boolean' ? forceState : !archDrawer.classList.contains('open');
    archDrawer.classList.toggle('open', willOpen);
    archToggleBtn.classList.toggle('active', willOpen);
}

archToggleBtn.addEventListener('click', () => toggleArchDrawer());
archCloseBtn.addEventListener('click', () => toggleArchDrawer(false));
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && archDrawer.classList.contains('open')) toggleArchDrawer(false);
});

document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        document.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active-tool'));
        button.classList.add('active-tool');
        currentTool = parseInt(button.dataset.tool, 10);
    });
});

document.getElementById('btn-auto-storm').addEventListener('click', (e) => {
    sim.autoStormEnabled = !sim.autoStormEnabled;
    e.currentTarget.classList.toggle('storm-on', sim.autoStormEnabled);
});

document.getElementById('btn-camera-tilt').addEventListener('click', (e) => {
    isTilted = !isTilted;
    targetCamPos.copy(isTilted ? ISO_CAM_POS : TOP_CAM_POS);
    targetLookAt.set(0, isTilted ? 1 : 0, 0);
    isCameraTransitioning = true;
    e.currentTarget.classList.toggle('toggle-on', isTilted);
});

document.getElementById('btn-play').addEventListener('click', () => {
    isRunning = !isRunning;
    const label = document.getElementById('play-state-label');
    if (label) {
        label.textContent = isRunning ? 'ACTIVE' : 'PAUSED';
        label.style.color = isRunning ? 'var(--text-secondary)' : '#fb7185';
    }
});

document.getElementById('btn-step').addEventListener('click', (e) => {
    flashClickAnimation(e.currentTarget);
    isRunning = false;
    const label = document.getElementById('play-state-label');
    if (label) {
        label.textContent = 'STEP';
        label.style.color = 'var(--cell-packet)';
    }
    sim.step();
});

document.getElementById('btn-clear').addEventListener('click', (e) => {
    flashClickAnimation(e.currentTarget);
    isRunning = false;
    const label = document.getElementById('play-state-label');
    if (label) {
        label.textContent = 'PAUSED';
        label.style.color = '#fb7185';
    }
    sim.clearGrid();
});

document.getElementById('btn-preset-clock').addEventListener('click', (e) => {
    flashClickAnimation(e.currentTarget);
    sim.loadDualRelayPreset();

    });

    // Boot
sim.loadDualRelayPreset();
console.log('MORPH boot:', {
    terrain0: sim.terrainHeight[0],
    camPos: camera.position.toArray(),
    target: controls.target.toArray()
});