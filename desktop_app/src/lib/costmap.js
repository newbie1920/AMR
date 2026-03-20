/**
 * costmap.js
 * ==========
 * Occupancy Costmap 2D — thay thế nav2_costmap_2d trong ROS2
 *
 * ROS2 nav2_costmap_2d có:
 *   - StaticLayer      (bản đồ nền từ SLAM)
 *   - ObstacleLayer    (LiDAR scan → obstacles)
 *   - InflationLayer   (thổi phồng obstacles theo robot radius)
 *
 * Module này:
 *   - Occupancy grid chuẩn: cells 0 (free) → 100 (occupied) → 255 (unknown)
 *   - ObstacleLayer từ LaserScan + TF (scan → world coords)
 *   - InflationLayer với exponential decay
 *   - StaticLayer từ SLAM map
 *   - Rolling window mode (follow robot) + global mode
 *
 * COST VALUES (tương đương nav2):
 *   0          = FREE
 *   1-252      = Inflated cost (robot can pass, với penalty)
 *   253        = Near obstacle — planner tránh nếu có thể
 *   254        = Inscribed radius — va chạm chắc chắn
 *   255        = Occupied / Unknown
 *
 * USAGE:
 *   import costmap from './costmap';
 *   costmap.init({ width: 200, height: 200, resolution: 0.05, originX: -5, originY: -5 });
 *   costmap.updateFromScan(laserScan, robotPose);
 *   const cost = costmap.getCost(worldX, worldY);
 *   const grid = costmap.getGrid(); // Uint8Array
 */

import tfTree from './tfTree';

// Cost constants (tương đương nav2_costmap_2d/cost_values.hpp)
export const COST_FREE = 0;
export const COST_LETHAL = 254;   // Inscribed obstacle
export const COST_OCCUPIED = 255;   // Hard obstacle / unknown
export const COST_UNKNOWN = 255;
export const COST_INFLATION = 253;   // Near-lethal

class Costmap2D {
    constructor(tfTreeInstance = null) {
        this._tfTree = tfTreeInstance || tfTree;
        // Grid parameters
        this._width = 1000;   // 50m @ 0.05m res
        this._height = 1000;
        this._resolution = 0.05;   // m/cell (5cm)
        this._originX = -5.0;   // world X of cell (0,0)
        this._originY = -5.0;

        // Grid layers
        this._staticLayer = null;   // Uint8Array — from SLAM
        this._obstacleLayer = null;   // Uint8Array — from LiDAR
        this._virtualLayer = null;    // Uint8Array — for keepout zones
        this._fleetLayer = null;      // Uint8Array — from other robots
        this._masterGrid = null;   // Uint8Array — combined costmap

        // Inflation params
        this._robotRadius = 0.22;  // m — insribed circle (from URDF)
        this._inflationRadius = 0.4;  // m — expand by this much around obstacles

        this._listeners = [];
        this._init();
    }

    // ─── Init ──────────────────────────────────────────────────────────────────

    /**
     * init(options)
     * @param {Object} options
     *   width, height   - cells
     *   resolution      - m/cell
     *   originX, originY - world coords of cell (0,0)
     *   robotRadius, inflationRadius - m
     */
    init(options = {}) {
        Object.assign(this, {
            _width: options.width ?? this._width,
            _height: options.height ?? this._height,
            _resolution: options.resolution ?? this._resolution,
            _originX: options.originX ?? this._originX,
            _originY: options.originY ?? this._originY,
            _robotRadius: options.robotRadius ?? this._robotRadius,
            _inflationRadius: options.inflationRadius ?? this._inflationRadius,
        });
        this._init();
    }

    _init() {
        const size = this._width * this._height;
        // Initialize all layers as FREE (0) instead of UNKNOWN (255)
        // When no real LiDAR/SLAM data is present (simulation mode),
        // UNKNOWN cells cause the A* planner to generate erratic paths.
        // Obstacles will be populated when real sensor data arrives.
        this._staticLayer = new Uint8Array(size).fill(COST_FREE);
        this._obstacleLayer = new Uint8Array(size).fill(COST_FREE);
        this._virtualLayer = new Uint8Array(size).fill(COST_FREE);
        this._fleetLayer = new Uint8Array(size).fill(COST_FREE);
        this._masterGrid = new Uint8Array(size).fill(COST_FREE);
        this._precomputeInflationKernel();
        console.log(`[Costmap] Initialized ${this._width}×${this._height} @ ${this._resolution}m/cell (FREE default)`);
    }

    // ─── Coordinate conversion ─────────────────────────────────────────────────

    /** World (m) → cell index.  Returns -1 if out of bounds. */
    worldToCell(wx, wy) {
        const cx = Math.floor((wx - this._originX) / this._resolution);
        const cy = Math.floor((wy - this._originY) / this._resolution);
        if (cx < 0 || cx >= this._width || cy < 0 || cy >= this._height) return -1;
        return cy * this._width + cx;
    }

    /** Cell index → world center (m) */
    cellToWorld(idx) {
        const cx = idx % this._width;
        const cy = Math.floor(idx / this._width);
        return {
            x: this._originX + (cx + 0.5) * this._resolution,
            y: this._originY + (cy + 0.5) * this._resolution,
        };
    }

    worldToGrid(wx, wy) {
        return {
            cx: Math.floor((wx - this._originX) / this._resolution),
            cy: Math.floor((wy - this._originY) / this._resolution),
        };
    }

    gridToWorld(cx, cy) {
        return {
            x: this._originX + (cx + 0.5) * this._resolution,
            y: this._originY + (cy + 0.5) * this._resolution,
        };
    }

    inBounds(cx, cy) {
        return cx >= 0 && cx < this._width && cy >= 0 && cy < this._height;
    }

    // ─── Static Layer (from SLAM) ──────────────────────────────────────────────

    /**
     * loadStaticMap(occupancyGrid)
     * Tương đương: nav2_costmap_2d::StaticLayer::incomingMap()
     *
     * @param {Object} occupancyGrid - { width, height, resolution, origin: {x,y}, data: Int8Array }
     *   data: -1=unknown, 0=free, 100=occupied (chuẩn ROS OccupancyGrid)
     */
    loadStaticMap(occupancyGrid) {
        const { width, height, resolution, origin, data } = occupancyGrid;

        // Re-init if size changed
        if (width !== this._width || height !== this._height) {
            this.init({
                width, height, resolution,
                originX: origin.x, originY: origin.y
            });
        }

        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            if (v === -1 || v === 255) {
                this._staticLayer[i] = COST_UNKNOWN;
            } else if (v >= 65) {
                this._staticLayer[i] = COST_LETHAL;  // Occupied
            } else {
                this._staticLayer[i] = COST_FREE;
            }
        }

        this._composeLayers();
        console.log('[Costmap] Static map loaded.');
    }

    /**
     * clearStaticMap()
     * Mark all cells as free (before SLAM is ready)
     */
    clearStaticMap() {
        this._staticLayer.fill(COST_FREE);
        this._composeLayers();
    }

    // ─── Virtual Layer (Keepout Zones) ─────────────────────────────────────────

    /**
     * addVirtualKeepout(x, y, w, h)
     * Thêm vùng cấm ảo (Virtual Wall)
     */
    addVirtualKeepout(x, y, w, h) {
        const { cx: cxStart, cy: cyStart } = this.worldToGrid(x, y);
        const { cx: cxEnd, cy: cyEnd } = this.worldToGrid(x + w, y + h);

        for (let cy = cyStart; cy <= cyEnd; cy++) {
            for (let cx = cxStart; cx <= cxEnd; cx++) {
                if (!this.inBounds(cx, cy)) continue;
                this._virtualLayer[this.idx(cx, cy)] = COST_LETHAL;
            }
        }
        this._composeLayers();
    }

    idx(cx, cy) { return cy * this._width + cx; }

    // ─── Obstacle Layer (from LiDAR) ──────────────────────────────────────────

    /**
     * updateFromScan(scan, robotPose)
     * Tương đương: nav2_costmap_2d::ObstacleLayer::laserScanCallback()
     *
     * @param {LaserScan} scan     - From lidarDriver.onScan()
     * @param {Object}    robotPose - { x, y, theta } in map frame
     */
    updateFromScan(scan, robotPose) {
        if (!scan || !scan.ranges) return;

        // 1. Clear previous obstacle layer (rolling window)
        this._obstacleLayer.fill(COST_FREE);

        // 2. Get LiDAR pose in map frame (via TF tree)
        const lidarWorld = this._tfTree.getLidarPoseInMap();
        const lx = lidarWorld?.x ?? robotPose.x;
        const ly = lidarWorld?.y ?? robotPose.y;
        const lyaw = (lidarWorld?.theta ?? robotPose.theta);

        // 3. Project each scan point into world coords → mark as obstacle
        for (let i = 0; i < scan.ranges.length; i++) {
            const r = scan.ranges[i];
            if (r < scan.range_min || r > scan.range_max || !isFinite(r)) continue;

            const scanAngle = scan.angle_min + i * scan.angle_increment;
            const worldAngle = lyaw + scanAngle;

            // Obstacle world position
            const ox = lx + r * Math.cos(worldAngle);
            const oy = ly + r * Math.sin(worldAngle);

            const idx = this.worldToCell(ox, oy);
            if (idx >= 0) {
                this._obstacleLayer[idx] = COST_LETHAL;
            }

            // Bresenham line: mark free space between LiDAR and obstacle
            this._raytrace(lx, ly, ox, oy);
        }

        // 4. Apply inflation and recompose
        this._applyInflation();
        this._composeLayers();
        this._notify();
    }

    // ─── Fleet Layer (Multi-robot avoidance) ───────────────────────────────────

    /**
     * updateFleetObstacles(robots, selfId)
     * Marks other robots in the fleet as obstacles.
     * 
     * @param {Array} robots - Array of robot objects from fleetStore
     * @param {string} selfId - ID of this robot (to exclude itself)
     */
    updateFleetObstacles(robots, selfId) {
        if (!Array.isArray(robots)) return;

        // 1. Clear previous fleet layer
        this._fleetLayer.fill(COST_FREE);

        // 2. Mark each other robot's pose in the costmap
        for (const robot of robots) {
            if (robot.id === selfId || !robot.pose) continue;

            const idx = this.worldToCell(robot.pose.x, robot.pose.y);
            if (idx >= 0) {
                this._fleetLayer[idx] = COST_LETHAL;

                // Also mark immediate neighbors for better avoidance if resolution is fine
                // This simulates the footprint of the other robot
                const cx = idx % this._width;
                const cy = Math.floor(idx / this._width);
                const rCells = Math.ceil(this._robotRadius / this._resolution);

                for (let dy = -rCells; dy <= rCells; dy++) {
                    for (let dx = -rCells; dx <= rCells; dx++) {
                        if (dx * dx + dy * dy > rCells * rCells) continue;
                        const nx = cx + dx, ny = cy + dy;
                        if (this.inBounds(nx, ny)) {
                            this._fleetLayer[ny * this._width + nx] = COST_LETHAL;
                        }
                    }
                }
            }
        }

        // 3. Recompose (inflation is handled via its own layer, but we could also inflate this)
        // For now, we rely on the robot footprint we just marked.
        this._composeLayers();
        this._notify();
    }

    // ─── Inflation Layer ───────────────────────────────────────────────────────

    _inflationKernel = null;
    _inflationRadiusCells = 0;

    _precomputeInflationKernel() {
        const r = Math.ceil(this._inflationRadius / this._resolution);
        this._inflationRadiusCells = r;
        const lethalR = Math.ceil(this._robotRadius / this._resolution);

        // Kernel: cost at each offset (cx, cy) from obstacle center
        this._inflationKernel = [];
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy) * this._resolution;
                if (dist > this._inflationRadius) continue;
                let cost;
                if (dist <= this._robotRadius) {
                    cost = COST_LETHAL;
                } else {
                    // Exponential decay: costINFL * e^(-k * (dist - robot_radius))
                    const k = 5.0; // decay factor
                    cost = Math.round(COST_INFLATION * Math.exp(-k * (dist - this._robotRadius)));
                    cost = Math.max(1, Math.min(COST_INFLATION, cost));
                }
                this._inflationKernel.push({ dx, dy, cost });
            }
        }
    }

    _inflatedObstacles = null;

    _applyInflation() {
        if (!this._inflationKernel) return;
        const inflated = new Uint8Array(this._width * this._height).fill(COST_FREE);

        for (let idx = 0; idx < this._obstacleLayer.length; idx++) {
            if (this._obstacleLayer[idx] < COST_LETHAL) continue;

            const cx = idx % this._width;
            const cy = Math.floor(idx / this._width);

            for (const { dx, dy, cost } of this._inflationKernel) {
                const nx = cx + dx, ny = cy + dy;
                if (!this.inBounds(nx, ny)) continue;
                const nIdx = ny * this._width + nx;
                if (inflated[nIdx] < cost) inflated[nIdx] = cost;
            }
        }

        this._inflatedObstacles = inflated;
    }

    // ─── Layer composition ─────────────────────────────────────────────────────

    _composeLayers() {
        const size = this._width * this._height;
        for (let i = 0; i < size; i++) {
            const static_ = this._staticLayer[i];
            const obs = this._obstacleLayer[i];
            const virt = this._virtualLayer[i];
            const fleet = this._fleetLayer ? this._fleetLayer[i] : 0;
            const inf = this._inflatedObstacles ? this._inflatedObstacles[i] : 0;

            // Master = max of all layers
            this._masterGrid[i] = Math.max(static_, obs, virt, fleet, inf);
        }
    }

    // ─── Raytrace (Bresenham's line) ───────────────────────────────────────────
    //   Mark free space between LiDAR and obstacle point

    _raytrace(x0, y0, x1, y1) {
        const { cx: cx0, cy: cy0 } = this.worldToGrid(x0, y0);
        const { cx: cx1, cy: cy1 } = this.worldToGrid(x1, y1);

        let x = cx0, y = cy0;
        const dx = Math.abs(cx1 - cx0), dy = Math.abs(cy1 - cy0);
        const sx = cx0 < cx1 ? 1 : -1, sy = cy0 < cy1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            if (x === cx1 && y === cy1) break;
            if (!this.inBounds(x, y)) break;
            const idx = y * this._width + x;
            // Don't overwrite static map walls
            if (this._staticLayer[idx] < COST_LETHAL) {
                this._obstacleLayer[idx] = COST_FREE;
            }
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }

    // ─── Public query API ──────────────────────────────────────────────────────

    /**
     * getCost(wx, wy) — world coords → cost value
     * Tương đương: costmap_2d::Costmap2D::getCost()
     */
    getCost(wx, wy) {
        const idx = this.worldToCell(wx, wy);
        if (idx < 0) return COST_UNKNOWN;
        return this._masterGrid[idx];
    }

    getCostAtCell(cx, cy) {
        if (!this.inBounds(cx, cy)) return COST_UNKNOWN;
        return this._masterGrid[cy * this._width + cx];
    }

    /**
     * isFree(wx, wy, threshold)
     * Check if a world point is traversable (cost below threshold)
     */
    isFree(wx, wy, threshold = COST_LETHAL) {
        return this.getCost(wx, wy) < threshold;
    }

    isUnknown(wx, wy) {
        return this.getCost(wx, wy) === COST_UNKNOWN;
    }

    /** Get full master grid (for rendering) */
    getGrid() { return this._masterGrid; }

    /** Metadata object (tương đương nav_msgs/OccupancyGrid metadata) */
    getMetadata() {
        return {
            width: this._width,
            height: this._height,
            resolution: this._resolution,
            origin: { x: this._originX, y: this._originY },
        };
    }

    // ─── Listener system ───────────────────────────────────────────────────────

    onUpdate(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }

    _notify() {
        this._listeners.forEach(cb => { try { cb(this); } catch (e) { console.error(e); } });
    }

    // ─── Resize / recentre ─────────────────────────────────────────────────────

    /**
     * recenter(robotX, robotY)
     * Move the costmap window so robot stays centered.
     * Tương đương: rolling window mode in nav2
     */
    recenter(robotX, robotY) {
        const newOriginX = robotX - (this._width * this._resolution) / 2;
        const newOriginY = robotY - (this._height * this._resolution) / 2;
        this._originX = newOriginX;
        this._originY = newOriginY;
        // Clear obstacle layer (static stays)
        this._obstacleLayer.fill(COST_FREE);
        if (this._inflatedObstacles) this._inflatedObstacles.fill(COST_FREE);
    }
}

const costmap = new Costmap2D();
export default costmap;
export { Costmap2D };
