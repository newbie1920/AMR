/**
 * globalPlanner.js
 * ================
 * A* Global Path Planner — thay thế nav2_navfn_planner (NavFn + A*) trong ROS2
 *
 * ROS2 dùng: nav2_navfn_planner::NavfnPlanner (Dijkstra / A*)
 * Module này: A* trên costmap grid với:
 *   - Heuristic: octile distance (diagonal movement)
 *   - Cost weighting: costmap cost → path penalty
 *   - Path smoothing: gradient descent (giống ROS2's PathSmootherPlugin)
 *   - Output: Array of { x, y } waypoints (world coords, m)
 *
 * USAGE:
 *   import globalPlanner from './planner/globalPlanner';
 *   import costmap from '../costmap';
 *
 *   const path = globalPlanner.plan(
 *     { x: 0, y: 0 },    // start (world)
 *     { x: 2.5, y: 1.8}, // goal  (world)
 *     costmap
 *   );
 *   // path = [{ x, y }, ...] or null if no path found
 */

import { COST_FREE, COST_LETHAL, COST_UNKNOWN } from '../costmap';

// ─── A* Node ─────────────────────────────────────────────────────────────────
class AStarNode {
    constructor(cx, cy, g, h, parent) {
        this.cx = cx; this.cy = cy;
        this.g = g;               // Cost from start
        this.h = h;               // Heuristic to goal
        this.f = g + h;           // Total estimated cost
        this.parent = parent;     // Parent AStarNode
    }
}

// ─── Min Heap (priority queue) ───────────────────────────────────────────────
class MinHeap {
    constructor() { this._data = []; }

    push(node) {
        this._data.push(node);
        this._bubbleUp(this._data.length - 1);
    }

    pop() {
        const top = this._data[0];
        const last = this._data.pop();
        if (this._data.length > 0) {
            this._data[0] = last;
            this._siftDown(0);
        }
        return top;
    }

    get size() { return this._data.length; }

    _bubbleUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this._data[parent].f <= this._data[i].f) break;
            [this._data[parent], this._data[i]] = [this._data[i], this._data[parent]];
            i = parent;
        }
    }

    _siftDown(i) {
        const n = this._data.length;
        while (true) {
            let smallest = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this._data[l].f < this._data[smallest].f) smallest = l;
            if (r < n && this._data[r].f < this._data[smallest].f) smallest = r;
            if (smallest === i) break;
            [this._data[smallest], this._data[i]] = [this._data[i], this._data[smallest]];
            i = smallest;
        }
    }
}

// ─── Global Planner ──────────────────────────────────────────────────────────
class GlobalPlanner {
    constructor(options = {}) {
        this._costWeight = options.costWeight ?? 3.0;  // Penalty for high-cost cells
        this._diagonalCost = options.diagonalCost ?? 1.414;
        this._maxIterations = options.maxIterations ?? 500000;
        this._maxCostAllowed = options.maxCostAllowed ?? COST_LETHAL - 1; // 253
        this._smoothingIter = options.smoothingIter ?? 5;
        this._smoothingAlpha = options.smoothingAlpha ?? 0.5;
        this._allowUnknown = options.allowUnknown ?? true;
    }

    /**
     * plan(start, goal, costmap)
     * Tương đương: nav2_navfn_planner::NavfnPlanner::createPlan()
     *
     * @param {{ x: number, y: number }} start - World coords (m)
     * @param {{ x: number, y: number }} goal  - World coords (m)
     * @param {Costmap2D} costmap
     * @returns {Array<{x,y}>|null} - Waypoints in world coords, or null if no path
     */
    plan(start, goal, costmap) {
        const meta = costmap.getMetadata();
        const W = meta.width, H = meta.height;

        const startGrid = costmap.worldToGrid(start.x, start.y);
        const goalGrid = costmap.worldToGrid(goal.x, goal.y);

        if (!costmap.inBounds(startGrid.cx, startGrid.cy)) {
            console.warn('[GlobalPlanner] Start outside costmap.');
            return null;
        }
        if (!costmap.inBounds(goalGrid.cx, goalGrid.cy)) {
            console.warn('[GlobalPlanner] Goal outside costmap.');
            return null;
        }

        // Check goal is not in occupied cell
        const goalCost = costmap.getCostAtCell(goalGrid.cx, goalGrid.cy);
        if (goalCost >= COST_LETHAL && goalCost !== COST_UNKNOWN) {
            console.warn('[GlobalPlanner] Goal in obstacle.');
            return null;
        }
        if (goalCost === COST_UNKNOWN && !this._allowUnknown) {
            console.warn('[GlobalPlanner] Goal in unknown space (prohibited).');
            return null;
        }

        // ─── A* search ────────────────────────────────────────────────────────────
        const openSet = new MinHeap();
        const closed = new Uint8Array(W * H);         // visited
        const gScore = new Float32Array(W * H).fill(Infinity);

        const startIdx = startGrid.cy * W + startGrid.cx;
        const goalIdx = goalGrid.cy * W + goalGrid.cx;

        gScore[startIdx] = 0;
        openSet.push(new AStarNode(startGrid.cx, startGrid.cy, 0, this._heuristic(startGrid.cx, startGrid.cy, goalGrid.cx, goalGrid.cy), null));

        // 8-connected neighbours
        const DIRS = [
            { dx: 1, dy: 0, c: 1.0 },
            { dx: -1, dy: 0, c: 1.0 },
            { dx: 0, dy: 1, c: 1.0 },
            { dx: 0, dy: -1, c: 1.0 },
            { dx: 1, dy: 1, c: this._diagonalCost },
            { dx: 1, dy: -1, c: this._diagonalCost },
            { dx: -1, dy: 1, c: this._diagonalCost },
            { dx: -1, dy: -1, c: this._diagonalCost },
        ];

        let goalNode = null;
        let iterations = 0;

        while (openSet.size > 0 && iterations++ < this._maxIterations) {
            const current = openSet.pop();
            const idx = current.cy * W + current.cx;

            if (idx === goalIdx) {
                goalNode = current;
                break;
            }
            if (closed[idx]) continue;
            closed[idx] = 1;

            for (const { dx, dy, c } of DIRS) {
                const nx = current.cx + dx, ny = current.cy + dy;
                if (!costmap.inBounds(nx, ny)) continue;

                const nIdx = ny * W + nx;
                if (closed[nIdx]) continue;

                const cellCost = costmap.getCostAtCell(nx, ny);
                if (cellCost >= this._maxCostAllowed && cellCost !== COST_UNKNOWN) continue; // Obstacle
                if (cellCost === COST_UNKNOWN && !this._allowUnknown) continue;

                // Cost = movement cost + weighted cell traversal cost
                let costPenalty = 0;
                if (cellCost === COST_UNKNOWN) {
                    costPenalty = 1.5; // Moderate penalty for unknown space (was 10.0)
                } else {
                    costPenalty = (cellCost / COST_LETHAL) * this._costWeight;
                }

                const tentativeG = current.g + c * meta.resolution + costPenalty * meta.resolution;

                if (tentativeG >= gScore[nIdx]) continue;
                gScore[nIdx] = tentativeG;

                const h = this._heuristic(nx, ny, goalGrid.cx, goalGrid.cy) * meta.resolution;
                openSet.push(new AStarNode(nx, ny, tentativeG, h, current));
            }
        }

        if (!goalNode) {
            console.warn('[GlobalPlanner] No path found after', iterations, 'iterations.');
            return null;
        }

        // ─── Reconstruct path ─────────────────────────────────────────────────────
        const cellPath = [];
        let node = goalNode;
        while (node) {
            cellPath.push({ cx: node.cx, cy: node.cy });
            node = node.parent;
        }
        cellPath.reverse();

        // Convert to world coords
        const worldPath = cellPath.map(({ cx, cy }) => costmap.gridToWorld(cx, cy));

        // ─── Path smoothing (gradient descent) ───────────────────────────────────
        return this._smooth(worldPath);
    }

    _heuristic(cx, cy, gx, gy) {
        // Octile distance (8-connected)
        const dx = Math.abs(cx - gx), dy = Math.abs(cy - gy);
        return Math.max(dx, dy) + (this._diagonalCost - 1) * Math.min(dx, dy);
    }

    /**
     * _smooth(path)
     * Gradient descent path smoother.
     * Tương đương: nav2_smoother_server
     */
    _smooth(path) {
        if (path.length < 3) return path;

        const result = path.map(p => ({ x: p.x, y: p.y }));
        const alpha = this._smoothingAlpha;
        const beta = 0.1;       // Data weight (pulls back toward original)

        for (let iter = 0; iter < this._smoothingIter * path.length; iter++) {
            for (let i = 1; i < result.length - 1; i++) {
                const prev = result[i - 1], curr = result[i], next = result[i + 1];
                const ox = path[i].x, oy = path[i].y;  // Original point

                result[i] = {
                    x: curr.x + alpha * (prev.x + next.x - 2 * curr.x) + beta * (ox - curr.x),
                    y: curr.y + alpha * (prev.y + next.y - 2 * curr.y) + beta * (oy - curr.y),
                };
            }
        }

        return result;
    }
}

export default GlobalPlanner;
export { GlobalPlanner };
