/**
 * waypointSequencer.js
 * ====================
 * Waypoint Sequencer — thay thế nav2_waypoint_follower
 * 
 * Quản lý việc đi qua nhiều điểm (mission):
 *   [Goal 1] -> [Goal 2] -> [Target 3] -> Done
 *
 * Tính năng:
 *   - Auto-advance: Tự động chuyển checkpoint khi đến đích.
 *   - Stop-at-waypoint: Dừng lại thực hiện task (ví dụ: gắp hàng) trước khi đi tiếp.
 *   - Loop mission: Chạy vòng lặp.
 *
 * USAGE:
 *   import waypointSequencer from './waypointSequencer';
 *   waypointSequencer.startMission([
 *     { x: 1, y: 1, theta: 0, task: 'pick' },
 *     { x: 5, y: 2, theta: 1.57, task: 'drop' }
 *   ]);
 */

import { NAV_STATE } from './navController';

export class WaypointSequencer {
    constructor(robotId, behaviorManager, navController) {
        this._robotId = robotId;
        this._behaviorManager = behaviorManager;
        this._navController = navController;

        this._waypoints = [];
        this._currentIndex = -1;
        this._isMissionActive = false;
        this._isPaused = false;
        this._onTaskCallback = null;
        this._onProgressCallback = null;
        this._onCompleteCallback = null;

        // Listen to navigation state
        this._navController.onState(({ state }) => {
            if (!this._isMissionActive || this._isPaused) return;

            if (state === NAV_STATE.GOAL_REACHED) {
                this._handleWaypointReached();
            } else if (state === NAV_STATE.FAILED || state === NAV_STATE.CANCELLED) {
                // If it's CANCELLED and we are paused, don't fail the mission
                if (state === NAV_STATE.CANCELLED && this._isPaused) return;
                
                this._handleMissionFailure(state);
            }
        });
    }

    onProgress(cb) { this._onProgressCallback = cb; }
    onComplete(cb) { this._onCompleteCallback = cb; }
    onTask(cb) { this._onTaskCallback = cb; }

    /**
     * startMission(waypoints)
     * @param {Array<{x,y,theta,task?}>} waypoints 
     */
    startMission(waypoints) {
        if (!waypoints || waypoints.length === 0) return;

        this._waypoints = waypoints;
        this._currentIndex = 0;
        this._isMissionActive = true;

        console.log(`[Waypoints] Starting mission with ${waypoints.length} waypoints.`);
        this._navigateToCurrent();
    }

    stopMission() {
        this._isMissionActive = false;
        this._isPaused = false;
        this._behaviorManager.cancel();
    }

    pauseMission() {
        if (!this._isMissionActive || this._isPaused) return;
        this._isPaused = true;
        this._behaviorManager.pause();
        console.log(`[Waypoints:${this._robotId}] Mission paused at waypoint ${this._currentIndex + 1}`);
    }

    resumeMission() {
        if (!this._isMissionActive || !this._isPaused) return;
        this._isPaused = false;
        console.log(`[Waypoints:${this._robotId}] Mission resumed.`);
        this._behaviorManager.resume();
        this._navigateToCurrent(); // Continue to current or next waypoint
    }

    async _handleWaypointReached() {
        const currentWp = this._waypoints[this._currentIndex];
        console.log(`[Waypoints] Reached waypoint ${this._currentIndex + 1}/${this._waypoints.length}`);

        // Thực hiện task tại waypoint (nếu có)
        if (currentWp.task) {
            console.log(`[Waypoints] Executing task: ${currentWp.task}`);
            if (this._onTaskCallback) await this._onTaskCallback(currentWp.task);
            // Wait a bit
            await new Promise(r => setTimeout(r, 1000));
        }

        this._currentIndex++;

        if (this._currentIndex < this._waypoints.length) {
            if (this._onProgressCallback) this._onProgressCallback(this._currentIndex);
            this._navigateToCurrent();
        } else {
            console.log('[Waypoints] Mission Complete!');
            this._isMissionActive = false;
            if (this._onCompleteCallback) this._onCompleteCallback();
        }
    }

    _handleMissionFailure(state) {
        if (state === 'CANCELLED') {
            console.log(`[Waypoints] Mission stopped by user.`);
        } else {
            console.error(`[Waypoints] Mission failed at waypoint ${this._currentIndex + 1} due to state: ${state}`);
        }
        this._isMissionActive = false;
    }

    async _navigateToCurrent() {
        if (!this._isMissionActive || this._isPaused) return;

        const wp = this._waypoints[this._currentIndex];
        console.log(`[Waypoints:${this._robotId}] Navigating to waypoint ${this._currentIndex + 1}:`, wp);

        try {
            // NOTE: BehaviorManager.navigateTo doesn't return a promise that waits for completion.
            // Completion is handled by the onState listener above.
            await this._behaviorManager.navigateTo(wp);
        } catch (error) {
            console.error(`[Waypoints] Navigation trigger failed at waypoint ${this._currentIndex + 1}:`, error);
            this._isMissionActive = false;
        }
    }

}

export default WaypointSequencer;
