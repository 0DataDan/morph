import {
    GRID_SIZE,
    TOTAL_CELLS,
    EMITTER_POS,
    RECEIVER_POS,
    TERRAIN_PRESETS,
    STATE_EMPTY,
    STATE_WIRE,
    STATE_HEAD,
    STATE_TAIL,
    STATE_CRATER,
    STATE_HEALING,
    STATE_EMITTER,
    STATE_RECEIVER
} from './config.js';
import { runAStar, isConductiveState } from './astar.js';

export class SpatialSimulation {
    constructor(callbacks = {}) {
        this.cellState = new Uint8Array(TOTAL_CELLS);
        this.nextState = new Uint8Array(TOTAL_CELLS);
        this.stateTimer = new Uint8Array(TOTAL_CELLS);
        this.terrainHeight = new Float32Array(TOTAL_CELLS);

        this.currentTerrainKey = 'synthetic';
        this.tickCount = 0;
        this.ticksSinceLastPulse = 0;
        this.linkIntegrity = 100;
        this.globalFailoverCooldown = 0;
        this.autoStormEnabled = false;

        this.healQueue = [];
        this.shockwaves = [];

        this.onTelemetryUpdate = callbacks.onTelemetryUpdate || (() => {});
        this.onSolverUpdate = callbacks.onSolverUpdate || (() => {});
        this.onCellColorDirty = callbacks.onCellColorDirty || (() => {});
        this.onFlushColors = callbacks.onFlushColors || (() => {});

    }

    getIndex(x, y) {
        const wx = (x + GRID_SIZE) % GRID_SIZE;
        const wy = (y + GRID_SIZE) % GRID_SIZE;
        return wy * GRID_SIZE + wx;
    }

    applyTerrain(presetKey) {
        const preset = TERRAIN_PRESETS[presetKey];
        if (!preset) return;
        this.currentTerrainKey = presetKey;

        let i = 0;
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                this.terrainHeight[i] = preset.fn(x, y);
                this.onCellColorDirty(i);
                i++;
            }
        }
        this.onFlushColors();
    }

    clearGrid() {
        this.healQueue = [];
        for (let i = 0; i < TOTAL_CELLS; i++) {
            this.cellState[i] = STATE_EMPTY;
            this.stateTimer[i] = 0;
            this.onCellColorDirty(i);
        }
        this.onFlushColors();
    }

    loadDualRelayPreset() {
        this.healQueue = [];
        this.tickCount = 0;
        this.ticksSinceLastPulse = -65; // Grace period for first pulse to reach RX
        this.linkIntegrity = 100;
        this.globalFailoverCooldown = 0;
        this.onSolverUpdate('IDLE');

        for (let i = 0; i < TOTAL_CELLS; i++) {
            this.cellState[i] = STATE_EMPTY;
            this.stateTimer[i] = 0;
            this.onCellColorDirty(i);
        }

        const eIdx = this.getIndex(EMITTER_POS.x, EMITTER_POS.y);
        const rIdx = this.getIndex(RECEIVER_POS.x, RECEIVER_POS.y);
        this.cellState[eIdx] = STATE_EMITTER;
        this.cellState[rIdx] = STATE_RECEIVER;
        this.onCellColorDirty(eIdx);
        this.onCellColorDirty(rIdx);

        for (let x = EMITTER_POS.x + 1; x < RECEIVER_POS.x; x++) {
            const idx = this.getIndex(x, EMITTER_POS.y);
            this.cellState[idx] = STATE_WIRE;
            this.onCellColorDirty(idx);
        }

        const branchStart = EMITTER_POS.x + 6;
        const branchEnd = RECEIVER_POS.x - 6;
        const offsetY = 12;
        for (let dy = 1; dy <= offsetY; dy++) {
            const leftIdx = this.getIndex(branchStart, EMITTER_POS.y + dy);
            const rightIdx = this.getIndex(branchEnd, EMITTER_POS.y + dy);
            this.cellState[leftIdx] = STATE_WIRE;
            this.cellState[rightIdx] = STATE_WIRE;
            this.onCellColorDirty(leftIdx);
            this.onCellColorDirty(rightIdx);
        }
        for (let x = branchStart; x <= branchEnd; x++) {
            const idx = this.getIndex(x, EMITTER_POS.y + offsetY);
            this.cellState[idx] = STATE_WIRE;
            this.onCellColorDirty(idx);
        }

        this.onFlushColors();
        this.onTelemetryUpdate(this.linkIntegrity);
    }

    executeAttenuationStrike(strikeX, strikeY, radius = 3) {
        let severedWire = false;
        for (let rdy = -radius; rdy <= radius; rdy++) {
            for (let rdx = -radius; rdx <= radius; rdx++) {
                if (rdx * rdx + rdy * rdy <= radius * radius) {
                    const cx = strikeX + rdx;
                    const cy = strikeY + rdy;
                    if (cx >= 0 && cx < GRID_SIZE && cy >= 0 && cy < GRID_SIZE) {
                        const killIdx = cy * GRID_SIZE + cx;
                        const s = this.cellState[killIdx];
                        if (s === STATE_EMITTER || s === STATE_RECEIVER) continue;
                        if (s === STATE_WIRE || s === STATE_HEAD || s === STATE_TAIL) {
                            severedWire = true;
                        }
                        this.cellState[killIdx] = STATE_CRATER;
                        this.stateTimer[killIdx] = 55;
                        this.onCellColorDirty(killIdx);
                    }
                }
            }
        }
        this.shockwaves.push({ x: strikeX, y: strikeY, radius: 1.0, maxRadius: 18.0, strength: 1.0 });
        if (severedWire) {
            this.triggerLocalHealing(strikeX, strikeY, radius);
        }
        this.onFlushColors();
    }

    triggerLocalHealing(strikeX, strikeY, radius) {
        const ringRadius = radius + 1;
        const severedEnds = [];

        for (let dy = -ringRadius; dy <= ringRadius; dy++) {
            for (let dx = -ringRadius; dx <= ringRadius; dx++) {
                const distSq = dx * dx + dy * dy;
                if (distSq > radius * radius && distSq <= ringRadius * ringRadius + 2) {
                    const cx = strikeX + dx;
                    const cy = strikeY + dy;
                    if (cx >= 0 && cx < GRID_SIZE && cy >= 0 && cy < GRID_SIZE) {
                        const idx = cy * GRID_SIZE + cx;
                        if (isConductiveState(this.cellState[idx])) {
                            severedEnds.push({ x: cx, y: cy, idx });
                        }
                    }
                }
            }
        }

        if (severedEnds.length < 2) return;

        let startNode = severedEnds[0];
        let endNode = severedEnds[1];
        let maxDist = -1;
        for (let i = 0; i < severedEnds.length; i++) {
            for (let j = i + 1; j < severedEnds.length; j++) {
                const d = Math.hypot(severedEnds[i].x - severedEnds[j].x, severedEnds[i].y - severedEnds[j].y);
                if (d > maxDist) {
                    maxDist = d;
                    startNode = severedEnds[i];
                    endNode = severedEnds[j];
                }
            }
        }

        const margin = radius + 10;
        const result = runAStar(this.cellState, this.terrainHeight, startNode.x, startNode.y, endNode.x, endNode.y, {
            minX: Math.max(0, strikeX - margin),
            maxX: Math.min(GRID_SIZE - 1, strikeX + margin),
            minY: Math.max(0, strikeY - margin),
            maxY: Math.min(GRID_SIZE - 1, strikeY + margin)
        });

        if (result && result.path.length > 0) {
            result.path.forEach(idx => {
                if (this.cellState[idx] === STATE_EMPTY && !this.healQueue.includes(idx)) {
                    this.healQueue.push(idx);
                }
            });
            this.onSolverUpdate(`LOCAL · ${result.solveMs.toFixed(2)}ms · ${result.nodesExpanded}N`);
        }
    }

    triggerGlobalFailover() {
        const eIdx = this.getIndex(EMITTER_POS.x, EMITTER_POS.y);
        const rIdx = this.getIndex(RECEIVER_POS.x, RECEIVER_POS.y);
        if (this.cellState[eIdx] !== STATE_EMITTER || this.cellState[rIdx] !== STATE_RECEIVER) return;

        const result = runAStar(this.cellState, this.terrainHeight, EMITTER_POS.x, EMITTER_POS.y, RECEIVER_POS.x, RECEIVER_POS.y, {
            reuseDiscount: 0.35
        });

        if (result && result.path.length > 0) {
            let queuedCount = 0;
            result.path.forEach(idx => {
                if (this.cellState[idx] === STATE_EMPTY && !this.healQueue.includes(idx)) {
                    this.healQueue.push(idx);
                    queuedCount++;
                }
            });
            if (queuedCount > 0) {
                this.onSolverUpdate(`GLOBAL · ${result.solveMs.toFixed(2)}ms · ${result.nodesExpanded}N`);
            }
        }
    }

    drawLine(x0, y0, x1, y1, tool) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        let paintedAny = false;

        while (true) {
            if (x0 >= 0 && x0 < GRID_SIZE && y0 >= 0 && y0 < GRID_SIZE) {
                const idx = y0 * GRID_SIZE + x0;
                if (tool === -1) {
                    this.executeAttenuationStrike(x0, y0, 3);
                } else if (
                    this.cellState[idx] !== STATE_EMITTER &&
                    this.cellState[idx] !== STATE_RECEIVER &&
                    this.cellState[idx] !== tool
                ) {
                    this.cellState[idx] = tool;
                    this.onCellColorDirty(idx);
                    paintedAny = true;
                }
            }
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }

        if (paintedAny) this.onFlushColors();
    }

    step() {
        this.tickCount++;
        this.ticksSinceLastPulse++;
        if (this.globalFailoverCooldown > 0) this.globalFailoverCooldown--;

        if (this.autoStormEnabled && this.tickCount % 28 === 0) {
            const activeCorridors = [];
            for (let y = 8; y < GRID_SIZE - 8; y++) {
                for (let x = EMITTER_POS.x + 5; x < RECEIVER_POS.x - 5; x++) {
                    const s = this.cellState[y * GRID_SIZE + x];
                    if (s === STATE_WIRE || s === STATE_HEAD || s === STATE_TAIL) {
                        activeCorridors.push({ x, y });
                    }
                }
            }
            if (activeCorridors.length > 0) {
                const target = activeCorridors[Math.floor(Math.random() * activeCorridors.length)];
                this.executeAttenuationStrike(target.x, target.y, 3);
            }
        }

        if (
            this.linkIntegrity === 0 &&
            this.ticksSinceLastPulse > 38 &&
            this.healQueue.length === 0 &&
            this.globalFailoverCooldown === 0
        ) {
            this.triggerGlobalFailover();
            this.globalFailoverCooldown = 45;
        }

        this.nextState.fill(STATE_EMPTY);

        const popRate = this.healQueue.length > 20 ? 5 : 3;
        for (let h = 0; h < popRate; h++) {
            if (this.healQueue.length > 0) {
                const healIdx = this.healQueue.shift();
                if (this.cellState[healIdx] === STATE_EMPTY) {
                    this.cellState[healIdx] = STATE_HEALING;
                    this.stateTimer[healIdx] = 4;
                    this.onCellColorDirty(healIdx);
                }
            }
        }

        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const i = this.getIndex(x, y);
                const curr = this.cellState[i];
                if (curr === STATE_EMPTY) continue;

                if (curr === STATE_EMITTER) {
                    this.nextState[i] = STATE_EMITTER;
                    continue;
                }
                if (curr === STATE_RECEIVER) {
                    this.nextState[i] = STATE_RECEIVER;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            if (this.cellState[this.getIndex(x + dx, y + dy)] === STATE_HEAD) {
                                this.ticksSinceLastPulse = 0;
                            }
                        }
                    }
                    continue;
                }
                if (curr === STATE_CRATER) {
                    if (this.stateTimer[i] > 0) {
                        this.stateTimer[i]--;
                        this.nextState[i] = STATE_CRATER;
                    } else {
                        this.nextState[i] = STATE_EMPTY;
                    }
                    continue;
                }
                if (curr === STATE_HEALING) {
                    if (this.stateTimer[i] > 0) {
                        this.stateTimer[i]--;
                        this.nextState[i] = STATE_HEALING;
                    } else {
                        this.nextState[i] = STATE_WIRE;
                    }
                    continue;
                }

                if (curr === STATE_HEAD) {
                    this.nextState[i] = STATE_TAIL;
                } else if (curr === STATE_TAIL) {
                    this.nextState[i] = STATE_WIRE;
                } else if (curr === STATE_WIRE) {
                    let activeHeads = 0;
                    let touchesEmitter = false;
                    const emitTick = this.tickCount % 6 === 0;

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const ns = this.cellState[this.getIndex(x + dx, y + dy)];
                            if (ns === STATE_HEAD) activeHeads++;
                            if (emitTick && ns === STATE_EMITTER) touchesEmitter = true;
                        }
                    }

                    this.nextState[i] = (activeHeads === 1 || activeHeads === 2 || touchesEmitter)
                        ? STATE_HEAD
                        : STATE_WIRE;
                }
            }
        }

        if (this.ticksSinceLastPulse <= 10) {
            this.linkIntegrity = Math.min(100, this.linkIntegrity + 10);
        } else {
            this.linkIntegrity = Math.max(0, this.linkIntegrity - 4);
        }

        for (let i = 0; i < TOTAL_CELLS; i++) {
            if (this.cellState[i] !== this.nextState[i]) {
                this.cellState[i] = this.nextState[i];
                this.onCellColorDirty(i);
            }
        }

        this.onFlushColors();
        this.onTelemetryUpdate(this.linkIntegrity);
    }
}