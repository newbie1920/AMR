/**
 * healthMonitor.js
 * ================
 * System Health & Watchdog — thay thế ROS2 Diagnostics & Lifecycle management
 * 
 * Tính năng:
 *   - Giám sát tần suất (Hz) của các dòng dữ liệu quan trọng.
 *   - Phát hiện các module bị "treo" hoặc mất kết nối.
 *   - Cung cấp trạng thái tổng quán cho UI.
 *   - Cơ chế tự phục hồi (auto-recovery) cơ bản.
 */

import robotBridge, { MSG } from './robotBridge';
import lidarDriver from './lidarDriver';

const MODULES = {
    LIDAR: 'lidar',
    ODOM: 'odom',
    PLANNER: 'planner',
    SLAM: 'slam'
};

const THRESHOLDS = {
    LIDAR: { minHz: 5, timeoutMs: 1000 },
    ODOM: { minHz: 8, timeoutMs: 500 },
    PLANNER: { minHz: 0.5, timeoutMs: 5000 }, // Global plan can be slow
};

class HealthMonitor {
    constructor() {
        this._status = {};
        this._lastSeen = {};
        this._counters = {};
        this._hz = {};
        this._interval = null;

        // Initialize status for all modules
        Object.values(MODULES).forEach(m => {
            this._status[m] = 'STALE';
            this._lastSeen[m] = 0;
            this._counters[m] = 0;
            this._hz[m] = 0;
        });
    }

    start() {
        console.log('[HealthMonitor] Watchdog started.');

        // 1. Subscribe to events to track frequency
        lidarDriver.onScan(() => this._beat(MODULES.LIDAR));
        robotBridge.subscribe('robot_1', MSG.TELEM, () => this._beat(MODULES.ODOM));

        // 2. Periodic check (every 1 second)
        this._interval = setInterval(() => this._check(), 1000);
    }

    stop() {
        if (this._interval) clearInterval(this._interval);
    }

    _beat(module) {
        this._lastSeen[module] = Date.now();
        this._counters[module]++;
    }

    _check() {
        const now = Date.now();

        Object.values(MODULES).forEach(m => {
            const config = THRESHOLDS[m];
            if (!config) return;

            const elapsed = now - this._lastSeen[m];

            // Calculate Hz
            this._hz[m] = this._counters[m]; // Counters are per-interval
            this._counters[m] = 0;

            if (elapsed > config.timeoutMs) {
                if (this._status[m] !== 'ERROR') {
                    console.error(`[HealthMonitor] ${m.toUpperCase()} TIMEOUT detected!`);
                    this._status[m] = 'ERROR';
                    this._handleFailure(m);
                }
            } else if (this._hz[m] < config.minHz) {
                this._status[m] = 'WARNING'; // Low frequency
            } else {
                this._status[m] = 'OK';
            }
        });
    }

    _handleFailure(module) {
        // Basic auto-recovery
        if (module === MODULES.LIDAR) {
            console.log('[HealthMonitor] Attempting to reconnect LiDAR...');
            // lidarDriver.connect(); // Logic re-connect 
        }
    }

    /**
     * feed(robotId, moduleName)
     * Records a heartbeat for a specific module.
     */
    feed(robotId, moduleName) {
        // Map external names to internal module keys
        let target = moduleName;
        if (moduleName === 'telem') target = MODULES.ODOM;

        if (this._status[target] !== undefined) {
            this._beat(target);
        }
    }

    getStatus() { return this._status; }
    getHz() { return this._hz; }

    isSystemHealthy() {
        return Object.values(this._status).every(s => s === 'OK' || s === 'STALE');
    }
}

const healthMonitor = new HealthMonitor();
export default healthMonitor;
