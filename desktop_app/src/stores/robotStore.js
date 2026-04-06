import { create } from 'zustand';
import robotBridge, { MSG } from '../lib/robotBridge';
import healthMonitor from '../lib/healthMonitor';
import BehaviorManager from '../lib/behaviorManager';
import NavController, { NAV_STATE } from '../lib/navController';
import paramServer from '../lib/paramServer';
import syncService from '../lib/syncService';
import sensorFusion from '../lib/sensorFusion/sensorFusion';
import eventBus from '../lib/eventBus';
import pluginManager from '../lib/pluginManager';
import { useFleetStore } from './fleetStore';

const initialRobotState = {
    connected: false,
    bridgeStatus: 'disconnected',
    lastSeen: null,
    status: 'idle',
    pose: null, // Let it inherit from fleetStore initially
    velocity: { linear: 0, angular: 0 },
    battery: 0,
    telemetry: { distance: 0, heading: 0, acceleration: 0 },
    traveledPath: [],
    lidarData: [],
    accumulatedMap: [],
    mapVersion: 0,
    activeBehavior: 'IDLE',
    isNavigating: false,
    navigationStatus: 'idle',
    targetPose: null,
    currentPath: [],
    tfTree: null,
    filteredOdom: null, // { x, y, theta, v, omega } from EKF sensor fusion
    monitorStatus: 'disconnected', // 'connecting', 'connected', 'error', 'disconnected'
};

/**
 * Robot Store
 * Manages active robot connections and their logical controllers (NavController, BehaviorManager)
 */
const useRobotStore = create((set, get) => {
    // Registry for robot-specific instances (strictly encapsulated within the store closure)
    const navControllers = new Map();
    const behaviorManagers = new Map();
    const subscriptions = new Map();

    // PERFORMANCE OPTIMIZATION: Telemetry & LiDAR update buffering
    const telemBuffer = new Map(); // robotId -> data
    const lidarMapBuffer = new Map(); // robotId -> points[]
    let updateScheduled = false;

    // Grid-based dedup set for mapping (5cm resolution)
    const GRID_RES = 0.05;
    const globalMapGridSets = new Map(); // robotId -> Set

    const flushUpdates = () => {
        set(state => {
            const newRobots = { ...state.robots };
            let hasChanges = false;

            // Apply buffered telemetry
            telemBuffer.forEach((data, rid) => {
                if (newRobots[rid]) {
                    newRobots[rid] = { ...newRobots[rid], ...data };
                    hasChanges = true;
                }
            });

            // Apply buffered LiDAR maps
            lidarMapBuffer.forEach((newPoints, rid) => {
                const robot = newRobots[rid];
                if (robot && newPoints.length > 0) {
                    const currentMap = robot.accumulatedMap || [];
                    const combinedMap = [...currentMap, ...newPoints].slice(-50000);
                    newRobots[rid] = { 
                        ...newRobots[rid], 
                        accumulatedMap: combinedMap,
                        mapVersion: (robot.mapVersion || 0) + 1 
                    };
                    hasChanges = true;
                }
            });

            telemBuffer.clear();
            lidarMapBuffer.clear();
            updateScheduled = false;

            if (!hasChanges) return state;
            return { robots: newRobots };
        });
    };

    const queueUpdate = () => {
        if (!updateScheduled) {
            updateScheduled = true;
            // 100ms throttle (10Hz) for UI state updates
            setTimeout(flushUpdates, 100);
        }
    };

    // Initialize IPC listeners for monitor status
    if (window.electronAPI && window.electronAPI.onMonitorStatus) {
        window.electronAPI.onMonitorStatus((data) => {
            console.log(`[Store] Monitor Status Update:`, data);
            set(state => {
                const robots = { ...state.robots };
                if (data.robotId && robots[data.robotId]) {
                    robots[data.robotId].monitorStatus = data.status;
                } else if (state.selectedRobotId && robots[state.selectedRobotId]) {
                    // Fallback to selected robot if no ID provided in event
                    robots[state.selectedRobotId].monitorStatus = data.status;
                }
                return { robots };
            });
        });
    }

    return {
        robots: {},
        selectedRobotId: null,

        setManualControl: (robotId, active) => {
            set(state => ({
                robots: {
                    ...state.robots,
                    [robotId]: { ...state.robots[robotId], manualControlActive: active }
                }
            }));
        },

        setManualControl: (robotId, active) => {
            set(state => ({
                robots: {
                    ...state.robots,
                    [robotId]: { ...state.robots[robotId], manualControlActive: active }
                }
            }));
        },

        connect: (robotId, connectionUrl = null) => {
            const currentRobots = get().robots;
            if (currentRobots[robotId]?.connected) return;

            const url = connectionUrl || `ws://${robotId}:81`;
            console.log(`[RobotStore] Connecting to ${robotId} at ${url}...`);

            // 1. Initialize NavController and BehaviorManager
            const navController = new NavController(robotId);
            const behaviorManager = new BehaviorManager(robotId, navController);

            navControllers.set(robotId, navController);
            behaviorManagers.set(robotId, behaviorManager);

            // 2. Establish bridge connection
            robotBridge.connect(url, robotId);

            // Initialize state for this robot
            set(state => ({
                robots: {
                    ...state.robots,
                    [robotId]: { ...initialRobotState, bridgeStatus: 'connecting', tfTree: navController.getTFTree() }
                }
            }));

            const robotSubs = [];

            // --- Telemetry & Pose ---
            robotSubs.push(robotBridge.subscribe(robotId, MSG.TELEM, (msg) => {
                const robot = get().robots[robotId] || initialRobotState;

                let rawTheta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.theta || 0);
                let rawX = msg.x !== undefined ? msg.x : 0;
                let rawY = msg.y !== undefined ? msg.y : 0;

                const v = msg.v !== undefined ? msg.v : (msg.vx || 0);
                const w = msg.w !== undefined ? msg.w : (msg.wz || 0);
                
                // 🚀 BẢO TOÀN POSE KHI MẤT KẾT NỐI (Ghost Frame Realignment)
                if (robot._needsRealign && robot.pose) {
                    // Khi xe mới thức dậy, odometry của nó luôn bắt đầu từ số 0, nhưng ta biết vị trí thật của nó trên map
                    const offset = {
                         x: robot.pose.x - rawX,
                         y: robot.pose.y - rawY,
                         // tính toán chênh lệch góc xoay
                         theta: robot.pose.theta - rawTheta
                    };
                    navControllers.get(robotId)._odomOffset = offset; // Lưu vào nháp
                    set(state => ({
                        robots: { ...state.robots, [robotId]: { ...state.robots[robotId], _needsRealign: false, _odomOffset: offset } }
                    }));
                }

                // Lấy offset đã lưu
                const offset = robot._odomOffset || { x: 0, y: 0, theta: 0 };
                
                // CỘNG BÙ ODOMETRY ẢO
                const posX = rawX + offset.x;
                const posY = rawY + offset.y;
                let theta = rawTheta + offset.theta;
                // Chuẩn hóa góc theta
                theta = Math.atan2(Math.sin(theta), Math.cos(theta));

                const traveledPath = robot.traveledPath || [];
                const lastPoint = traveledPath[traveledPath.length - 1];
                const shouldAddPoint = traveledPath.length === 0 ||
                    Math.hypot(posX - (lastPoint?.x ?? 0), posY - (lastPoint?.y ?? 0)) > 0.05;

                const newPath = shouldAddPoint
                    ? [...traveledPath, { x: posX, y: posY }].slice(-500)
                    : traveledPath;

                const telemData = {
                    pose: { x: posX, y: posY, theta: theta },
                    velocity: { linear: v, angular: w },
                    battery: msg.batt || 0,
                    status: msg.status || robot.status || 'active',
                    telemetry: {
                        battery: msg.batt || 0,
                        distance: msg.d || 0,
                        heading: msg.h || 0,
                        acceleration: msg.a || 0,
                        vL_t: msg.vL_t, vL_r: msg.vL_r,
                        vR_t: msg.vR_t, vR_r: msg.vR_r,
                        pwmL: msg.pwmL, pwmR: msg.pwmR,
                        ticks: msg.enc ? { left: msg.enc.l, right: msg.enc.r } : { left: 0, right: 0 },
                        imu: typeof msg.imu === 'object' ? msg.imu : {
                            enabled: !!msg.imu,
                            calibrated: !!msg.imu_cal,
                            gyroZ: msg.gyroZ ?? 0,
                            fusedHeadingDeg: msg.fTheta ?? msg.h ?? 0,
                        }
                    },
                    traveledPath: newPath
                };

                // Buffer updates to reduce React re-renders
                const currentBuffered = telemBuffer.get(robotId) || {};
                telemBuffer.set(robotId, { ...currentBuffered, ...telemData });
                
                // Update fleet store if status changed (rare event)
                if (msg.status && msg.status !== robot.status) {
                    useFleetStore.getState().updateRobot(robotId, { status: msg.status });
                }
                
                queueUpdate();
            }));

            // --- LiDAR Data ---
            robotSubs.push(robotBridge.subscribe(robotId, MSG.LIDAR, (msg) => {
                const fleetState = useFleetStore.getState();
                const isMapping = fleetState.settings.isMapping;
                const robot = get().robots[robotId];
                if (!robot) return;

                const pose = robot.pose || { x: 0, y: 0, theta: 0 };
                const worldPoints = [];
                
                if (isMapping && msg.points && msg.points.length > 0) {
                    if (!globalMapGridSets.has(robotId)) globalMapGridSets.set(robotId, new Set());
                    const gridSet = globalMapGridSets.get(robotId);

                    for (const p of msg.points) {
                        if (p.distance > 0.18 && p.distance < 6.0 && p.quality !== 0) {
                            const angleRad = (p.angle * Math.PI) / 180 + pose.theta;
                            const wx = pose.x + p.distance * Math.cos(angleRad);
                            const wy = pose.y + p.distance * Math.sin(angleRad);
                            
                            const gx = Math.round(wx / GRID_RES);
                            const gy = Math.round(wy / GRID_RES);
                            const gridKey = gx + ',' + gy;
                            if (!gridSet.has(gridKey)) {
                                gridSet.add(gridKey);
                                worldPoints.push({ x: wx, y: wy });
                            }
                        }
                    }
                }

                // Buffer update for UI
                const currentRobotState = get().robots[robotId];
                const isManualActive = currentRobotState?.manualControlActive;

                if (!isManualActive) {
                    const currentData = telemBuffer.get(robotId) || {};
                    telemBuffer.set(robotId, { ...currentData, lidarData: msg.points || [] });
                }

                if (worldPoints.length > 0 && !isManualActive) {
                    const currentMapBuffered = lidarMapBuffer.get(robotId) || [];
                    lidarMapBuffer.set(robotId, [...currentMapBuffered, ...worldPoints]);
                }
                
                queueUpdate();
            }));

            // --- Connection Lifecycle ---
            robotSubs.push(robotBridge.subscribe(robotId, 'connection', (conn) => {
                const { state } = conn;
                const isConnected = state === 'connected';
                console.log(`[RobotStore] ${robotId} connection: ${state.toUpperCase()}`);

                set(stateStore => ({
                    robots: {
                        ...stateStore.robots,
                        [robotId]: {
                            ...stateStore.robots[robotId],
                            connected: isConnected,
                            bridgeStatus: state,
                            // Bật cờ đo đạc lại tọa độ nếu xe bị rớt mạng
                            ...(!isConnected ? { _needsRealign: true } : {})
                        }
                    }
                }));

                useFleetStore.getState().updateRobot(robotId, {
                    connected: isConnected,
                    bridgeStatus: state
                });

                if (isConnected) {
                    // Start navigation controller processing
                    navController.init();
                    // Sync parameters
                    paramServer.sync(robotId);

                    // Sync saved DWA + motor params from fleet store
                    const fleetRobot = useFleetStore.getState().robots.find(r => r.id === robotId);
                    if (fleetRobot?.config) {
                        const c = fleetRobot.config;
                        // DWA params → NavController (desktop-side)
                        navController.updateDWAParams({
                            maxLinearVel: c.dwa_maxLinearVel ?? 0.2,
                            maxAngularVel: c.dwa_maxAngularVel ?? 1.0,
                            maxLinearAcc: c.dwa_maxLinearAcc ?? 0.5,
                            maxAngularAcc: c.dwa_maxAngularAcc ?? 2.0,
                            goalTolerance: c.dwa_goalTolerance ?? 0.15,
                            simTime: c.dwa_simTime ?? 1.5,
                        });
                        navController.setOdometrySource(fleetRobot.odometrySource || 'encoder');
                        // Motor params → firmware
                        robotBridge.sendConfig(robotId, {
                            ff_gain: parseFloat(c.ff_gain ?? 20.0),
                            min_pwm: parseInt(c.min_pwm ?? 50),
                            cmd_timeout: parseInt(c.cmd_timeout ?? 500),
                        });

                        // ─── Initialize Sensor Fusion (EKF Web Worker) ───
                        sensorFusion.init(robotId, {
                            wheelRadius: parseFloat(c.wheel_radius ?? 0.033),
                            wheelSeparation: parseFloat(c.wheel_separation ?? 0.17),
                            ticksPerRev: parseInt(c.ticks_per_rev ?? 1665),
                        });
                    } else {
                        // Default sensor fusion config
                        sensorFusion.init(robotId);
                    }

                    // Subscribe to filtered odom updates
                    sensorFusion.onFiltered((odom) => {
                        const fleetRobotCurrent = useFleetStore.getState().robots.find(r => r.id === robotId);
                        const odometrySource = fleetRobotCurrent?.odometrySource || 'encoder';
                        const useFusedPose = odometrySource === 'fusion' || odometrySource === 'imu' || odometrySource === 'all';
                        const fusedPose = {
                            x: odom.x,
                            y: odom.y,
                            theta: odom.theta,
                        };
                        const fusedVelocity = {
                            linear: odom.v,
                            angular: odom.omega,
                        };

                        if (useFusedPose) {
                            navController.applyExternalOdometry(odom);
                            useFleetStore.getState().updateRobot(robotId, {
                                pose: fusedPose,
                                velocity: fusedVelocity,
                                battery: get().robots[robotId]?.battery || 0
                            });
                        }

                        set(stateStore => ({
                            robots: {
                                ...stateStore.robots,
                                [robotId]: {
                                    ...stateStore.robots[robotId],
                                    ...(useFusedPose ? {
                                        pose: fusedPose,
                                        velocity: fusedVelocity,
                                    } : {}),
                                    filteredOdom: {
                                        x: odom.x,
                                        y: odom.y,
                                        theta: odom.theta,
                                        v: odom.v,
                                        omega: odom.omega,
                                    }
                                }
                            }
                        }));
                    }, robotId);

                    if (!pluginManager._eventBus) {
                        pluginManager.init(eventBus);
                    }

                    // ─── AUTO-START TELNET MONITOR ───
                    if (window.electronAPI && window.electronAPI.startMonitor) {
                        const ip = robotBridge.getRobotIP(robotId);
                        window.electronAPI.startMonitor({ ip, robotId });
                        console.log(`[RobotStore] Auto-started Telnet monitor for ${robotId} at ${ip}:23`);
                    }
                } else if (state === 'disconnected') {
                    navController.stop();
                    sensorFusion.destroy(robotId);
                }
            }));

            // --- Navigation State Updates ---
            navController.onState(({ state: navS, path, goal }) => {
                set(state => ({
                    robots: {
                        ...state.robots,
                        [robotId]: {
                            ...state.robots[robotId],
                            navigationStatus: navS,
                            currentPath: path || [],
                            targetPose: goal,
                            isNavigating: [NAV_STATE.PLANNING, NAV_STATE.FOLLOWING, NAV_STATE.NAVIGATING_THROUGH].includes(navS)
                        }
                    }
                }));
            });

            // --- Behavior State Updates ---
            behaviorManager.onState(({ state: bS }) => {
                set(stateStore => {
                    const r = stateStore.robots[robotId] || { ...initialRobotState };
                    return {
                        robots: {
                            ...stateStore.robots,
                            [robotId]: { ...r, activeBehavior: bS }
                        }
                    };
                });
            });

            subscriptions.set(robotId, robotSubs);
        },

        disconnect: (robotId) => {
            console.log(`[RobotStore] Disconnecting ${robotId}...`);
            // Send stop command
            robotBridge.cmdVel(robotId, 0, 0);

            const robotSubs = subscriptions.get(robotId);
            if (robotSubs) {
                robotSubs.forEach(unsub => unsub());
                subscriptions.delete(robotId);
            }
            robotBridge.disconnect(robotId);

            navControllers.delete(robotId);
            behaviorManagers.get(robotId)?.cancel();
            behaviorManagers.delete(robotId);
            sensorFusion.destroy(robotId);

            set(state => {
                const newRobots = { ...state.robots };
                if (newRobots[robotId]) {
                    newRobots[robotId] = {
                        ...newRobots[robotId],
                        connected: false,
                        bridgeStatus: 'disconnected'
                    };
                }
                return { robots: newRobots };
            });

            useFleetStore.getState().updateRobot(robotId, {
                connected: false,
                bridgeStatus: 'disconnected',
                status: 'offline'
            });
        },

        sendVelocity: (robotId, linear, angular) => {
            if (window.electronAPI && window.electronAPI.logAppEvent) {
                window.electronAPI.logAppEvent(`CMD_VEL: v=${linear.toFixed(2)}, w=${angular.toFixed(2)}`);
            }
            robotBridge.cmdVel(robotId, linear, angular);
        },

        selectRobot: (robotId) => set({ selectedRobotId: robotId }),

        getBehaviorManager: (robotId) => {
            return behaviorManagers.get(robotId);
        },

        getNavController: (robotId) => {
            return navControllers.get(robotId);
        },

        stopMission: (robotId) => {
            const bm = behaviorManagers.get(robotId);
            if (bm) {
                bm.cancel();
            } else {
                robotBridge.cmdVel(robotId, 0, 0);
            }
        },

        pauseMission: (robotId) => {
            const bm = behaviorManagers.get(robotId);
            if (bm) {
                bm.pause();
                console.log(`[RobotStore] Mission PAUSED for ${robotId}`);
            }
        },

        resumeMission: (robotId) => {
            const bm = behaviorManagers.get(robotId);
            if (bm) {
                bm.resume();
                console.log(`[RobotStore] Mission RESUMED for ${robotId}`);
            }
        },

        clearTraveledPath: (robotId) => {
            set(state => ({
                robots: {
                    ...state.robots,
                    [robotId]: { ...state.robots[robotId], traveledPath: [] }
                }
            }));
        },

        clearAllTraveledPaths: () => {
            set(state => {
                const newRobots = {};
                Object.keys(state.robots).forEach(id => {
                    newRobots[id] = { ...state.robots[id], traveledPath: [] };
                });
                return { robots: newRobots };
            });
        },

        syncFleetPositions: () => {
            const fleetStore = useFleetStore.getState();
            const fleetRobots = fleetStore.robots;
            const liveRobots = get().robots;

            const robotsWithPoses = fleetRobots.map(fr => {
                const liveRobot = liveRobots[fr.id];
                const pose = liveRobot?.pose || fr.pose;

                // Sync back to fleet store for general UI visibility
                if (liveRobot?.pose && (liveRobot.pose.x !== fr.pose?.x || liveRobot.pose.y !== fr.pose?.y)) {
                    fleetStore.updateRobot(fr.id, {
                        pose: liveRobot.pose,
                        velocity: liveRobot.velocity,
                        battery: liveRobot.battery
                    });
                }

                return {
                    id: fr.id,
                    pose: pose,
                    name: fr.name
                };
            }).filter(r => r.pose);

            navControllers.forEach((nc, robotId) => {
                nc.updateFleetContext(robotsWithPoses);
                const bm = behaviorManagers.get(robotId);
                if (bm) bm.updateFleetContext(robotsWithPoses);
            });
        },

        getGlobalMap: () => syncService.getGlobalMap(),
    };
});

export { useRobotStore };
