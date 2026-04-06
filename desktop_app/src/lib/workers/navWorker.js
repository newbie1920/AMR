/**
 * navWorker.js
 * ============
 * Web Worker — DWA Local Planner + Control Loop
 *
 * Chạy DWA local planner ở tần số cao (e.g., 20Hz), tách biệt hoàn toàn khỏi UI thread.
 * Nhận state từ main thread, trả về Twist command (linear, angular)
 *
 * Protocol:
 *   IN:  { type: 'config', params: { ...DWA_DEFAULTS } }
 *   IN:  { type: 'state', pose, velocity, path, costmapData, costmapMeta }
 *   OUT: { type: 'cmd_vel', linear, angular }
 *   OUT: { type: 'debug', trajectory: [{x,y}, ...] }
 */

// ─── Inline DWAPlanner ───────────────────────────────────────────────────────

class GoalDistCritic {
    constructor(weight = 0.2) { this.weight = weight; }
    score(traj, context) {
        const { goal } = context;
        if (!goal) return 0;
        const end = traj[traj.length - 1];
        const dist = Math.hypot(goal.x - end.x, goal.y - end.y);
        return Math.max(0, 1 - dist / 5.0); // Normalize by 5m
    }
}

class PathDistCritic {
    constructor(weight = 0.5) { this.weight = weight; }
    score(traj, context) {
        const { path } = context;
        if (!path || path.length === 0) return 0;
        const end = traj[traj.length - 1];
        let minDist = Infinity;
        for (let i = 0; i < path.length; i++) {
            const d = Math.hypot(path[i].x - end.x, path[i].y - end.y);
            if (d < minDist) minDist = d;
        }
        return Math.max(0, 1.0 - minDist / 0.5);
    }
}

class PathAlignCritic {
    constructor(weight = 0.2) { this.weight = weight; }
    score(traj, context) {
        const { targetWp, v } = context;
        if (!targetWp) return 0;
        const end = traj[traj.length - 1];
        const start = traj[0];
        const desiredAngle = Math.atan2(targetWp.y - start.y, targetWp.x - start.x);
        
        let currentHeading = end.theta;
        // If moving backwards, use the back of the robot for alignment
        if (v < -0.01) {
            currentHeading += Math.PI;
        }

        let d = currentHeading - desiredAngle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        
        const headingError = Math.abs(d);
        return 1.0 - headingError / Math.PI;
    }
}

class ObstacleCritic {
    constructor(weight = 0.3) { this.weight = weight; }
    score(traj, context) {
        const { costmapData, meta, robotRadius, footprintPadding } = context;
        if (!costmapData) return 1.0;
        
        let minClearance = 1.0;
        const grid = new Uint8Array(costmapData);
        
        // Skip index 0 (current pose) to avoid deadlock if current position is noisy
        for (let i = 1; i < traj.length; i++) {
            const pt = traj[i];
            // Get cost
            const cx = Math.floor((pt.x - meta.origin.x) / meta.resolution);
            const cy = Math.floor((pt.y - meta.origin.y) / meta.resolution);
            let cost = 0;
            if (cx >= 0 && cx < meta.width && cy >= 0 && cy < meta.height) {
                cost = grid[cy * meta.width + cx];
            } else {
                cost = 255; // UNKNOWN out of bounds
            }
            if (cost >= 254 && cost < 255) return -100; // Hard collision
            
            const normalizedCost = (cost === 255) ? 128 : cost;
            const clearance = 1.0 - normalizedCost / 254;
            minClearance = Math.min(minClearance, clearance);
        }
        return minClearance;
    }
}

class VelocityCritic {
    constructor(weight = 0.1) { this.weight = weight; }
    score(traj, context) {
        const { v, maxLinearVel } = context;
        const absV = Math.abs(v);
        // Reward high velocity, slightly penalize reversing to favor forward motion
        return (v >= 0) ? (absV / maxLinearVel) : (absV / maxLinearVel * 0.8);
    }
}

const DEFAULTS = {
    maxLinearVel: 0.85,
    minLinearVel: -0.2, // 🚀 Bật lùi xe trong Worker
    maxAngularVel: 0.6,
    minAngularVel: -0.6,
    maxLinearAcc: 0.8,
    maxAngularAcc: 1.2,
    simTime: 1.5,
    dt: 0.1,
    vSamples: 15,
    wSamples: 21,
    robotRadius: 0.22,
    footprintPadding: 0.05,
    goalTolerance: 0.15,
};

class WorkerDWAPlanner {
    constructor(params = {}) {
        this._p = { ...DEFAULTS, ...params };
        this._critics = [
            new PathDistCritic(0.5),
            new GoalDistCritic(0.2),
            new PathAlignCritic(0.2),
            new ObstacleCritic(0.3),
            new VelocityCritic(0.1)
        ];
    }

    updateParams(params) {
        for (const key of Object.keys(DEFAULTS)) {
            if (params[key] !== undefined) {
                this._p[key] = params[key];
            }
        }
        if (params.maxAngularVel !== undefined) {
            this._p.minAngularVel = -this._p.maxAngularVel;
        }
    }

    computeVelocity(pose, velocity, path, costmapData, costmapMeta) {
        if (!path || path.length === 0) return { cmd: { linear: 0, angular: 0 }, bestTraj: [] };
        
        const goal = path[path.length - 1];
        const distToGoal = Math.hypot(goal.x - pose.x, goal.y - pose.y);
        if (distToGoal < this._p.goalTolerance) return { cmd: { linear: 0, angular: 0 }, bestTraj: [] };

        const targetWp = this._getLookahead(pose, path);
        const { vMin, vMax, wMin, wMax } = this._getDynamicWindow(velocity);

        let bestScore = -Infinity;
        let bestCmd = null;
        let bestTraj = [];

        const vStep = (vMax - vMin) / Math.max(1, this._p.vSamples - 1);
        const wStep = (wMax - wMin) / Math.max(1, this._p.wSamples - 1);

        const context = {
            goal, targetWp, costmapData, meta: costmapMeta, path,
            robotRadius: this._p.robotRadius,
            footprintPadding: this._p.footprintPadding,
            maxLinearVel: this._p.maxLinearVel
        };

        for (let vi = 0; vi < this._p.vSamples; vi++) {
            const v = vMin + vi * vStep;
            for (let wi = 0; wi < this._p.wSamples; wi++) {
                const w = wMin + wi * wStep;
                const traj = this._simulate(pose, v, w);

                context.v = v;
                context.w = w;

                let totalScore = 0;
                let valid = true;
                for (const critic of this._critics) {
                    const s = critic.score(traj, context);
                    if (s < 0) { valid = false; break; }
                    totalScore += s * critic.weight;
                }

                if (valid && totalScore > bestScore) {
                    bestScore = totalScore;
                    bestCmd = { linear: v, angular: w };
                    bestTraj = traj;
                }
            }
        }

        if (!bestCmd) {
            const backupW = this._rotateToward(pose, targetWp);
            return { cmd: { linear: 0, angular: backupW }, bestTraj: this._simulate(pose, 0, backupW) };
        }
        
        return { cmd: bestCmd, bestTraj };
    }

    _getDynamicWindow(v) {
        // Decouple the dynamic window from the extremely tight dt * acc bound,
        // similar to what was fixed in dwaPlanner.js.
        // We allow the planner to pick from the full allowed velocity range,
        // and rely on navController.smoothVelocity() to ramp it up.
        return {
            vMin: this._p.minLinearVel,
            vMax: this._p.maxLinearVel,
            wMin: this._p.minAngularVel,
            wMax: this._p.maxAngularVel
        };
    }

    _getLookahead(pose, path) {
        let minDist = Infinity, minI = 0;
        for (let i = 0; i < path.length; i++) {
            const d = Math.hypot(path[i].x - pose.x, path[i].y - pose.y);
            if (d < minDist) { minDist = d; minI = i; }
        }
        let dist = 0, lookDist = 0.5;
        for (let i = minI; i < path.length - 1; i++) {
            dist += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
            if (dist >= lookDist) return path[i + 1];
        }
        return path[path.length - 1];
    }

    _simulate(pose, v, w) {
        const { simTime, dt } = this._p;
        const steps = Math.ceil(simTime / dt);
        const traj = [];
        let { x, y, theta } = pose;
        for (let i = 0; i < steps; i++) {
            if (Math.abs(w) > 1e-6) {
                const r = v / w;
                x += r * (Math.sin(theta + w * dt) - Math.sin(theta));
                y += r * (Math.cos(theta) - Math.cos(theta + w * dt));
            } else {
                x += v * Math.cos(theta) * dt;
                y += v * Math.sin(theta) * dt;
            }
            theta += w * dt;
            traj.push({ x, y, theta });
        }
        return traj;
    }

    _rotateToward(pose, target) {
        const desiredAngle = Math.atan2(target.y - pose.y, target.x - pose.x);
        let diff = desiredAngle - pose.theta;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        return Math.sign(diff) * Math.min(Math.abs(diff), this._p.maxAngularVel * 0.5);
    }
}

// ─── Worker State ────────────────────────────────────────────────────────────

const planner = new WorkerDWAPlanner();

self.onmessage = function (e) {
    const msg = e.data;

    switch (msg.type) {
        case 'config':
            planner.updateParams(msg.params);
            break;
            
        case 'state':
            // Run DWA local planning
            const start = performance.now();
            const { cmd, bestTraj } = planner.computeVelocity(
                msg.pose,
                msg.velocity,
                msg.path,
                msg.costmapData,
                msg.costmapMeta
            );
            const elapsed = performance.now() - start;

            // Output command
            self.postMessage({ type: 'cmd_vel', linear: cmd.linear, angular: cmd.angular, dt: elapsed });
            
            // Output debug trajectory if needed
            self.postMessage({ type: 'debug', trajectory: bestTraj });
            break;
    }
};

self.postMessage({ type: 'ready' });
