import React, { useState, useRef, useCallback, useMemo, Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useFleetStore } from '../../stores/fleetStore';
import { useMapStore } from '../../stores/mapStore';
import { useMissionStore } from '../../stores/missionStore';
import { useRobotStore } from '../../stores/robotStore';
import syncService from '../../lib/syncService';
import WarehouseFloor from './WarehouseFloor';
import Robot3D from './Robot3D';
import PathRenderer3D from './PathRenderer3D';
import LidarRenderer3D from './LidarRenderer3D';
import OccupancyGrid3D from './OccupancyGrid3D';
import * as THREE from 'three';
import translations from '../../translations';
import './Map3D.css';


// Camera controller component for following robot
const CameraController = ({ viewMode, selectedRobot, controlsRef }) => {
    const { camera } = useThree();
    const targetPosition = useRef(new THREE.Vector3());
    const targetLookAt = useRef(new THREE.Vector3());
    const interpX = useRef(0);
    const interpZ = useRef(0);
    const interpTheta = useRef(0);
    const isFirstFrame = useRef(true);

    useFrame((state, delta) => {
        if (!selectedRobot?.pose) return;

        const targetX = selectedRobot.pose.x;
        const targetZ = -selectedRobot.pose.y; // Map Left to -Z to match Robot3D
        const targetTheta = (selectedRobot.pose.theta || 0); // Synchronize rotation

        // If very first frame, snap immediately to prevent wild flying
        if (isFirstFrame.current) {
            interpX.current = targetX;
            interpZ.current = targetZ;
            interpTheta.current = targetTheta;
            isFirstFrame.current = false;
        } else {
            // Apply EXACT same smooth lerp factors as Robot3D.jsx
            const posLerp = 1 - Math.exp(-3 * delta);
            const rotLerp = 1 - Math.exp(-3 * delta);

            interpX.current = THREE.MathUtils.lerp(interpX.current, targetX, posLerp);
            interpZ.current = THREE.MathUtils.lerp(interpZ.current, targetZ, posLerp);
            interpTheta.current = THREE.MathUtils.lerp(interpTheta.current, targetTheta, rotLerp);
        }

        const robotX = interpX.current;
        const robotZ = interpZ.current;
        const robotTheta = interpTheta.current;

        if (viewMode === 'firstPerson') {
            // First person view - camera at robot position looking forward
            const cameraHeight = 0.5;
            const lookDistance = 3;

            targetPosition.current.set(
                robotX,
                cameraHeight,
                robotZ
            );

            targetLookAt.current.set(
                robotX + Math.cos(robotTheta) * lookDistance,
                cameraHeight * 0.8,
                robotZ + Math.sin(robotTheta) * lookDistance
            );

            // Bind camera tightly to interpolated robot position
            camera.position.copy(targetPosition.current);
            camera.lookAt(targetLookAt.current); // Use lookAt directly since robot pos/rot is already smoothed

            // Disable orbit controls in first person
            if (controlsRef.current) {
                controlsRef.current.enabled = false;
            }
        } else if (viewMode === 'thirdPerson') {
            // Third person view - camera behind and above robot
            const distance = 3;
            const height = 2;

            // Position camera behind robot
            targetPosition.current.set(
                robotX - Math.cos(robotTheta) * distance,
                height,
                robotZ - Math.sin(robotTheta) * distance
            );

            targetLookAt.current.set(robotX, 0.3, robotZ);

            // Smoothly track the moving targetPosition for extra 'camera drone' feel
            camera.position.lerp(targetPosition.current, 1 - Math.exp(-5 * delta));
            camera.lookAt(targetLookAt.current);

            // Disable orbit controls in third person
            if (controlsRef.current) {
                controlsRef.current.enabled = false;
            }
        } else if (viewMode === 'follow') {
            // Follow mode - orbit around robot position
            if (controlsRef.current) {
                controlsRef.current.enabled = true;
                controlsRef.current.target.set(robotX, 0, robotZ);
                controlsRef.current.update();
            }
        } else {
            // Free camera mode
            if (controlsRef.current) {
                controlsRef.current.enabled = true;
            }
        }
    });

    return null;
};

const Map3D = ({ onWaypointClick, isSelectingWaypoint = false }) => {
    const containerRef = useRef(null);
    const controlsRef = useRef(null);
    const {
        selectedRobotId,
        selectRobot,
        settings,
    } = useFleetStore();

    // Get basic fleet data
    const fleetRobots = useFleetStore(state => state.robots);
    // Get live telemetry data
    const liveRobots = useRobotStore(state => state.robots);

    // Merge fleet data (name, color) with live data (pose, connected)
    const robots = useMemo(() => {
        return fleetRobots.map(fr => ({
            ...fr,
            ...(liveRobots[fr.id] || {})
        }));
    }, [fleetRobots, liveRobots]);

    const {
        width: WAREHOUSE_WIDTH,
        height: WAREHOUSE_HEIGHT,
        zones,
        docks
    } = useMapStore();

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const { missions } = useMissionStore();

    const [viewMode, setViewMode] = useState('isometric'); // Start with 3D view
    const [showGrid, setShowGrid] = useState(true);
    const [showPaths, setShowPaths] = useState(true);
    const [showLidar, setShowLidar] = useState(true);
    const [showSlam, setShowSlam] = useState(true);
    const [showGlobalMap, setShowGlobalMap] = useState(false);
    const [globalMap, setGlobalMap] = useState(null);

    // Initial camera preset
    useEffect(() => {
        const timer = setTimeout(() => {
            handleCameraPreset('isometric');
        }, 500);
        return () => clearTimeout(timer);
    }, []);

    // Get selected robot's SLAM map
    const slamMap = useRobotStore(state => state.robots[selectedRobotId]?.slamMap);

    // Sync Global Map from SyncService
    useEffect(() => {
        setGlobalMap(syncService.getGlobalMap());
        return syncService.onUpdate(map => setGlobalMap(map));
    }, []);

    // Camera presets
    const midX = WAREHOUSE_WIDTH / 2;
    const midZ = WAREHOUSE_HEIGHT / 2;
    const cameraPresets = {
        top: { position: [midX, 25, midZ], target: [midX, 0, midZ] },
        isometric: { position: [WAREHOUSE_WIDTH * 1.3, 15, WAREHOUSE_HEIGHT * 1.3], target: [midX, 0, midZ] },
    };

    const handleCameraPreset = (mode) => {
        setViewMode(mode);
        if (cameraPresets[mode] && controlsRef.current) {
            const preset = cameraPresets[mode];
            controlsRef.current.enabled = true;

            // For top view, we want to ensure it's not rotated
            if (mode === 'top') {
                controlsRef.current.object.position.set(preset.position[0], preset.position[1], preset.position[2] + 0.001);
                controlsRef.current.target.set(...preset.target);
            } else {
                controlsRef.current.object.position.set(...preset.position);
                controlsRef.current.target.set(...preset.target);
            }

            controlsRef.current.update();
        }
    };

    const handleRobotClick = useCallback((robotId) => {
        selectRobot(robotId);
    }, [selectRobot]);

    const handleFloorClick = useCallback((point) => {
        if (isSelectingWaypoint && onWaypointClick) {
            onWaypointClick({ x: point.x, y: point.z });
        }
    }, [isSelectingWaypoint, onWaypointClick]);

    // Get selected robot for follow mode
    const selectedRobot = robots.find(r => r.id === selectedRobotId);

    // View mode labels
    const viewModes = [
        { id: 'top', icon: '⬆️', title: t('top_view') },
        { id: 'isometric', icon: '🎯', title: t('isometric_view') },
        { id: 'follow', icon: '👁️', title: t('follow_robot'), needsRobot: true },
        { id: 'thirdPerson', icon: '🤖', title: t('third_person'), needsRobot: true },
        { id: 'firstPerson', icon: '👤', title: t('first_person'), needsRobot: true },
    ];

    return (
        <div className="map3d-container" ref={containerRef}>
            <Canvas shadows>
                <Suspense fallback={null}>
                    {/* Camera */}
                    <PerspectiveCamera
                        makeDefault
                        position={[midX, 30, midZ + 0.01]}
                        fov={40}
                    />

                    {/* Camera Controller for robot-following modes */}
                    <CameraController
                        viewMode={viewMode}
                        selectedRobot={selectedRobot}
                        controlsRef={controlsRef}
                    />

                    {/* Controls */}
                    <OrbitControls
                        ref={controlsRef}
                        enableDamping
                        dampingFactor={0.05}
                        minDistance={2}
                        maxDistance={50}
                        maxPolarAngle={Math.PI / 2.1}
                        target={[midX, 0, midZ]}
                    />

                    {/* Lighting */}
                    <ambientLight intensity={0.4} />
                    <directionalLight
                        position={[WAREHOUSE_WIDTH * 1.5, 30, WAREHOUSE_HEIGHT * 0.7]}
                        intensity={1}
                        castShadow
                        shadow-mapSize={[2048, 2048]}
                        shadow-camera-far={50}
                        shadow-camera-left={-20}
                        shadow-camera-right={20}
                        shadow-camera-top={20}
                        shadow-camera-bottom={-20}
                    />
                    <pointLight position={[midX, 10, midZ]} intensity={0.3} />

                    {/* Environment */}
                    <fog attach="fog" args={['#0a0a1a', 30, 60]} />

                    {/* Warehouse Floor & Zones */}
                    <WarehouseFloor
                        size={Math.max(WAREHOUSE_WIDTH, WAREHOUSE_HEIGHT)}
                        showGrid={showGrid}
                        onFloorClick={handleFloorClick}
                        isSelectingWaypoint={isSelectingWaypoint}
                    />

                    {/* Robots */}
                    {robots.map(robot => (
                        <Robot3D
                            key={robot.id}
                            robot={robot}
                            isSelected={robot.id === selectedRobotId}
                            onClick={() => handleRobotClick(robot.id)}
                            hideInFirstPerson={viewMode === 'firstPerson' && robot.id === selectedRobotId}
                        />
                    ))}

                    {/* Paths */}
                    {showPaths && robots.map(robot => (
                        <PathRenderer3D
                            key={`path-${robot.id}`}
                            robot={robot}
                            mission={missions.find(m => m.assignedRobotId === robot.id && m.status === 'active')}
                        />
                    ))}

                    {/* LiDAR Points */}
                    {showLidar && robots.map(robot => (
                        <LidarRenderer3D
                            key={`lidar-${robot.id}`}
                            robot={robot}
                        />
                    ))}

                    {/* SLAM Map Layer (Local) */}
                    {showSlam && slamMap && (
                        <OccupancyGrid3D grid={slamMap} opacity={0.6} yOffset={0.02} color="#4ade80" />
                    )}

                    {/* Global Map Layer (Cloud) */}
                    {showGlobalMap && globalMap && (
                        <OccupancyGrid3D grid={globalMap} opacity={0.4} yOffset={0.01} color="#3b82f6" />
                    )}
                </Suspense>
            </Canvas>

            {/* Controls Overlay */}
            <div className="map3d-controls">
                <div className="view-controls">
                    {viewModes.map(mode => (
                        <button
                            key={mode.id}
                            className={`control-btn ${viewMode === mode.id ? 'active' : ''}`}
                            onClick={() => handleCameraPreset(mode.id)}
                            title={mode.title}
                            disabled={mode.needsRobot && !selectedRobotId}
                        >
                            {mode.icon}
                        </button>
                    ))}
                </div>

                <div className="toggle-controls">
                    <button
                        className={`control-btn ${showGrid ? 'active' : ''}`}
                        onClick={() => setShowGrid(!showGrid)}
                        title={t('toggle_grid')}
                    >
                        #
                    </button>
                    <button
                        className={`control-btn ${showPaths ? 'active' : ''}`}
                        onClick={() => setShowPaths(!showPaths)}
                        title={t('toggle_paths')}
                    >
                        〰️
                    </button>
                    <button
                        className={`control-btn ${showLidar ? 'active' : ''}`}
                        onClick={() => setShowLidar(!showLidar)}
                        title={t('toggle_lidar')}
                    >
                        📡
                    </button>
                    <button
                        className={`control-btn ${showSlam ? 'active' : ''}`}
                        onClick={() => setShowSlam(!showSlam)}
                        title={t('toggle_slam')}
                    >
                        🗺️
                    </button>
                    <button
                        className={`control-btn ${showGlobalMap ? 'active' : ''}`}
                        onClick={() => setShowGlobalMap(!showGlobalMap)}
                        title={t('toggle_global')}
                    >
                        ☁️
                    </button>
                </div>
            </div>

            {/* View Mode Indicator */}
            {(viewMode === 'firstPerson' || viewMode === 'thirdPerson') && (
                <div className="view-mode-indicator">
                    {viewMode === 'firstPerson' ? `👤 ${t('first_person')}` : `🤖 ${t('third_person')}`}
                    <span className="view-hint">{t('exit_hint')}</span>
                </div>
            )}

            {/* Info Overlay */}
            <div className="map3d-info">
                <span className="info-item">
                    <span className="info-label">{t('warehouse_label')}:</span>
                    <span className="info-value">{WAREHOUSE_WIDTH}×{WAREHOUSE_HEIGHT}m</span>
                </span>
                <span className="info-divider">|</span>
                <span className="info-item">
                    <span className="info-label">{t('robots_label')}:</span>
                    <span className="info-value">{robots.filter(r => r.connected).length}/{robots.length}</span>
                </span>
            </div>

            {/* Waypoint Selection Indicator */}
            {isSelectingWaypoint && (
                <div className="waypoint-indicator">
                    <span className="pulse"></span>
                    {t('add_waypoint_hint')}
                </div>
            )}
        </div>
    );
};

export default Map3D;
