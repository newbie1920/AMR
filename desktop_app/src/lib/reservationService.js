/**
 * reservationService.js
 * =====================
 * Centralized resource locking for the AMR fleet.
 * Prevents multiple robots from entering narrow aisles or utilizing same charging dock.
 * 
 * Logic: First-Come-First-Served (FCFS) with Priority Overrides.
 */

class ReservationService {
    constructor() {
        this._locks = new Map(); // resourceId -> { robotId, priority, timestamp }
        this._listeners = [];
    }

    /**
     * requestLock(resourceId, robotId, priority = 0)
     * Attempts to acquire a lock for a specific zone or resource.
     * 
     * @returns {boolean} - True if lock acquired or already held.
     */
    requestLock(resourceId, robotId, priority = 0) {
        const currentLock = this._locks.get(resourceId);

        if (!currentLock) {
            // Resource is free
            this._locks.set(resourceId, { robotId, priority, timestamp: Date.now() });
            this._notify();
            return true;
        }

        if (currentLock.robotId === robotId) {
            // Already held by this robot
            return true;
        }

        // Priority Override Logic
        if (priority > currentLock.priority) {
            console.log(`[Reservation] Priority Override: Robot ${robotId} (${priority}) taking ${resourceId} from ${currentLock.robotId}`);
            this._locks.set(resourceId, { robotId, priority, timestamp: Date.now() });
            this._notify();
            return true;
        }

        return false;
    }

    /**
     * releaseLock(resourceId, robotId)
     */
    releaseLock(resourceId, robotId) {
        const currentLock = this._locks.get(resourceId);
        if (currentLock && currentLock.robotId === robotId) {
            this._locks.delete(resourceId);
            this._notify();
            return true;
        }
        return false;
    }

    /**
     * getLockStatus(resourceId)
     */
    getLockStatus(resourceId) {
        return this._locks.get(resourceId);
    }

    /**
     * getAllLocks()
     */
    getAllLocks() {
        return Object.fromEntries(this._locks);
    }

    onUpdate(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }

    _notify() {
        const locks = this.getAllLocks();
        this._listeners.forEach(cb => cb(locks));
    }
}

const reservationService = new ReservationService();
export default reservationService;
export { reservationService };
