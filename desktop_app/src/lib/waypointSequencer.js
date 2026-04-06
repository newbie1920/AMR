/**
 * waypointSequencer.js
 * ====================
 * Waypoint Sequencer — thay thế nav2_waypoint_follower
 */

import { NAV_STATE } from './navController';

export class WaypointSequencer {
    constructor(robotId, behaviorManager, navController) {
        this._robotId = robotId;
        this._behaviorManager = behaviorManager;
        this._navController = navController;

        this._waypoints = [];
        this._currentIndex = -1;
        this._retryCount = 0;
        this._retryLimit = 3;
        this._isMissionActive = false;
        this._isPaused = false;
        
        this._onTaskCallback = null;
        this._onProgressCallback = null;
        this._onCompleteCallback = null;
        this._onFailCallback = null;

        // Listen to navigation state
        this._navController.onState(({ state }) => {
            if (!this._isMissionActive || this._isPaused) return;

            if (state === NAV_STATE.GOAL_REACHED) {
                this._retryCount = 0; // Reset retry count upon success
                this._handleWaypointReached();
            } else if (state === NAV_STATE.FAILED || state === NAV_STATE.STUCK) {
                this._handleMissionFailure(state);
            }
        });
    }

    onProgress(cb) { this._onProgressCallback = cb; }
    onComplete(cb) { this._onCompleteCallback = cb; }
    onTask(cb) { this._onTaskCallback = cb; }
    onFail(cb) { this._onFailCallback = cb; }

    startMission(waypoints) {
        if (!waypoints || waypoints.length === 0) return;

        this._waypoints = waypoints;
        this._currentIndex = 0;
        this._retryCount = 0;
        this._isMissionActive = true;
        this._isPaused = false;

        console.log(`[Waypoints:${this._robotId}] Starting mission with ${waypoints.length} waypoints.`);
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
    }

    resumeMission() {
        if (!this._isMissionActive || !this._isPaused) return;
        this._isPaused = false;
        this._behaviorManager.resume();
        this._navigateToCurrent();
    }

    async _handleWaypointReached() {
        const currentWp = this._waypoints[this._currentIndex];
        console.log(`[Waypoints:${this._robotId}] Reached waypoint ${this._currentIndex + 1}/${this._waypoints.length}`);

        if (currentWp.task) {
            console.log(`[Waypoints:${this._robotId}] Executing task: ${currentWp.task}`);
            if (this._onTaskCallback) await this._onTaskCallback(currentWp.task);
            await new Promise(r => setTimeout(r, 1000));
        }

        this._currentIndex++;

        if (this._currentIndex < this._waypoints.length) {
            if (this._onProgressCallback) this._onProgressCallback(this._currentIndex);
            this._navigateToCurrent();
        } else {
            console.log(`[Waypoints:${this._robotId}] Mission Complete!`);
            this._isMissionActive = false;
            if (this._onCompleteCallback) this._onCompleteCallback();
        }
    }

    async _handleMissionFailure(state) {
        if (state === NAV_STATE.CANCELLED) {
            console.log(`[Waypoints:${this._robotId}] Mission cancelled by controller.`);
            return;
        }

        if (this._retryCount < this._retryLimit) {
            this._retryCount++;
            console.warn(`[Waypoints:${this._robotId}] Nav ${state} at WP ${this._currentIndex + 1}. Retry ${this._retryCount}/${this._retryLimit}...`);
            
            await new Promise(r => setTimeout(r, 2000)); // Cool down
            
            if (this._isMissionActive && !this._isPaused) {
                this._navigateToCurrent();
            }
        } else {
            console.error(`[Waypoints:${this._robotId}] Mission failed at WP ${this._currentIndex + 1} after ${this._retryLimit} retries.`);
            if (this._onFailCallback) this._onFailCallback(state);
            this._isMissionActive = false;
        }
    }

    async _navigateToCurrent() {
        if (!this._isMissionActive || this._isPaused) return;

        const wp = this._waypoints[this._currentIndex];
        console.log(`[Waypoints:${this._robotId}] Navigating to waypoint ${this._currentIndex + 1} (Retry: ${this._retryCount}):`, wp);

        try {
            await this._behaviorManager.navigateTo(wp);
        } catch (error) {
            console.error(`[Waypoints:${this._robotId}] Navigation trigger failed:`, error);
            this._handleMissionFailure('TRIGGER_FAILED');
        }
    }
}

export default WaypointSequencer;
