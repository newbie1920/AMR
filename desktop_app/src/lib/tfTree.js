/**
 * tfTree.js
 * =========
 * TF2 (Transform) System — thay thế ros2 tf2_ros
 *
 * ROS2 có: map → odom → base_link → lidar_link → imu_link
 * Module này tính và lưu trữ các transform đó dựa trên odometry data từ robot.
 *
 * FRAME DEFINITIONS:
 *   map        : World frame (gốc tuyệt đối, được thiết lập bởi SLAM)
 *   odom       : Odometry frame (bắt đầu từ vị trí robot khi boot)
 *   base_link  : Robot body frame (center of robot)
 *   base_footprint: Robot footprint on ground
 *   lidar_link : LiDAR sensor frame
 *   imu_link   : IMU sensor frame
 *
 * USAGE:
 *   import tfTree from './tfTree';
 *   tfTree.updateOdom({ x, y, theta });
 *   const tf = tfTree.lookupTransform('map', 'base_link');
 *   // tf = { translation: {x, y, z}, rotation: {roll, pitch, yaw} }
 */

class TFTree {
    constructor() {
        /**
         * Transform store: parent_frame → child_frame → Transform
         * Transform = { translation: {x, y, z}, rotation: {roll, pitch, yaw}, stamp: Date.now() }
         */
        this._transforms = new Map();

        // Static transforms (hardcoded from URDF amr.urdf.xacro)
        this._initStaticTransforms();

        // Map → odom offset (set by SLAM/AMCL localization)
        // Khi chưa có SLAM: map = odom (identity transform)
        this._mapToOdomOffset = { x: 0, y: 0, theta: 0 };

        // Listeners for transform updates
        this._listeners = [];
    }

    // ---------------------------------------------------------------------------
    //   Static Transforms (tương đương static_transform_publisher trong ROS2)
    //   Lấy từ amr.urdf.xacro
    // ---------------------------------------------------------------------------
    _initStaticTransforms() {
        const CHASSIS_HEIGHT = 0.12;  // m
        const WHEEL_RADIUS = 0.033;   // m
        const CHASSIS_LENGTH = 0.4;   // m
        const WHEEL_SEPARATION = 0.170; // m

        // base_footprint → base_link (lifted by chassis height + wheel radius)
        this._setTransform('base_footprint', 'base_link', {
            translation: { x: 0, y: 0, z: 0 },
            rotation: { roll: 0, pitch: 0, yaw: 0 },
            static: true
        });

        // base_link → lidar_link (mounted on top of chassis)
        this._setTransform('base_link', 'lidar_link', {
            translation: { x: 0, y: 0, z: CHASSIS_HEIGHT + WHEEL_RADIUS + 0.02 },
            rotation: { roll: 0, pitch: 0, yaw: 0 },
            static: true
        });

        // base_link → imu_link (at top of chassis)
        this._setTransform('base_link', 'imu_link', {
            translation: { x: 0, y: 0, z: CHASSIS_HEIGHT + WHEEL_RADIUS },
            rotation: { roll: 0, pitch: 0, yaw: 0 },
            static: true
        });

        // base_link → left_wheel
        this._setTransform('base_link', 'left_wheel', {
            translation: { x: 0, y: WHEEL_SEPARATION / 2, z: WHEEL_RADIUS },
            rotation: { roll: Math.PI / 2, pitch: 0, yaw: 0 },
            static: true
        });

        // base_link → right_wheel
        this._setTransform('base_link', 'right_wheel', {
            translation: { x: 0, y: -WHEEL_SEPARATION / 2, z: WHEEL_RADIUS },
            rotation: { roll: Math.PI / 2, pitch: 0, yaw: 0 },
            static: true
        });

        // base_link → front_caster
        this._setTransform('base_link', 'front_caster', {
            translation: { x: CHASSIS_LENGTH / 2 - 0.05, y: 0, z: 0.02 },
            rotation: { roll: 0, pitch: 0, yaw: 0 },
            static: true
        });

        // base_link → rear_caster
        this._setTransform('base_link', 'rear_caster', {
            translation: { x: -(CHASSIS_LENGTH / 2 - 0.05), y: 0, z: 0.02 },
            rotation: { roll: 0, pitch: 0, yaw: 0 },
            static: true
        });
    }

    // ---------------------------------------------------------------------------
    //   Internal transform store
    // ---------------------------------------------------------------------------
    _setTransform(parent, child, tf) {
        const key = `${parent}→${child}`;
        this._transforms.set(key, { ...tf, parent, child, stamp: Date.now() });
    }

    _getTransform(parent, child) {
        return this._transforms.get(`${parent}→${child}`) || null;
    }

    // ---------------------------------------------------------------------------
    //   Dynamic Transform Updates
    // ---------------------------------------------------------------------------

    /**
     * updateOdom(pose)
     * Tương đương: broadcaster của odom → base_footprint trong ROS2 diff_drive_controller
     *
     * @param {Object} pose - { x, y, theta } — từ robot telemetry
     */
    updateOdom(pose) {
        const { x = 0, y = 0, theta = 0 } = pose;
        this._setTransform('odom', 'base_footprint', {
            translation: { x, y, z: 0 },
            rotation: { roll: 0, pitch: 0, yaw: theta },
            static: false
        });
        this._notifyListeners('odom', 'base_footprint');
    }

    /**
     * updateMapToOdom(offset)
     * Tương đương: map → odom transform từ AMCL/SLAM
     * Khi chưa có SLAM: offset = {x:0, y:0, theta:0} (map = odom)
     *
     * @param {Object} offset - { x, y, theta }
     */
    updateMapToOdom(offset) {
        this._mapToOdomOffset = offset;
        this._setTransform('map', 'odom', {
            translation: { x: offset.x, y: offset.y, z: 0 },
            rotation: { roll: 0, pitch: 0, yaw: offset.theta },
            static: false
        });
        this._notifyListeners('map', 'odom');
    }

    /**
     * updateWheelJoints(left_rad, right_rad)
     * Tương đương: joint_state_broadcaster
     */
    updateWheelJoints(leftAngle, rightAngle) {
        this._setTransform('base_link', 'left_wheel', {
            ...this._getTransform('base_link', 'left_wheel'),
            rotation: { roll: Math.PI / 2, pitch: leftAngle, yaw: 0 },
            static: false
        });
        this._setTransform('base_link', 'right_wheel', {
            ...this._getTransform('base_link', 'right_wheel'),
            rotation: { roll: Math.PI / 2, pitch: rightAngle, yaw: 0 },
            static: false
        });
    }

    // ---------------------------------------------------------------------------
    //   Transform Lookup (tương đương tf2_ros::Buffer::lookupTransform)
    // ---------------------------------------------------------------------------

    /**
     * lookupTransform(targetFrame, sourceFrame)
     * Tìm transform từ sourceFrame đến targetFrame.
     *
     * Supported chains:
     *   map → base_link
     *   map → lidar_link
     *   map → imu_link
     *   odom → base_link
     *   odom → lidar_link
     *   base_link → lidar_link
     *   base_link → imu_link
     *
     * @returns {Object|null} { translation: {x,y,z}, rotation: {roll,pitch,yaw} }
     */
    lookupTransform(targetFrame, sourceFrame) {
        // Direct lookup
        const direct = this._getTransform(targetFrame, sourceFrame);
        if (direct) return direct;

        // Chain lookup via compose
        const chains = this._buildChain(targetFrame, sourceFrame);
        if (!chains) return null;
        return this._composeChain(chains);
    }

    /**
     * getMapPose()
     * Robot position in map frame (most useful for UI display)
     * @returns { x, y, theta }
     */
    getMapPose() {
        const odomToBase = this._getTransform('odom', 'base_footprint');
        if (!odomToBase) return { x: 0, y: 0, theta: 0 };

        const { x: ox, y: oy } = this._mapToOdomOffset;
        const oTheta = this._mapToOdomOffset.theta || 0;
        const bx = odomToBase.translation.x;
        const by = odomToBase.translation.y;
        const bTheta = odomToBase.rotation.yaw;

        // Compose: map_T_base = map_T_odom * odom_T_base
        const cos_ = Math.cos(oTheta);
        const sin_ = Math.sin(oTheta);
        return {
            x: ox + bx * cos_ - by * sin_,
            y: oy + bx * sin_ + by * cos_,
            theta: oTheta + bTheta
        };
    }

    /**
     * getLidarPoseInMap()
     * LiDAR pose in map frame (needed for scan → map projection in SLAM)
     */
    getLidarPoseInMap() {
        const base = this.getMapPose();
        const lidarTf = this._getTransform('base_link', 'lidar_link');
        if (!lidarTf) return base;

        const c = Math.cos(base.theta);
        const s = Math.sin(base.theta);
        const lx = lidarTf.translation.x;
        const ly = lidarTf.translation.y;
        return {
            x: base.x + lx * c - ly * s,
            y: base.y + lx * s + ly * c,
            z: lidarTf.translation.z,
            theta: base.theta
        };
    }

    // ---------------------------------------------------------------------------
    //   Chain composition helper
    // ---------------------------------------------------------------------------
    _buildChain(target, source) {
        // Simple chain builder for known frame hierarchy:
        // map → odom → base_footprint → base_link → lidar_link / imu_link / wheels

        const hierarchy = [
            'map', 'odom', 'base_footprint', 'base_link',
            'lidar_link', 'imu_link', 'left_wheel', 'right_wheel',
            'front_caster', 'rear_caster'
        ];

        const ti = hierarchy.indexOf(target);
        const si = hierarchy.indexOf(source);
        if (ti === -1 || si === -1) return null;

        const chain = [];
        if (ti < si) {
            for (let i = ti; i < si; i++) {
                chain.push({ parent: hierarchy[i], child: hierarchy[i + 1] });
            }
        }
        return chain.length > 0 ? chain : null;
    }

    _composeChain(chain) {
        let x = 0, y = 0, z = 0, yaw = 0;
        for (const { parent, child } of chain) {
            const tf = this._getTransform(parent, child);
            if (!tf) return null;
            const c = Math.cos(yaw), s = Math.sin(yaw);
            const tx = tf.translation.x, ty = tf.translation.y, tz = tf.translation.z;
            x += tx * c - ty * s;
            y += tx * s + ty * c;
            z += tz;
            yaw += tf.rotation.yaw || 0;
        }
        return {
            translation: { x, y, z },
            rotation: { roll: 0, pitch: 0, yaw },
            stamp: Date.now()
        };
    }

    // ---------------------------------------------------------------------------
    //   Listener system (tương đương tf2 callbacks)
    // ---------------------------------------------------------------------------
    onUpdate(callback) {
        this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter(l => l !== callback); };
    }

    _notifyListeners(parent, child) {
        const tf = this._getTransform(parent, child);
        this._listeners.forEach(cb => cb({ parent, child, tf }));
    }

    // ---------------------------------------------------------------------------
    //   Debug: Print all frames (tương đương ros2 run tf2_ros tf2_echo)
    // ---------------------------------------------------------------------------
    getAllFrames() {
        const frames = {};
        for (const [key, tf] of this._transforms.entries()) {
            frames[key] = {
                translation: tf.translation,
                rotation: tf.rotation,
                static: tf.static,
                age_ms: Date.now() - tf.stamp
            };
        }
        return frames;
    }
}

const tfTree = new TFTree();
export default tfTree;
export { TFTree };
