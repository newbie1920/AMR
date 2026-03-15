import { create } from 'zustand';
import robotBridge, { MSG } from '../lib/robotBridge';
import healthMonitor from '../lib/healthMonitor';
import BehaviorManager from '../lib/behaviorManager';
import NavController, { NAV_STATE } from '../lib/navController';
import paramServer from '../lib/paramServer';
import syncService from '../lib/syncService';
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
    activeBehavior: { name: 'Idle', progress: 0, status: 'ready' },
    isNavigating: false,
    navigationStatus: 'idle',
    targetPose: null,
    currentPath: [],
    tfTree: null
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
                const theta = msg.h !== undefined ? (msg.h * Math.PI / 180) : (msg.theta || 0);
                const v = msg.v !== undefined ? msg.v : (msg.vx || 0);
                const w = msg.w !== undefined ? msg.w : (msg.wz || 0);

                // Position might not be sent in every message or basic telemetry
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
                        distance: msg.d || 0,
                        heading: msg.h || 0,
                        acceleration: msg.a || 0,
                        vL_t: msg.vL_t, vL_r: msg.vL_r,
                        vR_t: msg.vR_t, vR_r: msg.vR_r,
                        pwmL: msg.pwmL, pwmR: msg.pwmR,
                        ticks: msg.enc ? {
                            left: Math.round(msg.enc.l / 1000) * 1000,
                            right: Math.round(msg.enc.r / 1000) * 1000
                        } : { left: 0, right: 0 }
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
            robotSubs.push(robotBridge.subscribe(robotId, MSG.LIDAR, (msg) => {
                set(state => ({
                    robots: {
                        ...state.robots,
                        [robotId]: { ...state.robots[robotId], lidarData: msg.points || [] }
                    }
                }));
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
                        // Motor params → firmware
                        robotBridge.sendConfig(robotId, {
                            ff_gain: parseFloat(c.ff_gain ?? 20.0),
                            min_pwm: parseInt(c.min_pwm ?? 50),
                            cmd_timeout: parseInt(c.cmd_timeout ?? 500),
                        });
                    }
                } else if (state === 'disconnected') {
                    navController.stop();
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
