/**
 * eventBus.js
 * ===========
 * EventBus — Giao thức Pub/Sub chuẩn quy (Local "ROS-like" message bus)
 * Thay thế: ROS2 rclcpp Node graph (Nodes, Topics, Services)
 *
 * Tầng trừu tượng bọc trên topicManager nhưng cung cấp API
 * giống ROS2 hơn, phục vụ plugin architecture.
 *
 * Standard Topics (tương đương ROS2 conventions):
 *   /scan           — sensor_msgs/LaserScan
 *   /odom           — nav_msgs/Odometry (filtered)
 *   /odom_raw       — nav_msgs/Odometry (raw encoder)
 *   /cmd_vel        — geometry_msgs/Twist
 *   /map            — nav_msgs/OccupancyGrid
 *   /tf             — tf2_msgs/TFMessage
 *   /plan           — nav_msgs/Path (global plan)
 *   /local_plan     — nav_msgs/Path (DWA trajectory)
 *   /goal_pose      — geometry_msgs/PoseStamped
 *   /diagnostics    — diagnostic_msgs/DiagnosticArray
 *   /fleet/status   — amr_msgs/FleetStatus
 *
 * USAGE:
 *   import eventBus from './eventBus';
 *
 *   // Publish (like a ROS2 Publisher)
 *   eventBus.publish('/scan', scanData);
 *
 *   // Subscribe (like a ROS2 Subscription)
 *   const unsub = eventBus.subscribe('/odom', (msg) => { ... });
 *   unsub(); // cleanup
 *
 *   // Services (like ROS2 Services)
 *   eventBus.advertiseService('/reset_odom', async (req) => ({ success: true }));
 *   const res = await eventBus.callService('/reset_odom', {});
 *
 *   // Introspection
 *   eventBus.listTopics();   // like `ros2 topic list`
 *   eventBus.listServices(); // like `ros2 service list`
 */

import topicManager, { MSG_TYPES, QOS, STANDARD_TOPICS } from './topicManager';

class EventBus {
    constructor() {
        this._services = new Map();   // serviceName → handler fn
        this._serviceListeners = [];  // global service change listeners
    }

    // ─── Pub/Sub (delegated to topicManager) ─────────────────────────────────

    /**
     * publish(topic, message)
     * Tương đương: publisher->publish(msg)
     */
    publish(topic, message) {
        topicManager.publish(topic, message);
    }

    /**
     * subscribe(topic, callback, qos)
     * Tương đương: create_subscription()
     * @returns {Function} unsubscribe function
     */
    subscribe(topic, callback, qos = QOS.RELIABLE) {
        const subId = topicManager.subscribe(topic, callback, qos);
        return () => topicManager.unsubscribe(topic, subId);
    }

    /**
     * advertise(topic, msgType, qos)
     * Register as a publisher for a topic.
     * @returns {string} publisher ID
     */
    advertise(topic, msgType = MSG_TYPES.STRING, qos = QOS.RELIABLE) {
        return topicManager.advertise(topic, msgType, qos);
    }

    // ─── Services (Request/Response — like ROS2 Services) ────────────────────

    /**
     * advertiseService(name, handler)
     * Register a service handler.
     * Tương đương: create_service()
     *
     * @param {string}   name    - e.g. '/reset_odom', '/save_map'
     * @param {Function} handler - async (request) => response
     */
    advertiseService(name, handler) {
        this._services.set(name, handler);
        this._notifyServiceChange();
        console.log(`[EventBus] Service advertised: ${name}`);
    }

    /**
     * callService(name, request, timeoutMs)
     * Call a service and await response.
     * Tương đương: client->async_send_request()
     *
     * @param {string} name
     * @param {Object} request
     * @param {number} timeoutMs
     * @returns {Promise<Object>} response
     */
    async callService(name, request = {}, timeoutMs = 5000) {
        const handler = this._services.get(name);
        if (!handler) {
            throw new Error(`[EventBus] Service not found: ${name}`);
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`[EventBus] Service '${name}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            Promise.resolve(handler(request))
                .then(response => {
                    clearTimeout(timer);
                    resolve(response);
                })
                .catch(err => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    /**
     * removeService(name)
     */
    removeService(name) {
        this._services.delete(name);
        this._notifyServiceChange();
    }

    // ─── Introspection ───────────────────────────────────────────────────────

    /**
     * listTopics()
     * Tương đương: ros2 topic list
     */
    listTopics() {
        return topicManager.listTopics();
    }

    /**
     * listServices()
     * Tương đương: ros2 service list
     */
    listServices() {
        return Array.from(this._services.keys()).sort();
    }

    /**
     * getTopicInfo(topic)
     * Tương đương: ros2 topic info
     */
    getTopicInfo(topic) {
        return topicManager.getTopicInfo(topic);
    }

    /**
     * getTopicHz(topic)
     * Tương đương: ros2 topic hz
     */
    getTopicHz(topic) {
        return topicManager.getTopicHz(topic);
    }

    /**
     * echoTopic(topic, callback)
     * Tương đương: ros2 topic echo
     * @returns {Function} unsubscribe
     */
    echoTopic(topic, callback) {
        return topicManager.echoTopic(topic, callback);
    }

    /**
     * onTopicListChange(callback)
     */
    onTopicListChange(callback) {
        return topicManager.onTopicListChange(callback);
    }

    /**
     * onServiceListChange(callback)
     */
    onServiceListChange(callback) {
        this._serviceListeners.push(callback);
        return () => {
            this._serviceListeners = this._serviceListeners.filter(cb => cb !== callback);
        };
    }

    _notifyServiceChange() {
        const services = this.listServices();
        for (const cb of this._serviceListeners) {
            try { cb(services); } catch (_) { /* ignore */ }
        }
    }

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    destroy() {
        this._services.clear();
        this._serviceListeners = [];
        topicManager.destroy();
    }
}

// Singleton
const eventBus = new EventBus();
export default eventBus;
export { EventBus };
