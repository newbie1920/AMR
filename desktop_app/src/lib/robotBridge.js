/**
 * robotBridge.js
 * ==============
 * WebSocket Bridge — thay thế rosbridge_server + rclnodejs
 *
 * ROS2 dùng: rosbridge_server (ws://localhost:9090) + roslib.js
 * Module này: trực tiếp kết nối ESP32 WebSocket + parse typed protocol
 *
 * Features:
 *   - Auto-reconnect với exponential backoff
 *   - Multi-robot support (Fleet mode)
 *   - Typed message routing (telem → tfTree + store, status → UI)
 *   - cmd_vel publisher
 *   - Robot discovery via mDNS (amr.local)
 *   - Thống kê latency / connection quality
 *
 * USAGE:
 *   import robotBridge from './robotBridge';
 *
 *   // Kết nối tới robot
 *   robotBridge.connect('ws://amr.local:81', 'robot_1');
 *   robotBridge.connect('ws://192.168.1.101:81', 'robot_2');
 *
 *   // Subscribe telem (tương đương ros2 topic subscribe)
 *   robotBridge.subscribe('robot_1', 'telem', (data) => console.log(data));
 *
 *   // Publish cmd_vel (tương đương ros2 topic publish)
 *   robotBridge.cmdVel('robot_1', 0.3, 0.0);
 *
 *   // Gửi lệnh
 *   robotBridge.sendCommand('robot_1', 'reset_odom');
 *   robotBridge.sendCommand('robot_1', 'e_stop');
 */

import tfTree from './tfTree';

// ─── Message types (từ protocol.h) ────────────────────────────────────────────
export const MSG = {
    TELEM: 'telem',
    STATUS: 'status',
    CMD_VEL: 'cmd_vel',
    CONFIG: 'config',
    CMD: 'cmd',
};

// ─── Default config ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    reconnectBaseMs: 2000,   // Initial reconnect delay (fast recovery)
    reconnectMaxMs: 15000,  // Max reconnect delay
    reconnectFactor: 1.5,    // Exponential backoff factor
    heartbeatMs: 5000,   // How often to check connection health
    pingIntervalMs: 3000,  // Ping keep-alive interval
    staleTimeoutMs: 8000,  // Force reconnect if no data for this long
    commandTimeoutMs: 200,    // Max cmd_vel interval (safety: stop if no cmd in X ms)
    latencyWindowSize: 20,     // Rolling window for latency stats
};

// ─── Main Bridge Class ─────────────────────────────────────────────────────────
class RobotBridge {
    constructor(config = {}) {
        this._config = { ...DEFAULT_CONFIG, ...config };
        this._robots = new Map();   // robotId → RobotConnection
        this._listeners = new Map();   // `${robotId}:${msgType}` → Set<callback>
        this._globalListeners = new Map(); // msgType → Set<callback> (all robots)
    }

    // ─── Connection Management ────────────────────────────────────────────────────

    /**
     * connect(url, robotId)
     * Kết nối tới robot WebSocket.
     * Tương đương rosbridge_server connection + namespace setup.
     *
     * @param {string} url     - WebSocket URL, e.g. 'ws://amr.local:81' or 'ws://192.168.1.x:81'
     * @param {string} robotId - Unique robot ID (tương đương ROS2 namespace)
     */
    connect(url, robotId = 'robot_1') {
        if (this._robots.has(robotId)) {
            const existing = this._robots.get(robotId);
            if (existing.url === url && (existing.state === 'connected' || existing.state === 'connecting')) {
                // console.log(`[Bridge] '${robotId}' is already ${existing.state}. Skipping connect.`);
                return robotId;
            }
            console.warn(`[Bridge] Robot '${robotId}' already connected or URL changed. Reconnecting...`);
            this.disconnect(robotId);
        }

        const conn = {
            robotId,
            url,
            ws: null,
            state: 'disconnected',   // disconnected | connecting | connected
            reconnectDelay: this._config.reconnectBaseMs,
            reconnectTimer: null,
            pingTimer: null,         // Ping keep-alive interval
            lastDataMs: null,        // Last time ANY data was received
            lastTelemMs: null,
            lastStatusMs: null,
            latencySamples: [],
            stats: {
                telemCount: 0,
                droppedFrames: 0,
                avgLatencyMs: 0,
            },
            _lastErrorLogMs: 0,
        };

        this._robots.set(robotId, conn);
        this._doConnect(robotId);
        return robotId;
    }

    disconnect(robotId) {
        const conn = this._robots.get(robotId);
        if (!conn) return;
        conn.state = 'disconnected';
        clearTimeout(conn.reconnectTimer);
        clearInterval(conn.pingTimer);
        if (conn.ws) {
            conn.ws.onclose = null; // Prevent reconnect loop
            conn.ws.close();
        }
        this._robots.delete(robotId);
        console.log(`[Bridge] Robot '${robotId}' disconnected.`);
    }

    disconnectAll() {
        for (const id of this._robots.keys()) this.disconnect(id);
    }

    // ─── Internal connection logic ────────────────────────────────────────────────
    _doConnect(robotId) {
        const conn = this._robots.get(robotId);
        if (!conn) return;

        conn.state = 'connecting';
        console.log(`[Bridge] Connecting '${robotId}' → ${conn.url}`);
        this._emit(robotId, 'connection', { state: 'connecting', robotId });

        let ws;
        try {
            ws = new WebSocket(conn.url);
            conn.ws = ws;
        } catch (e) {
            console.error(`[Bridge] Failed to create WebSocket for '${robotId}':`, e);
            conn.state = 'error';
            // We need a way to trigger reconnect on init failure - wait for state machine
            setTimeout(() => {
                if (this._robots.has(robotId)) this._doConnect(robotId);
            }, conn.reconnectDelay);
            return;
        }

        ws.onopen = () => {
            conn.state = 'connected';
            conn.reconnectDelay = this._config.reconnectBaseMs; // Reset backoff
            conn.lastDataMs = Date.now();
            console.log(`[Bridge] '${robotId}' connected!`);
            this._emit(robotId, 'connection', { state: 'connected', robotId });

            // Start ping keep-alive
            clearInterval(conn.pingTimer);
            conn.pingTimer = setInterval(() => {
                this._pingCheck(robotId);
            }, this._config.pingIntervalMs);
        };

        ws.onclose = () => {
            if (conn.state === 'disconnected') return; // Intentional disconnect
            conn.state = 'disconnected';
            clearInterval(conn.pingTimer);
            console.warn(`[Bridge] '${robotId}' disconnected. Retry in ${conn.reconnectDelay}ms`);
            this._emit(robotId, 'connection', { state: 'disconnected', robotId });

            // Exponential backoff reconnect
            conn.reconnectTimer = setTimeout(() => {
                if (this._robots.has(robotId)) this._doConnect(robotId);
            }, conn.reconnectDelay);

            conn.reconnectDelay = Math.min(
                conn.reconnectDelay * this._config.reconnectFactor,
                this._config.reconnectMaxMs
            );
        };

        ws.onerror = (err) => {
            const now = Date.now();
            if (!conn._lastErrorLogMs || (now - conn._lastErrorLogMs) > 10000) {
                console.warn(`[Bridge] '${robotId}' Connection Error (Robot may be offline):`, conn.url);
                conn._lastErrorLogMs = now;
            }
            this._emit(robotId, 'error', { robotId, error: err });
        };

        ws.onmessage = (event) => {
            this._handleMessage(robotId, event.data);
        };
    }

    _handleMessage(robotId, rawData) {
        let msg;
        try {
            msg = JSON.parse(rawData);
        } catch (e) {
            console.warn(`[Bridge] '${robotId}' invalid JSON:`, rawData.substr(0, 100));
            return;
        }

        const conn = this._robots.get(robotId);
        if (!conn) return;

        // Track last data time for stale detection
        conn.lastDataMs = Date.now();

        // Latency tracking (seq-based)
        if (msg.ts) {
            const latency = Date.now() - msg.ts;
            conn.latencySamples.push(latency);
            if (conn.latencySamples.length > this._config.latencyWindowSize) {
                conn.latencySamples.shift();
            }
            conn.stats.avgLatencyMs = conn.latencySamples.reduce((a, b) => a + b, 0)
                / conn.latencySamples.length;
        }

        // Type routing (tương đương ROS2 message type dispatch)
        const type = msg.type || this._inferLegacyType(msg);

        switch (type) {
            case MSG.TELEM:
                conn.lastTelemMs = Date.now();
                conn.stats.telemCount++;
                this._handleTelem(robotId, msg);
                break;

            case MSG.STATUS:
                conn.lastStatusMs = Date.now();
                this._handleStatus(robotId, msg);
                break;

            default:
                // Unknown message type — pass through to listeners anyway
                break;
        }

        // Emit to all subscribers of this type
        this._emit(robotId, type, { ...msg, robotId });
    }

    // Legacy support for old firmware (no "type" field)
    _inferLegacyType(msg) {
        if (msg.telem === true || (msg.x !== undefined && msg.theta !== undefined)) return MSG.TELEM;
        if (msg.uptime !== undefined || msg.wifi_rssi !== undefined) return MSG.STATUS;
        return 'unknown';
    }

    /**
     * _pingCheck(robotId)
     * Sends a ping and checks if the connection is stale.
     * If no data received for staleTimeoutMs, force reconnect.
     */
    _pingCheck(robotId) {
        const conn = this._robots.get(robotId);
        if (!conn || conn.state !== 'connected') return;

        // Send ping to keep connection alive
        try {
            if (conn.ws?.readyState === WebSocket.OPEN) {
                conn.ws.send(JSON.stringify({ type: 'ping' }));
            }
        } catch (e) { /* ignore send errors */ }

        // Check for stale connection
        if (conn.lastDataMs && (Date.now() - conn.lastDataMs) > this._config.staleTimeoutMs) {
            console.warn(`[Bridge] '${robotId}' stale (no data for ${this._config.staleTimeoutMs}ms). Force reconnecting...`);
            clearInterval(conn.pingTimer);
            if (conn.ws) {
                conn.ws.onclose = null;
                conn.ws.close();
            }
            conn.state = 'disconnected';
            this._emit(robotId, 'connection', { state: 'disconnected', robotId });
            // Reconnect immediately
            setTimeout(() => {
                if (this._robots.has(robotId)) this._doConnect(robotId);
            }, 500);
        }
    }

    /**
     * _handleTelem: tương đương nav_msgs/Odometry + sensor_msgs/Imu callback
     * Feeds data into TF tree automatically
     */
    _handleTelem(robotId, msg) {
        // Update TF tree: odom → base_footprint
        // Only update if this is the primary robot (or scoped TF tree per robot in fleet)
        if (robotId === 'robot_1' || this._robots.size === 1) {
            // Mapping keys to match firmware (main.cpp)
            const theta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.theta || 0);

            tfTree.updateOdom({
                x: msg.x || 0,
                y: msg.y || 0,
                theta: theta,
            });

            // Update wheel joint angles (for future 3D viz)
            if (msg.enc) {
                const ticksL = msg.enc.l || 0;
                const ticksR = msg.enc.r || 0;
                const TICKS_PER_REV = 1665;
                tfTree.updateWheelJoints(
                    (ticksL / TICKS_PER_REV) * 2 * Math.PI,
                    (ticksR / TICKS_PER_REV) * 2 * Math.PI
                );
            }
        }
    }

    _handleStatus(robotId, msg) {
        // Check E-Stop state changes
        const conn = this._robots.get(robotId);
        if (conn && msg.e_stop !== conn._lastEStop) {
            conn._lastEStop = msg.e_stop;
            this._emit(robotId, 'estop_change', { robotId, eStop: msg.e_stop });
        }
    }

    // ─── Publishing (tương đương ros2 publisher) ──────────────────────────────────

    /**
     * cmdVel(robotId, linear, angular)
     * Tương đương: ros2 topic pub /cmd_vel geometry_msgs/Twist
     *
     * @param {string} robotId
     * @param {number} linear  - m/s (forward positive)
     * @param {number} angular - rad/s (CCW positive)
     */
    cmdVel(robotId, linear, angular) {
        this._send(robotId, {
            type: MSG.CMD_VEL,
            linear: Number(linear.toFixed(4)),
            angular: Number(angular.toFixed(4)),
        });
    }

    /**
     * sendCommand(robotId, command)
     * Tương đương: ros2 service call
     *
     * @param {string} robotId
     * @param {string} command - 'reset_odom' | 'calibrate_imu' | 'e_stop' | 'clear_e_stop'
     */
    sendCommand(robotId, command) {
        this._send(robotId, { type: MSG.CMD, cmd: command });
    }

    /**
     * sendConfig(robotId, params)
     * Tương đương: ros2 param set
     *
     * @param {string} robotId
     * @param {Object} params - { ticks_per_rev, wheel_radius, wheel_separation, ... }
     */
    sendConfig(robotId, params) {
        this._send(robotId, { type: MSG.CONFIG, ...params });
    }

    /**
     * stopAll()
     * Emergency stop all robots
     */
    stopAll() {
        for (const id of this._robots.keys()) {
            this.sendCommand(id, 'e_stop');
        }
    }

    sendMessage(robotId, msg) {
        return this._send(robotId, msg);
    }

    _send(robotId, msg) {
        const conn = this._robots.get(robotId);
        if (!conn || conn.state !== 'connected' || !conn.ws) {
            // console.warn(`[Bridge] Cannot send to '${robotId}' — not connected`);
            return false;
        }
        try {
            conn.ws.send(JSON.stringify(msg));
            return true;
        } catch (e) {
            console.error(`[Bridge] Send error to '${robotId}':`, e);
            return false;
        }
    }

    // ─── Subscription (tương đương ros2 subscriber) ───────────────────────────────

    /**
     * subscribe(robotId, msgType, callback)
     * Tương đương: ros2 subscription create
     *
     * @param {string}   robotId  - Robot ID, or '*' for all robots
     * @param {string}   msgType  - Message type (MSG.TELEM, MSG.STATUS, 'connection', etc.)
     * @param {Function} callback - Called with (messageData)
     * @returns {Function}        - Unsubscribe function
     */
    subscribe(robotId, msgType, callback) {
        if (robotId === '*') {
            // Subscribe to all robots
            const key = msgType;
            if (!this._globalListeners.has(key)) this._globalListeners.set(key, new Set());
            this._globalListeners.get(key).add(callback);
            return () => this._globalListeners.get(key)?.delete(callback);
        }

        const key = `${robotId}:${msgType}`;
        if (!this._listeners.has(key)) this._listeners.set(key, new Set());
        this._listeners.get(key).add(callback);
        return () => this._listeners.get(key)?.delete(callback);
    }

    _emit(robotId, msgType, data) {
        // Robot-specific subscribers
        const specific = this._listeners.get(`${robotId}:${msgType}`);
        if (specific) specific.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });

        // Global subscribers
        const global = this._globalListeners.get(msgType);
        if (global) global.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
    }

    // ─── Status / Diagnostics (tương đương ros2 diagnostics) ─────────────────────

    /**
     * getStatus(robotId)
     * @returns {Object} - { state, latencyMs, telemCount, droppedFrames, url }
     */
    getStatus(robotId) {
        const conn = this._robots.get(robotId);
        if (!conn) return { state: 'not_found' };
        return {
            robotId,
            state: conn.state,
            url: conn.url,
            avgLatencyMs: Math.round(conn.stats.avgLatencyMs),
            telemCount: conn.stats.telemCount,
            droppedFrames: conn.stats.droppedFrames,
            lastTelemAgo: conn.lastTelemMs ? Date.now() - conn.lastTelemMs : null,
            lastStatusAgo: conn.lastStatusMs ? Date.now() - conn.lastStatusMs : null,
        };
    }

    getAllStatus() {
        const result = {};
        for (const [id] of this._robots.entries()) {
            result[id] = this.getStatus(id);
        }
        return result;
    }

    getConnectedRobots() {
        return Array.from(this._robots.entries())
            .filter(([, conn]) => conn.state === 'connected')
            .map(([id]) => id);
    }
}

// Singleton bridge
const robotBridge = new RobotBridge();
export default robotBridge;
