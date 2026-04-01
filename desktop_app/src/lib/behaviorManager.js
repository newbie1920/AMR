/**
 * behaviorManager.js
 * ==================
 * Navigation Behavior Manager — thay thế Nav2 BehaviorTree Navigator
 * 
 * Quản lý vòng lặp high-level của navigation:
 *   1. Nhận Goal
 *   2. Thử Planning
 *   3. Nếu Planning fail: Chạy Recovery (Spin -> BackUp -> Planning lại)
 *   4. Nếu Following bị Stuck: Chạy Recovery
 *   5. Quản lý trạng thái Task (Cancel, Pause, Resume)
 *
 * USAGE:
 *   import behaviorManager from './behaviorManager';
 *   behaviorManager.navigateToGoal({ x, y, theta });
 */

import { NAV_STATE } from './navController';
import recovery from './planner/recoveryBehaviors';
import robotBridge from './robotBridge';
import WaypointSequencer from './waypointSequencer';
import { reservationService } from './reservationService';

class BehaviorManager {
    constructor(robotId = 'robot_1', navController) {
        this._robotId = robotId;
        this._navController = navController;
        this._currentGoal = null;
        this._isRecovering = false;
        this._recoveryAttempt = 0;
        this._isPaused = false;
        this._robots = []; // Internal fleet state to avoid require cycle
        this._onStateChange = null;

        if (this._navController) {
            this._navController.onState(({ state }) => this._handleStateChange(state));
        }

        this._sequencer = new WaypointSequencer(this._robotId, this, this._navController);
    }

    init() {
        console.log(`[BehaviorManager:${this._robotId}] Initialized.`);
    }

    onState(cb) {
        this._onStateChange = cb;
    }

    startMission(waypoints) {
        this._sequencer.startMission(waypoints);
    }

    stopMission() {
        this._sequencer.stopMission();
    }

    onMissionProgress(cb) {
        this._sequencer.onProgress(cb);
    }

    onMissionComplete(cb) {
        this._sequencer.onComplete(cb);
    }

    onMissionFailed(cb) {
        this._sequencer.onFail(cb);
    }

    pause() {
        if (this._isPaused) return;
        this._isPaused = true;
        this._isRecovering = false; // Reset recovery on pause
        this._recoveryAttempt = 0;
        recovery.cancel(this._robotId); // Stop any active recovery movement
        
        this._notify(NAV_STATE.PAUSED);
        this._navController.pause();
        console.log(`[BehaviorManager:${this._robotId}] Paused.`);
    }

    resume() {
        if (!this._isPaused) return;
        this._isPaused = false;
        console.log(`[BehaviorManager:${this._robotId}] Resuming...`);
        this._navController.resume();
    }

    pauseMission() {
        this._sequencer.pauseMission();
    }

    resumeMission() {
        this._sequencer.resumeMission();
    }

    /**
     * navigateTo(goal)
     * Entry point chính cho mọi lệnh di chuyển.
     */
    async navigateTo(goal) {
        this._currentGoal = goal;
        this._isRecovering = false;
        this._recoveryAttempt = 0;

        // ─── Phase 11: Zone Reservation Check ───
        const requiredZone = this._identifyZoneFromGoal(goal);
        if (requiredZone) {
            this._notify(`REQUESTING LOCK: ${requiredZone}`);
            const acquired = reservationService.requestLock(requiredZone, this._robotId);
            if (!acquired) {
                this._notify(`WAITING: Zone ${requiredZone} is Busy`);
                await recovery.wait(2000); // Poll every 2s
                return this.navigateTo(goal); // Retry
            }
        }

        this._notify('PLANNING');
        this._navController.setGoal(goal);
    }

    /**
     * updateFleetContext(robots)
     * Updates internal knowledge of the fleet to avoid dependencies on stores.
     */
    updateFleetContext(robots) {
        this._robots = robots || [];
    }

    _notify(state) {
        if (this._onStateChange) this._onStateChange({ robotId: this._robotId, state });
    }

    async cancel() {
        this._releaseAllLocks();
        this._currentGoal = null;
        this._isRecovering = false; // Interrupt recovery state
        this._recoveryAttempt = 0;
        recovery.cancel(this._robotId); // Kill active recovery animations/intervals
        this._notify('IDLE');
        this._navController.cancel();
        robotBridge.cmdVel(this._robotId, 0, 0);
    }

    async _handleStateChange(state) {
        if (this._isRecovering || this._isPaused) return;

        switch (state) {
            case NAV_STATE.FAILED:
            case NAV_STATE.STUCK:
                const reason = state === NAV_STATE.STUCK ? 'Robot Stuck' : 'Planning Failed';
                this._notify(`RECOVERING: ${reason}`);
                console.warn(`[BehaviorManager:${this._robotId}] ${reason} detected. Initiating recovery sequence...`);
                await this._runRecoverySequence();
                break;

            case NAV_STATE.GOAL_REACHED:
                this._recoveryAttempt = 0;
                this._notify('SUCCESS: Goal Reached');
                this._currentGoal = null;
                setTimeout(() => this._notify('IDLE'), 3000);
                break;

            case NAV_STATE.FOLLOWING:
                this._notify('FOLLOWING');
                break;

            case NAV_STATE.PLANNING:
                this._notify('PLANNING');
                break;
        }
    }

    async _runRecoverySequence() {
        if (this._isRecovering || this._isPaused) return;
        this._isRecovering = true;

        // Phase 0: Check for Yield (Traffic Rule)
        const blockingRobot = this._getBlockingRobot();
        if (blockingRobot) {
            const hasPriority = this._robotId < blockingRobot.id; // Simple ID-based priority
            if (!hasPriority) {
                this._notify(`YIELDING to ${blockingRobot.name || blockingRobot.id}`);
                await recovery.wait(2000); // Wait for them to pass
                if (!this._isRecovering) return;
                
                // Do not increment recovery attempt for yielding
                this._finishRecoveryStep();
                return;
            }
        }

        switch (this._recoveryAttempt) {
            case 0:
                this._notify('RECOVERY: Waiting');
                console.log(`[BehaviorManager:${this._robotId}] Recovery Phase 0: Waiting 5s for clear path...`);
                await recovery.wait(5000);
                break;
            case 1:
                this._notify('RECOVERY: Spinning');
                console.log(`[BehaviorManager:${this._robotId}] Recovery Phase 1: Spinning to clear obstacles...`);
                await recovery.spin(this._robotId, Math.PI / 2);
                await recovery.wait(1000);
                break;
            case 2:
                this._notify('RECOVERY: Backing Up');
                console.log(`[BehaviorManager:${this._robotId}] Recovery Phase 2: Backing up to gain clearance...`);
                await recovery.backUp(this._robotId, 0.2);
                await recovery.wait(1000);
                break;
            case 3:
                this._notify('RECOVERY: Final Spin');
                console.log(`[BehaviorManager:${this._robotId}] Recovery Phase 3: Final Spin...`);
                await recovery.spin(this._robotId, Math.PI);
                break;
            default:
                this._notify('ERROR: All Recoveries Failed');
                console.error('[Behavior] All recovery behaviors exhausted. Mission failing.');
                this._releaseAllLocks();
                this._navController.cancel(); // Transition to CANCELLED/FAILED
                this._isRecovering = false;
                this._currentGoal = null;
                this._recoveryAttempt = 0;
                return;
        }

        if (!this._isRecovering) return; // If cancelled during wait

        this._recoveryAttempt++;
        this._finishRecoveryStep();
    }

    _finishRecoveryStep() {
        this._isRecovering = false;
        if (this._currentGoal && !this._isPaused) {
            this._navController.setGoal(this._currentGoal);
        }
    }

    _releaseAllLocks() {
        // Simple implementation for now: release based on known resource naming
        // In production, we'd track which locks this robot holds.
        const locks = reservationService.getAllLocks();
        for (const [resId, lock] of Object.entries(locks)) {
            if (lock.robotId === this._robotId) {
                reservationService.releaseLock(resId, this._robotId);
            }
        }
    }

    _identifyZoneFromGoal(goal) {
        // Placeholder Logic: Identify if goal is in a reserved corridor
        // Example: Zones defined in a JSON config normally.
        if (goal.x > 5 && goal.x < 10 && Math.abs(goal.y) < 1.0) {
            return 'Aisle_A';
        }
        return null;
    }

    // _tryReplan removed as it was causing infinite dummy loops

    /**
     * _getBlockingRobot()
     * Checks if the blockage is likely another robot.
     */
    _getBlockingRobot() {
        const robots = this._robots;
        const selfPose = this._navController.tf.getMapPose();

        // Simple proximity check: is any other robot very close to us?
        for (const robot of robots) {
            if (robot.id === this._robotId || !robot.pose) continue;

            const dist = Math.hypot(robot.pose.x - selfPose.x, robot.pose.y - selfPose.y);
            if (dist < 0.6) { // Blockage radius
                return robot;
            }
        }
        return null;
    }
}

export default BehaviorManager;
