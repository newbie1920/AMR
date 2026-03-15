import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import { useMapStore } from '../../stores/mapStore';
import MapEditorModal from '../MapEditor/MapEditorModal';
import translations from '../../translations';
import './WarehouseMap.css';

const WarehouseMap = () => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const {
        robots,
        selectedRobotId,
        selectRobot,
        clearTraveledPath,
        settings,
    } = useFleetStore();

    const [scale, setScale] = useState(40); // pixels per meter
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const [showGrid, setShowGrid] = useState(true);
    const [showPath, setShowPath] = useState(true);
    const [showEditor, setShowEditor] = useState(false);

    const {
        width: WAREHOUSE_WIDTH,
        height: WAREHOUSE_HEIGHT,
        zones: warehouseZones,
        docks
    } = useMapStore();

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    // Warehouse layout (15x15m)


    // Convert world coordinates to canvas coordinates
    const worldToCanvas = useCallback((wx, wy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        // Center the warehouse in the canvas
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        return {
            x: centerX + (wx - WAREHOUSE_WIDTH / 2) * scale + offset.x,
            y: centerY - (wy - WAREHOUSE_HEIGHT / 2) * scale + offset.y
        };
    }, [scale, offset, WAREHOUSE_WIDTH, WAREHOUSE_HEIGHT]);

    // Draw the warehouse map
    const drawMap = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw warehouse boundary
        const topLeft = worldToCanvas(0, WAREHOUSE_HEIGHT);
        const bottomRight = worldToCanvas(WAREHOUSE_WIDTH, 0);

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 3;
        ctx.strokeRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
        );

        // Draw grid
        if (showGrid) {
            ctx.strokeStyle = '#1a1a3a';
            ctx.lineWidth = 1;

            for (let i = 0; i <= WAREHOUSE_WIDTH; i++) {
                const start = worldToCanvas(i, 0);
                const end = worldToCanvas(i, WAREHOUSE_HEIGHT);
                ctx.beginPath();
                ctx.moveTo(start.x, start.y);
                ctx.lineTo(end.x, end.y);
                ctx.stroke();
            }

            for (let i = 0; i <= WAREHOUSE_HEIGHT; i++) {
                const startH = worldToCanvas(0, i);
                const endH = worldToCanvas(WAREHOUSE_WIDTH, i);
                ctx.beginPath();
                ctx.moveTo(startH.x, startH.y);
                ctx.lineTo(endH.x, endH.y);
                ctx.stroke();
            }
        }

        // Draw warehouse zones
        // Draw warehouse zones
        warehouseZones.forEach(zone => {
            const topLeft = worldToCanvas(zone.x, zone.y + zone.height);
            const bottomRight = worldToCanvas(zone.x + zone.width, zone.y);

            // Zone background
            ctx.fillStyle = (zone.color || '#95a5a6') + '20';
            ctx.fillRect(
                topLeft.x,
                topLeft.y,
                bottomRight.x - topLeft.x,
                bottomRight.y - topLeft.y
            );

            // Zone border
            ctx.strokeStyle = zone.color || '#95a5a6';
            ctx.lineWidth = 2;
            ctx.strokeRect(
                topLeft.x,
                topLeft.y,
                bottomRight.x - topLeft.x,
                bottomRight.y - topLeft.y
            );

            // Zone label
            const label = zone.label || zone.type;
            const centerPos = worldToCanvas(
                zone.x + zone.width / 2,
                zone.y + zone.height / 2
            );
            ctx.fillStyle = zone.color || '#95a5a6';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, centerPos.x, centerPos.y);
        });

        // Draw robot docks
        docks.forEach(dock => {
            const pos = worldToCanvas(dock.x, dock.y);
            const size = 15;

            // Dock background
            ctx.fillStyle = '#2c3e5066';
            ctx.strokeStyle = '#95a5a6';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(pos.x - size, pos.y - size, size * 2, size * 2);
            ctx.fill();
            ctx.stroke();

            // Orientation arrow
            const angleRad = -(dock.theta || 0) * (Math.PI / 180);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(
                pos.x + Math.cos(angleRad) * size,
                pos.y + Math.sin(angleRad) * size
            );
            ctx.stroke();

            // Label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(dock.label || dock.id, pos.x, pos.y - size - 5);
        });

        // Draw robots with their paths
        robots.forEach(robot => {
            if (!robot.pose) return;

            const robotPos = worldToCanvas(robot.pose.x, robot.pose.y);
            const robotSize = 12;
            const isSelected = robot.id === selectedRobotId;

            // Draw traveled path
            if (showPath && robot.traveledPath && robot.traveledPath.length > 1) {
                ctx.strokeStyle = robot.color + '80';
                ctx.lineWidth = 2;
                ctx.beginPath();
                const firstPoint = worldToCanvas(robot.traveledPath[0].x, robot.traveledPath[0].y);
                ctx.moveTo(firstPoint.x, firstPoint.y);

                for (let i = 1; i < robot.traveledPath.length; i++) {
                    const point = worldToCanvas(robot.traveledPath[i].x, robot.traveledPath[i].y);
                    ctx.lineTo(point.x, point.y);
                }
                ctx.stroke();
            }

            // Robot glow effect
            if (robot.connected) {
                const gradient = ctx.createRadialGradient(
                    robotPos.x, robotPos.y, 0,
                    robotPos.x, robotPos.y, robotSize * 2.5
                );
                gradient.addColorStop(0, robot.color + '66');
                gradient.addColorStop(1, 'transparent');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(robotPos.x, robotPos.y, robotSize * 2.5, 0, Math.PI * 2);
                ctx.fill();
            }

            // Selection ring
            if (isSelected) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(robotPos.x, robotPos.y, robotSize + 10, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Robot body (triangle pointing in direction)
            ctx.save();
            ctx.translate(robotPos.x, robotPos.y);
            ctx.rotate(-(robot.pose.theta || 0));

            // Triangle shape
            ctx.beginPath();
            ctx.moveTo(robotSize, 0);
            ctx.lineTo(-robotSize * 0.7, -robotSize * 0.6);
            ctx.lineTo(-robotSize * 0.5, 0);
            ctx.lineTo(-robotSize * 0.7, robotSize * 0.6);
            ctx.closePath();

            ctx.fillStyle = robot.connected ? robot.color : '#444';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.restore();

            // Robot info label
            ctx.fillStyle = '#ffffff';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(robot.name, robotPos.x, robotPos.y + robotSize + 15);

            // Position info
            if (isSelected) {
                ctx.font = '10px JetBrains Mono, monospace';
                ctx.fillStyle = '#00d4ff';
                ctx.fillText(
                    `(${robot.pose.x.toFixed(2)}, ${robot.pose.y.toFixed(2)})`,
                    robotPos.x,
                    robotPos.y + robotSize + 28
                );
            }

            // Status indicator
            if (robot.connected && robot.status !== 'idle') {
                ctx.fillStyle = robot.status === 'moving' ? '#3b82f6' :
                    robot.status === 'working' ? '#f59e0b' : '#ef4444';
                ctx.beginPath();
                ctx.arc(robotPos.x + robotSize, robotPos.y - robotSize, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Draw compass
        const compassX = canvas.width - 60;
        const compassY = 60;
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(compassX, compassY, 30, 0, Math.PI * 2);
        ctx.stroke();

        // North arrow
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.moveTo(compassX, compassY - 20);
        ctx.lineTo(compassX - 5, compassY - 10);
        ctx.lineTo(compassX + 5, compassY - 10);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('N', compassX, compassY - 25);

        // Draw info
        ctx.fillStyle = '#6b6b8a';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(
            `${t('map')}: ${WAREHOUSE_WIDTH}x${WAREHOUSE_HEIGHT}m | ${t('scale')}: ${scale.toFixed(0)} px/m | ${t('robots')}: ${robots.length}`,
            10,
            canvas.height - 10
        );

    }, [robots, selectedRobotId, scale, offset, showGrid, showPath, worldToCanvas, t]);

    // Resize canvas
    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;

            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            drawMap();
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [drawMap]);

    // Animation loop
    useEffect(() => {
        let animationId;

        const animate = () => {
            drawMap();
            animationId = requestAnimationFrame(animate);
        };

        animate();
        return () => cancelAnimationFrame(animationId);
    }, [drawMap]);

    // Wheel zoom handler
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setScale(prev => Math.min(Math.max(prev * delta, 15), 100));
        };

        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, []);

    // Mouse handlers
    const handleMouseDown = (e) => {
        if (e.button === 0) {
            setIsDragging(true);
            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging) {
            const dx = e.clientX - lastMousePosRef.current.x;
            const dy = e.clientY - lastMousePosRef.current.y;
            setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleClick = (e) => {
        if (isDragging) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Check if clicked on a robot
        for (const robot of robots) {
            if (!robot.pose) continue;
            const robotPos = worldToCanvas(robot.pose.x, robot.pose.y);
            const distance = Math.sqrt(
                Math.pow(cx - robotPos.x, 2) + Math.pow(cy - robotPos.y, 2)
            );
            if (distance < 20) {
                selectRobot(robot.id);
                return;
            }
        }
    };

    const resetView = () => {
        setScale(40);
        setOffset({ x: 0, y: 0 });
    };

    return (
        <div className="warehouse-map" ref={containerRef}>
            <canvas
                ref={canvasRef}
                className="map-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleClick}
            />

            <div className="map-controls">
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={() => setScale(prev => Math.min(prev * 1.2, 100))}
                    title={t('zoom_in')}
                >
                    +
                </button>
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={() => setScale(prev => Math.max(prev * 0.8, 15))}
                    title={t('zoom_out')}
                >
                    −
                </button>
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={resetView}
                    title={t('reset_view')}
                >
                    ⟲
                </button>
                <button
                    className={`btn btn-icon btn-secondary ${showGrid ? 'active' : ''}`}
                    onClick={() => setShowGrid(!showGrid)}
                    title={t('toggle_grid')}
                >
                    #
                </button>
                <button
                    className={`btn btn-icon btn-secondary ${showPath ? 'active' : ''}`}
                    onClick={() => setShowPath(!showPath)}
                    title={t('toggle_path')}
                >
                    ⤴
                </button>
                <button
                    className={`btn btn-icon btn-secondary ${showEditor ? 'active' : ''}`}
                    onClick={() => setShowEditor(true)}
                    title={t('edit_map')}
                >
                    ✎
                </button>
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={() => {
                        if (selectedRobotId) {
                            clearTraveledPath(selectedRobotId);
                        } else {
                            // If no robot selected, clear all
                            const fs = useFleetStore.getState();
                            if (fs.clearAllTraveledPaths) fs.clearAllTraveledPaths();
                        }
                    }}
                    onDoubleClick={() => {
                        // Double click always clears all
                        const fs = useFleetStore.getState();
                        if (fs.clearAllTraveledPaths) fs.clearAllTraveledPaths();
                    }}
                    title={selectedRobotId ? t('clear_path_desc') : t('clear_all_paths_desc')}
                >
                    🧹
                </button>
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={() => {
                        const fs = useFleetStore.getState();
                        if (fs.clearAllTraveledPaths) fs.clearAllTraveledPaths();
                    }}
                    title={t('clear_all_paths_desc')}
                >
                    🧺
                </button>
            </div>

            {showEditor && (
                <MapEditorModal onClose={() => setShowEditor(false)} />
            )}

            <div className="warehouse-legend">
                <h4>{t('warehouse_zones')}</h4>
                {warehouseZones.map((zone) => (
                    <div key={zone.id} className="legend-zone">
                        <span
                            className="zone-color"
                            style={{ backgroundColor: zone.color }}
                        />
                        <span className="zone-name">{zone.label || t(zone.type)}</span>
                    </div>
                ))}
                <div className="legend-zone">
                    <span className="zone-color" style={{ backgroundColor: '#2c3e50', border: '1px solid #95a5a6' }} />
                    <span className="zone-name">{t('robot_dock')}</span>
                </div>
            </div>
        </div >
    );
};

export default WarehouseMap;
