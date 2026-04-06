import React, { useEffect, useState, useCallback, useRef } from 'react';
import Layout from './components/Layout/Layout';
import FleetPanel from './components/FleetPanel/FleetPanel';
import Map3D from './components/Map3D/Map3D';
import RightSidebar from './components/RightSidebar/RightSidebar';
import FleetStatusBar from './components/FleetStatusBar/FleetStatusBar';
import MapEditorModal from './components/MapEditor/MapEditorModal';
import WarehouseMap from './components/WarehouseMap/WarehouseMap';
import { useFleetStore } from './stores/fleetStore';
import { useRobotStore } from './stores/robotStore';
import translations from './translations';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useWorkflowEngine } from './lib/useWorkflowEngine';
import './App.css';


function App() {
    const {
        robots,
        selectedRobotId,
        sendVelocity,
        stopRobot,
        selectRobot,
        settings,
        connectAllRobots,
    } = useFleetStore();

    const syncFleetPositions = useRobotStore(state => state.syncFleetPositions);

    // Engine Hooks
    useWorkflowEngine();

    // 2. State Hooks
    const [isSelectingWaypoint, setIsSelectingWaypoint] = useState(false);
    const [waypointCallback, setWaypointCallback] = useState(null);
    const [leftActiveTab, setLeftActiveTab] = useState('fleet');

    // 3. Ref Hooks
    const leftTabsRef = useRef(null);

    // 4. Callbacks
    const handleWaypointClick = useCallback((point) => {
        if (waypointCallback) {
            waypointCallback(point);
        }
    }, [waypointCallback]);

    const handleStartWaypointSelect = useCallback((callback) => {
        setIsSelectingWaypoint(true);
        setWaypointCallback(() => callback);
    }, []);

    const handleCancelWaypointSelect = useCallback(() => {
        setIsSelectingWaypoint(false);
        setWaypointCallback(null);
    }, []);

    // 5. Effects
    // Auto-connect on startup
    useEffect(() => {
        if (settings.autoReconnect) {
            connectAllRobots();
        }
    }, [connectAllRobots, settings.autoReconnect]);

    // Fleet coordination loop
    useEffect(() => {
        const interval = setInterval(() => {
            syncFleetPositions();
        }, 250); // 4Hz coordination sync
        return () => clearInterval(interval);
    }, [syncFleetPositions]);

    // Handle mouse wheel over left tabs
    useEffect(() => {
        const el = leftTabsRef.current;
        if (!el) return;

        const handleWheel = (e) => {
            const delta = e.deltaY || e.deltaX;
            if (Math.abs(delta) > 5) {
                e.preventDefault();
                el.scrollLeft += delta;
            }
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, []);

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    // Persistent keyboard state to avoid resets during robot telemetry updates
    const keysPressed = useRef(new Set());
    const currentLinear = useRef(0);
    const currentAngular = useRef(0);
    const velocityInterval = useRef(null);
    const lastSentStop = useRef(false);

    useEffect(() => {
        const UPDATE_MS = 50; // 20Hz - Smoother control
        const ACCEL_RATE = 1.0;  // Instant accel
        const DECEL_RATE = 0.15; // Fast but visible decel for tapping

        const updateVelocity = () => {
            const { robots, selectedRobotId, sendVelocity, stopRobot } = useFleetStore.getState();
            if (!selectedRobotId) return;

            const robot = robots.find(r => r.id === selectedRobotId);
            if (!robot?.connected) return;

            const linearSpeed = robot.linearSpeed || 0.25;
            const angularSpeed = robot.angularSpeed || 2.0;

            let targetLinear = 0;
            let targetAngular = 0;

            if (keysPressed.current.has('KeyW') || keysPressed.current.has('ArrowUp')) targetLinear += linearSpeed;
            if (keysPressed.current.has('KeyS') || keysPressed.current.has('ArrowDown')) targetLinear -= linearSpeed;
            if (keysPressed.current.has('KeyA') || keysPressed.current.has('ArrowLeft')) targetAngular += angularSpeed;
            if (keysPressed.current.has('KeyD') || keysPressed.current.has('ArrowRight')) targetAngular -= angularSpeed;

            // Apply fast deceleration so tapping the key sends commands for a few cycles
            if (targetLinear !== 0) {
                currentLinear.current = targetLinear;
            } else {
                if (currentLinear.current > 0) currentLinear.current = Math.max(0, currentLinear.current - DECEL_RATE);
                else if (currentLinear.current < 0) currentLinear.current = Math.min(0, currentLinear.current + DECEL_RATE);
            }

            if (targetAngular !== 0) {
                currentAngular.current = targetAngular;
            } else {
                if (currentAngular.current > 0) currentAngular.current = Math.max(0, currentAngular.current - DECEL_RATE * 4);
                else if (currentAngular.current < 0) currentAngular.current = Math.min(0, currentAngular.current + DECEL_RATE * 4);
            }

            // Zero out tiny values
            if (Math.abs(currentLinear.current) < 0.01) currentLinear.current = 0;
            if (Math.abs(currentAngular.current) < 0.05) currentAngular.current = 0;

            if (currentLinear.current !== 0 || currentAngular.current !== 0 || targetLinear !== 0 || targetAngular !== 0) {
                sendVelocity(selectedRobotId, currentLinear.current, currentAngular.current);
                lastSentStop.current = false;
            } else if (!lastSentStop.current) {
                stopRobot(selectedRobotId);
                lastSentStop.current = true;
            }

            // Auto-stop interval if no keys pressed and speeds are zero
            if (currentLinear.current === 0 && currentAngular.current === 0) {
                const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
                const hasMovement = movementKeys.some(key => keysPressed.current.has(key));
                if (!hasMovement) {
                    console.log('[KeyboardControl] Loop stopped (idle)');
                    if (velocityInterval.current) {
                        clearInterval(velocityInterval.current);
                        velocityInterval.current = null;
                    }
                }
            }
        };

        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
            if (movementKeys.includes(e.code)) {
                e.preventDefault();
                
                // Get current state to avoid stale closure issues
                const { selectedRobotId } = useFleetStore.getState();
                const { stopMission } = useRobotStore.getState();

                // ONLY trigger manual override once when starting a movement sequence
                const isFirstKey = keysPressed.current.size === 0;
                keysPressed.current.add(e.code);

                if (isFirstKey && selectedRobotId) {
                    console.log(`[Manual Control] Manual override START for robot ${selectedRobotId}`);
                    // STOP any autonomous task (navigation, exploration, mission)
                    if (stopMission) stopMission(selectedRobotId);

                    import('./lib/autoExplorer').then(mod => {
                        const autoExplorer = mod.default;
                        autoExplorer.stop();
                    });

                    // Stop legacy AutoExplorer if active
                    if (window.exploreActive && e.code !== 'Space') {
                        console.log('[Manual Override] Stopping legacy AutoExplorer');
                        if (window.exploreInterval) clearInterval(window.exploreInterval);
                        window.exploreActive = false;
                    }
                }

                if (!velocityInterval.current) {
                    velocityInterval.current = setInterval(updateVelocity, UPDATE_MS);
                }
            }

            if (e.code === 'Space') {
                e.preventDefault();
                currentLinear.current = 0;
                currentAngular.current = 0;
                const { selectedRobotId, stopRobot } = useFleetStore.getState();
                if (selectedRobotId) stopRobot(selectedRobotId);
            }

            if (e.code === 'Escape' && isSelectingWaypoint) {
                handleCancelWaypointSelect();
            }
        };

        const handleKeyUp = (e) => {
            keysPressed.current.delete(e.code);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // [BUGFIX] Ensure loop restarts if keys were already held during effect re-run
        // This prevents the robot from stopping when dependencies like 'isSelectingWaypoint' change
        const checkAndRestartLoop = () => {
             const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
             const hasMovement = movementKeys.some(k => keysPressed.current.has(k));
             if (hasMovement && !velocityInterval.current) {
                 console.log('[KeyboardControl] Restarting loop after effect re-run');
                 velocityInterval.current = setInterval(updateVelocity, UPDATE_MS);
             }
        };
        checkAndRestartLoop();

        return () => {
            console.log('[KeyboardControl] Cleaning up effect');
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            if (velocityInterval.current) {
                clearInterval(velocityInterval.current);
                velocityInterval.current = null;
            }
        };
    }, [isSelectingWaypoint, handleCancelWaypointSelect]);


    return (
        <Layout>
            <div className="fleet-app">
                <Group id="main-layout" orientation="horizontal" className="main-panel-group">
                    {/* Left Sidebar - Fleet + Map Editor + Warehouse */}
                    <Panel id="left-sidebar" defaultSize={20} minSize={10}>
                        <aside className="sidebar left-sidebar">
                            {/* Tab switcher */}
                            <div className="left-sidebar-tabs" ref={leftTabsRef}>
                                <button
                                    className={`left-tab-btn ${leftActiveTab === 'fleet' ? 'active' : ''}`}
                                    onClick={() => setLeftActiveTab('fleet')}
                                >
                                    <span className="left-tab-icon">🤖</span>
                                    <span className="left-tab-text">{t('fleet')}</span>
                                </button>
                                <button
                                    className={`left-tab-btn ${leftActiveTab === 'editor' ? 'active' : ''}`}
                                    onClick={() => setLeftActiveTab('editor')}
                                >
                                    <span className="left-tab-icon">🏗️</span>
                                    <span className="left-tab-text">{t('map_editor')}</span>
                                </button>
                                <button
                                    className={`left-tab-btn ${leftActiveTab === 'warehouse' ? 'active' : ''}`}
                                    onClick={() => setLeftActiveTab('warehouse')}
                                >
                                    <span className="left-tab-icon">📦</span>
                                    <span className="left-tab-text">{t('warehouse_map')}</span>
                                </button>
                            </div>
                            {/* Tab content */}
                            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                                {leftActiveTab === 'fleet' && <FleetPanel />}
                                {leftActiveTab === 'editor' && <MapEditorModal onClose={() => setLeftActiveTab('warehouse')} />}
                                {leftActiveTab === 'warehouse' && <WarehouseMap />}
                            </div>
                        </aside>
                    </Panel>

                    <Separator id="s1" className="resize-handle" />

                    {/* Main Content - 3D Map */}
                    <Panel id="main-content" defaultSize={50} minSize={10}>
                        <main className="main-content">
                            <div className="content-top">
                                <Map3D
                                    onWaypointClick={handleWaypointClick}
                                    isSelectingWaypoint={isSelectingWaypoint}
                                />
                            </div>
                        </main>
                    </Panel>

                    <Separator id="s2" className="resize-handle" />

                    {/* Right Sidebar - Control & Tasks */}
                    <Panel id="right-sidebar" defaultSize={30} minSize={10}>
                        <aside className="sidebar right-sidebar">
                            <RightSidebar
                                onSelectWaypoint={handleStartWaypointSelect}
                                isSelectingWaypoint={isSelectingWaypoint}
                                onCancelWaypointSelect={handleCancelWaypointSelect}
                            />
                        </aside>
                    </Panel>
                </Group>

                {/* Bottom Status Bar */}
                <footer className="status-bar-container">
                    <FleetStatusBar />
                </footer>
            </div>
        </Layout>
    );
}

export default App;
