import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import robotBridge, { MSG } from '../lib/robotBridge';

/**
 * Fleet Management Store
 * Highly protected state management for AMR fleet
 */
// Registry for subscriptions to avoid memory leaks
const subscriptions = new Map();

const useFleetStore = create(
    persist(
        (set, get) => ({
            robots: [],
            selectedRobotId: null,

            // Workflow state
            workflows: [],
            activeWorkflows: [],

            // Global settings
            settings: {
                defaultLinearSpeed: 0.25, // ~7.5 rad/s
                defaultAngularSpeed: 3.0,
                autoReconnect: true,
                telemetryInterval: 200,
                language: 'en',
                isMapping: false, // Global mapping state
            },

            // ============ ROBOT MANAGEMENT ============

            addRobot: (robotConfig) => {
                const newRobot = {
                    id: `robot_${Date.now()}`,
                    name: robotConfig.name || `AMR-${get().robots.length + 1}`,
                    ip: robotConfig.ip,
                    port: robotConfig.port || 81,
                    color: robotConfig.color || getRandomColor(),

                    bridgeStatus: 'disconnected',
                    connected: false,
                    lastSeen: null,
                    status: 'idle',

                    pose: { x: 7.5, y: 7.5, theta: 0 },
                    velocity: { linear: 0, angular: 0 },
                    battery: 100,
                    telemetry: { distance: 0, heading: 0, acceleration: 0 },
                    traveledPath: [],

                    taskQueue: [],
                    currentTask: null,
                    maxLinearSpeed: 0.35,
                    maxAngularSpeed: 4.0,
                    linearSpeed: 0.25,
                    angularSpeed: 2.0,

                    // Calibration parameters
                    config: {
                        ticksPerRev: 333,
                        wheelWidth: 0.170,
                        wheelRadius: 0.033,
                        invertLeftEncoder: false,
                        invertRightEncoder: false,
                        invertLeftMotor: false,
                        invertRightMotor: false,
                        // Motor tuning (firmware)
                        ff_gain: 20.0,
                        min_pwm: 50,
                        cmd_timeout: 500,
                        // DWA Planner (desktop)
                        dwa_maxLinearVel: 0.3,
                        dwa_maxAngularVel: 3.0,
                        dwa_maxLinearAcc: 1.0,
                        dwa_maxAngularAcc: 4.0,
                        dwa_goalTolerance: 0.15,
                        dwa_simTime: 1.5,
                    },
                    configProfiles: [],
                    lidarData: [], // Current frame
                    accumulatedMap: [], // Persistent SLAM points {x, z}
                    sensors: {
                        encoder: true,  // Encoder enabled by default
                        lidar: false,
                        imu: false
                    },
                    odometrySource: 'encoder' // 'encoder' | 'imu' | 'fusion' | 'all'
                };

                set(state => ({
                    robots: [...state.robots, newRobot],
                    selectedRobotId: state.selectedRobotId || newRobot.id,
                }));
                return newRobot.id;
            },

            removeRobot: (robotId) => {
                get().disconnectRobot(robotId);

                set(state => ({
                    robots: (state.robots || []).filter(r => r.id !== robotId),
                    selectedRobotId: state.selectedRobotId === robotId
                        ? (state.robots[0]?.id || null)
                        : state.selectedRobotId,
                }));
            },

            updateRobot: (robotId, updates) => {
                set(state => ({
                    robots: (state.robots || []).map(r =>
                        r.id === robotId ? { ...r, ...updates } : r
                    ),
                }));
            },

            selectRobot: (robotId) => set({ selectedRobotId: robotId }),

            getSelectedRobot: () => {
                const state = get();
                return (state.robots || []).find(r => r.id === state.selectedRobotId);
            },

            // ============ CONNECTION MANAGEMENT ============

            connectRobot: (robotId) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                // Avoid redundant connection attempts if already handled by robotStore
                if (robot.connected || robot.bridgeStatus === 'connecting') return;

                const url = `ws://${(robot.ip || '192.168.1.1').trim()}:${robot.port || 81}`;

                // Delegate to robotStore for active management
                import('./robotStore').then(module => {
                    const rStore = module.useRobotStore;
                    if (rStore && rStore.getState().connect) {
                        rStore.getState().connect(robotId, url);
                        console.log(`[FleetStore] Connection delegated for ${robotId} to ${url}`);
                    }
                }).catch(err => {
                    console.error('[FleetStore] Could not delegate connect:', err);
                });
            },

            disconnectRobot: (robotId) => {
                // Delegate to robotStore
                import('./robotStore').then(module => {
                    const rStore = module.useRobotStore;
                    if (rStore && rStore.getState().disconnect) {
                        rStore.getState().disconnect(robotId);
                    }
                }).catch(() => { });

                get().updateRobot(robotId, { connected: false, status: 'offline' });
            },

            connectAllRobots: () => {
                (get().robots || []).forEach(r => {
                    if (!r.connected && r.bridgeStatus !== 'connecting') get().connectRobot(r.id);
                });
            },

            disconnectAllRobots: () => {
                (get().robots || []).forEach(r => get().disconnectRobot(r.id));
            },

            // ============ ROBOT CONTROL ============

            sendVelocity: (robotId, linear, angular) => {
                robotBridge.cmdVel(robotId, linear, angular);
            },

            toggleSensor: (robotId, sensorType, enabled) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                // Update local state first
                get().updateRobot(robotId, {
                    sensors: {
                        ...robot.sensors,
                        [sensorType]: enabled
                    }
                });

                // Send command to robot if connected
                if (robot.connected) {
                    const cmdMap = {
                        lidar: 'lidar_pwr',
                        imu: 'imu_pwr',
                        encoder: 'encoder_pwr'
                    };
                    const cmdKey = cmdMap[sensorType];
                    if (cmdKey) {
                        robotBridge.sendMessage(robotId, { [cmdKey]: enabled });
                    }
                }
            },

            setOdometrySource: (robotId, source) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                // Update local state
                get().updateRobot(robotId, { odometrySource: source });

                // Send to robot if connected
                if (robot.connected) {
                    robotBridge.sendMessage(robotId, {
                        type: 'set_odometry_source',
                        source: source
                    });
                    console.log(`[${robot.name}] Odometry source set to: ${source}`);
                }
            },

            updateRobotConfig: (robotId, config) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                // Merge all config keys
                const mergedConfig = { ...robot.config };
                const configKeys = [
                    'ticksPerRev', 'wheelWidth', 'wheelRadius',
                    'invertLeftEncoder', 'invertRightEncoder',
                    'invertLeftMotor', 'invertRightMotor',
                    'ff_gain', 'min_pwm', 'cmd_timeout',
                    'dwa_maxLinearVel', 'dwa_maxAngularVel',
                    'dwa_maxLinearAcc', 'dwa_maxAngularAcc',
                    'dwa_goalTolerance', 'dwa_simTime',
                ];
                for (const k of configKeys) {
                    if (config[k] !== undefined) mergedConfig[k] = config[k];
                }

                // Update local store
                get().updateRobot(robotId, {
                    config: mergedConfig,
                    maxLinearSpeed: config.maxLinearSpeed ?? robot.maxLinearSpeed,
                    maxAngularSpeed: config.maxAngularSpeed ?? robot.maxAngularSpeed,
                    linearSpeed: config.linearSpeed ?? robot.linearSpeed,
                    angularSpeed: config.angularSpeed ?? robot.angularSpeed,
                });

                if (!robot.connected) return;

                // Send firmware-specific config to ESP32
                robotBridge.sendConfig(robotId, {
                    ticks_per_rev: parseInt(mergedConfig.ticksPerRev),
                    wheel_width: parseFloat(mergedConfig.wheelWidth),
                    wheel_radius: parseFloat(mergedConfig.wheelRadius),
                    invert_left: !!mergedConfig.invertLeftEncoder,
                    invert_right: !!mergedConfig.invertRightEncoder,
                    invert_left_motor: !!mergedConfig.invertLeftMotor,
                    invert_right_motor: !!mergedConfig.invertRightMotor,
                    ff_gain: parseFloat(mergedConfig.ff_gain),
                    min_pwm: parseInt(mergedConfig.min_pwm),
                    cmd_timeout: parseInt(mergedConfig.cmd_timeout),
                });

                // Propagate DWA params to NavController (runs on desktop)
                import('./robotStore').then(module => {
                    const rStore = module.useRobotStore;
                    const nc = rStore?.getState()?.getNavController?.(robotId);
                    if (nc) {
                        nc.updateDWAParams({
                            maxLinearVel: mergedConfig.dwa_maxLinearVel,
                            maxAngularVel: mergedConfig.dwa_maxAngularVel,
                            maxLinearAcc: mergedConfig.dwa_maxLinearAcc,
                            maxAngularAcc: mergedConfig.dwa_maxAngularAcc,
                            goalTolerance: mergedConfig.dwa_goalTolerance,
                            simTime: mergedConfig.dwa_simTime,
                        });
                    }
                }).catch(() => { });

                console.log(`[${robot.name}] Config sent via bridge:`, config);
            },

            snapToDock: (robotId) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;
                get().resetRobotOdometry(robotId);
            },

            resetRobotOdometry: (robotId, customPose = null) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                let targetPose = customPose;

                if (!targetPose) {
                    // Use dynamic import for mapStore to avoid circular dependency
                    import('./mapStore').then(module => {
                        const mapState = module.useMapStore?.getState?.();
                        if (mapState && mapState.docks) {
                            let dock = mapState.docks.find(d => d.robotId === robotId);
                            if (!dock && mapState.docks.length > 0) {
                                dock = mapState.docks[0];
                            }
                            if (dock) {
                                const pose = { x: dock.x, y: dock.y, theta: dock.theta || 0 };
                                // Re-apply reset with the found pose
                                get().resetRobotOdometry(robotId, pose);
                            }
                        }
                    }).catch(err => {
                        console.warn('Failed to fetch mapStore docks via dynamic import:', err);
                    });
                    // Fallback to default pose while waiting for import if needed (but we usually want the dock)
                    targetPose = { x: 7.5, y: 7.5, theta: 0 };
                }

                if (!targetPose) {
                    targetPose = { x: 7.5, y: 7.5, theta: 0 };
                }

                if (robot.connected) {
                    robotBridge.sendMessage(robotId, {
                        type: 'cmd',
                        cmd: 'reset_odom',
                        x: targetPose.x,
                        y: targetPose.y,
                        theta: targetPose.theta
                    });
                }

                // Reset local state
                get().updateRobot(robotId, {
                    pose: targetPose,
                    telemetry: { ...robot.telemetry, distance: 0, heading: targetPose.theta },
                    traveledPath: []
                });
            },

            resetRobotEncoders: (robotId) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                if (robot.connected) {
                    robotBridge.sendMessage(robotId, { type: 'cmd', cmd: 'reset_encoders' });
                }
            },

            saveRobotConfigProfile: (robotId, name) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                const newProfile = {
                    id: `profile_${Date.now()}`,
                    name: name || `Profile ${robot.configProfiles.length + 1}`,
                    timestamp: Date.now(),
                    config: JSON.parse(JSON.stringify(robot.config)), // Deep clone
                    maxLinearSpeed: robot.maxLinearSpeed,
                    maxAngularSpeed: robot.maxAngularSpeed,
                    linearSpeed: robot.linearSpeed,
                    angularSpeed: robot.angularSpeed,
                };

                set(state => ({
                    robots: state.robots.map(r =>
                        r.id === robotId
                            ? { ...r, configProfiles: [newProfile, ...r.configProfiles] }
                            : r
                    )
                }));
            },

            deleteRobotConfigProfile: (robotId, profileId) => {
                set(state => ({
                    robots: state.robots.map(r =>
                        r.id === robotId
                            ? { ...r, configProfiles: r.configProfiles.filter(p => p.id !== profileId) }
                            : r
                    )
                }));
            },

            applyRobotConfigProfile: (robotId, profileId) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (!robot) return;

                const profile = robot.configProfiles.find(p => p.id === profileId);
                if (!profile) return;

                get().updateRobotConfig(robotId, {
                    ...profile.config,
                    maxLinearSpeed: profile.maxLinearSpeed,
                    maxAngularSpeed: profile.maxAngularSpeed,
                    linearSpeed: profile.linearSpeed,
                    angularSpeed: profile.angularSpeed,
                });
            },

            stopRobot: (robotId) => {
                get().sendVelocity(robotId, 0, 0);
                get().updateRobot(robotId, { status: 'idle' });
            },

            stopAllRobots: () => {
                (get().robots || []).forEach(r => {
                    if (r.connected) {
                        get().sendVelocity(r.id, 0, 0);
                        get().updateRobot(r.id, { status: 'idle' });
                    }
                });
            },

            // ============ WORKFLOW & TASK MANAGEMENT ============

            createWorkflow: (workflowData) => {
                set(state => ({
                    workflows: [...(state.workflows || []), { ...workflowData, id: `wf_${Date.now()}` }]
                }));
            },

            deleteWorkflow: (workflowId) => {
                set(state => ({
                    workflows: (state.workflows || []).filter(w => w.id !== workflowId),
                    activeWorkflows: (state.activeWorkflows || []).filter(aw => aw.workflowId !== workflowId)
                }));
            },

            startWorkflow: (workflowId, robotAssignments = {}) => {
                set(state => ({
                    activeWorkflows: [
                        ...(state.activeWorkflows || []),
                        {
                            id: `awf_${Date.now()}`,
                            workflowId,
                            currentStep: 0,
                            robotAssignments,
                            startedAt: Date.now()
                        }
                    ]
                }));
                // In a full implementation, a workflow engine/manager would pick this up
                // and start coordinating the associated tasks to the assigned robots.
            },

            stopWorkflow: (activeId) => {
                set(state => ({
                    activeWorkflows: (state.activeWorkflows || []).filter(aw => aw.id !== activeId)
                }));
            },

            addTaskToRobot: (robotId, taskData) => {
                set(state => ({
                    robots: state.robots.map(r =>
                        r.id === robotId
                            ? { ...r, taskQueue: [...(r.taskQueue || []), { ...taskData, id: `task_${Date.now()}` }] }
                            : r
                    )
                }));
            },

            clearRobotTasks: (robotId) => {
                set(state => ({
                    robots: state.robots.map(r =>
                        r.id === robotId ? { ...r, taskQueue: [], currentTask: null } : r
                    )
                }));
            },

            // ============ HELPERS ============

            updateSettings: (newSettings) => {
                set(state => ({ settings: { ...state.settings, ...newSettings } }));
            },

            clearMap: (robotId) => {
                const robot = get().robots.find(r => r.id === robotId);
                if (robot?.connected) {
                    robotBridge.sendMessage(robotId, { type: 'clear_map' });
                }
                set(state => ({
                    robots: state.robots.map(r => r.id === robotId ? { ...r, accumulatedMap: [] } : r)
                }));
            },

            clearTraveledPath: (robotId) => {
                // Clear from fleet store (persistent state)
                get().updateRobot(robotId, { traveledPath: [] });
                // Also clear from individual robotStore if available
                import('./robotStore').then(module => {
                    const rStore = module.useRobotStore;
                    if (rStore && rStore.getState().clearTraveledPath) {
                        rStore.getState().clearTraveledPath(robotId);
                    }
                }).catch(() => { });
            },

            clearAllTraveledPaths: () => {
                set(state => ({
                    robots: (state.robots || []).map(r => ({ ...r, traveledPath: [] }))
                }));
                import('./robotStore').then(module => {
                    const rStore = module.useRobotStore;
                    if (rStore && rStore.getState().clearAllTraveledPaths) {
                        rStore.getState().clearAllTraveledPaths();
                    }
                }).catch(() => { });
            },

            hardReset: () => {
                set({ robots: [], selectedRobotId: null, activeWorkflows: [] });
                localStorage.removeItem('fleet-storage');
                window.location.reload();
            },

            t: (key) => key,
        }),
        {
            name: 'fleet-storage',
            partialize: (state) => ({
                robots: (state.robots || []).map(r => ({
                    id: r.id,
                    name: r.name,
                    ip: r.ip,
                    port: r.port,
                    color: r.color,
                    maxLinearSpeed: r.maxLinearSpeed,
                    maxAngularSpeed: r.maxAngularSpeed,
                    config: r.config,
                    configProfiles: r.configProfiles || [],
                    pose: r.pose || { x: 7.5, y: 7.5, theta: 0 },
                    traveledPath: r.traveledPath || [],
                })),
                workflows: state.workflows,
                settings: state.settings,
            }),
        }
    )
);

function getRandomColor() {
    const colors = ['#00d4ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6'];
    return colors[Math.floor(Math.random() * colors.length)];
}

export { useFleetStore };
