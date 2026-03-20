/**
 * serviceManager.js
 * =================
 * Service Request/Reply System — thay thế rclcpp::Service<> / rclcpp::Client<>
 *
 * USAGE:
 *   import serviceManager from './serviceManager';
 *
 *   // Server side
 *   serviceManager.createService('/save_map', async (req) => {
 *       await slam.saveMap(req.filename);
 *       return { success: true };
 *   });
 *
 *   // Client side
 *   const result = await serviceManager.callService('/save_map', { filename: 'map1' });
 */

// ─── Service Entry ───────────────────────────────────────────────────────────
class ServiceEntry {
    constructor(name, handler) {
        this.name = name;
        this.handler = handler;
        this.callCount = 0;
        this.avgResponseMs = 0;
        this._totalMs = 0;
        this.lastCallTime = 0;
        this.isActive = true;
    }

    recordCall(ms) {
        this.callCount++;
        this._totalMs += ms;
        this.avgResponseMs = Math.round(this._totalMs / this.callCount * 100) / 100;
        this.lastCallTime = Date.now();
    }
}

// ─── Service Manager ─────────────────────────────────────────────────────────
class ServiceManager {
    constructor() {
        /** @type {Map<string, ServiceEntry>} */
        this._services = new Map();
        this._listeners = [];
    }

    /**
     * Create a service server.
     * Tương đương: rclcpp::Node::create_service<T>(name, handler)
     */
    createService(serviceName, handler) {
        if (this._services.has(serviceName)) {
            console.warn(`[ServiceManager] Service '${serviceName}' already exists. Overwriting.`);
        }
        this._services.set(serviceName, new ServiceEntry(serviceName, handler));
        this._notifyListeners();
        console.log(`[ServiceManager] Service '${serviceName}' created.`);
    }

    /**
     * Remove a service server.
     */
    removeService(serviceName) {
        this._services.delete(serviceName);
        this._notifyListeners();
    }

    /**
     * Call a service (as client).
     * Tương đương: client->async_send_request(request)
     * 
     * @param {string} serviceName
     * @param {Object} request
     * @param {number} timeoutMs - Timeout in ms (default 5000)
     * @returns {Promise<Object>} Response
     */
    async callService(serviceName, request = {}, timeoutMs = 5000) {
        const entry = this._services.get(serviceName);
        if (!entry || !entry.isActive) {
            throw new Error(`Service '${serviceName}' not available.`);
        }

        const startTime = performance.now();

        // Race between handler and timeout
        const result = await Promise.race([
            entry.handler(request),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Service '${serviceName}' timed out (${timeoutMs}ms)`)), timeoutMs)
            ),
        ]);

        entry.recordCall(performance.now() - startTime);
        return result;
    }

    /**
     * Check if a service exists and is ready.
     * Tương đương: client->wait_for_service()
     */
    serviceExists(serviceName) {
        const entry = this._services.get(serviceName);
        return entry?.isActive || false;
    }

    /**
     * Wait for a service to become available.
     */
    async waitForService(serviceName, timeoutMs = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (this.serviceExists(serviceName)) return true;
            await new Promise(r => setTimeout(r, 100));
        }
        return false;
    }

    /**
     * List all services.
     * Tương đương: ros2 service list
     */
    listServices() {
        const result = [];
        for (const [name, entry] of this._services) {
            result.push({
                name,
                isActive: entry.isActive,
                callCount: entry.callCount,
                avgResponseMs: entry.avgResponseMs,
                lastCallTime: entry.lastCallTime,
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get info about a specific service.
     * Tương đương: ros2 service type <name>
     */
    getServiceInfo(serviceName) {
        const entry = this._services.get(serviceName);
        if (!entry) return null;
        return {
            name: entry.name,
            isActive: entry.isActive,
            callCount: entry.callCount,
            avgResponseMs: entry.avgResponseMs,
            lastCallTime: entry.lastCallTime,
        };
    }

    onListChange(callback) {
        this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter(cb => cb !== callback); };
    }

    _notifyListeners() {
        const list = this.listServices();
        for (const cb of this._listeners) {
            try { cb(list); } catch (_) { }
        }
    }

    destroy() {
        this._services.clear();
        this._listeners = [];
    }
}

const serviceManager = new ServiceManager();
export default serviceManager;
export { ServiceManager };
