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
    activeBehavior: 'IDLE',
    isNavigating: false,
    navigationStatus: 'idle',
    targetPose: null,
    currentPath: [],
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

            // 3. Setup Subscriptions
            // --- Telemetry & Pose ---
            robotSubs.push(robotBridge.subscribe(robotId, MSG.TELEM, (msg) => {
                const state = get();
                const robot = state.robots[robotId];
                if (!robot) return;

                // Handle firmware variations in naming and units
                // NOTE: Firmware sends negated values (see main.cpp "NEGATE for App").
                // Theta and velocity keep firmware convention (Robot3D uses -pose.theta to handle it).
                // Only position X,Y are corrected here so the 3D map shows correct direction.
                // HEADING FIX: Negate firmware theta.
                const theta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.theta || 0);
                // VELOCITY FIX: Standard velocity convention
                const v = msg.v !== undefined ? msg.v : (msg.vx || 0);
                const w = msg.w !== undefined ? msg.w : (msg.wz || 0);
                
                // POSITION FIX: Standard X,Y coordinates
                const posX = msg.x !== undefined ? msg.x : (robot.pose?.x ?? 0);
                const posY = msg.y !== undefined ? msg.y : (robot.pose?.y ?? 0);

                const traveledPath = robot.traveledPath || [];
                // Only add point if moved significantly (> 2cm)
                const shouldAddPoint = traveledPath.length === 0 ||
                    Math.hypot(posX - (traveledPath.at(-1)?.x ?? 0),
                        posY - (traveledPath.at(-1)?.y ?? 0)) > 0.02;

                const newPath = shouldAddPoint
                    ? [...traveledPath, { x: posX, y: posY }]
                    : traveledPath;

                const updatedData = {
                    pose: { x: posX, y: posY, theta: theta },
                    velocity: { linear: v, angular: w },
                    battery: msg.batt || 0,
                    telemetry: {
                        battery: msg.batt || 0,
                        distance: msg.d || 0,
                        heading: msg.h || 0,
                        acceleration: msg.a || 0,
                        // DISPLAY FIX: Negate PID velocities so they show positive for forward
                        vL_t: msg.vL_t,
                        vL_r: msg.vL_r,
                        vR_t: msg.vR_t,
                        vR_r: msg.vR_r,
                        pwmL: msg.pwmL, pwmR: msg.pwmR,
                        // TICKS: Use raw values
                        ticks: msg.enc ? {
                            left: msg.enc.l,
                            right: msg.enc.r
                        } : { left: 0, right: 0 },
                        imu: typeof msg.imu === 'object'
                            ? msg.imu
                            : {
                                enabled: !!msg.imu,
                                calibrated: !!msg.imu_cal,
                                gyroZ: msg.gyroZ ?? 0,
                                fusedHeadingDeg: msg.fTheta ?? msg.h ?? 0,
                            }
                    },
                    traveledPath: newPath.slice(-500)
                };

                // Sync with FleetStore
                useFleetStore.getState().updateRobot(robotId, updatedData);

                // Update local robot state
                set(state => ({
                    robots: {
                        ...state.robots,
                        [robotId]: {
                            ...state.robots[robotId],
                            ...updatedData
                        }
                    }
                }));

                // Feed health monitor
                healthMonitor.feed(robotId, 'telem');
            }));

            // --- Status & Logs ---
            robotSubs.push(robotBridge.subscribe(robotId, MSG.STATUS, (msg) => {
                set(state => ({
                    robots: {
                        ...state.robots,
                        [robotId]: { ...state.robots[robotId], status: msg.status || 'active' }
                    }
                }));
                useFleetStore.getState().updateRobot(robotId, { status: msg.status || 'active' });
            }));

            // --- LiDAR Data ---
            // Grid-based dedup set for mapping (5cm resolution)
            const GRID_RES = 0.05; // 5cm grid
            const _mapGridSet = new Set();
            
            robotSubs.push(robotBridge.subscribe(robotId, MSG.LIDAR, (msg) => {
                const fleetState = useFleetStore.getState();
                const isMapping = fleetState.settings.isMapping;

                set(state => {
                    const robot = state.robots[robotId];
                    if (!robot) return state;

                    let newAccumulatedMap = robot.accumulatedMap || [];
                    if (isMapping && msg.points && msg.points.length > 0) {
                        const pose = robot.pose || { x: 0, y: 0, theta: 0 };
                        const worldPoints = [];
                        for (const p of msg.points) {
                            if (p.distance > 0.05 && p.distance < 6.0 && p.quality !== 0) {
                                const angleRad = (p.angle * Math.PI) / 180 + pose.theta;
                                const wx = pose.x + p.distance * Math.cos(angleRad);
                                const wy = pose.y + p.distance * Math.sin(angleRad);
                                
                                // Grid-based deduplication: skip if this cell already has a point
                                const gx = Math.round(wx / GRID_RES);
                                const gy = Math.round(wy / GRID_RES);
                                const gridKey = gx + ',' + gy;
                                if (!_mapGridSet.has(gridKey)) {
                                    _mapGridSet.add(gridKey);
                                    worldPoints.push({ x: wx, y: wy });
                                }
                            }
                        }
                        
                        if (worldPoints.length > 0) {
                            newAccumulatedMap = [...newAccumulatedMap, ...worldPoints];
                        }
                        
                        // Hard cap at 50000 unique grid cells
                        if (newAccumulatedMap.length > 50000) {
                            newAccumulatedMap = newAccumulatedMap.slice(newAccumulatedMap.length - 50000);
                        }
                    }

                    return {
                        robots: {
                            ...state.robots,
                            [robotId]: {
                                ...robot,
                                lidarData: msg.points || [],
                                accumulatedMap: newAccumulatedMap
                            }
                        }
                    };
                });
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
                            bridgeStatus: state
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
                            isNavigating: [NAV_STATE.PLANNING, NAV_STATE.FOLLOWING].includes(navS)
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
                // Fallback: direct stop if BM is missing
                robotBridge.cmdVel(robotId, 0, 0);
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
