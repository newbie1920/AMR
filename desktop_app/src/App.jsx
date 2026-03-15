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

    // Keyboard controls for selected robot
    useEffect(() => {
        const keysPressed = new Set();
        let velocityInterval = null;

        const updateVelocity = () => {
            if (!selectedRobotId) return;

            const robot = robots.find(r => r.id === selectedRobotId);
            if (!robot?.connected) return;

            let linear = 0;
            let angular = 0;

            // Use robot's max speeds as a base for keyboard control
            const linearSpeed = robot.maxLinearSpeed || 0.3;
            const angularSpeed = robot.maxAngularSpeed || 0.5;

            if (keysPressed.has('KeyW') || keysPressed.has('ArrowUp')) linear += linearSpeed;
            if (keysPressed.has('KeyS') || keysPressed.has('ArrowDown')) linear -= linearSpeed;
            if (keysPressed.has('KeyA') || keysPressed.has('ArrowLeft')) angular += angularSpeed;
            if (keysPressed.has('KeyD') || keysPressed.has('ArrowRight')) angular -= angularSpeed;

            if (linear !== 0 || angular !== 0) {
                sendVelocity(selectedRobotId, linear, angular);
            }
        };

        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault();
                keysPressed.add(e.code);

                if (!velocityInterval) {
                    updateVelocity();
                    velocityInterval = setInterval(updateVelocity, 100);
                }
            }

            if (e.code === 'Space') {
                e.preventDefault();
                if (selectedRobotId) stopRobot(selectedRobotId);
            }

            // Cancel waypoint selection with Escape
            if (e.code === 'Escape' && isSelectingWaypoint) {
                handleCancelWaypointSelect();
            }
        };

        const handleKeyUp = (e) => {
            const wasMovementKey = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
            keysPressed.delete(e.code);

            // Check if any movement keys are still pressed
            const hasMovementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
                .some(key => keysPressed.has(key));

            if (wasMovementKey && !hasMovementKeys) {
                // Stop immediately when no movement keys are pressed
                if (velocityInterval) {
                    clearInterval(velocityInterval);
                    velocityInterval = null;
                }
                // Send stop command immediately
                if (selectedRobotId) {
                    stopRobot(selectedRobotId);
                }
            } else if (wasMovementKey && hasMovementKeys) {
                // Still have some keys pressed, update velocity
                updateVelocity();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            if (velocityInterval) clearInterval(velocityInterval);
        };
    }, [selectedRobotId, robots, sendVelocity, stopRobot, isSelectingWaypoint, handleCancelWaypointSelect]);

    return (
        <Layout>
            <div className="fleet-app">
                <Group id="main-layout" orientation="horizontal" className="main-panel-group">
                    {/* Left Sidebar - Fleet + Map Editor + Warehouse */}
                    <Panel id="left-sidebar" defaultSize={33} minSize={10}>
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
                    <Panel id="main-content" defaultSize={34} minSize={10}>
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
                    <Panel id="right-sidebar" defaultSize={33} minSize={10}>
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
