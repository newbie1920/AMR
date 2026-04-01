/**
 * dwaPlanner.js (Refactored - Plugin-based)
 * ========================================
 * Dynamic Window Approach with Critic Plugins — Thay thế Nav2 DWB
 * 
 * Mỗi "Critic" là một hàm thành phần chấm điểm trajectoy.
 * Tổng điểm = Σ (weight_i * score_i)
 */

import { COST_LETHAL } from '../costmap';

// ─── Critics (Plugins) ──────────────────────────────────────────────────────

class GoalDistCritic {
    constructor(weight = 0.2) { this.weight = weight; }
    score(traj, context) {
        const { goal } = context;
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
        // Search for the closest point on the path
        for (let i = 0; i < path.length; i++) {
            const d = Math.hypot(path[i].x - end.x, path[i].y - end.y);
            if (d < minDist) minDist = d;
        }
        // Normalize: score 1.0 if perfectly on path, 0.0 if > 0.5m away
        return Math.max(0, 1.0 - minDist / 0.5);
    }
}

class PathAlignCritic {
    constructor(weight = 0.2) { this.weight = weight; }
    score(traj, context) {
        const { targetWp } = context;
        const end = traj[traj.length - 1];
        const start = traj[0];
        const desiredAngle = Math.atan2(targetWp.y - start.y, targetWp.x - start.x);
        const headingError = Math.abs(this._angleDiff(end.theta, desiredAngle));
        return 1.0 - headingError / Math.PI;
    }
    _angleDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }
}

class ObstacleCritic {
    constructor(weight = 0.3) { this.weight = weight; }
    score(traj, context) {
        const { costmap, robotRadius, footprintPadding } = context;
        let minClearance = 1.0;
        const r = robotRadius + footprintPadding;

        for (const pt of traj) {
            const cost = costmap.getCost(pt.x, pt.y);

            // COST_LETHAL is 254. COST_UNKNOWN is 255.
            // We only block if it's explicitly lethal.
            if (cost >= 254 && cost < 255) return -100; // Collision with known obstacle

            // Treat UNKNOWN (255) as navigable for now, but slightly less desirable
            // than clear space (0).
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
        return v / maxLinearVel;
    }
}

// ─── Planner ────────────────────────────────────────────────────────────────

const DEFAULTS = {
    maxLinearVel: 0.85, // Significant increase for straight lines
    minLinearVel: 0.0,
    maxAngularVel: 0.6, // Tăng lên 0.6 để ôm cua tốt, không lạng
    minAngularVel: -0.6,
    maxLinearAcc: 0.8,  // Allow faster takeoff
    maxAngularAcc: 1.2, // Tăng tốc tối đa khi xoay, giúp xe quay nhanh và không trễ khúc cua
    simTime: 1.5,
    dt: 0.1,
    vSamples: 15,
    wSamples: 21,
    robotRadius: 0.22,
    footprintPadding: 0.02,
    goalTolerance: 0.15,
};

class DWAPlanner {
    constructor(params = {}) {
        this._p = { ...DEFAULTS, ...params };
        this._critics = [
            new PathDistCritic(0.5),
            new GoalDistCritic(0.2),
            new PathAlignCritic(0.2),
            new ObstacleCritic(0.3),
            new VelocityCritic(0.35) // Increased weight to prioritize reaching max linear speed
        ];
    }

    /**
     * updateParams(params) — Update planner parameters at runtime from the app UI.
     * Only updates keys that exist in DEFAULTS to avoid injecting invalid params.
     */
    updateParams(params) {
        for (const key of Object.keys(DEFAULTS)) {
            if (params[key] !== undefined) {
                this._p[key] = params[key];
            }
        }
        // Mirror minAngularVel to negative of maxAngularVel
        if (params.maxAngularVel !== undefined) {
            this._p.minAngularVel = -this._p.maxAngularVel;
        }
        console.log('[DWAPlanner] Params updated:', this._p);
    }

    /** Get current params for UI display */
    getParams() { return { ...this._p }; }

    computeVelocity(pose, velocity, path, costmap) {
        if (!path || path.length === 0) return { linear: 0, angular: 0 };
        const goal = path[path.length - 1];
        const distToGoal = Math.hypot(goal.x - pose.x, goal.y - pose.y);
        if (distToGoal < this._p.goalTolerance) return { linear: 0, angular: 0 };

        const targetWp = this._getLookahead(pose, path);
        const { vMin, vMax, wMin, wMax } = this._getDynamicWindow(velocity);

        let bestScore = -Infinity;
        let bestCmd = null;

        const vStep = (vMax - vMin) / Math.max(1, this._p.vSamples - 1);
        const wStep = (wMax - wMin) / Math.max(1, this._p.wSamples - 1);

        const context = {
            goal, targetWp, costmap, path,
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
                    if (s < 0) { valid = false; break; } // Hard failure (collision)
                    totalScore += s * critic.weight;
                }

                if (valid && totalScore > bestScore) {
                    bestScore = totalScore;
                    bestCmd = { linear: v, angular: w };
                }
            }
        }

        if (!bestCmd) return { linear: 0, angular: this._rotateToward(pose, targetWp) };
        return bestCmd;
    }

    _getDynamicWindow(v) {
        // We decouple the dynamic window from the extremely tight dt * acc bound.
        // If we strictly bound vMax = v.linear + acc * dt, and dt=0.1, vMax might be 0.05.
        // If the firmware ignores 0.05 due to deadbands, the robot never moves and v.linear stays 0.
        // Instead, we allow the planner to pick from the full allowed velocity range,
        // and rely on navController.smoothVelocity() to ramp it up smoothly.
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

export default DWAPlanner;
export { DWAPlanner, GoalDistCritic, PathAlignCritic, PathDistCritic, ObstacleCritic, VelocityCritic };
