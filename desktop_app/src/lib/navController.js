/**
 * navController.js
 * ================
 * Navigation Controller — thay thế nav2_bt_navigator + FollowPath + ComputePathToPose
 *
 * Orchestrates toàn bộ navigation stack:
 *   LiDAR scan → Costmap → Global planner → Local planner (DWA) → cmd_vel → Robot
 *
 * State machine (tương đương ROS2 Nav2 BehaviorTree):
 *   IDLE → PLANNING → FOLLOWING → GOAL_REACHED / STUCK / FAILED
 *
 * USAGE:
 *   import navController from './navController';
 *   navController.init();       // Start processing
 *   navController.setGoal({ x: 2.5, y: 1.8, theta: 0 });
 *   navController.onState(({ state, pose }) => console.log(state));
 *   navController.cancel();
 */

import robotBridge, { MSG } from './robotBridge';
import LidarDriver from './lidarDriver';
import { Costmap2D } from './costmap';
import { TFTree } from './tfTree';
import GlobalPlanner from './planner/globalPlanner';
import DWAPlanner from './planner/dwaPlanner';
import HectorSlam from './slam/hectorSlam';
import WaypointSequencer from './waypointSequencer';

const CONFIG = {
    cmdVelHz: 10,
    planHz: 2,
    goalTolerance: 0.15,
    yawTolerance: 0.1,
    stuckMinMove: 0.015, // Threshold for movement (meters)
    stuckMinTurn: 0.05,  // Threshold for rotation (radians)
    stuckTimeoutSec: 15, // Give it more time before triggering recovery
    costmapRolling: false // Disabled: Rolling window causes instability in simulation without lidar
};

const NAV_STATE = {
    IDLE: 'IDLE',
    PLANNING: 'PLANNING',
    FOLLOWING: 'FOLLOWING',
    GOAL_REACHED: 'GOAL_REACHED',
    STUCK: 'STUCK',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    NAVIGATING_THROUGH: 'NAVIGATING_THROUGH',
    PAUSED: 'PAUSED',
};

class NavController {
    constructor(robotId = 'robot_1') {
        this._robotId = robotId;
        this._state = NAV_STATE.IDLE;
        this._goal = null;
        this._path = [];
        this._robotPose = { x: 0, y: 0, theta: 0 };
        this._robotVel = { linear: 0, angular: 0 };

        // Instances per robot
        this.tf = new TFTree();
        this.hectorSlam = new HectorSlam();
        this.costmap = new Costmap2D(this.tf);
        this.lidarDriver = new LidarDriver();
        this.globalPlanner = new GlobalPlanner();
        this.dwaPlanner = new DWAPlanner();

        this._listeners = [];
        this._cmdTimer = null;
        this._planTimer = null;
        this._scanUnsub = null;
        this._stuckTimer = null;
        this._stuckLastPos = null;
        this._stuckStartTime = null;
        this._lastStuckTime = null; // For new stuck detection logic
        this._lastStuckPose = null; // For new stuck detection logic

        this._initialized = false;
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        // Nhận telemetry từ robot (pose update)
        robotBridge.subscribe(this._robotId, MSG.TELEM, (msg) => {
            // Mapping keys to match firmware (main.cpp)
            import('../stores/fleetStore').then(module => {
                const robot = module.useFleetStore.getState().robots.find(r => r.id === this._robotId);
                const rotCorr = robot?.config?.rotationCorrection || 1.0;
                
                const theta = msg.h !== undefined ? (msg.h * Math.PI / 180 * rotCorr) : (msg.theta ?? this._robotPose.theta);
                const x = msg.x !== undefined ? -msg.x : (this._robotPose.x ?? 0);
                const y = msg.y !== undefined ? -msg.y : (this._robotPose.y ?? 0);

                this._robotPose = { x, y, theta };
                
                // VELOCITY SIGN FIX: Positions are double-negated (firmware negates, we negate again)
                // to get true world coordinates. Velocities MUST also be negated to match.
                // Without this, DWA thinks +v = forward but firmware interprets +v as backward.
                const linear = msg.v !== undefined ? -msg.v : -(msg.vx ?? 0);
                const angular = msg.w !== undefined ? -msg.w : -(msg.wz ?? 0);
                this._robotVel = { linear, angular };
                this.tf.updateOdom(this._robotPose);

                // Debug log every few frames to avoid console flood
                if (Math.random() < 0.05) {
                    console.debug(`[NavInternal:${this._robotId}] Inbound: h=${msg.h}°, x=${x.toFixed(2)}, y=${y.toFixed(2)}`);
                }
            }).catch(() => {
                const theta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.theta ?? this._robotPose.theta);
                const x = msg.x !== undefined ? -msg.x : (this._robotPose.x ?? 0);
                const y = msg.y !== undefined ? -msg.y : (this._robotPose.y ?? 0);
                
                this._robotPose = { x, y, theta };

                // VELOCITY SIGN FIX (fallback path): same negation as primary path
                const linear = msg.v !== undefined ? -msg.v : -(msg.vx ?? 0);
                const angular = msg.w !== undefined ? -msg.w : -(msg.wz ?? 0);
                this._robotVel = { linear, angular };
                this.tf.updateOdom(this._robotPose);
                
                if (Math.random() < 0.05) {
                    console.debug(`[NavInternal:${this._robotId}] Inbound (Fallback): x=${x.toFixed(2)}, y=${y.toFixed(2)}`);
                }
            });
        });

        // Cập nhật costmap + SLAM từ LiDAR scans
        this._scanUnsub = this.lidarDriver.onScan((scan) => {
            const odomPose = { ...this._robotPose };

            // 1. Run Hector SLAM: scan-to-map matching → corrected pose
            const { pose: slamPose, map: slamMap } = this.hectorSlam.processScan(scan, odomPose);

            // 2. Compute map→odom offset
            const offsetX = slamPose.x - odomPose.x;
            const offsetY = slamPose.y - odomPose.y;
            const offsetTheta = slamPose.theta - odomPose.theta;
            this.tf.updateMapToOdom({ x: offsetX, y: offsetY, theta: offsetTheta });

            // 3. Load SLAM map into costmap static layer
            this._slamMapCount = (this._slamMapCount ?? 0) + 1;
            if (this._slamMapCount % 5 === 0) {
                this.costmap.loadStaticMap(slamMap);
            }

            // 4. Update rolling window + obstacle layer
            const mapPose = this.tf.getMapPose();
            if (CONFIG.costmapRolling) {
                this.costmap.recenter(mapPose.x, mapPose.y);
            }
            this.costmap.updateFromScan(scan, mapPose);
        });

        // TF update
        this.tf.onUpdate(() => { });

        // cmd_vel loop
        this._cmdTimer = setInterval(() => this._cmdLoop(), 1000 / CONFIG.cmdVelHz);

        // Global replan loop
        this._planTimer = setInterval(() => this._planLoop(), 1000 / CONFIG.planHz);

        console.log('[NavController] Initialized.');
    }

    stop() {
        clearInterval(this._cmdTimer);
        clearInterval(this._planTimer);
        clearTimeout(this._stuckTimer);
        if (this._scanUnsub) this._scanUnsub();
        this._initialized = false;
        this._setState(NAV_STATE.IDLE);
        console.log('[NavController] Stopped.');
    }

    shutdown() { this.stop(); }

    // ─── Goal API ──────────────────────────────────────────────────────────────

    /**
     * setGoal({ x, y, theta })
     * Tương đương: NavigateToPose action goal
     */
    setGoal(goal) {
        this._goal = goal;
        this._path = [];
        this._stuckLastPos = { ...this._robotPose };
        this._stuckStartTime = Date.now();
        this._setState(NAV_STATE.PLANNING);
        console.log('[NavController] Goal set:', goal);

        // Immediate replan
        this._planLoop();
    }

    cancel() {
        this._goal = null;
        this._path = [];
        this._throughPoses = [];
        this._throughIndex = 0;
        robotBridge.cmdVel(this._robotId, 0, 0);
        this._setState(NAV_STATE.CANCELLED);
    }

    pause() {
        robotBridge.cmdVel(this._robotId, 0, 0);
        this._setState(NAV_STATE.PAUSED);
        console.log(`[NavController:${this._robotId}] Navigation Paused.`);
    }

    resume() {
        if (this._state !== NAV_STATE.PAUSED) return;
        if (this._goal) {
            this._setState(NAV_STATE.PLANNING);
            console.log(`[NavController:${this._robotId}] Navigation Resumed. Target:`, this._goal);
        } else {
            this._setState(NAV_STATE.IDLE);
        }
    }

    // ─── NavigateThroughPoses ────────────────────────────────────────────────

    /**
     * Navigate through a sequence of poses.
     * Tương đương: NavigateThroughPoses action
     * @param {Array<{x, y, theta}>} poses
     */
    async navigateThroughPoses(poses) {
        if (!poses || poses.length === 0) return;
        this._throughPoses = [...poses];
        this._throughIndex = 0;
        this._setState(NAV_STATE.NAVIGATING_THROUGH);
        console.log(`[NavController] NavigateThroughPoses: ${poses.length} waypoints`);
        this._navigateToNextPose();
    }

    _navigateToNextPose() {
        if (this._throughIndex >= this._throughPoses.length) {
            this._throughPoses = [];
            this._throughIndex = 0;
            this._setState(NAV_STATE.GOAL_REACHED);
            console.log('[NavController] All waypoints reached!');
            return;
        }

        const nextPose = this._throughPoses[this._throughIndex];
        console.log(`[NavController] Navigating to waypoint ${this._throughIndex + 1}/${this._throughPoses.length}`);
        this._goal = nextPose;
        this._path = [];
        this._stuckLastPos = { ...this._robotPose };
        this._stuckStartTime = Date.now();

        // Re-use planning logic
        this._planLoop();
    }

    // ─── Velocity Smoother ─────────────────────────────────────────────────

    /**
     * Apply velocity smoothing to reduce jerky motion.
     * Tương đương: nav2_velocity_smoother
     */
    smoothVelocity(targetLinear, targetAngular, smoothFactor = 0.8) {
        const prevLinear = this._lastSmoothedLinear || 0;
        const prevAngular = this._lastSmoothedAngular || 0;

        const smoothedLinear = prevLinear + (targetLinear - prevLinear) * (1 - smoothFactor);
        const smoothedAngular = prevAngular + (targetAngular - prevAngular) * (1 - smoothFactor);

        this._lastSmoothedLinear = smoothedLinear;
        this._lastSmoothedAngular = smoothedAngular;

        return { linear: smoothedLinear, angular: smoothedAngular };
    }

    /**
     * Set initial pose estimate.
     * Tương đương: /initialpose topic (AMCL)
     */
    setPoseEstimate(pose) {
        this._robotPose = { ...pose };
        this.tf.setOdometry(pose.x, pose.y, pose.theta, 0, 0);
        console.log(`[NavController] Pose estimate set: (${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${(pose.theta * 180 / Math.PI).toFixed(1)}°)`);
        this._notify();
    }

    _notify() {
        this._listeners.forEach(cb => {
            try { cb({ state: this._state, goal: this._goal, pose: this.tf.getMapPose(), path: this._path }); }
            catch (e) { console.error(e); }
        });
    }

    /**
     * updateFleetContext(robots)
     * Updates the costmap with other robots' positions.
     */
    updateFleetContext(robots) {
        if (!this.costmap) return;
        this.costmap.updateFleetObstacles(robots, this._robotId);
    }

    // ─── Control loops ─────────────────────────────────────────────────────────

    _planLoop() {
        if (this._state !== NAV_STATE.PLANNING && this._state !== NAV_STATE.FOLLOWING) return;
        if (!this._goal) return;

        const mapPose = this.tf.getMapPose();
        const path = this.globalPlanner.plan(mapPose, this._goal, this.costmap);

        if (!path || path.length === 0) {
            console.warn(`[NavController:${this._robotId}] Global planner failed — no path.`);
            this._setState(NAV_STATE.FAILED);
            robotBridge.cmdVel(this._robotId, 0, 0);
            return;
        }

        this._path = path;
        if (this._state === NAV_STATE.PLANNING) {
            this._setState(NAV_STATE.FOLLOWING);
        }
        console.log(`[NavController] Path replanned: ${path.length} waypoints.`);
    }

    _cmdLoop() {
        if (this._state !== NAV_STATE.FOLLOWING) return;
        if (!this._goal || !this._path.length) return;

        const mapPose = this.tf.getMapPose();

        // ─── Goal check ────────────────────────────────────────────────────────
        const distToGoal = Math.hypot(this._goal.x - mapPose.x, this._goal.y - mapPose.y);
        if (distToGoal < CONFIG.goalTolerance) {
            const yawErr = Math.abs(this._angleDiff(this._goal.theta, mapPose.theta));
            if (yawErr < CONFIG.yawTolerance) {
                robotBridge.cmdVel(this._robotId, 0, 0);
                this._setState(NAV_STATE.GOAL_REACHED);
                console.log(`[NavController:${this._robotId}] Goal reached!`);
                return;
            }
            // Rotate in place to final heading
            // CMD SIGN FIX: Negate output to compensate for firmware's internal negation
            const w = this._angleDiff(this._goal.theta, mapPose.theta) * 0.8;
            robotBridge.cmdVel(this._robotId, 0, -Math.max(-0.5, Math.min(0.5, w)));
            return;
        }

        // ─── Stuck detection ───────────────────────────────────────────────────
        const moved = Math.hypot(mapPose.x - this._stuckLastPos.x, mapPose.y - this._stuckLastPos.y);
        const turned = Math.abs(this._angleDiff(mapPose.theta, this._stuckLastPos.theta));

        // Only consider "stuck" if neither moving nor turning significantly
        if (moved > CONFIG.stuckMinMove || turned > CONFIG.stuckMinTurn) {
            this._stuckLastPos = { ...mapPose };
            this._stuckStartTime = Date.now();
        } else if ((Date.now() - this._stuckStartTime) / 1000 > CONFIG.stuckTimeoutSec) {
            robotBridge.cmdVel(this._robotId, 0, 0);
            this._setState(NAV_STATE.STUCK);
            console.warn(`[NavController:${this._robotId}] Robot is stuck! (No move/turn in ${CONFIG.stuckTimeoutSec}s)`);
            return;
        }

        // ─── DWA local planner ─────────────────────────────────────────────────
        const cmd = this.dwaPlanner.computeVelocity(mapPose, this._robotVel, this._path, this.costmap);
        if (!cmd) {
            robotBridge.cmdVel(this._robotId, 0, 0);
            return;
        }

        // Apply velocity smoother
        const smoothed = this.smoothVelocity(cmd.linear, cmd.angular);

        console.log(`[NavCmd:${this._robotId}] OUT ➔ v: ${smoothed.linear.toFixed(3)}, w: ${smoothed.angular.toFixed(3)} | Pose: (${mapPose.x.toFixed(2)}, ${mapPose.y.toFixed(2)}, ${(mapPose.theta * 180 / Math.PI).toFixed(1)}°) | GoalDist: ${distToGoal.toFixed(2)}m`);

        // CMD SIGN FIX: Negate velocity commands to match coordinate convention.
        // NavController positions are double-negated (true world coords),
        // but firmware also negates incoming velocity (v = -v_app).
        // Without this negation, sending +v makes robot go backward from NavController's view.
        robotBridge.cmdVel(this._robotId, -smoothed.linear, -smoothed.angular);
    }

    // ─── State machine ─────────────────────────────────────────────────────────

    _setState(newState) {
        if (this._state === newState) return;
        const prevState = this._state;
        this._state = newState;
        console.log(`[NavController] State → ${newState}`);

        // Handle NavigateThroughPoses — advance to next waypoint on GOAL_REACHED
        if (prevState === NAV_STATE.FOLLOWING && newState === NAV_STATE.GOAL_REACHED
            && this._throughPoses.length > 0) {
            this._throughIndex++;
            setTimeout(() => this._navigateToNextPose(), 100);
            return; // Don't notify yet
        }

        this._listeners.forEach(cb => {
            try { cb({ state: newState, goal: this._goal, pose: this.tf.getMapPose(), path: this._path }); }
            catch (e) { console.error(e); }
        });
    }

    // ─── Subscriber API ────────────────────────────────────────────────────────

    onState(cb) {
        this._listeners.push(cb);
        return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }

    getState() { return this._state; }
    getPath() { return this._path; }
    getCostmap() { return this.costmap; }
    getTFTree() { return this.tf; }

    /** Update DWA planner params at runtime from the app UI */
    updateDWAParams(params) { this.dwaPlanner.updateParams(params); }

    /** Get current DWA planner params for UI display */
    getDWAParams() { return this.dwaPlanner.getParams(); }

    // ─── Helper ───────────────────────────────────────────────────────────────

    _angleDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
    }
}

export default NavController;
export { NAV_STATE };
