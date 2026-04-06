import React, { useState, useRef, useCallback, useMemo, Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useFleetStore } from '../../stores/fleetStore';
import { useMapStore } from '../../stores/mapStore';
import { useMissionStore } from '../../stores/missionStore';
import { useRobotStore } from '../../stores/robotStore';
import syncService from '../../lib/syncService';
import autoExplorer from '../../lib/autoExplorer';
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
        const targetTheta = -(selectedRobot.pose.theta || 0); // Corrected mapping: Y_world -> -Z_three requires sign flip

        // If very first frame, snap immediately to prevent wild flying
        if (isFirstFrame.current) {
            interpX.current = targetX;
            interpZ.current = targetZ;
            interpTheta.current = targetTheta;
            isFirstFrame.current = false;
        } else {
            // Apply smooth lerp factors
            const posLerp = 1 - Math.exp(-4 * delta);
            const rotLerp = 1 - Math.exp(-5 * delta); // Faster rotation for camera

            interpX.current = THREE.MathUtils.lerp(interpX.current, targetX, posLerp);
            interpZ.current = THREE.MathUtils.lerp(interpZ.current, targetZ, posLerp);
            
            // Handle angle wrap-around for smooth rotation
            let deltaTheta = targetTheta - interpTheta.current;
            while (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
            while (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;
            interpTheta.current += deltaTheta * rotLerp;
        }

        const robotX = interpX.current;
        const robotZ = interpZ.current;
        const robotTheta = interpTheta.current;

        if (viewMode === 'firstPerson') {
            // First person view - camera at robot position looking forward
            const cameraHeight = 0.5;
            const lookDistance = 5;

            targetPosition.current.set(robotX, cameraHeight, robotZ);
            targetLookAt.current.set(
                robotX + Math.cos(robotTheta) * lookDistance,
                cameraHeight * 0.9,
                robotZ + Math.sin(robotTheta) * lookDistance
            );

            // Bind camera tightly
            camera.position.copy(targetPosition.current);
            camera.lookAt(targetLookAt.current);

            if (controlsRef.current) controlsRef.current.enabled = false;
        } else if (viewMode === 'thirdPerson') {
            // Third person view - camera behind and above robot, looking at center
            const distance = 8;
            const height = 4.5;

            // Position camera behind robot
            targetPosition.current.set(
                robotX - Math.cos(robotTheta) * distance,
                height,
                robotZ - Math.sin(robotTheta) * distance
            );

            // Directly center the robot in the viewport
            targetLookAt.current.set(robotX, 0.4, robotZ);

            // Smoothly track
            camera.position.lerp(targetPosition.current, 1 - Math.exp(-6 * delta));
            camera.lookAt(targetLookAt.current);

            if (controlsRef.current) controlsRef.current.enabled = false;
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
        updateSettings,
        clearMap,
        saveMap,
        loadMap,
        getSavedMaps,
        exportMapToFile,
    } = useFleetStore();

    // Get basic fleet data
    const fleetRobots = useFleetStore(state => state.robots);
    // Get live telemetry data
    const liveRobots = useRobotStore(state => state.robots);
    
    const stopRobot = () => {
        import('../../stores/robotStore').then(mod => {
            // Stop any ongoing planner mission
            if (mod.useRobotStore.getState().stopMission) {
                mod.useRobotStore.getState().stopMission(selectedRobotId);
            }
        });
        // Stop the physical robot using fleetStore
        useFleetStore.getState().stopRobot(selectedRobotId);
    };

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
        docks,
        activeMapSource,
        activeMapId,
        activeMapName,
        savedSlamMaps,
        saveSlamMap,
        loadSlamMapPoints,
        deleteSlamMap,
        activateSlamMap,
        activateMockMap,
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
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [mapName, setMapName] = useState('');
    const [showMapList, setShowMapList] = useState(false);
    const [mapSaveMsg, setMapSaveMsg] = useState('');
    const [isExploring, setIsExploring] = useState(false);
    const [showMapManager, setShowMapManager] = useState(false);
    const [continuingMapId, setContinuingMapId] = useState(null); // ID map đang vẽ tiếp
    
    // Get current robot's accumulated point count for display
    const currentRobot = robots.find(r => r.id === selectedRobotId);
    const mapPointCount = currentRobot?.accumulatedMap?.length || 0;

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
    const midZ = -WAREHOUSE_HEIGHT / 2;
    const cameraPresets = {
        top: { position: [midX, 25, midZ], target: [midX, 0, midZ] },
        isometric: { position: [WAREHOUSE_WIDTH * 1.3, 15, WAREHOUSE_HEIGHT * 0.2], target: [midX, 0, midZ] },
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
            onWaypointClick({ x: point.x, y: -point.z });
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

                    {/* Conditional rendering based on mapSource */}
                    {activeMapSource === 'mock' && !settings.isMapping ? (
                        <WarehouseFloor
                            size={Math.max(WAREHOUSE_WIDTH, WAREHOUSE_HEIGHT)}
                            showGrid={showGrid}
                            onFloorClick={handleFloorClick}
                            isSelectingWaypoint={isSelectingWaypoint}
                        />
                    ) : (
                        showGrid && (
                            <group position={[WAREHOUSE_WIDTH / 2, 0.01, -WAREHOUSE_HEIGHT / 2]}>
                                <gridHelper args={[Math.max(WAREHOUSE_WIDTH, WAREHOUSE_HEIGHT) * 1.5, Math.max(WAREHOUSE_WIDTH, WAREHOUSE_HEIGHT) * 1.5, '#2a2a4a', '#1a1a3a']} />
                            </group>
                        )
                    )}

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

                    {/* SLAM Specific Renderers */}
                    {/* SLAM Specific Renderers - show when mapping or SLAM active */}
                    {(settings.isMapping || activeMapSource === 'slam') && (
                        <>
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
                        </>
                    )}

                    {/* Global Map Layer (Cloud - can be shown on both theoretically but usually SLAM) */}
                    {showGlobalMap && globalMap && (
                        <OccupancyGrid3D grid={globalMap} opacity={0.4} yOffset={0.01} color="#3b82f6" />
                    )}
                </Suspense>
            </Canvas>

            {/* Controls Overlay */}
            <div className="map3d-controls">
                <div className="source-controls view-controls" style={{ flexDirection: 'row' }}>
                    <button
                        className={`control-btn ${activeMapSource === 'mock' && !activeMapId ? 'active' : ''}`}
                        onClick={() => activateMockMap()}
                        title="Map Giả Lập"
                        style={{ width: 'auto', padding: '0 8px' }}
                    >
                        Map Giả
                    </button>
                    <button
                        className={`control-btn ${activeMapSource === 'slam' || activeMapId ? 'active' : ''}`}
                        onClick={() => setShowMapManager(true)}
                        title="Map SLAM (đã vẽ)"
                        style={{ width: 'auto', padding: '0 8px' }}
                    >
                        {activeMapId ? `📍 ${activeMapName}` : 'Map Xe Vẽ'}
                    </button>
                </div>
                
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

            {/* SLAM Mapping Control Panel — always visible when mapping */}
            {settings.isMapping && (
                <div className="slam-mapping-panel" style={{
                    position: 'absolute',
                    bottom: '40px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 10,
                    background: 'rgba(10, 10, 26, 0.92)',
                    backdropFilter: 'blur(12px)',
                    padding: '10px 16px',
                    borderRadius: '16px',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                    minWidth: '320px',
                }}>
                    {/* Top row: main controls */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                            style={{
                                padding: '5px 14px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                                border: 'none', color: '#fff',
                                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                boxShadow: '0 0 12px rgba(239,68,68,0.4)',
                                animation: 'pulse 2s infinite',
                            }}
                            onClick={() => {
                                // Dừng mapping + dừng khám phá
                                updateSettings({ isMapping: false });
                                autoExplorer.stop();
                                setIsExploring(false);
                                stopRobot();
                            }}
                        >
                            ⏹ Dừng Vẽ
                        </button>

                        {/* Nút bật/tắt tự chạy */}
                        <button
                            style={{
                                padding: '5px 12px', borderRadius: '12px', fontSize: '11px', cursor: 'pointer',
                                border: isExploring ? 'none' : '1px solid rgba(59,130,246,0.5)',
                                color: '#fff',
                                background: isExploring ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                                animation: isExploring ? 'pulse 3s infinite' : 'none',
                            }}
                            onClick={() => {
                                if (isExploring) {
                                    autoExplorer.stop();
                                    setIsExploring(false);
                                    stopRobot();
                                } else if (selectedRobotId) {
                                    const getRobotState = () => useRobotStore.getState().robots[selectedRobotId];
                                    autoExplorer.start(selectedRobotId, getRobotState);
                                    setIsExploring(true);
                                }
                            }}
                        >
                            {isExploring ? '🧠 Đang Tự Chạy...' : '🚀 Tự Chạy Dò'}
                        </button>

                        {isExploring && (
                            <button
                                style={{
                                    padding: '5px 10px', borderRadius: '12px', fontSize: '11px', cursor: 'pointer',
                                    border: '1px solid rgba(250,204,21,0.4)', color: '#fbbf24', background: 'transparent',
                                }}
                                onClick={() => { autoExplorer.stop(); setIsExploring(false); }}
                                title="Tắt tự chạy để lái bằng bàn phím (WASD)"
                            >
                                🎮 Lái Tay
                            </button>
                        )}

                        {/* Đang vẽ tiếp map nào */}
                        {continuingMapId && (
                            <span style={{
                                fontSize: '10px', color: '#60a5fa', fontStyle: 'italic',
                                background: 'rgba(59,130,246,0.1)', padding: '3px 6px', borderRadius: '6px',
                            }}>
                                📝 Vẽ tiếp: {savedSlamMaps.find(m => m.id === continuingMapId)?.name}
                            </span>
                        )}

                        {/* Point counter */}
                        <span style={{
                            fontSize: '11px', color: '#a78bfa', fontFamily: 'monospace',
                            background: 'rgba(139, 92, 246, 0.15)', padding: '3px 8px', borderRadius: '8px',
                        }}>
                            📍 {mapPointCount.toLocaleString()} pts
                        </span>
                    </div>

                    {/* Bottom row: save */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                        {!showSaveDialog ? (
                            <button
                                style={{
                                    padding: '4px 10px', borderRadius: '10px', fontSize: '11px', cursor: 'pointer',
                                    border: '1px solid rgba(250,204,21,0.4)', color: '#fbbf24', background: 'transparent',
                                }}
                                onClick={() => { setShowSaveDialog(true); setMapName(continuingMapId ? (savedSlamMaps.find(m => m.id === continuingMapId)?.name || '') : `Map_${new Date().toLocaleTimeString('vi')}`); }}
                                disabled={mapPointCount === 0}
                            >
                                💾 {continuingMapId ? 'Cập Nhật Map' : 'Lưu Map Mới'}
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={mapName}
                                    onChange={e => setMapName(e.target.value)}
                                    style={{
                                        width: '140px', padding: '3px 6px', borderRadius: '8px', fontSize: '11px',
                                        border: '1px solid rgba(250,204,21,0.4)', background: 'rgba(0,0,0,0.3)', color: '#fff',
                                    }}
                                    placeholder="Tên map..."
                                    autoFocus
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            // Lấy points từ robotStore
                                            const rState = useRobotStore.getState().robots[selectedRobotId];
                                            const pts = rState?.accumulatedMap || [];
                                            const id = saveSlamMap(mapName, pts, continuingMapId);
                                            if (id) {
                                                setContinuingMapId(id); // Lần sau lưu sẽ ghi đè map này
                                                setMapSaveMsg('✅ Đã lưu!');
                                            }
                                            setShowSaveDialog(false);
                                            setTimeout(() => setMapSaveMsg(''), 2000);
                                        }
                                    }}
                                />
                                <button
                                    style={{ padding: '3px 8px', borderRadius: '8px', fontSize: '11px', border: 'none', background: '#fbbf24', color: '#000', cursor: 'pointer' }}
                                    onClick={() => {
                                        const rState = useRobotStore.getState().robots[selectedRobotId];
                                        const pts = rState?.accumulatedMap || [];
                                        const id = saveSlamMap(mapName, pts, continuingMapId);
                                        if (id) {
                                            setContinuingMapId(id);
                                            setMapSaveMsg('✅ Đã lưu!');
                                        }
                                        setShowSaveDialog(false);
                                        setTimeout(() => setMapSaveMsg(''), 2000);
                                    }}
                                >✓</button>
                                <button
                                    style={{ padding: '3px 6px', borderRadius: '8px', fontSize: '11px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#aaa', cursor: 'pointer' }}
                                    onClick={() => setShowSaveDialog(false)}
                                >✕</button>
                            </div>
                        )}

                        <button
                            style={{
                                padding: '4px 10px', borderRadius: '10px', fontSize: '11px', cursor: 'pointer',
                                border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', background: 'transparent',
                            }}
                            onClick={() => {
                                if (confirm('Xóa toàn bộ bản đồ đang vẽ?')) {
                                    clearMap(selectedRobotId);
                                    setContinuingMapId(null);
                                }
                            }}
                            disabled={mapPointCount === 0}
                        >
                            🗑️ Xóa
                        </button>

                        {mapSaveMsg && (
                            <span style={{ fontSize: '11px', color: '#4ade80', animation: 'fadeIn 0.3s' }}>{mapSaveMsg}</span>
                        )}
                    </div>
                </div>
            )}

            {/* Nút Bắt Đầu Vẽ Map (hiện khi KHÔNG mapping) */}
            {!settings.isMapping && (
                <div style={{
                    position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 10,
                }}>
                    <button
                        style={{
                            padding: '6px 16px', borderRadius: '14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                            border: 'none', color: '#fff',
                            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                            boxShadow: '0 0 12px rgba(34,197,94,0.3)',
                        }}
                        onClick={() => {
                            updateSettings({ isMapping: true });
                            setContinuingMapId(null); // Map mới
                        }}
                        disabled={!selectedRobotId}
                        title={!selectedRobotId ? 'Chọn robot trước' : ''}
                    >
                        ▶ Bắt Đầu Vẽ Map Mới
                    </button>
                </div>
            )}

            {/* Map Manager Modal */}
            {showMapManager && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
                    zIndex: 100, display: 'flex', justifyContent: 'center', alignItems: 'center',
                }} onClick={(e) => { if (e.target === e.currentTarget) setShowMapManager(false); }}>
                    <div style={{
                        background: 'rgba(15, 15, 35, 0.98)', borderRadius: '20px',
                        border: '1px solid rgba(139, 92, 246, 0.3)', padding: '20px',
                        width: '420px', maxHeight: '80vh', overflowY: 'auto',
                        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '16px' }}>🗺️ Quản Lý Bản Đồ</h3>
                            <button
                                onClick={() => setShowMapManager(false)}
                                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}
                            >✕</button>
                        </div>

                        {/* Mock map option */}
                        <div style={{
                            padding: '10px 12px', borderRadius: '12px', marginBottom: '8px', cursor: 'pointer',
                            background: activeMapSource === 'mock' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)',
                            border: activeMapSource === 'mock' ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(255,255,255,0.08)',
                        }} onClick={() => { activateMockMap(); setShowMapManager(false); }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '20px' }}>🏭</span>
                                <div>
                                    <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Map Giả Lập (Warehouse)</div>
                                    <div style={{ color: '#94a3b8', fontSize: '11px' }}>15×15m • 6 zones • 3 docks</div>
                                </div>
                                {activeMapSource === 'mock' && <span style={{ marginLeft: 'auto', color: '#4ade80', fontSize: '11px' }}>✓ Đang dùng</span>}
                            </div>
                        </div>

                        {/* Saved SLAM maps */}
                        <div style={{ color: '#94a3b8', fontSize: '11px', margin: '16px 0 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            📍 Bản đồ robot đã vẽ ({savedSlamMaps.length})
                        </div>

                        {savedSlamMaps.length === 0 ? (
                            <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '12px', fontStyle: 'italic' }}>
                                Chưa có bản đồ nào. Bấm "Bắt Đầu Vẽ Map Mới" để tạo.
                            </div>
                        ) : (
                            savedSlamMaps.map(m => (
                                <div key={m.id} style={{
                                    padding: '10px 12px', borderRadius: '12px', marginBottom: '6px',
                                    background: activeMapId === m.id ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.03)',
                                    border: activeMapId === m.id ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(255,255,255,0.08)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '20px' }}>{activeMapId === m.id ? '📍' : '🗺️'}</span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 500 }}>{m.name}</div>
                                            <div style={{ color: '#94a3b8', fontSize: '10px' }}>
                                                {m.pointCount.toLocaleString()} pts • {m.bounds?.width}×{m.bounds?.height}m • {new Date(m.timestamp).toLocaleDateString('vi')}
                                            </div>
                                        </div>
                                        {activeMapId === m.id && <span style={{ color: '#60a5fa', fontSize: '10px' }}>✓ Active</span>}
                                    </div>

                                    {/* Action buttons */}
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                                        <button
                                            style={{
                                                padding: '3px 10px', borderRadius: '8px', fontSize: '10px', cursor: 'pointer',
                                                border: 'none', color: '#fff',
                                                background: activeMapId === m.id ? 'rgba(96,165,250,0.3)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                            }}
                                            onClick={() => { activateSlamMap(m.id); setShowMapManager(false); }}
                                            disabled={activeMapId === m.id}
                                        >
                                            🎯 Dùng Map Này
                                        </button>

                                        <button
                                            style={{
                                                padding: '3px 10px', borderRadius: '8px', fontSize: '10px', cursor: 'pointer',
                                                border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', background: 'transparent',
                                            }}
                                            onClick={() => {
                                                // Tải points vào robot → vẽ tiếp
                                                const pts = loadSlamMapPoints(m.id);
                                                if (pts.length > 0 && selectedRobotId) {
                                                    useRobotStore.setState(state => ({
                                                        robots: {
                                                            ...state.robots,
                                                            [selectedRobotId]: {
                                                                ...state.robots[selectedRobotId],
                                                                accumulatedMap: pts,
                                                            }
                                                        }
                                                    }));
                                                    setContinuingMapId(m.id);
                                                    updateSettings({ isMapping: true });
                                                    setShowMapManager(false);
                                                    setMapSaveMsg(`📝 Đang vẽ tiếp: ${m.name}`);
                                                    setTimeout(() => setMapSaveMsg(''), 3000);
                                                }
                                            }}
                                            disabled={!selectedRobotId}
                                        >
                                            ✏️ Vẽ Tiếp
                                        </button>

                                        <button
                                            style={{
                                                padding: '3px 10px', borderRadius: '8px', fontSize: '10px', cursor: 'pointer',
                                                border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', background: 'transparent',
                                            }}
                                            onClick={() => {
                                                if (confirm(`Xóa vĩnh viễn map "${m.name}"?`)) {
                                                    deleteSlamMap(m.id);
                                                }
                                            }}
                                        >
                                            🗑
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}

                        {/* Import map from file */}
                        <div style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
                            <button
                                style={{
                                    padding: '6px 14px', borderRadius: '10px', fontSize: '11px', cursor: 'pointer', width: '100%',
                                    border: '1px dashed rgba(139,92,246,0.4)', color: '#a78bfa', background: 'transparent',
                                }}
                                onClick={() => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.accept = '.json';
                                    input.onchange = (e) => {
                                        const file = e.target.files[0];
                                        if (!file) return;
                                        const reader = new FileReader();
                                        reader.onload = (ev) => {
                                            try {
                                                const data = JSON.parse(ev.target.result);
                                                const pts = data.points || data;
                                                if (Array.isArray(pts) && pts.length > 0) {
                                                    const name = data.name || file.name.replace('.json', '');
                                                    saveSlamMap(name, pts);
                                                    setMapSaveMsg(`📥 Đã nhập: ${name}`);
                                                    setTimeout(() => setMapSaveMsg(''), 2000);
                                                }
                                            } catch (err) {
                                                alert('File không hợp lệ!');
                                            }
                                        };
                                        reader.readAsText(file);
                                    };
                                    input.click();
                                }}
                            >
                                📥 Nhập Map Từ File JSON
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
