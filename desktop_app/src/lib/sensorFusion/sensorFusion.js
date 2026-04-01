/**
 * sensorFusion.js
 * ===============
 * Sensor Fusion Orchestrator — kết nối WebSocket data → Worker → Store
 * Thay thế: robot_localization/ekf_node (ROS2)
 *
 * Flow:
 *   ESP32 WebSocket → robotBridge (telem) → SensorFusion
 *     → odometryWorker.js (Web Worker: Forward Kinematics + EKF)
 *       → filtered odom back to SensorFusion
 *         → Update robotStore / fleetStore với tọa độ chính xác
 *         → Publish lên topicManager: /odom (filtered)
 *
 * USAGE:
 *   import sensorFusion from './sensorFusion';
 *   sensorFusion.init('robot_1');    // Start fusion for robot
 *   sensorFusion.onFiltered((odom) => { ... });
 *   sensorFusion.destroy();          // Cleanup
 */

import robotBridge, { MSG } from '../robotBridge';
import topicManager, { MSG_TYPES, QOS, STANDARD_TOPICS } from '../topicManager';

class SensorFusion {
    constructor() {
        this._workers = new Map();   // robotId → Worker
        this._listeners = new Map(); // robotId → Set<callback>
        this._globalListeners = [];  // callbacks for any robot
        this._unsubscribers = new Map(); // robotId → unsub fn
        this._latestOdom = new Map(); // robotId → latest filtered odom
        this._initialized = new Set();
    }

    // ─── Init ──────────────────────────────────────────────────────────────────

    /**
     * init(robotId, config)
     * Start sensor fusion for a specific robot.
     *
     * @param {string} robotId - e.g. 'robot_1'
     * @param {Object} config  - { wheelRadius, wheelSeparation, ticksPerRev }
     */
    init(robotId = 'robot_1', config = {}) {
        if (this._initialized.has(robotId)) {
            console.warn(`[SensorFusion] Already initialized for '${robotId}'.`);
            return;
        }

        // 1. Create Web Worker
        let worker;
        try {
            worker = new Worker(
                new URL('./odometryWorker.js', import.meta.url),
                { type: 'module' }
            );
        } catch (err) {
            console.error('[SensorFusion] Failed to create Web Worker:', err);
            console.warn('[SensorFusion] Falling back to main-thread mode.');
            this._initMainThread(robotId, config);
            return;
        }

        this._workers.set(robotId, worker);
        this._listeners.set(robotId, new Set());

        // 2. Send config to worker
        worker.postMessage({
            type: 'config',
            wheelRadius: config.wheelRadius || 0.033,
            wheelSeparation: config.wheelSeparation || 0.17,
            ticksPerRev: config.ticksPerRev || 1665,
        });

        // 3. Handle messages from worker
        worker.onmessage = (e) => {
            const msg = e.data;

            if (msg.type === 'ready') {
                console.log(`[SensorFusion] Worker ready for '${robotId}'.`);
                return;
            }

            if (msg.type === 'odom' && msg.filtered) {
                this._latestOdom.set(robotId, msg);

                // Notify listeners
                const listeners = this._listeners.get(robotId);
                if (listeners) {
                    for (const cb of listeners) {
                        try { cb(msg); } catch (err) { console.error(err); }
                    }
                }
                for (const cb of this._globalListeners) {
                    try { cb({ ...msg, robotId }); } catch (err) { console.error(err); }
                }

                // Publish to topicManager
                topicManager.publish(STANDARD_TOPICS.ODOM, {
                    robotId,
                    pose: { x: msg.x, y: msg.y, theta: msg.theta },
                    twist: { linear: msg.v, angular: msg.omega },
                    filtered: true,
                    frame_id: 'odom',
                });
            }

            if (msg.type === 'raw_odom') {
                // Publish raw odom for debugging
                topicManager.publish('/odom_raw', {
                    robotId,
                    pose: { x: msg.x, y: msg.y, theta: msg.theta },
                    twist: { linear: msg.v, angular: msg.omega },
                    filtered: false,
                    frame_id: 'odom',
                });
            }
        };

        worker.onerror = (err) => {
            console.error(`[SensorFusion] Worker error for '${robotId}':`, err);
        };

        // 4. Subscribe to robotBridge telemetry
        const unsub = robotBridge.subscribe(robotId, MSG.TELEM, (msg) => {
            this._handleTelem(robotId, msg);
        });
        this._unsubscribers.set(robotId, unsub);

        // 5. Advertise topics
        topicManager.advertise(STANDARD_TOPICS.ODOM, MSG_TYPES.ODOMETRY, QOS.BEST_EFFORT);
        topicManager.advertise('/odom_raw', MSG_TYPES.ODOMETRY, QOS.BEST_EFFORT);

        this._initialized.add(robotId);
        console.log(`[SensorFusion] Initialized for '${robotId}'.`);
    }

    // ─── Main-thread fallback (no Worker support) ────────────────────────────

    _initMainThread(robotId, config) {
        // Fallback: pass-through without EKF
        this._listeners.set(robotId, new Set());
        this._initialized.add(robotId);

        const unsub = robotBridge.subscribe(robotId, MSG.TELEM, (msg) => {
            const theta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.theta || 0);
            const odom = {
                type: 'odom',
                x: msg.x || 0,
                y: msg.y || 0,
                theta,
                v: msg.v || 0,
                omega: msg.w || 0,
                filtered: false, // Not actually filtered
            };

            this._latestOdom.set(robotId, odom);

            const listeners = this._listeners.get(robotId);
            if (listeners) {
                for (const cb of listeners) {
                    try { cb(odom); } catch (err) { console.error(err); }
                }
            }
        });
        this._unsubscribers.set(robotId, unsub);
    }

    // ─── Telemetry Handler ───────────────────────────────────────────────────

    _handleTelem(robotId, msg) {
        const worker = this._workers.get(robotId);
        if (!worker) return;

        // Forward encoder data to worker
        if (msg.enc) {
            worker.postMessage({
                type: 'encoder',
                ticksL: msg.enc.l || 0,
                ticksR: msg.enc.r || 0,
                dt: msg.dt || 0.1, // seconds between samples
            });
        }

        // Forward IMU data to worker
        if (msg.h !== undefined || msg.imu) {
            const theta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.imu?.yaw || 0);
            const omega = msg.w !== undefined ? msg.w : (msg.imu?.gyroZ || 0);

            worker.postMessage({
                type: 'imu',
                theta,
                omega,
            });
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * onFiltered(callback, robotId)
     * Subscribe to filtered odometry updates.
     *
     * @param {Function} callback - Called with { x, y, theta, v, omega, filtered }
     * @param {string}   robotId  - Robot ID, or '*' for all robots
     * @returns {Function} Unsubscribe function
     */
    onFiltered(callback, robotId = 'robot_1') {
        if (robotId === '*') {
            this._globalListeners.push(callback);
            return () => {
                this._globalListeners = this._globalListeners.filter(cb => cb !== callback);
            };
        }

        if (!this._listeners.has(robotId)) {
            this._listeners.set(robotId, new Set());
        }
        this._listeners.get(robotId).add(callback);
        return () => this._listeners.get(robotId)?.delete(callback);
    }

    /**
     * getLatest(robotId)
     * Get the latest filtered odometry.
     */
    getLatest(robotId = 'robot_1') {
        return this._latestOdom.get(robotId) || null;
    }

    /**
     * resetOdom(robotId)
     * Reset odometry to (0, 0, 0).
     */
    resetOdom(robotId = 'robot_1') {
        const worker = this._workers.get(robotId);
        if (worker) worker.postMessage({ type: 'reset' });
    }

    /**
     * setPose(robotId, pose)
     * Set pose estimate (e.g. from AMCL or user click).
     */
    setPose(robotId = 'robot_1', pose = {}) {
        const worker = this._workers.get(robotId);
        if (worker) worker.postMessage({ type: 'set_pose', ...pose });
    }

    /**
     * updateConfig(robotId, config)
     * Update robot physical parameters.
     */
    updateConfig(robotId = 'robot_1', config = {}) {
        const worker = this._workers.get(robotId);
        if (worker) worker.postMessage({ type: 'config', ...config });
    }

    /**
     * destroy(robotId)
     * Cleanup worker and subscriptions.
     */
    destroy(robotId) {
        if (robotId) {
            this._destroyOne(robotId);
        } else {
            // Destroy all
            for (const id of this._initialized) {
                this._destroyOne(id);
            }
        }
    }

    _destroyOne(robotId) {
        const worker = this._workers.get(robotId);
        if (worker) worker.terminate();
        this._workers.delete(robotId);

        const unsub = this._unsubscribers.get(robotId);
        if (unsub) unsub();
        this._unsubscribers.delete(robotId);

        this._listeners.delete(robotId);
        this._latestOdom.delete(robotId);
        this._initialized.delete(robotId);

        console.log(`[SensorFusion] Destroyed for '${robotId}'.`);
    }

    /**
     * isInitialized(robotId)
     */
    isInitialized(robotId = 'robot_1') {
        return this._initialized.has(robotId);
    }
}

// Singleton
const sensorFusion = new SensorFusion();
export default sensorFusion;
export { SensorFusion };
