/**
 * hectorSlam.js
 * =============
 * Hector SLAM — scan-to-map matching + occupancy grid building
 * Thay thế: slam_toolbox + AMCL (ROS2)
 *
 * Thuật toán Hector SLAM (Kohlbrecher et al., 2011):
 *   - Không cần odometry (scan-only matching)
 *   - Gauss-Newton optimization: tối ưu pose (tx, ty, theta) để maximize scan-to-map match
 *   - Multi-resolution map: coarse-to-fine matching (3 levels)
 *   - Bresenham raytrace: cập nhật occupancy grid từ scan
 *   - Log-odds update: incremental bayesian map update
 *
 * Output:
 *   - `slamPose`     : { x, y, theta } — robot pose trong map frame
 *   - `occupancyGrid`: { width, height, resolution, data: Int8Array, origin: {x,y} }
 *                      data: 0=free, 100=occupied, -1=unknown  (chuẩn ROS OccupancyGrid)
 *
 * USAGE:
 *   import hectorSlam from './hectorSlam';
 *
 *   hectorSlam.init({ resolution: 0.05, width: 400, height: 400 });
 *   lidarDriver.onScan((scan) => {
 *     const { pose, map } = hectorSlam.processScan(scan);
 *     tfTree.updateMapToOdom({ x: pose.x - odom.x, y: pose.y - odom.y, theta: ... });
 *     costmap.loadStaticMap(map);
 *   });
 */

import { RANGE_MIN, RANGE_MAX } from '../lidarDriver';

// ─── Log-odds update params ───────────────────────────────────────────────────
const LOG_ODDS_FREE = -0.4;   // decreaseOccupancy
const LOG_ODDS_OCC = 0.9;   // increaseOccupancy
const LOG_ODDS_MIN = -2.0;
const LOG_ODDS_MAX = 3.5;
const LOG_ODDS_THRESHOLD = 0.5;   // above → occupied (in grid output)

// ─── SLAM Classes ────────────────────────────────────────────────────────────

class Keyframe {
    constructor(pose, scan) {
        this.pose = { ...pose };
        this.scan = scan; // LaserScan copy
        this.links = [];  // { toIndex, relativePose }
    }
}

// ─── Occupancy Grid ───────────────────────────────────────────────────────────
class OccupancyGrid {
    /**
     * @param {number} width      cells
     * @param {number} height     cells
     * @param {number} resolution m/cell
     * @param {{ x, y }} origin   world coords of cell (0,0)
     */
    constructor(width, height, resolution, origin = { x: 0, y: 0 }) {
        this.width = width;
        this.height = height;
        this.resolution = resolution;
        this.origin = origin;

        // Log-odds map (Float32Array for precision)
        this._logOdds = new Float32Array(width * height).fill(0);

        // Exported occupancy data (-1/0/100, chuẩn ROS)
        this.data = new Int8Array(width * height).fill(-1); // Start: unknown
    }

    inBounds(cx, cy) { return cx >= 0 && cx < this.width && cy >= 0 && cy < this.height; }

    worldToGrid(wx, wy) {
        return {
            cx: Math.floor((wx - this.origin.x) / this.resolution),
            cy: Math.floor((wy - this.origin.y) / this.resolution),
        };
    }

    gridToWorld(cx, cy) {
        return {
            x: this.origin.x + (cx + 0.5) * this.resolution,
            y: this.origin.y + (cy + 0.5) * this.resolution,
        };
    }

    idx(cx, cy) { return cy * this.width + cx; }

    // Log-odds lookup for Gauss-Newton gradient computation
    getLogOdds(cx, cy) {
        if (!this.inBounds(cx, cy)) return 0;
        return this._logOdds[this.idx(cx, cy)];
    }

    // Bilinear-interpolated occupancy probability (needed for GN gradient)
    getOccupancyInterp(wx, wy) {
        const { cx, cy } = this.worldToGrid(wx, wy);
        if (!this.inBounds(cx, cy)) return 0;

        // Bilinear interpolation over 2×2 neighbour cells
        const fx = ((wx - this.origin.x) / this.resolution) - cx;
        const fy = ((wy - this.origin.y) / this.resolution) - cy;

        const p00 = this._prob(cx, cy);
        const p10 = this._prob(cx + 1, cy);
        const p01 = this._prob(cx, cy + 1);
        const p11 = this._prob(cx + 1, cy + 1);

        return p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
    }

    // Gradient of occupancy probability (dP/dx, dP/dy) — for Gauss-Newton Jacobian
    getOccupancyGradient(wx, wy) {
        const res = this.resolution;
        const dx = (this.getOccupancyInterp(wx + res, wy) - this.getOccupancyInterp(wx - res, wy)) / (2 * res);
        const dy = (this.getOccupancyInterp(wx, wy + res) - this.getOccupancyInterp(wx, wy - res)) / (2 * res);
        return { dx, dy };
    }

    _prob(cx, cy) {
        if (!this.inBounds(cx, cy)) return 0.5;
        const lo = this._logOdds[this.idx(cx, cy)];
        return 1 / (1 + Math.exp(-lo));  // sigmoid: log-odds → probability
    }

    // ─── Map update (Bresenham + log-odds) ─────────────────────────────────────

    /**
     * updateWithRay(sensorX, sensorY, obstacleX, obstacleY)
     * Update occupancy along a LiDAR ray.
     */
    updateWithRay(sx, sy, ox, oy, isHit) {
        const { cx: cx0, cy: cy0 } = this.worldToGrid(sx, sy);
        const { cx: cx1, cy: cy1 } = this.worldToGrid(ox, oy);

        // Bresenham line — mark traversed cells as free
        this._bresenham(cx0, cy0, cx1, cy1, (cx, cy) => {
            if (!this.inBounds(cx, cy)) return;
            const i = this.idx(cx, cy);
            this._logOdds[i] = Math.max(LOG_ODDS_MIN, this._logOdds[i] + LOG_ODDS_FREE);
        });

        // Final cell: mark as occupied (if hit, not max range)
        if (isHit && this.inBounds(cx1, cy1)) {
            const i = this.idx(cx1, cy1);
            this._logOdds[i] = Math.min(LOG_ODDS_MAX, this._logOdds[i] + LOG_ODDS_OCC);
        }

        this._dirtyExport = true;
    }

    _dirtyExport = true;

    /**
     * exportData()
     * Convert log-odds to ROS-compatible -1/0/100 grid.
     */
    exportData() {
        if (!this._dirtyExport) return this.data;
        for (let i = 0; i < this._logOdds.length; i++) {
            const lo = this._logOdds[i];
            if (lo === 0) {
                this.data[i] = -1;    // Unknown
            } else if (lo > LOG_ODDS_THRESHOLD) {
                this.data[i] = 100;   // Occupied
            } else {
                this.data[i] = 0;     // Free
            }
        }
        this._dirtyExport = false;
        return this.data;
    }

    // ─── Bresenham's line algorithm ────────────────────────────────────────────
    _bresenham(x0, y0, x1, y1, callback) {
        let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        let x = x0, y = y0;
        const maxSteps = Math.max(dx, dy, 1) + 1;

        for (let step = 0; step < maxSteps; step++) {
            callback(x, y);
            if (x === x1 && y === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }

    toRosOccupancyGrid() {
        return {
            width: this.width,
            height: this.height,
            resolution: this.resolution,
            origin: this.origin,
            data: this.exportData(),
        };
    }
}

// ─── Multi-resolution map hierarchy ──────────────────────────────────────────
class MultiResMap {
    constructor(baseWidth, baseHeight, baseResolution, origin, levels = 3) {
        this.levels = [];
        let w = baseWidth, h = baseHeight, res = baseResolution;

        for (let i = 0; i < levels; i++) {
            this.levels.push(new OccupancyGrid(w, h, res, { ...origin }));
            // Each level is half the resolution (double cell size)
            w = Math.ceil(w / 2);
            h = Math.ceil(h / 2);
            res = res * 2;
        }
    }

    updateWithRay(sx, sy, ox, oy, isHit) {
        // Update all levels
        for (const grid of this.levels) {
            grid.updateWithRay(sx, sy, ox, oy, isHit);
        }
    }
}

// ─── Hector SLAM ─────────────────────────────────────────────────────────────
class HectorSlam {
    constructor() {
        this._map = null;
        this._slamPose = { x: 0, y: 0, theta: 0 };
        this._initialized = false;
        this._listeners = [];

        // GN optimizer params
        this._gnIterations = 5;     // Max Gauss-Newton iterations per scan
        this._gnConvergence = 1e-4;  // Stop if delta norm < this
        this._maxLinearUpdate = 0.5;   // m — cap per-scan movement
        this._maxAngularUpdate = 0.3;  // rad

        // Motion prediction
        this._prevScanTime = null;

        // Loop Closure params
        this._keyframes = [];
        this._lastKfPose = { x: -100, y: -100, theta: 0 };
        this._kfDistThreshold = 1.0;  // m — create KF every 1m
        this._kfAngleThreshold = 0.5; // rad
        this._loopDistMin = 3.0;      // m — ignore loops closer than this
        this._loopMaxSearch = 20;     // max KFs to check
    }

    // ─── Init ──────────────────────────────────────────────────────────────────

    /**
     * init(options)
     * @param {{ width, height, resolution, originX, originY, mapLevels }} options
     */
    init(options = {}) {
        const width = options.width ?? 400;
        const height = options.height ?? 400;
        const resolution = options.resolution ?? 0.05;   // 5cm
        const originX = options.originX ?? -(width * resolution / 2);
        const originY = options.originY ?? -(height * resolution / 2);
        const levels = options.mapLevels ?? 3;

        this._map = new MultiResMap(width, height, resolution, { x: originX, y: originY }, levels);
        this._slamPose = { x: 0, y: 0, theta: 0 };
        this._initialized = true;

        console.log(`[HectorSLAM] Init: ${width}×${height} @ ${resolution}m/cell, ${levels} levels`);
    }

    // ─── Process Scan ──────────────────────────────────────────────────────────

    /**
     * processScan(scan, initialPose)
     * Main entry point — match scan to map, update map, update pose.
     * Tương đương: slam_toolbox::SlamToolbox::laserCallback()
     *
     * @param {LaserScan} scan
     * @param {{ x, y, theta }|null} initialPose - Seed from odometry (optional)
     * @returns {{ pose: {x,y,theta}, map: OccupancyGrid }}
     */
    processScan(scan, initialPose = null) {
        if (!this._initialized) this.init();
        if (!scan || !scan.ranges || scan.ranges.length === 0) {
            return { pose: this._slamPose, map: this._map.levels[0].toRosOccupancyGrid() };
        }

        // Convert scan → world points (using current pose as initial estimate)
        const seed = initialPose
            ? this._blendPose(this._slamPose, initialPose, 0.3)
            : this._slamPose;

        // ─── Gauss-Newton scan matching (multi-resolution, coarse to fine) ───────
        let pose = { ...seed };

        for (let level = this._map.levels.length - 1; level >= 0; level--) {
            const grid = this._map.levels[level];
            pose = this._gaussNewtonOptimize(scan, pose, grid);
        }

        // Clamp per-scan update
        const dx = pose.x - this._slamPose.x;
        const dy = pose.y - this._slamPose.y;
        const moveDist = Math.hypot(dx, dy);
        if (moveDist > this._maxLinearUpdate) {
            const scale = this._maxLinearUpdate / moveDist;
            pose.x = this._slamPose.x + dx * scale;
            pose.y = this._slamPose.y + dy * scale;
        }
        const dTheta = this._angleDiff(pose.theta, this._slamPose.theta);
        if (Math.abs(dTheta) > this._maxAngularUpdate) {
            pose.theta = this._slamPose.theta + Math.sign(dTheta) * this._maxAngularUpdate;
        }

        this._slamPose = pose;

        // ─── Loop Closure & Graph Optimization ────────────────────────────────────
        this._handleKeyframes(scan, pose);

        // ─── Update map using matched pose ────────────────────────────────────────
        this._updateMap(scan, pose);

        // ─── Notify listeners ─────────────────────────────────────────────────────
        const mapOut = this._map.levels[0].toRosOccupancyGrid();
        this._listeners.forEach(cb => {
            try { cb({ pose, map: mapOut }); } catch (e) { console.error(e); }
        });

        return { pose, map: mapOut };
    }

    // ─── Gauss-Newton Optimizer ───────────────────────────────────────────────

    _gaussNewtonOptimize(scan, initialPose, grid) {
        let pose = { ...initialPose };

        for (let iter = 0; iter < this._gnIterations; iter++) {
            const { H, b } = this._computeHessian(scan, pose, grid);

            // Solve: H * delta = -b  (3x3 system)
            const delta = this._solve3x3(H, b.map(v => -v));
            if (!delta) break;

            const [dtx, dty, dtheta] = delta;

            // Convergence check
            if (Math.sqrt(dtx * dtx + dty * dty + dtheta * dtheta) < this._gnConvergence) break;

            pose = {
                x: pose.x + dtx,
                y: pose.y + dty,
                theta: pose.theta + dtheta,
            };
        }

        return pose;
    }

    /**
     * _computeHessian(scan, pose, grid)
     * Compute: H = Σ Jᵀ J,  b = Σ Jᵀ r
     * where J = ∂M(p)/∂pose,  r = M(p) - 1  (want occupancy = 1 at scan endpoints)
     */
    _computeHessian(scan, pose, grid) {
        // 3x3 Hessian (tx, ty, theta) — upper triangular, symmetric
        const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        const b = [0, 0, 0];

        const cos = Math.cos(pose.theta), sin = Math.sin(pose.theta);

        for (let i = 0; i < scan.ranges.length; i++) {
            const r = scan.ranges[i];
            if (r < scan.range_min || r > scan.range_max || !isFinite(r)) continue;

            const scanAngle = scan.angle_min + i * scan.angle_increment;

            // Scan point in world frame
            const lx = r * Math.cos(scanAngle);
            const ly = r * Math.sin(scanAngle);
            const wx = pose.x + lx * cos - ly * sin;
            const wy = pose.y + lx * sin + ly * cos;

            // Occupancy residual: we want M(wx,wy) → 1 (occupied at scan hit)
            const M = grid.getOccupancyInterp(wx, wy);
            const residual = 1.0 - M;

            // Gradient of M w.r.t world coords
            const { dx: dMdx, dy: dMdy } = grid.getOccupancyGradient(wx, wy);

            // Jacobian of world point w.r.t. pose (tx, ty, theta):
            //   d(wx)/d(tx) = 1,  d(wx)/d(ty) = 0,  d(wx)/d(theta) = -lx*sin - ly*cos
            //   d(wy)/d(tx) = 0,  d(wy)/d(ty) = 1,  d(wy)/d(theta) =  lx*cos - ly*sin
            const dWdTheta_x = -lx * sin - ly * cos;
            const dWdTheta_y = lx * cos - ly * sin;

            // dM/d(pose) = [dM/dx, dM/dy, dM/dx*dW/dθ + dM/dy*dW/dθ]
            const J = [
                dMdx,
                dMdy,
                dMdx * dWdTheta_x + dMdy * dWdTheta_y,
            ];

            // Accumulate H += Jᵀ J,  b += Jᵀ r
            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 3; col++) {
                    H[row][col] += J[row] * J[col];
                }
                b[row] += J[row] * residual;
            }
        }

        // Damping (Levenberg-Marquardt style) to improve conditioning
        const lambda = 0.01;
        for (let i = 0; i < 3; i++) H[i][i] += lambda;

        return { H, b };
    }

    // ─── 3×3 linear system solver (Gaussian elimination) ─────────────────────

    _solve3x3(A, b) {
        // Make augmented matrix [A|b]
        const m = A.map((row, i) => [...row, b[i]]);

        for (let col = 0; col < 3; col++) {
            // Partial pivoting
            let maxRow = col;
            for (let row = col + 1; row < 3; row++) {
                if (Math.abs(m[row][col]) > Math.abs(m[maxRow][col])) maxRow = row;
            }
            [m[col], m[maxRow]] = [m[maxRow], m[col]];

            if (Math.abs(m[col][col]) < 1e-10) return null; // Singular

            const pivot = m[col][col];
            for (let j = col; j <= 3; j++) m[col][j] /= pivot;

            for (let row = 0; row < 3; row++) {
                if (row === col) continue;
                const factor = m[row][col];
                for (let j = col; j <= 3; j++) m[row][j] -= factor * m[col][j];
            }
        }

        return [m[0][3], m[1][3], m[2][3]];
    }

    // ─── Map update ──────────────────────────────────────────────────────────────

    _updateMap(scan, pose) {
        const cos = Math.cos(pose.theta), sin = Math.sin(pose.theta);

        // LiDAR sensor position in world
        const sx = pose.x, sy = pose.y;

        for (let i = 0; i < scan.ranges.length; i++) {
            const r = scan.ranges[i];
            if (!isFinite(r) || r < scan.range_min) continue;

            const scanAngle = scan.angle_min + i * scan.angle_increment;
            const lx = r * Math.cos(scanAngle);
            const ly = r * Math.sin(scanAngle);

            const wx = sx + lx * cos - ly * sin;
            const wy = sy + lx * sin + ly * cos;

            const isHit = r < scan.range_max;
            this._map.updateWithRay(sx, sy, wx, wy, isHit);
        }
    }

    // ─── Pose blend (seed from odometry) ─────────────────────────────────────

    _blendPose(a, b, t) {
        return {
            x: a.x * (1 - t) + b.x * t,
            y: a.y * (1 - t) + b.y * t,
            theta: a.theta * (1 - t) + b.theta * t,
        };
    }

    _angleDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }

    // ─── Keyframes & Graph Optimization ──────────────────────────────────────

    _handleKeyframes(scan, pose) {
        const dist = Math.hypot(pose.x - this._lastKfPose.x, pose.y - this._lastKfPose.y);
        const angle = Math.abs(this._angleDiff(pose.theta, this._lastKfPose.theta));

        if (dist > this._kfDistThreshold || angle > this._kfAngleThreshold) {
            const newKf = new Keyframe(pose, { ...scan, ranges: new Float32Array(scan.ranges) });
            this._keyframes.push(newKf);
            this._lastKfPose = { ...pose };

            console.log(`[HectorSLAM] Keyframe added: #${this._keyframes.length}`);

            // Try Loop Closure
            this._detectLoops(newKf);
        }
    }

    _detectLoops(newKf) {
        if (this._keyframes.length < 10) return;

        // Check against old keyframes (excluding the most recent ones)
        for (let i = 0; i < this._keyframes.length - 10; i++) {
            const oldKf = this._keyframes[i];
            const dist = Math.hypot(newKf.pose.x - oldKf.pose.x, newKf.pose.y - oldKf.pose.y);

            if (dist < this._loopDistMin) {
                // Potential loop! Run GN scan match to verify and get relative pose
                const relativePose = this._gaussNewtonOptimize(newKf.scan, oldKf.pose, this._map.levels[0]);
                const score = this._scoreMatch(newKf.scan, relativePose, this._map.levels[0]);

                if (score > 0.8) {
                    console.log(`[HectorSLAM] LOOP DETECTED between kf:${this._keyframes.length - 1} and kf:${i}`);
                    newKf.links.push({ toIndex: i, relativePose });
                    this._optimizeGraph();
                    break; // One loop per KF is enough
                }
            }
        }
    }

    /**
     * _optimizeGraph()
     * Simplified Pose-Graph Relaxation using Stochastic Gradient Descent.
     */
    _optimizeGraph() {
        const iterations = 30;
        const learningRate = 0.1;

        for (let iter = 0; iter < iterations; iter++) {
            for (let i = 1; i < this._keyframes.length; i++) {
                const kf = this._keyframes[i];
                const prevKf = this._keyframes[i - 1];

                // 1. Odom edge (sequential constraint)
                const dx = kf.pose.x - prevKf.pose.x;
                const dy = kf.pose.y - prevKf.pose.y;
                // Simplified: push/pull kf to maintain relative distance
                // (In full SLAM we'd use SE2 transforms)

                // 2. Loop edges
                for (const link of kf.links) {
                    const targetKf = this._keyframes[link.toIndex];
                    const errX = (kf.pose.x - targetKf.pose.x) - (link.relativePose.x - targetKf.pose.x);
                    const errY = (kf.pose.y - targetKf.pose.y) - (link.relativePose.y - targetKf.pose.y);

                    kf.pose.x -= errX * learningRate;
                    kf.pose.y -= errY * learningRate;
                }
            }
        }
        this._slamPose = this._keyframes[this._keyframes.length - 1].pose;
    }

    _scoreMatch(scan, pose, grid) {
        let score = 0, count = 0;
        for (let i = 0; i < scan.ranges.length; i += 5) {
            const r = scan.ranges[i];
            if (r < scan.range_min || r > scan.range_max) continue;
            const angle = scan.angle_min + i * scan.angle_increment + pose.theta;
            const wx = pose.x + r * Math.cos(angle);
            const wy = pose.y + r * Math.sin(angle);
            if (grid.getLogOdds(Math.floor((wx - grid.origin.x) / grid.resolution), Math.floor((wy - grid.origin.y) / grid.resolution)) > 0) {
                score++;
            }
            count++;
        }
        return count > 0 ? score / count : 0;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    onUpdate(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }

    getPose() { return { ...this._slamPose }; }

    getMap() {
        return this._map ? this._map.levels[0].toRosOccupancyGrid() : null;
    }

    /**
     * resetMap()
     * Tương đương: ros2 service call /slam_toolbox/clear
     */
    resetMap() {
        this.init();
        console.log('[HectorSLAM] Map cleared.');
    }

    /**
     * saveMap()
     * Returns occupancy grid data for saving (serializable).
     * Tương đương: ros2 service call /slam_toolbox/serialize_map
     */
    saveMap() {
        if (!this._map) return null;
        const grid = this._map.levels[0];
        return {
            width: grid.width,
            height: grid.height,
            resolution: grid.resolution,
            origin: grid.origin,
            pose: { ...this._slamPose },
            data: Array.from(grid.exportData()),
        };
    }

    /**
     * loadMap(savedMap)
     * Load a previously saved map (e.g. from JSON file).
     * Tương đương: ros2 service call /map_server/load_map
     */
    loadMap(savedMap) {
        const { width, height, resolution, origin, data, pose } = savedMap;
        this.init({ width, height, resolution, originX: origin.x, originY: origin.y });

        const grid = this._map.levels[0];
        // Fill log-odds from saved data
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            grid._logOdds[i] = v === 100 ? LOG_ODDS_MAX * 0.9
                : v === 0 ? LOG_ODDS_MIN * 0.9
                    : 0;
        }
        grid._dirtyExport = true;

        if (pose) this._slamPose = pose;
        console.log('[HectorSLAM] Map loaded:', width, '×', height);
    }
}

export default HectorSlam;
export { HectorSlam, OccupancyGrid };
