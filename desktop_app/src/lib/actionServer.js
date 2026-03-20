/**
 * actionServer.js
 * ===============
 * Action Server/Client — thay thế rclcpp_action::Server / rclcpp_action::Client
 *
 * Long-running action pattern with Goal → Feedback → Result lifecycle.
 *
 * USAGE:
 *   import actionManager, { ACTION_STATUS } from './actionServer';
 *
 *   // Server: Define action
 *   actionManager.createAction('NavigateToPose', async (goal, feedback, cancelToken) => {
 *       for (let i = 0; i < 100; i++) {
 *           if (cancelToken.cancelled) throw new Error('Cancelled');
 *           feedback({ progress: i / 100 });
 *           await sleep(100);
 *       }
 *       return { success: true };
 *   });
 *
 *   // Client: Send goal
 *   const handle = actionManager.sendGoal('NavigateToPose', { x: 1, y: 2, theta: 0 });
 *   handle.onFeedback((fb) => console.log(fb.progress));
 *   const result = await handle.result;
 */

export const ACTION_STATUS = {
    PENDING: 'PENDING',
    EXECUTING: 'EXECUTING',
    CANCELING: 'CANCELING',
    SUCCEEDED: 'SUCCEEDED',
    CANCELED: 'CANCELED',
    ABORTED: 'ABORTED',
};

// ─── Cancel Token ────────────────────────────────────────────────────────────
class CancelToken {
    constructor() {
        this.cancelled = false;
        this._callbacks = [];
    }
    cancel() {
        this.cancelled = true;
        this._callbacks.forEach(cb => cb());
    }
    onCancel(cb) { this._callbacks.push(cb); }
}

// ─── Goal Handle ─────────────────────────────────────────────────────────────
class GoalHandle {
    constructor(goalId, actionName, goal) {
        this.goalId = goalId;
        this.actionName = actionName;
        this.goal = goal;
        this.status = ACTION_STATUS.PENDING;
        this.feedback = null;
        this.startTime = Date.now();
        this.endTime = null;

        this._feedbackCallbacks = [];
        this._statusCallbacks = [];
        this._cancelToken = new CancelToken();
        this._resultPromise = null;
        this._resolveResult = null;
        this._rejectResult = null;

        this.result = new Promise((resolve, reject) => {
            this._resolveResult = resolve;
            this._rejectResult = reject;
        });
    }

    onFeedback(cb) {
        this._feedbackCallbacks.push(cb);
        return this; // chainable
    }

    onStatusChange(cb) {
        this._statusCallbacks.push(cb);
        return this; // chainable
    }

    cancel() {
        if (this.status === ACTION_STATUS.EXECUTING || this.status === ACTION_STATUS.PENDING) {
            this.status = ACTION_STATUS.CANCELING;
            this._cancelToken.cancel();
            this._notifyStatus();
        }
    }

    get elapsed() { return (this.endTime || Date.now()) - this.startTime; }
    get isActive() {
        return this.status === ACTION_STATUS.PENDING || this.status === ACTION_STATUS.EXECUTING;
    }

    // Internal
    _setStatus(status) {
        this.status = status;
        if (status === ACTION_STATUS.SUCCEEDED || status === ACTION_STATUS.CANCELED || status === ACTION_STATUS.ABORTED) {
            this.endTime = Date.now();
        }
        this._notifyStatus();
    }

    _emitFeedback(fb) {
        this.feedback = fb;
        for (const cb of this._feedbackCallbacks) {
            try { cb(fb); } catch (_) { }
        }
    }

    _notifyStatus() {
        for (const cb of this._statusCallbacks) {
            try { cb(this.status, this); } catch (_) { }
        }
    }
}

// ─── Action Entry ────────────────────────────────────────────────────────────
class ActionEntry {
    constructor(name, executeFn) {
        this.name = name;
        this.executeFn = executeFn;
        this.activeGoals = new Map(); // goalId -> GoalHandle
        this.completedGoals = [];
        this.maxHistory = 20;
    }

    archiveGoal(handle) {
        this.completedGoals.push({
            goalId: handle.goalId,
            status: handle.status,
            elapsed: handle.elapsed,
            startTime: handle.startTime,
            endTime: handle.endTime,
        });
        if (this.completedGoals.length > this.maxHistory) {
            this.completedGoals.shift();
        }
        this.activeGoals.delete(handle.goalId);
    }
}

// ─── Action Manager ──────────────────────────────────────────────────────────
class ActionManager {
    constructor() {
        /** @type {Map<string, ActionEntry>} */
        this._actions = new Map();
        this._goalIdCounter = 0;
        this._listeners = [];
    }

    /**
     * Create an action server.
     * Tương đương: rclcpp_action::create_server<T>(node, name, handle_goal, handle_cancel, handle_accepted)
     *
     * @param {string} actionName
     * @param {Function} executeFn - async (goal, feedbackFn, cancelToken) => result
     */
    createAction(actionName, executeFn) {
        this._actions.set(actionName, new ActionEntry(actionName, executeFn));
        this._notifyListeners();
        console.log(`[ActionManager] Action '${actionName}' registered.`);
    }

    /**
     * Remove an action server.
     */
    removeAction(actionName) {
        const entry = this._actions.get(actionName);
        if (entry) {
            // Cancel all active goals
            for (const handle of entry.activeGoals.values()) {
                handle.cancel();
            }
        }
        this._actions.delete(actionName);
        this._notifyListeners();
    }

    /**
     * Send a goal to an action.
     * Tương đương: action_client->send_goal(goal)
     *
     * @returns {GoalHandle}
     */
    sendGoal(actionName, goal = {}) {
        const entry = this._actions.get(actionName);
        if (!entry) {
            throw new Error(`Action '${actionName}' not registered.`);
        }

        const goalId = `goal_${++this._goalIdCounter}_${Date.now()}`;
        const handle = new GoalHandle(goalId, actionName, goal);
        entry.activeGoals.set(goalId, handle);

        // Start execution asynchronously
        handle._setStatus(ACTION_STATUS.EXECUTING);
        this._executeGoal(entry, handle);
        this._notifyListeners();

        return handle;
    }

    async _executeGoal(entry, handle) {
        const feedbackFn = (fb) => handle._emitFeedback(fb);

        try {
            const result = await entry.executeFn(handle.goal, feedbackFn, handle._cancelToken);

            if (handle._cancelToken.cancelled) {
                handle._setStatus(ACTION_STATUS.CANCELED);
                handle._resolveResult({ status: ACTION_STATUS.CANCELED, result: null });
            } else {
                handle._setStatus(ACTION_STATUS.SUCCEEDED);
                handle._resolveResult({ status: ACTION_STATUS.SUCCEEDED, result });
            }
        } catch (err) {
            if (handle._cancelToken.cancelled) {
                handle._setStatus(ACTION_STATUS.CANCELED);
                handle._resolveResult({ status: ACTION_STATUS.CANCELED, result: null });
            } else {
                handle._setStatus(ACTION_STATUS.ABORTED);
                handle._rejectResult(err);
            }
        }

        entry.archiveGoal(handle);
        this._notifyListeners();
    }

    /**
     * Cancel a running goal.
     */
    cancelGoal(actionName, goalId) {
        const entry = this._actions.get(actionName);
        if (!entry) return false;
        const handle = entry.activeGoals.get(goalId);
        if (!handle) return false;
        handle.cancel();
        return true;
    }

    /**
     * List all registered actions.
     * Tương đương: ros2 action list
     */
    listActions() {
        const result = [];
        for (const [name, entry] of this._actions) {
            result.push({
                name,
                activeGoals: entry.activeGoals.size,
                completedGoals: entry.completedGoals.length,
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get active goals for an action.
     */
    getActiveGoals(actionName) {
        const entry = this._actions.get(actionName);
        if (!entry) return [];
        return [...entry.activeGoals.values()].map(h => ({
            goalId: h.goalId,
            status: h.status,
            elapsed: h.elapsed,
            feedback: h.feedback,
        }));
    }

    /**
     * Get goal history for an action.
     */
    getGoalHistory(actionName) {
        const entry = this._actions.get(actionName);
        return entry ? entry.completedGoals : [];
    }

    onListChange(callback) {
        this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter(cb => cb !== callback); };
    }

    _notifyListeners() {
        const list = this.listActions();
        for (const cb of this._listeners) {
            try { cb(list); } catch (_) { }
        }
    }

    destroy() {
        for (const entry of this._actions.values()) {
            for (const handle of entry.activeGoals.values()) {
                handle.cancel();
            }
        }
        this._actions.clear();
        this._listeners = [];
    }
}

const actionManager = new ActionManager();
export default actionManager;
export { ActionManager, GoalHandle, ACTION_STATUS };
