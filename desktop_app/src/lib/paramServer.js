/**
 * paramServer.js
 * ==============
 * Parameter Server — thay thế ROS2 Parameter Server (rclcpp::Node::declare_parameter)
 * 
 * Tính năng:
 *   - Quản lý các tham số cấu hình của hệ thống (PID, DWA weights, Speed limits).
 *   - Persistence: Lưu vào localStorage để giữ cấu hình sau khi reload trang.
 *   - Event-based: Thông báo khi tham số thay đổi (dynamic reconfigure).
 */

import robotBridge from './robotBridge';

class ParamServer {
    constructor() {
        this._params = {};
        this._listeners = [];
        this._storageKey = 'amr_params';

        this._load();
    }

    /**
     * sync(robotId)
     * Sends all current parameters to a specific robot.
     */
    sync(robotId) {
        console.log(`[ParamServer] Syncing parameters to ${robotId}...`);
        robotBridge.sendConfig(robotId, this._params);
    }

    /**
     * declare(key, defaultValue)
     */
    declare(key, defaultValue) {
        if (!(key in this._params)) {
            this._params[key] = defaultValue;
            this._save();
        }
        return this._params[key];
    }

    get(key) { return this._params[key]; }

    /**
     * set(key, value)
     * Tương đương: ros2 param set
     */
    set(key, value) {
        const old = this._params[key];
        if (old === value) return;

        this._params[key] = value;
        this._save();

        console.log(`[ParamServer] ${key}: ${old} -> ${value}`);

        // Notify listeners
        this._listeners.forEach(cb => {
            try { cb(key, value); } catch (e) { console.error(e); }
        });
    }

    subscribe(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }

    _save() {
        localStorage.setItem(this._storageKey, JSON.stringify(this._params));
    }

    _load() {
        const saved = localStorage.getItem(this._storageKey);
        if (saved) {
            try { this._params = JSON.parse(saved); } catch (e) { this._params = {}; }
        }
    }

    getAll() { return { ...this._params }; }
}

const paramServer = new ParamServer();
export default paramServer;
