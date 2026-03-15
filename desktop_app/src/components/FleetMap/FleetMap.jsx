import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import { useMissionStore } from '../../stores/missionStore';
import './FleetMap.css';

const FleetMap = () => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const {
        robots,
        selectedRobotId,
        selectRobot,
    } = useFleetStore();

    const { missions } = useMissionStore();

    const [scale, setScale] = useState(50); // pixels per meter
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });

    // Convert world coordinates to canvas coordinates
    const worldToCanvas = useCallback((wx, wy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        return {
            x: canvas.width / 2 + (wx * scale) + offset.x,
            y: canvas.height / 2 - (wy * scale) + offset.y
        };
    }, [scale, offset]);

    // Convert canvas coordinates to world coordinates
    const canvasToWorld = useCallback((cx, cy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        return {
            x: (cx - canvas.width / 2 - offset.x) / scale,
            y: -(cy - canvas.height / 2 - offset.y) / scale
        };
    }, [scale, offset]);

    // Draw the map with all robots
    const drawMap = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        ctx.strokeStyle = '#1a1a3a';
        ctx.lineWidth = 1;

        const gridSize = scale;
        const startX = (offset.x % gridSize) + (canvas.width / 2) % gridSize;
        const startY = (offset.y % gridSize) + (canvas.height / 2) % gridSize;

        for (let x = startX; x < canvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        for (let y = startY; y < canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Draw origin cross
        const origin = worldToCanvas(0, 0);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(origin.x - 20, origin.y);
        ctx.lineTo(origin.x + 20, origin.y);
        ctx.moveTo(origin.x, origin.y - 20);
        ctx.lineTo(origin.x, origin.y + 20);
        ctx.stroke();

        // Draw all robots
        robots.forEach(robot => {
            const robotPos = worldToCanvas(robot.pose?.x || 0, robot.pose?.y || 0);
            const robotSize = 15;
            const isSelected = robot.id === selectedRobotId;

            // Robot glow
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
                ctx.arc(robotPos.x, robotPos.y, robotSize + 8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Robot body (triangle pointing in direction)
            ctx.save();
            ctx.translate(robotPos.x, robotPos.y);
            ctx.rotate(-(robot.pose?.theta || 0));

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

            // Robot name label
            ctx.fillStyle = '#ffffff';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(robot.name, robotPos.x, robotPos.y + robotSize + 15);

            // Status indicator
            if (robot.connected && robot.status !== 'idle') {
                ctx.fillStyle = robot.status === 'moving' ? '#3b82f6' :
                    robot.status === 'working' ? '#f59e0b' : '#ef4444';
                ctx.beginPath();
                ctx.arc(robotPos.x + robotSize, robotPos.y - robotSize, 5, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Draw mission overlay and HUD for each robot
        robots.forEach(robot => {
            const mission = missions.find(m =>
                m.assignedRobotId === robot.id &&
                (m.status === 'active' || m.status === 'assigned')
            );

            const robotPos = worldToCanvas(robot.pose?.x || 0, robot.pose?.y || 0);

            // 1. Draw Mission Path & Waypoints
            if (mission) {
                // Draw planned path if available
                if (mission.plannedPath && mission.plannedPath.length > 0) {
                    ctx.strokeStyle = robot.color + '44';
                    ctx.setLineDash([5, 5]);
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    const startP = worldToCanvas(mission.plannedPath[0].x, mission.plannedPath[0].y);
                    ctx.moveTo(startP.x, startP.y);
                    for (let i = 1; i < mission.plannedPath.length; i++) {
                        const p = worldToCanvas(mission.plannedPath[i].x, mission.plannedPath[i].y);
                        ctx.lineTo(p.x, p.y);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Draw Waypoints
                mission.waypoints.forEach((wp, idx) => {
                    const wpPos = worldToCanvas(wp.x, wp.y);
                    const isCurrent = idx === mission.currentWaypointIndex && mission.status === 'active';

                    // Waypoint circle
                    ctx.fillStyle = isCurrent ? '#ffffff' : robot.color + 'aa';
                    ctx.beginPath();
                    ctx.arc(wpPos.x, wpPos.y, 6, 0, Math.PI * 2);
                    ctx.fill();

                    // Glow for current waypoint
                    if (isCurrent) {
                        ctx.shadowBlur = 10;
                        ctx.shadowColor = '#ffffff';
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.shadowBlur = 0;
                    }

                    // Waypoint label (number)
                    ctx.fillStyle = isCurrent ? '#000000' : '#ffffff';
                    ctx.font = 'bold 9px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText((idx + 1).toString(), wpPos.x, wpPos.y);
                    ctx.textBaseline = 'alphabetic';
                });
            }

            // 2. Draw Robot HUD (Heads-Up Display)
            if (robot.connected) {
                const hudX = robotPos.x + 25;
                const hudY = robotPos.y - 25;

                // HUD Background
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.roundRect?.(hudX, hudY, 115, 70, 6) || ctx.fillRect(hudX, hudY, 115, 70);
                ctx.fill();
                ctx.strokeStyle = robot.color + 'aa';
                ctx.lineWidth = 1;
                ctx.stroke();

                // HUD Text
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'left';
                ctx.font = '10px monospace';

                const linVel = robot.telemetry?.vx?.toFixed(2) || '0.00';
                const angVel = robot.telemetry?.wz?.toFixed(2) || '0.00';

                ctx.fillText(`V: ${linVel}  W: ${angVel}`, hudX + 5, hudY + 15);

                // PID Target vs Real
                const vLt = robot.telemetry?.vL_t?.toFixed(2) || '0.00';
                const vLr = robot.telemetry?.vL_r?.toFixed(2) || '0.00';
                const vRt = robot.telemetry?.vR_t?.toFixed(2) || '0.00';
                const vRr = robot.telemetry?.vR_r?.toFixed(2) || '0.00';

                ctx.fillStyle = '#ff4d4f'; // Target color
                ctx.fillText(`L T/R: ${vLt}/${vLr}`, hudX + 5, hudY + 28);
                ctx.fillStyle = '#1890ff'; // Real color
                ctx.fillText(`R T/R: ${vRt}/${vRr}`, hudX + 5, hudY + 41);

                if (mission && mission.status === 'active') {
                    const progress = `${mission.currentWaypointIndex + 1}/${mission.waypoints.length}`;
                    ctx.fillStyle = '#3b82f6';
                    ctx.fillText(`TASK: ${progress}`, hudX + 5, hudY + 58);
                }
            }
        });

        // Draw general info
        ctx.fillStyle = '#6b6b8a';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Robots: ${robots.length} | Scale: ${scale.toFixed(0)} px/m`, 10, canvas.height - 10);

    }, [robots, missions, selectedRobotId, scale, offset, worldToCanvas]);

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

    // Wheel zoom handler (non-passive to allow preventDefault)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setScale(prev => Math.min(Math.max(prev * delta, 10), 200));
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
            const robotPos = worldToCanvas(robot.pose?.x || 0, robot.pose?.y || 0);
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
        setScale(50);
        setOffset({ x: 0, y: 0 });
    };

    return (
        <div className="fleet-map" ref={containerRef}>
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
                    onClick={() => setScale(prev => Math.min(prev * 1.2, 200))}
                    title="Zoom In"
                >
                    +
                </button>
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={() => setScale(prev => Math.max(prev * 0.8, 10))}
                    title="Zoom Out"
                >
                    −
                </button>
                <button
                    className="btn btn-icon btn-secondary"
                    onClick={resetView}
                    title="Reset View"
                >
                    ⟲
                </button>
            </div>

            <div className="map-legend">
                {robots.map(robot => (
                    <div
                        key={robot.id}
                        className={`legend-item ${selectedRobotId === robot.id ? 'selected' : ''}`}
                        onClick={() => selectRobot(robot.id)}
                    >
                        <span
                            className="legend-color"
                            style={{ backgroundColor: robot.color }}
                        />
                        <span className="legend-name">{robot.name}</span>
                        <span className={`legend-status ${robot.connected ? 'online' : ''}`}>
                            {robot.connected ? '●' : '○'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default FleetMap;
