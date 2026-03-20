/**
 * recoveryBehaviors.js
 * =====================
 * Recovery Behaviors — thay thế Nav2 recovery plugins (Spin, BackUp, Wait)
 * 
 * Khi robot bị stuck hoặc global planner không tìm được đường,
 * Behavior Manager sẽ gọi các module này để "giải cứu" robot.
 *
 * BEHAVIORS:
 *   - Spin: Xoay tại chỗ 360 độ để LiDAR quét thêm data hoặc tìm hướng thoáng.
 *   - BackUp: Lùi lại một đoạn ngắn để thoát khỏi góc kẹt.
 *   - Wait: Đợi một khoảng thời gian ngắn (để obstacles di động đi qua).
 *   - DriveOnHeading: Đi thẳng một đoạn ngắn theo hướng chỉ định.
 *
 * USAGE:
 *   import recovery from './recoveryBehaviors';
 *   await recovery.spin(robotId, 2 * Math.PI);
 *   await recovery.backUp(robotId, 0.2);
 */

import robotBridge from '../robotBridge';

class RecoveryBehaviors {
    constructor() {
        this._activeIntervals = new Map(); // Store interval per robotId
    }

    /**
     * spin(robotId, angle, speed)
     * Tương đương: nav2_recoveries/Spin
     */
    async spin(robotId, angle = 2 * Math.PI, speed = 0.5) {
        console.log(`[Recovery] Executing SPIN: ${angle} rad @ ${speed} rad/s`);
        const duration = Math.abs(angle / speed) * 1000;
        const startTime = Date.now();

        this.cancel(robotId); // Prevent overlapping recoveries

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                if (elapsed >= duration) {
                    this._cleanup(robotId);
                    robotBridge.cmdVel(robotId, 0, 0);
                    resolve(true);
                    return;
                }
                robotBridge.cmdVel(robotId, 0, Math.sign(angle) * speed);
            }, 100);
            this._activeIntervals.set(robotId, { interval, resolve });
        });
    }

    /**
     * backUp(robotId, distance, speed)
     * Tương đương: nav2_recoveries/BackUp
     */
    async backUp(robotId, distance = 0.2, speed = 0.1) {
        console.log(`[Recovery] Executing BACKUP: ${distance} m @ ${speed} m/s`);
        const duration = (distance / speed) * 1000;
        const startTime = Date.now();

        this.cancel(robotId);

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                if (elapsed >= duration) {
                    this._cleanup(robotId);
                    robotBridge.cmdVel(robotId, 0, 0);
                    resolve(true);
                    return;
                }
                robotBridge.cmdVel(robotId, -speed, 0); // Negative linear velocity
            }, 100);
            this._activeIntervals.set(robotId, { interval, resolve });
        });
    }

    /**
     * wait(ms)
     * Tương đương: nav2_recoveries/Wait
     */
    async wait(ms = 3000) {
        console.log(`[Recovery] Executing WAIT: ${ms} ms`);
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * driveOnHeading(robotId, distance, speed)
     * Tương đương: nav2_recoveries/DriveOnHeading
     */
    async driveOnHeading(robotId, distance = 0.2, speed = 0.1) {
        console.log(`[Recovery] Executing DRIVE_ON_HEADING: ${distance} m @ ${speed} m/s`);
        const duration = (distance / speed) * 1000;
        const startTime = Date.now();

        this.cancel(robotId);

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                if (elapsed >= duration) {
                    this._cleanup(robotId);
                    robotBridge.cmdVel(robotId, 0, 0);
                    resolve(true);
                    return;
                }
                robotBridge.cmdVel(robotId, speed, 0);
            }, 100);
            this._activeIntervals.set(robotId, { interval, resolve });
        });
    }

    cancel(robotId) {
        const active = this._activeIntervals.get(robotId);
        if (active) {
            console.log(`[Recovery] Cancelling active behavior for robot: ${robotId}`);
            clearInterval(active.interval);
            this._activeIntervals.delete(robotId);
            active.resolve(false); // Resolve promise with false indicating interruption
            robotBridge.cmdVel(robotId, 0, 0);
        }
    }

    _cleanup(robotId) {
        const active = this._activeIntervals.get(robotId);
        if (active) {
            clearInterval(active.interval);
            this._activeIntervals.delete(robotId);
        }
    }
}

const recoveryBy = new RecoveryBehaviors();
export default recoveryBy;
