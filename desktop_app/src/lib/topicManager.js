/**
 * topicManager.js
 * ===============
 * Topic Pub/Sub System — thay thế hoàn toàn rclcpp::Publisher / rclcpp::Subscription
 *
 * Features (vượt ROS2):
 *   - publish(topic, msg) / subscribe(topic, callback, qos)
 *   - Topic introspection: listTopics(), getTopicInfo(), echoTopic()
 *   - Hz monitoring per topic (thay thế `ros2 topic hz`)
 *   - QoS profiles: RELIABLE, BEST_EFFORT, TRANSIENT_LOCAL
 *   - Message type registry (LaserScan, Odometry, Twist, TF, etc.)
 *   - Latency tracking per topic
 *   - History buffer per topic for debugging
 *
 * USAGE:
 *   import topicManager, { QOS, MSG_TYPES } from './topicManager';
 *   
 *   // Publishing
 *   topicManager.advertise('/scan', MSG_TYPES.LASER_SCAN);
 *   topicManager.publish('/scan', scanData);
 *   
 *   // Subscribing
 *   topicManager.subscribe('/scan', (msg) => { ... }, QOS.BEST_EFFORT);
 *   
 *   // Introspection (like ros2 topic list / info / hz)
 *   topicManager.listTopics();
 *   topicManager.getTopicInfo('/scan');
 *   topicManager.getTopicHz('/scan');
 */

// ─── QoS Profiles ────────────────────────────────────────────────────────────
export const QOS = {
    RELIABLE: 'RELIABLE',           // Guaranteed delivery (default)
    BEST_EFFORT: 'BEST_EFFORT',     // Fire-and-forget (sensor data)
    TRANSIENT_LOCAL: 'TRANSIENT_LOCAL', // Late-joining subscribers get last value
};

// ─── Standard Message Types ──────────────────────────────────────────────────
export const MSG_TYPES = {
    // Geometry
    TWIST: 'geometry_msgs/Twist',
    POSE: 'geometry_msgs/Pose',
    POSE_STAMPED: 'geometry_msgs/PoseStamped',
    TRANSFORM: 'geometry_msgs/TransformStamped',

    // Sensor
    LASER_SCAN: 'sensor_msgs/LaserScan',
    POINT_CLOUD: 'sensor_msgs/PointCloud2',
    IMU: 'sensor_msgs/Imu',
    BATTERY_STATE: 'sensor_msgs/BatteryState',
    JOY: 'sensor_msgs/Joy',

    // Navigation
    ODOMETRY: 'nav_msgs/Odometry',
    OCCUPANCY_GRID: 'nav_msgs/OccupancyGrid',
    PATH: 'nav_msgs/Path',
    MAP_META_DATA: 'nav_msgs/MapMetaData',

    // Standard
    STRING: 'std_msgs/String',
    BOOL: 'std_msgs/Bool',
    INT32: 'std_msgs/Int32',
    FLOAT64: 'std_msgs/Float64',
    HEADER: 'std_msgs/Header',

    // TF
    TF_MESSAGE: 'tf2_msgs/TFMessage',

    // Diagnostics
    DIAGNOSTIC_STATUS: 'diagnostic_msgs/DiagnosticStatus',
    DIAGNOSTIC_ARRAY: 'diagnostic_msgs/DiagnosticArray',

    // Action
    GOAL_STATUS: 'action_msgs/GoalStatus',

    // Custom AMR
    FLEET_STATUS: 'amr_msgs/FleetStatus',
    ROBOT_TELEMETRY: 'amr_msgs/RobotTelemetry',
    MISSION_STATUS: 'amr_msgs/MissionStatus',
    CMD_VEL: 'geometry_msgs/Twist', // alias
};

// ─── Standard Topics (Pre-defined like ROS2 conventions) ─────────────────────
export const STANDARD_TOPICS = {
    CMD_VEL: '/cmd_vel',
    ODOM: '/odom',
    SCAN: '/scan',
    MAP: '/map',
    TF: '/tf',
    TF_STATIC: '/tf_static',
    GLOBAL_PLAN: '/plan',
    LOCAL_PLAN: '/local_plan',
    COSTMAP: '/costmap',
    GOAL_POSE: '/goal_pose',
    AMCL_POSE: '/amcl_pose',
    DIAGNOSTICS: '/diagnostics',
    BATTERY: '/battery_state',
    FLEET_STATUS: '/fleet/status',
    ROBOT_STATUS: '/robot/status',
};

// ─── Hz Tracker ──────────────────────────────────────────────────────────────
class HzTracker {
    constructor(windowSize = 60) {
        this._timestamps = [];
        this._windowSize = windowSize; // Keep last N timestamps
        this._hz = 0;
        this._count = 0;
    }

    tick() {
        const now = performance.now();
        this._timestamps.push(now);
        this._count++;
        // Trim old entries (older than 2 seconds)
        const cutoff = now - 2000;
        while (this._timestamps.length > 0 && this._timestamps[0] < cutoff) {
            this._timestamps.shift();
        }
        // Calculate Hz from timestamps in window
        if (this._timestamps.length >= 2) {
            const span = (this._timestamps[this._timestamps.length - 1] - this._timestamps[0]) / 1000;
            this._hz = span > 0 ? (this._timestamps.length - 1) / span : 0;
        }
    }

    get hz() { return Math.round(this._hz * 10) / 10; }
    get count() { return this._count; }

    /**
     * Get Hz history for sparkline rendering
     * @returns {number[]} Array of Hz values over the last N seconds
     */
    getHistory() {
        return this._hzHistory || [];
    }
}

// ─── Topic Entry ─────────────────────────────────────────────────────────────
class TopicEntry {
    constructor(name, msgType, qos = QOS.RELIABLE) {
        this.name = name;
        this.msgType = msgType;
        this.qos = qos;
        this.subscribers = [];        // [{ id, callback, qos }]
        this.publishers = new Set();  // Set of publisher IDs
        this.hzTracker = new HzTracker();
        this.lastMessage = null;
        this.lastTimestamp = 0;
        this.historyBuffer = [];      // Circular buffer for debugging
        this.historyMaxSize = 50;
        this.latencyMs = 0;           // Average publish-to-deliver latency
        this._latencySum = 0;
        this._latencyCount = 0;
        this._hzHistory = [];         // For sparkline chart
        this._hzHistoryMax = 60;      // 60 data points
    }

    addToHistory(msg) {
        this.historyBuffer.push({
            timestamp: Date.now(),
            data: msg,
        });
        if (this.historyBuffer.length > this.historyMaxSize) {
            this.historyBuffer.shift();
        }
    }

    recordLatency(ms) {
        this._latencySum += ms;
        this._latencyCount++;
        this.latencyMs = Math.round(this._latencySum / this._latencyCount * 100) / 100;
    }

    snapshotHz() {
        this._hzHistory.push(this.hzTracker.hz);
        if (this._hzHistory.length > this._hzHistoryMax) {
            this._hzHistory.shift();
        }
    }

    get hzHistory() { return this._hzHistory; }
}

// ─── Topic Manager ───────────────────────────────────────────────────────────
class TopicManager {
    constructor() {
        /** @type {Map<string, TopicEntry>} */
        this._topics = new Map();
        this._subscriberIdCounter = 0;
        this._publisherIdCounter = 0;
        this._listeners = [];          // Global listeners for topic list changes
        this._echoCallbacks = new Map(); // topic -> [callbacks] for echo functionality
        this._hzSnapshotInterval = null;

        // Start Hz history snapshots (1 per second)
        this._startHzSnapshots();
    }

    // ─── Publishing API ──────────────────────────────────────────────────────

    /**
     * Advertise a topic (register as publisher).
     * Tương đương: rclcpp::Node::create_publisher<T>(topic, qos)
     */
    advertise(topicName, msgType = MSG_TYPES.STRING, qos = QOS.RELIABLE) {
        const topic = this._getOrCreateTopic(topicName, msgType, qos);
        const pubId = `pub_${++this._publisherIdCounter}`;
        topic.publishers.add(pubId);
        this._notifyListeners();
        return pubId;
    }

    /**
     * Unadvertise a topic (remove publisher).
     */
    unadvertise(topicName, pubId) {
        const topic = this._topics.get(topicName);
        if (topic) {
            topic.publishers.delete(pubId);
            if (topic.publishers.size === 0 && topic.subscribers.length === 0) {
                this._topics.delete(topicName);
            }
            this._notifyListeners();
        }
    }

    /**
     * Publish a message to a topic.
     * Tương đương: publisher->publish(msg)
     */
    publish(topicName, message) {
        const topic = this._topics.get(topicName);
        if (!topic) {
            // Auto-create topic on first publish (convenience)
            this._getOrCreateTopic(topicName, MSG_TYPES.STRING, QOS.RELIABLE);
            return this.publish(topicName, message);
        }

        const publishTime = performance.now();

        // Stamp the message
        const stamped = {
            ...message,
            _header: {
                stamp: Date.now(),
                frame_id: message.frame_id || '',
                seq: topic.hzTracker.count,
            },
        };

        // Update topic stats
        topic.hzTracker.tick();
        topic.lastMessage = stamped;
        topic.lastTimestamp = Date.now();
        topic.addToHistory(stamped);

        // Deliver to subscribers
        for (const sub of topic.subscribers) {
            try {
                sub.callback(stamped);
            } catch (err) {
                console.warn(`[TopicManager] Subscriber error on '${topicName}':`, err.message);
            }
        }

        // Deliver to echo listeners
        const echoCbs = this._echoCallbacks.get(topicName);
        if (echoCbs) {
            for (const cb of echoCbs) {
                try { cb(stamped); } catch (_) { /* ignore */ }
            }
        }

        // Latency tracking
        const deliveryTime = performance.now();
        topic.recordLatency(deliveryTime - publishTime);
    }

    // ─── Subscription API ────────────────────────────────────────────────────

    /**
     * Subscribe to a topic.
     * Tương đương: rclcpp::Node::create_subscription<T>(topic, qos, callback)
     * 
     * @returns {string} Subscription ID (use to unsubscribe)
     */
    subscribe(topicName, callback, qos = QOS.RELIABLE) {
        const topic = this._getOrCreateTopic(topicName, MSG_TYPES.STRING, qos);
        const subId = `sub_${++this._subscriberIdCounter}`;

        topic.subscribers.push({ id: subId, callback, qos });

        // TRANSIENT_LOCAL: deliver last message immediately
        if (qos === QOS.TRANSIENT_LOCAL && topic.lastMessage) {
            try { callback(topic.lastMessage); } catch (_) { /* ignore */ }
        }

        this._notifyListeners();
        return subId;
    }

    /**
     * Unsubscribe from a topic.
     */
    unsubscribe(topicName, subId) {
        const topic = this._topics.get(topicName);
        if (topic) {
            topic.subscribers = topic.subscribers.filter(s => s.id !== subId);
            if (topic.publishers.size === 0 && topic.subscribers.length === 0) {
                this._topics.delete(topicName);
            }
            this._notifyListeners();
        }
    }

    // ─── Introspection API (thay thế ros2 topic list/info/hz/echo) ───────────

    /**
     * List all active topics.
     * Tương đương: ros2 topic list
     * @returns {Array<{name, msgType, pubCount, subCount, hz, latencyMs}>}
     */
    listTopics() {
        const result = [];
        for (const [name, topic] of this._topics) {
            result.push({
                name,
                msgType: topic.msgType,
                pubCount: topic.publishers.size,
                subCount: topic.subscribers.length,
                hz: topic.hzTracker.hz,
                latencyMs: topic.latencyMs,
                qos: topic.qos,
                messageCount: topic.hzTracker.count,
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get detailed info about a specific topic.
     * Tương đương: ros2 topic info <topic>
     */
    getTopicInfo(topicName) {
        const topic = this._topics.get(topicName);
        if (!topic) return null;

        return {
            name: topic.name,
            msgType: topic.msgType,
            qos: topic.qos,
            publishers: [...topic.publishers],
            subscriberCount: topic.subscribers.length,
            hz: topic.hzTracker.hz,
            hzHistory: topic.hzHistory,
            latencyMs: topic.latencyMs,
            lastMessage: topic.lastMessage,
            lastTimestamp: topic.lastTimestamp,
            messageCount: topic.hzTracker.count,
            historySize: topic.historyBuffer.length,
        };
    }

    /**
     * Get current Hz for a topic.
     * Tương đương: ros2 topic hz <topic>
     */
    getTopicHz(topicName) {
        const topic = this._topics.get(topicName);
        return topic ? topic.hzTracker.hz : 0;
    }

    /**
     * Get Hz sparkline history for a topic.
     */
    getHzHistory(topicName) {
        const topic = this._topics.get(topicName);
        return topic ? topic.hzHistory : [];
    }

    /**
     * Echo topic data in real-time.
     * Tương đương: ros2 topic echo <topic>
     * @returns {Function} Unsubscribe function
     */
    echoTopic(topicName, callback) {
        if (!this._echoCallbacks.has(topicName)) {
            this._echoCallbacks.set(topicName, []);
        }
        this._echoCallbacks.get(topicName).push(callback);

        // Return unsubscribe function
        return () => {
            const cbs = this._echoCallbacks.get(topicName);
            if (cbs) {
                const idx = cbs.indexOf(callback);
                if (idx !== -1) cbs.splice(idx, 1);
                if (cbs.length === 0) this._echoCallbacks.delete(topicName);
            }
        };
    }

    /**
     * Get message history buffer for a topic.
     * Tương đương: ros2 topic echo --once / debug inspection
     */
    getHistory(topicName, count = 10) {
        const topic = this._topics.get(topicName);
        if (!topic) return [];
        return topic.historyBuffer.slice(-count);
    }

    /**
     * Get a summary of all topics matching a filter.
     * Tương đương: ros2 topic list -t (with types)
     */
    findTopics(pattern) {
        const regex = new RegExp(pattern, 'i');
        return this.listTopics().filter(t => regex.test(t.name) || regex.test(t.msgType));
    }

    // ─── Global Listener API ─────────────────────────────────────────────────

    /**
     * Listen for changes to the topic list (topics added/removed).
     */
    onTopicListChange(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(cb => cb !== callback);
        };
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    _getOrCreateTopic(name, msgType, qos) {
        if (!this._topics.has(name)) {
            this._topics.set(name, new TopicEntry(name, msgType, qos));
            this._notifyListeners();
        }
        return this._topics.get(name);
    }

    _notifyListeners() {
        const topics = this.listTopics();
        for (const cb of this._listeners) {
            try { cb(topics); } catch (_) { /* ignore */ }
        }
    }

    _startHzSnapshots() {
        this._hzSnapshotInterval = setInterval(() => {
            for (const topic of this._topics.values()) {
                topic.snapshotHz();
            }
        }, 1000);
    }

    /**
     * Cleanup — call on app shutdown.
     */
    destroy() {
        if (this._hzSnapshotInterval) {
            clearInterval(this._hzSnapshotInterval);
        }
        this._topics.clear();
        this._listeners = [];
        this._echoCallbacks.clear();
    }
}

// Singleton
const topicManager = new TopicManager();
export default topicManager;
export { TopicManager, TopicEntry, HzTracker };
