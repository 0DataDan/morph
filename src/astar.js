import {
    GRID_SIZE,
    TOTAL_CELLS,
    STATE_WIRE,
    STATE_HEAD,
    STATE_TAIL,
    STATE_CRATER,
    STATE_HEALING,
    STATE_EMITTER,
    STATE_RECEIVER
} from './config.js';
import { MinHeap } from './minHeap.js';

// Pre-allocated typed arrays for zero-GC A* execution
const gScore = new Float32Array(TOTAL_CELLS);
const parent = new Int32Array(TOTAL_CELLS);
const closed = new Uint8Array(TOTAL_CELLS);

export function isConductiveState(s) {
    return (
        s === STATE_WIRE ||
        s === STATE_HEAD ||
        s === STATE_TAIL ||
        s === STATE_HEALING ||
        s === STATE_EMITTER ||
        s === STATE_RECEIVER
    );
}

export function runAStar(cellState, terrainHeight, startX, startY, endX, endY, options = {}) {
    const t0 = performance.now();
    const minX = options.minX ?? 0;
    const maxX = options.maxX ?? (GRID_SIZE - 1);
    const minY = options.minY ?? 0;
    const maxY = options.maxY ?? (GRID_SIZE - 1);
    const reuseDiscount = options.reuseDiscount ?? 1.0;

    gScore.fill(Infinity);
    parent.fill(-1);
    closed.fill(0);

    const startIdx = startY * GRID_SIZE + startX;
    const endIdx = endY * GRID_SIZE + endX;

    const heap = new MinHeap();
    gScore[startIdx] = 0;
    heap.push({
        x: startX,
        y: startY,
        idx: startIdx,
        g: 0,
        f: Math.abs(startX - endX) + Math.abs(startY - endY)
    });

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let nodesExpanded = 0;
    let found = false;

    while (heap.size > 0) {
        const curr = heap.pop();
        if (closed[curr.idx]) continue;
        closed[curr.idx] = 1;
        nodesExpanded++;

        if (curr.idx === endIdx) {
            found = true;
            break;
        }

        const currElev = terrainHeight[curr.idx];

        for (let d = 0; d < 4; d++) {
            const nx = curr.x + dirs[d][0];
            const ny = curr.y + dirs[d][1];
            if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;

            const nIdx = ny * GRID_SIZE + nx;
            if (closed[nIdx]) continue;
            if (cellState[nIdx] === STATE_CRATER) continue;

            const nextElev = terrainHeight[nIdx];
            const slopeDelta = Math.abs(nextElev - currElev);
            const altitudePenalty = Math.max(0, nextElev - 0.5) * 1.8;
            let stepCost = 1.0 + (slopeDelta * 14.0) + altitudePenalty;

            if (reuseDiscount < 1.0 && isConductiveState(cellState[nIdx])) {
                stepCost *= reuseDiscount;
            }

            const tentativeG = curr.g + stepCost;
            if (tentativeG < gScore[nIdx]) {
                gScore[nIdx] = tentativeG;
                parent[nIdx] = curr.idx;
                const h = Math.abs(nx - endX) + Math.abs(ny - endY);
                heap.push({ x: nx, y: ny, idx: nIdx, g: tentativeG, f: tentativeG + h });
            }
        }
    }

    const solveMs = performance.now() - t0;
    if (!found) return null;

    const path = [];
    let step = parent[endIdx];
    while (step !== -1 && step !== startIdx) {
        path.push(step);
        step = parent[step];
    }
    path.reverse();

    return { path, solveMs, nodesExpanded };
}