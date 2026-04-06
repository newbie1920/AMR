/**
 * autoExplorer.js
 * ================
 * Module tự động khám phá không gian bằng LiDAR.
 * Khi bật mapping, robot sẽ tự chạy quanh phòng, né vật cản,
 * và vẽ bản đồ bằng dữ liệu LiDAR.
 * 
 * Thuật toán: Wall-following + Obstacle Avoidance
 * - Ưu tiên đi thẳng khi không có vật cản
 * - Khi gặp vật cản phía trước → quay về phía có nhiều không gian hơn
 * - Bám theo tường để khám phá toàn bộ phòng
 * - Bảo vệ chống va chạm mọi hướng
 */

import robotBridge from './robotBridge';

const EXPLORE_CONFIG = {
    controlHz: 5,             // 5Hz vòng lặp điều khiển (200ms)
    safeDistFront: 0.35,      // Khoảng cách an toàn phía trước (m)
    slowDistFront: 0.60,      // Khoảng cách bắt đầu giảm tốc (m)
    safeDistSide: 0.20,       // Khoảng cách an toàn 2 bên (m)
    maxLinear: 0.15,           // Tốc độ tối đa (m/s) - chậm để map chính xác
    slowLinear: 0.08,          // Tốc độ khi gần vật cản
    turnSpeed: 0.6,            // Tốc độ quay khi tránh vật (rad/s)
    hardTurnSpeed: 0.9,        // Tốc độ quay mạnh khi sát vật cản
    wallFollowBias: 0.15,      // Lực hút nhẹ về phía tường (để bám tường)
    stuckTimeoutMs: 4000,      // Nếu không di chuyển 4 giây → coi là bị kẹt
    stuckRecoveryRotation: 1.2, // Quay mạnh khi kẹt
    minQuality: 5,             // Chất lượng tối thiểu của điểm LiDAR
};

class AutoExplorer {
    constructor() {
        this._running = false;
        this._interval = null;
        this._robotId = null;
        this._getRobotState = null; // callback to get store state
        this._lastPose = null;
        this._stuckTimer = 0;
        this._turnDirection = 1; // 1 = quay trái, -1 = quay phải
        this._listeners = new Set();
        this._stats = {
            startTime: null,
            distanceTraveled: 0,
            rotations: 0,
        };
    }

    /**
     * Bắt đầu khám phá tự động
     * @param {string} robotId - ID robot
     * @param {Function} getRobotState - Hàm lấy state robot từ store
     */
    start(robotId, getRobotState) {
        if (this._running) {
            console.warn('[AutoExplorer] Đã đang chạy!');
            return;
        }

        this._robotId = robotId;
        this._getRobotState = getRobotState;
        this._running = true;
        this._lastPose = null;
        this._stuckTimer = 0;
        this._stats.startTime = Date.now();
        this._stats.distanceTraveled = 0;

        console.log(`[AutoExplorer] 🚀 Bắt đầu khám phá với robot ${robotId}`);
        this._emit('started');

        const intervalMs = Math.round(1000 / EXPLORE_CONFIG.controlHz);
        this._interval = setInterval(() => this._controlLoop(), intervalMs);
    }

    /**
     * Dừng khám phá
     */
    stop() {
        if (!this._running) return;

        this._running = false;
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }

        // Gửi lệnh dừng
        if (this._robotId) {
            robotBridge.cmdVel(this._robotId, 0, 0);
            console.log(`[AutoExplorer] ⏹ Dừng khám phá. Di chuyển: ${this._stats.distanceTraveled.toFixed(2)}m`);
        }

        this._emit('stopped');
    }

    get isRunning() {
        return this._running;
    }

    get stats() {
        return {
            ...this._stats,
            elapsed: this._stats.startTime ? Date.now() - this._stats.startTime : 0,
        };
    }

    /**
     * Đăng ký lắng nghe sự kiện
     */
    onStateChange(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    _emit(event, data) {
        this._listeners.forEach(cb => {
            try { cb(event, data); } catch (e) { console.error(e); }
        });
    }

    /**
     * Vòng lặp điều khiển chính - chạy ở 5Hz
     */
    _controlLoop() {
        if (!this._running || !this._robotId) return;

        const robotState = this._getRobotState?.();
        if (!robotState || !robotState.connected) {
            console.warn('[AutoExplorer] Robot không kết nối. Tạm dừng...');
            return;
        }

        const lidar = robotState.lidarData || [];
        const pose = robotState.pose || { x: 0, y: 0, theta: 0 };

        // Phân tích dữ liệu LiDAR theo vùng
        const scan = this._analyzeLidar(lidar);

        // Phát hiện kẹt (stuck detection)
        const isStuck = this._checkStuck(pose);

        // Tính toán vận tốc
        let { linear, angular } = this._computeVelocity(scan, isStuck);

        // Gửi lệnh
        robotBridge.cmdVel(this._robotId, linear, angular);

        // Cập nhật stats
        if (this._lastPose) {
            const dx = pose.x - this._lastPose.x;
            const dy = pose.y - this._lastPose.y;
            this._stats.distanceTraveled += Math.hypot(dx, dy);
        }
        this._lastPose = { ...pose };
    }

    /**
     * Phân tích dữ liệu LiDAR theo 5 sector:
     * - front:     -30° đến +30°
     * - frontLeft: +30° đến +90°
     * - frontRight: -90° đến -30°  (tức 270° đến 330°)
     * - left:      +90° đến +180°
     * - right:     180° đến 270°
     */
    _analyzeLidar(points) {
        const scan = {
            front: 99, frontLeft: 99, frontRight: 99,
            left: 99, right: 99, back: 99,
            frontCount: 0, // Số điểm phía trước (để phát hiện hành lang hẹp)
        };

        if (!points || points.length === 0) return scan;

        for (const p of points) {
            if (!p || p.distance <= 0.18 || p.distance > 5.0) continue;
            if (p.quality !== undefined && p.quality < EXPLORE_CONFIG.minQuality) continue;

            // Chuẩn hóa góc về -180 đến 180
            let angle = p.angle % 360;
            if (angle > 180) angle -= 360;

            const d = p.distance;

            if (angle >= -30 && angle <= 30) {
                scan.front = Math.min(scan.front, d);
                scan.frontCount++;
            }
            if (angle > 30 && angle <= 90) {
                scan.frontLeft = Math.min(scan.frontLeft, d);
            }
            if (angle >= -90 && angle < -30) {
                scan.frontRight = Math.min(scan.frontRight, d);
            }
            if (angle > 90 && angle <= 150) {
                scan.left = Math.min(scan.left, d);
            }
            if (angle >= -150 && angle < -90) {
                scan.right = Math.min(scan.right, d);
            }
            if (angle > 150 || angle < -150) {
                scan.back = Math.min(scan.back, d);
            }
        }

        return scan;
    }

    /**
     * Phát hiện kẹt: nếu robot không di chuyển đủ xa trong thời gian dài
     */
    _checkStuck(pose) {
        if (!this._lastPose) return false;

        const dx = pose.x - this._lastPose.x;
        const dy = pose.y - this._lastPose.y;
        const dist = Math.hypot(dx, dy);

        const intervalMs = Math.round(1000 / EXPLORE_CONFIG.controlHz);

        if (dist < 0.005) { // Gần như không di chuyển
            this._stuckTimer += intervalMs;
        } else {
            this._stuckTimer = 0;
        }

        return this._stuckTimer > EXPLORE_CONFIG.stuckTimeoutMs;
    }

    _computeVelocity(scan, isStuck) {
        const cfg = EXPLORE_CONFIG;

        // Trường hợp 1: BỊ KẸT → quay tại chỗ để thoát
        if (isStuck) {
            this._stuckTimer = 0; // Reset timer
            this._turnDirection *= -1; // Đổi hướng quay
            console.log('[AutoExplorer] 🔄 Bị kẹt! Đang xoay để thoát...');
            this._emit('stuck');
            return {
                linear: scan.back > 0.3 ? -0.08 : 0, // Chỉ lùi nếu phía sau cực kỳ an toàn
                angular: this._turnDirection * cfg.stuckRecoveryRotation,
            };
        }

        // Trường hợp 2: VẬT CẢN SÁT PHÍA TRƯỚC → dừng lại và quay (không tự ý de lùi mù quáng)
        if (scan.front < cfg.safeDistFront || scan.frontCount > 10 && scan.front < cfg.safeDistFront + 0.1) {
            // Chọn hướng quay: về phía có nhiều không gian hơn
            const turnDir = scan.frontLeft > scan.frontRight ? 1 : -1;
            this._turnDirection = turnDir;

            let linearSpeed = 0;
            // Nếu quá sát tường (dưới 15cm) và đằng sau trống (trên 30cm) thì mới lùi nhẹ
            if (scan.front < 0.15 && scan.back > 0.3) {
                linearSpeed = -0.05;
            }

            return {
                linear: linearSpeed,
                angular: turnDir * cfg.hardTurnSpeed,
            };
        }

        // Trường hợp 3: ĐANG TIẾN GẦN VẬT CẢN → giảm tốc + bẻ lái mượt mà
        if (scan.front < cfg.slowDistFront) {
            const turnDir = scan.frontLeft > scan.frontRight ? 1 : -1;
            return {
                linear: cfg.slowLinear,
                angular: turnDir * cfg.turnSpeed,
            };
        }

        // Trường hợp 4: AN TOÀN → đi thẳng hoặc bám tường nhẹ
        let angular = 0;

        // Bám tường nhẹ: ưu tiên đi dọc theo tường bên phải (hoặc trái)
        if (scan.right < 0.8 && scan.right > cfg.safeDistSide) {
            // Có tường bên phải → bám nhẹ
            angular = -cfg.wallFollowBias;
        } else if (scan.left < 0.8 && scan.left > cfg.safeDistSide) {
            // Có tường bên trái → bám nhẹ
            angular = cfg.wallFollowBias;
        } else {
            // Không gian rộng → đi thẳng tắp giống các robot hút bụi cao cấp
            angular = 0;
        }

        // Bảo vệ phụ: nếu sát hoặc chạm bên sườn, né ngay lập tức
        if (scan.frontLeft < cfg.safeDistSide * 1.5) {
            angular -= 0.5; // Đánh lái gắt qua phải
        }
        if (scan.frontRight < cfg.safeDistSide * 1.5) {
            angular += 0.5; // Đánh lái gắt qua trái
        }

        return {
            linear: cfg.maxLinear,
            angular: angular,
        };
    }
}

// Singleton
const autoExplorer = new AutoExplorer();
export default autoExplorer;
