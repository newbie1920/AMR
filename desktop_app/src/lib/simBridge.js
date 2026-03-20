/**
 * simBridge.js
 * ============
 * Simulation Bridge — thay thế Gazebo / Stage / Webots
 * 
 * Tính năng:
 *   - Simulates unicycle kinematics (v, w -> pose).
 *   - Simulates LiDAR scans chống lại một Occupancy Grid map.
 *   - Thay thế robot thực (robotBridge) trong môi trường phát triển.
 */

import { LaserScan } from './lidarDriver';

class SimBridge {
    constructor() {
        this._pose = { x: 0, y: 0, theta: 0 };
        this._vel = { linear: 0, angular: 0 };
        this._map = null;
        this._lastUpdate = Date.now();
        this._isActive = false;
    }

    start(initialPose = { x: 0, y: 0, theta: 0 }, map = null) {
        this._pose = { ...initialPose };
        this._map = map;
        this._isActive = true;
        this._lastUpdate = Date.now();
        console.log('[SimBridge] Simulation started.');
    }

    stop() { this._isActive = false; }

    /**
     * step()
     * Chạy một bước mô phỏng (gọi 20-50Hz).
     */
    step(dt = 0.05) {
        if (!this._isActive) return;

        // 1. Kinematics (Unicycle Model)
        const { linear, angular } = this._vel;
        this._pose.theta += angular * dt;
        this._pose.x += linear * Math.cos(this._pose.theta) * dt;
        this._pose.y += linear * Math.sin(this._pose.theta) * dt;
    }

    /**
     * setVelocity(v, w)
     * Giả lập nhận cmd_vel.
     */
    setVelocity(v, w) {
        this._vel = { linear: v, angular: w };
    }

    /**
     * generateScan()
     * Giả lập LiDAR scan bằng cách raytrace trên map.
     */
    generateScan() {
        if (!this._map) return null;

        const scan = new LaserScan();
        scan.angle_min = -Math.PI;
        scan.angle_max = Math.PI;
        scan.angle_increment = (2 * Math.PI) / 360;
        scan.range_min = 0.15;
        scan.range_max = 12.0;

        const ranges = new Float32Array(360);
        const { width, height, resolution, origin, data } = this._map;

        for (let i = 0; i < 360; i++) {
            const angle = scan.angle_min + i * scan.angle_increment + this._pose.theta;
            let r = scan.range_min;
            let hit = false;

            // Raytrace
            while (r < scan.range_max) {
                const wx = this._pose.x + r * Math.cos(angle);
                const wy = this._pose.y + r * Math.sin(angle);

                const cx = Math.floor((wx - origin.x) / resolution);
                const cy = Math.floor((wy - origin.y) / resolution);

                if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
                    ranges[i] = scan.range_max;
                    break;
                }

                if (data[cy * width + cx] === 100) {
                    ranges[i] = r;
                    hit = true;
                    break;
                }
                r += resolution * 0.5; // Step half cell
            }
            if (!hit) ranges[i] = scan.range_max;
        }

        scan.ranges = ranges;
        return scan;
    }

    getTelemetry() {
        return {
            type: 'telem',
            x: this._pose.x,
            y: this._pose.y,
            theta: this._pose.theta,
            vx: this._vel.linear,
            wz: this._vel.angular
        };
    }
}

const sim = new SimBridge();
export default sim;
