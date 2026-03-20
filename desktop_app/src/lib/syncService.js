/**
 * syncService.js
 * ==============
 * Cloud Synchronization Service for Global Map Sharing.
 * 
 * Handles:
 *  - Uploading local SLAM maps to the "Cloud".
 *  - Downloading the global merged map.
 *  - Map merging logic (simple max-pooling for now).
 */

class SyncService {
    constructor() {
        this._cloudMap = null;
        this._lastUpdate = 0;
        this._isSyncing = false;
        this._listeners = [];
    }

    /**
     * pushMap(robotId, localMap)
     * Uploads a robot's local map to the cloud and merges it.
     * 
     * @param {string} robotId 
     * @param {Object} localMap - { width, height, resolution, origin, data }
     */
    async pushMap(robotId, localMap) {
        if (!localMap || !localMap.data) return;
        this._isSyncing = true;

        // Mock network latency
        await new Promise(resolve => setTimeout(resolve, 50));

        if (!this._cloudMap) {
            // First map initialization
            this._cloudMap = {
                ...localMap,
                data: new Int8Array(localMap.data), // Deep copy
                contributors: [robotId],
                timestamp: Date.now()
            };
        } else {
            // Merge logic: Simple Max-Pooling
            // In a real system, we'd use Pose-Graph Optimization or multi-robot SLAM algorithms
            this._mergeMaps(localMap);
            if (!this._cloudMap.contributors.includes(robotId)) {
                this._cloudMap.contributors.push(robotId);
            }
            this._cloudMap.timestamp = Date.now();
        }

        this._isSyncing = false;
        this._notify();
    }

    /**
     * getGlobalMap()
     * Retrieves the current merged global map.
     */
    getGlobalMap() {
        return this._cloudMap;
    }

    /**
     * _mergeMaps(incoming)
     * Merges incoming map data into the global cloud map.
     */
    _mergeMaps(incoming) {
        // Ensure dimensions match. In production, we'd handle resizing/offsetting.
        if (incoming.width !== this._cloudMap.width || incoming.height !== this._cloudMap.height) {
            console.warn('[SyncService] Map dimension mismatch. Skipping merge.');
            return;
        }

        const cloudData = this._cloudMap.data;
        const incomingData = incoming.data;

        for (let i = 0; i < cloudData.length; i++) {
            // ROS OccupancyGrid: -1: Unknown, 0: Free, 100: Occupied
            const c = cloudData[i];
            const v = incomingData[i];

            if (v === -1) continue; // Skip unknown
            if (c === -1 || (v > c)) {
                cloudData[i] = v;
            }
        }
    }

    onUpdate(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }

    _notify() {
        this._listeners.forEach(cb => cb(this._cloudMap));
    }
}

const syncService = new SyncService();
export default syncService;
export { syncService };
