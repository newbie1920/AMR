/**
 * chargingBehavior.js
 * ===================
 * Specialized behavior for autonomous recharging.
 */

import { reservationService } from '../reservationService';
import recovery from './recoveryBehaviors';
import robotBridge from './robotBridge';

class ChargingBehavior {
    constructor(robotId, behaviorManager) {
        this._robotId = robotId;
        this._bm = behaviorManager;
        this._isCharging = false;
    }

    async execute() {
        console.log(`[ChargingBehavior:${this._robotId}] Low battery detected. Initiating...`);

        // 1. Locate nearest charging station
        const dock = this._findNearestDock();
        if (!dock) {
            console.error('[Charging] No dock found!');
            return false;
        }

        // 2. Reserve the dock
        const acquired = reservationService.requestLock(dock.id, this._robotId, 100); // 100 = Power Priority
        if (!acquired) {
            console.warn(`[Charging] Dock ${dock.id} is occupied. Waiting...`);
            await recovery.wait(5000);
            return this.execute();
        }

        // 3. Navigate to dock approach point
        await this._bm.navigateTo(dock.approach);

        // 4. Final docking maneuver (blind or Lidar-assisted)
        console.log('[Charging] Final docking approach...');
        await robotBridge.cmdVel(this._robotId, 0.1, 0); // Slow forward
        await recovery.wait(3000);
        await robotBridge.cmdVel(this._robotId, 0, 0);

        this._isCharging = true;
        console.log('[Charging] Success: Attached to dock.');

        return true;
    }

    _findNearestDock() {
        // Mocked dock list
        const docks = [
            { id: 'Dock_1', approach: { x: 0.5, y: -2.0, theta: Math.PI } }
        ];
        return docks[0];
    }
}

export default ChargingBehavior;
