/**
 * plannerWorker.js
 * ================
 * Web Worker — A* Global Planner chạy trên luồng phụ
 * Giải quyết yêu cầu khnc.md: "Chạy thuật toán A* trên Web Worker"
 *
 * Giúp UI không bị đơ khi tìm đường trên bản đồ lớn.
 *
 * Protocol (postMessage):
 *   IN:  { type: 'plan', start: {x,y}, goal: {x,y}, costmapData, costmapMeta }
 *   OUT: { type: 'path', path: [{x,y}, ...], elapsed: ms }
 *   OUT: { type: 'error', message: string }
 */

// ─── Cost Constants ──────────────────────────────────────────────────────────
const COST_FREE = 0;
const COST_LETHAL = 254;
const COST_UNKNOWN = 255;

// ─── A* Node ─────────────────────────────────────────────────────────────────
class AStarNode {
    constructor(cx, cy, g, h, parent) {
        this.cx = cx; this.cy = cy;
        this.g = g; this.h = h; this.f = g + h;
        this.parent = parent;
    }
}

// ─── Min Heap ────────────────────────────────────────────────────────────────
class MinHeap {
    constructor() { this._data = []; }
    push(node) { this._data.push(node); this._bubbleUp(this._data.length - 1); }
    pop() {
        const top = this._data[0];
        const last = this._data.pop();
        if (this._data.length > 0) { this._data[0] = last; this._siftDown(0); }
        return top;
    }
    get size() { return this._data.length; }
    _bubbleUp(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this._data[p].f <= this._data[i].f) break;
            [this._data[p], this._data[i]] = [this._data[i], this._data[p]];
            i = p;
        }
    }
    _siftDown(i) {
        const n = this._data.length;
        while (true) {
            let s = i; const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this._data[l].f < this._data[s].f) s = l;
            if (r < n && this._data[r].f < this._data[s].f) s = r;
            if (s === i) break;
            [this._data[s], this._data[i]] = [this._data[i], this._data[s]];
            i = s;
        }
    }
}

// ─── A* Planner ──────────────────────────────────────────────────────────────

const DIRS = [
    { dx: 1, dy: 0, c: 1.0 }, { dx: -1, dy: 0, c: 1.0 },
    { dx: 0, dy: 1, c: 1.0 }, { dx: 0, dy: -1, c: 1.0 },
    { dx: 1, dy: 1, c: 1.414 }, { dx: 1, dy: -1, c: 1.414 },
    { dx: -1, dy: 1, c: 1.414 }, { dx: -1, dy: -1, c: 1.414 },
];

function heuristic(cx, cy, gx, gy) {
    const dx = Math.abs(cx - gx), dy = Math.abs(cy - gy);
    return Math.max(dx, dy) + (1.414 - 1) * Math.min(dx, dy);
}

function worldToGrid(wx, wy, meta) {
    return {
        cx: Math.floor((wx - meta.origin.x) / meta.resolution),
        cy: Math.floor((wy - meta.origin.y) / meta.resolution),
    };
}

function gridToWorld(cx, cy, meta) {
    return {
        x: meta.origin.x + (cx + 0.5) * meta.resolution,
        y: meta.origin.y + (cy + 0.5) * meta.resolution,
    };
}

function planAStar(start, goal, costmapData, meta) {
    const W = meta.width, H = meta.height;
    const grid = new Uint8Array(costmapData);

    const sg = worldToGrid(start.x, start.y, meta);
    const gg = worldToGrid(goal.x, goal.y, meta);

    // Bounds check
    if (sg.cx < 0 || sg.cx >= W || sg.cy < 0 || sg.cy >= H) return null;
    if (gg.cx < 0 || gg.cx >= W || gg.cy < 0 || gg.cy >= H) return null;

    // Goal check
    const goalCost = grid[gg.cy * W + gg.cx];
    if (goalCost >= COST_LETHAL && goalCost !== COST_UNKNOWN) return null;

    const openSet = new MinHeap();
    const closed = new Uint8Array(W * H);
    const gScore = new Float32Array(W * H).fill(Infinity);

    const startIdx = sg.cy * W + sg.cx;
    gScore[startIdx] = 0;
    openSet.push(new AStarNode(sg.cx, sg.cy, 0, heuristic(sg.cx, sg.cy, gg.cx, gg.cy), null));

    const costWeight = 3.0;
    const maxIterations = 500000;
    let iterations = 0;
    let goalNode = null;

    while (openSet.size > 0 && iterations++ < maxIterations) {
        const current = openSet.pop();
        const idx = current.cy * W + current.cx;

        if (current.cx === gg.cx && current.cy === gg.cy) {
            goalNode = current;
            break;
        }
        if (closed[idx]) continue;
        closed[idx] = 1;

        for (const { dx, dy, c } of DIRS) {
            const nx = current.cx + dx, ny = current.cy + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const nIdx = ny * W + nx;
            if (closed[nIdx]) continue;

            const cellCost = grid[nIdx];
            if (cellCost >= 253 && cellCost < 255) continue; // Obstacle
            if (cellCost === COST_UNKNOWN) {
                // Allow unknown but penalize
                const tentativeG = current.g + c * meta.resolution + 1.5 * meta.resolution;
                if (tentativeG >= gScore[nIdx]) continue;
                gScore[nIdx] = tentativeG;
                openSet.push(new AStarNode(nx, ny, tentativeG, heuristic(nx, ny, gg.cx, gg.cy) * meta.resolution, current));
                continue;
            }

            const costPenalty = (cellCost / COST_LETHAL) * costWeight;
            const tentativeG = current.g + c * meta.resolution + costPenalty * meta.resolution;
            if (tentativeG >= gScore[nIdx]) continue;
            gScore[nIdx] = tentativeG;
            openSet.push(new AStarNode(nx, ny, tentativeG, heuristic(nx, ny, gg.cx, gg.cy) * meta.resolution, current));
        }
    }

    if (!goalNode) return null;

    // Reconstruct
    const cellPath = [];
    let node = goalNode;
    while (node) {
        cellPath.push({ cx: node.cx, cy: node.cy });
        node = node.parent;
    }
    cellPath.reverse();

    // Convert + smooth
    const worldPath = cellPath.map(({ cx, cy }) => gridToWorld(cx, cy, meta));
    return smooth(worldPath);
}

function smooth(path) {
    if (path.length < 3) return path;
    const result = path.map(p => ({ x: p.x, y: p.y }));
    const alpha = 0.5, beta = 0.1;
    const iters = 5 * path.length;
    for (let iter = 0; iter < iters; iter++) {
        for (let i = 1; i < result.length - 1; i++) {
            const prev = result[i - 1], curr = result[i], next = result[i + 1];
            const ox = path[i].x, oy = path[i].y;
            result[i] = {
                x: curr.x + alpha * (prev.x + next.x - 2 * curr.x) + beta * (ox - curr.x),
                y: curr.y + alpha * (prev.y + next.y - 2 * curr.y) + beta * (oy - curr.y),
            };
        }
    }
    return result;
}

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = function (e) {
    const msg = e.data;

    if (msg.type === 'plan') {
        const startTime = performance.now();

        try {
            const path = planAStar(msg.start, msg.goal, msg.costmapData, msg.costmapMeta);
            const elapsed = Math.round(performance.now() - startTime);

            if (path) {
                self.postMessage({ type: 'path', path, elapsed, iterations: path.length });
            } else {
                self.postMessage({ type: 'error', message: `No path found (${elapsed}ms)` });
            }
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};

self.postMessage({ type: 'ready' });
