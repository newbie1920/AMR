/**
 * lifecycleManager.js
 * ===================
 * Node Lifecycle Management — thay thế lifecycle_msgs / lifecycle_node (ROS2)
 *
 * Manages lifecycle states for system modules:
 *   UNCONFIGURED → INACTIVE → ACTIVE → FINALIZED
 *
 * Transitions:
 *   configure()   : UNCONFIGURED → INACTIVE
 *   activate()    : INACTIVE → ACTIVE
 *   deactivate()  : ACTIVE → INACTIVE
 *   cleanup()     : INACTIVE → UNCONFIGURED
 *   shutdown()    : ANY → FINALIZED
 *   errorRecovery : ERROR → UNCONFIGURED (auto)
 *
 * USAGE:
 *   import lifecycleManager, { LIFECYCLE_STATE } from './lifecycleManager';
 *
 *   lifecycleManager.registerNode('slam', {
 *       onConfigure: async () => { ... },
 *       onActivate: async () => { ... },
 *       onDeactivate: async () => { ... },
 *       onCleanup: async () => { ... },
 *       onShutdown: async () => { ... },
 *   });
 *
 *   await lifecycleManager.transition('slam', 'configure');
 */

export const LIFECYCLE_STATE = {
    UNCONFIGURED: 'UNCONFIGURED',
    INACTIVE: 'INACTIVE',
    ACTIVE: 'ACTIVE',
    FINALIZED: 'FINALIZED',
    ERROR: 'ERROR',
    TRANSITIONING: 'TRANSITIONING',
};

export const LIFECYCLE_TRANSITIONS = {
    configure: { from: LIFECYCLE_STATE.UNCONFIGURED, to: LIFECYCLE_STATE.INACTIVE },
    activate: { from: LIFECYCLE_STATE.INACTIVE, to: LIFECYCLE_STATE.ACTIVE },
    deactivate: { from: LIFECYCLE_STATE.ACTIVE, to: LIFECYCLE_STATE.INACTIVE },
    cleanup: { from: LIFECYCLE_STATE.INACTIVE, to: LIFECYCLE_STATE.UNCONFIGURED },
    shutdown: { from: '*', to: LIFECYCLE_STATE.FINALIZED },
};

// ─── Node Entry ──────────────────────────────────────────────────────────────
class LifecycleNode {
    constructor(name, callbacks = {}) {
        this.name = name;
        this.state = LIFECYCLE_STATE.UNCONFIGURED;
        this.previousState = null;
        this.lastTransition = null;
        this.lastTransitionTime = null;
        this.errorMessage = null;
        this.transitionHistory = [];
        this.maxHistory = 30;

        // Callbacks
        this.onConfigure = callbacks.onConfigure || (async () => { });
        this.onActivate = callbacks.onActivate || (async () => { });
        this.onDeactivate = callbacks.onDeactivate || (async () => { });
        this.onCleanup = callbacks.onCleanup || (async () => { });
        this.onShutdown = callbacks.onShutdown || (async () => { });
        this.onError = callbacks.onError || (async () => { });
    }

    recordTransition(from, to, transition) {
        this.previousState = from;
        this.state = to;
        this.lastTransition = transition;
        this.lastTransitionTime = Date.now();
        this.transitionHistory.push({
            from, to, transition,
            timestamp: Date.now(),
        });
        if (this.transitionHistory.length > this.maxHistory) {
            this.transitionHistory.shift();
        }
    }

    getAvailableTransitions() {
        const available = [];
        for (const [name, { from }] of Object.entries(LIFECYCLE_TRANSITIONS)) {
            if (from === '*' || from === this.state) {
                available.push(name);
            }
        }
        return available;
    }
}

// ─── Lifecycle Manager ───────────────────────────────────────────────────────
class LifecycleManager {
    constructor() {
        /** @type {Map<string, LifecycleNode>} */
        this._nodes = new Map();
        this._listeners = [];
        this._autoRecoveryEnabled = true;
        this._autoRecoveryDelay = 3000;
    }

    /**
     * Register a node with lifecycle management.
     */
    registerNode(name, callbacks = {}) {
        if (this._nodes.has(name)) {
            console.warn(`[LifecycleManager] Node '${name}' already registered. Overwriting.`);
        }
        this._nodes.set(name, new LifecycleNode(name, callbacks));
        this._notify();
        console.log(`[LifecycleManager] Node '${name}' registered (UNCONFIGURED).`);
    }

    /**
     * Unregister a node.
     */
    unregisterNode(name) {
        this._nodes.delete(name);
        this._notify();
    }

    /**
     * Perform a lifecycle transition.
     * Tương đương: ros2 lifecycle set <node> <transition>
     */
    async transition(nodeName, transitionName) {
        const node = this._nodes.get(nodeName);
        if (!node) throw new Error(`Node '${nodeName}' not registered.`);

        const trans = LIFECYCLE_TRANSITIONS[transitionName];
        if (!trans) throw new Error(`Unknown transition '${transitionName}'.`);

        // Validate current state
        if (trans.from !== '*' && node.state !== trans.from) {
            throw new Error(
                `Cannot '${transitionName}' node '${nodeName}': ` +
                `expected state '${trans.from}', got '${node.state}'.`
            );
        }

        const prevState = node.state;
        node.state = LIFECYCLE_STATE.TRANSITIONING;
        node.errorMessage = null;
        this._notify();

        try {
            // Execute the transition callback
            switch (transitionName) {
                case 'configure': await node.onConfigure(); break;
                case 'activate': await node.onActivate(); break;
                case 'deactivate': await node.onDeactivate(); break;
                case 'cleanup': await node.onCleanup(); break;
                case 'shutdown': await node.onShutdown(); break;
            }

            node.recordTransition(prevState, trans.to, transitionName);
            console.log(`[LifecycleManager] ${nodeName}: ${prevState} → ${trans.to} (${transitionName})`);
        } catch (err) {
            node.state = LIFECYCLE_STATE.ERROR;
            node.errorMessage = err.message;
            node.recordTransition(prevState, LIFECYCLE_STATE.ERROR, `${transitionName} (FAILED)`);
            console.error(`[LifecycleManager] ${nodeName}: Transition '${transitionName}' failed:`, err.message);

            // Auto-recovery
            if (this._autoRecoveryEnabled) {
                setTimeout(() => this._autoRecover(nodeName), this._autoRecoveryDelay);
            }
        }

        this._notify();
    }

    async _autoRecover(nodeName) {
        const node = this._nodes.get(nodeName);
        if (!node || node.state !== LIFECYCLE_STATE.ERROR) return;

        console.log(`[LifecycleManager] Auto-recovering '${nodeName}'...`);
        try {
            await node.onError();
            node.recordTransition(LIFECYCLE_STATE.ERROR, LIFECYCLE_STATE.UNCONFIGURED, 'auto_recovery');
            this._notify();
        } catch (err) {
            console.error(`[LifecycleManager] Auto-recovery failed for '${nodeName}':`, err.message);
        }
    }

    /**
     * Activate all registered nodes (configure → activate).
     */
    async activateAll() {
        for (const [name, node] of this._nodes) {
            try {
                if (node.state === LIFECYCLE_STATE.UNCONFIGURED) {
                    await this.transition(name, 'configure');
                }
                if (node.state === LIFECYCLE_STATE.INACTIVE) {
                    await this.transition(name, 'activate');
                }
            } catch (err) {
                console.error(`[LifecycleManager] Failed to activate '${name}':`, err.message);
            }
        }
    }

    /**
     * Shutdown all nodes.
     */
    async shutdownAll() {
        for (const [name] of this._nodes) {
            try {
                await this.transition(name, 'shutdown');
            } catch (_) { }
        }
    }

    // ─── Introspection ───────────────────────────────────────────────────────

    /**
     * Get state of a node.
     * Tương đương: ros2 lifecycle get <node>
     */
    getNodeState(nodeName) {
        const node = this._nodes.get(nodeName);
        if (!node) return null;
        return {
            name: node.name,
            state: node.state,
            previousState: node.previousState,
            lastTransition: node.lastTransition,
            lastTransitionTime: node.lastTransitionTime,
            errorMessage: node.errorMessage,
            availableTransitions: node.getAvailableTransitions(),
            transitionHistory: node.transitionHistory,
        };
    }

    /**
     * List all nodes and their states.
     * Tương đương: ros2 lifecycle nodes
     */
    listNodes() {
        const result = [];
        for (const [name, node] of this._nodes) {
            result.push({
                name,
                state: node.state,
                previousState: node.previousState,
                lastTransition: node.lastTransition,
                lastTransitionTime: node.lastTransitionTime,
                errorMessage: node.errorMessage,
                availableTransitions: node.getAvailableTransitions(),
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    // ─── Config ──────────────────────────────────────────────────────────────

    setAutoRecovery(enabled, delayMs = 3000) {
        this._autoRecoveryEnabled = enabled;
        this._autoRecoveryDelay = delayMs;
    }

    // ─── Listeners ───────────────────────────────────────────────────────────
    onChange(callback) {
        this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter(cb => cb !== callback); };
    }

    _notify() {
        const nodes = this.listNodes();
        for (const cb of this._listeners) {
            try { cb(nodes); } catch (_) { }
        }
    }

    destroy() {
        this._nodes.clear();
        this._listeners = [];
    }
}

const lifecycleManager = new LifecycleManager();
export default lifecycleManager;
export { LifecycleManager };
