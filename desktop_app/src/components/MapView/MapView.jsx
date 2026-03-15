import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import { useMissionStore } from '../../stores/missionStore';
import translations from '../../translations';
import './MapView.css';

const MapView = () => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const { settings } = useFleetStore();
    const selectedRobotId = useRobotStore(state => state.selectedRobotId);
    const robot = useRobotStore(state => state.robots[selectedRobotId] || {});

    const {
        robotPose = { x: 0, y: 0, theta: 0 },
        slamMap: map = null,
        plannedPath = [],
        traveledPath = [],
        currentGoal = null,
        connected = false,
        robotVelocity = { linear: 0, angular: 0 }
    } = robot;

    const { sendNavigationGoal } = useRobotStore();
    const { missions } = useMissionStore();

    const mission = useMemo(() =>
        missions.find(m =>
            m.assignedRobotId === selectedRobotId &&
            (m.status === 'active' || m.status === 'assigned')
        ),
        [missions, selectedRobotId]);

    const mapMetadata = map?.metadata;
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [scale, setScale] = useState(50); // pixels per meter
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    const [clickMode, setClickMode] = useState('navigate'); // 'navigate' or 'pan'

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

    // Draw the map
    const drawMap = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw grid
        ctx.strokeStyle = '#1a1a3a';
        ctx.lineWidth = 1;

        const gridSize = scale; // 1 meter grid
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

        // Draw occupancy grid map if available
        if (map && mapMetadata) {
            const { width, height, resolution, origin } = mapMetadata;
            const imageData = ctx.createImageData(width, height);

            for (let i = 0; i < map.length; i++) {
                const value = map[i];
                let color;

                if (value === -1) {
                    color = [30, 30, 50, 255]; // Unknown
                } else if (value === 0) {
                    color = [20, 20, 40, 255]; // Free
                } else {
                    color = [100, 100, 120, 255]; // Occupied
                }

                imageData.data[i * 4] = color[0];
                imageData.data[i * 4 + 1] = color[1];
                imageData.data[i * 4 + 2] = color[2];
                imageData.data[i * 4 + 3] = color[3];
            }

            // Create temporary canvas for the map
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imageData, 0, 0);

            // Draw scaled map
            const mapOrigin = worldToCanvas(origin.position.x, origin.position.y + height * resolution);
            ctx.drawImage(
                tempCanvas,
                mapOrigin.x,
                mapOrigin.y,
                width * resolution * scale,
                height * resolution * scale
            );
        }

        // Draw traveled path
        if (traveledPath && traveledPath.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#7c3aed';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.6;

            const start = worldToCanvas(traveledPath[0].x, traveledPath[0].y);
            ctx.moveTo(start.x, start.y);

            for (let i = 1; i < traveledPath.length; i++) {
                const point = worldToCanvas(traveledPath[i].x, traveledPath[i].y);
                ctx.lineTo(point.x, point.y);
            }

            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Draw planned path
        // Draw planned path
        if (plannedPath && plannedPath.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);

            const start = worldToCanvas(plannedPath[0].x, plannedPath[0].y);
            ctx.moveTo(start.x, start.y);

            for (let i = 1; i < plannedPath.length; i++) {
                const point = worldToCanvas(plannedPath[i].x, plannedPath[i].y);
                ctx.lineTo(point.x, point.y);
            }

            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw goal
        if (currentGoal) {
            const goalPos = worldToCanvas(currentGoal.x, currentGoal.y);

            // Goal marker
            ctx.beginPath();
            ctx.arc(goalPos.x, goalPos.y, 15, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(245, 158, 11, 0.3)';
            ctx.fill();

            ctx.beginPath();
            ctx.arc(goalPos.x, goalPos.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b';
            ctx.fill();

            // Goal direction
            ctx.beginPath();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.moveTo(goalPos.x, goalPos.y);
            ctx.lineTo(
                goalPos.x + Math.cos(currentGoal.theta) * 20,
                goalPos.y - Math.sin(currentGoal.theta) * 20
            );
            ctx.stroke();
        }

        // Draw robot
        const robotPos = worldToCanvas(robotPose.x, robotPose.y);
        const robotSize = 20;

        // Robot glow
        const gradient = ctx.createRadialGradient(
            robotPos.x, robotPos.y, 0,
            robotPos.x, robotPos.y, robotSize * 2
        );
        gradient.addColorStop(0, 'rgba(0, 212, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(robotPos.x, robotPos.y, robotSize * 2, 0, Math.PI * 2);
        ctx.fill();

        // Robot body
        ctx.save();
        ctx.translate(robotPos.x, robotPos.y);
        ctx.rotate(-robotPose.theta);

        ctx.beginPath();
        ctx.moveTo(robotSize, 0);
        ctx.lineTo(-robotSize * 0.7, -robotSize * 0.6);
        ctx.lineTo(-robotSize * 0.5, 0);
        ctx.lineTo(-robotSize * 0.7, robotSize * 0.6);
        ctx.closePath();

        ctx.fillStyle = '#00d4ff';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();

        // Draw mission overlay
        if (mission) {
            // High-level mission path
            if (mission.plannedPath && mission.plannedPath.length > 0) {
                ctx.strokeStyle = '#3b82f644';
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

            // Mission Waypoints
            mission.waypoints.forEach((wp, idx) => {
                const wpPos = worldToCanvas(wp.x, wp.y);
                const isCurrent = idx === mission.currentWaypointIndex && mission.status === 'active';

                ctx.fillStyle = isCurrent ? '#ffffff' : '#3b82f6aa';
                ctx.beginPath();
                ctx.arc(wpPos.x, wpPos.y, 8, 0, Math.PI * 2);
                ctx.fill();

                if (isCurrent) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#ffffff';
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                }

                ctx.fillStyle = isCurrent ? '#000000' : '#ffffff';
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((idx + 1).toString(), wpPos.x, wpPos.y);
                ctx.textBaseline = 'alphabetic';
            });
        }

        // Draw HUD
        if (connected) {
            const hudX = robotPos.x + 30;
            const hudY = robotPos.y - 30;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.roundRect?.(hudX, hudY, 130, 75, 8) || ctx.fillRect(hudX, hudY, 130, 75);
            ctx.fill();
            ctx.strokeStyle = '#00d4ffaa';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.font = '11px monospace';

            ctx.fillText(`V: ${robotVelocity.linear.toFixed(2)}  W: ${robotVelocity.angular.toFixed(2)}`, hudX + 8, hudY + 18);

            // PID Tuning Data
            const telem = robot.telemetry || {};
            const vLt = (telem.vL_t || 0).toFixed(2);
            const vLr = (telem.vL_r || 0).toFixed(2);
            const vRt = (telem.vR_t || 0).toFixed(2);
            const vRr = (telem.vR_r || 0).toFixed(2);

            ctx.fillStyle = '#ff4d4f';
            ctx.fillText(`L T/R: ${vLt}/${vLr}`, hudX + 8, hudY + 33);
            ctx.fillStyle = '#1890ff';
            ctx.fillText(`R T/R: ${vRt}/${vRr}`, hudX + 8, hudY + 48);

            if (mission && mission.status === 'active') {
                const progress = `${mission.currentWaypointIndex + 1}/${mission.waypoints.length}`;
                ctx.fillStyle = '#3b82f6';
                ctx.fillText(`TARGET: ${progress}`, hudX + 8, hudY + 65);
            }
        }

        // Draw coordinates
        ctx.fillStyle = '#6b6b8a';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(`${t('robot')}: (${robotPose.x.toFixed(2)}, ${robotPose.y.toFixed(2)})`, 10, canvas.height - 40);
        ctx.fillText(`${t('angle')}: ${(robotPose.theta * 180 / Math.PI).toFixed(1)}°`, 10, canvas.height - 20);

    }, [map, mapMetadata, robotPose, robotVelocity, plannedPath, traveledPath, currentGoal, mission, scale, offset, worldToCanvas, t, connected]);

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

    // Mouse handlers
    const handleMouseDown = (e) => {
        if (e.button === 1 || (e.button === 0 && clickMode === 'pan')) {
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
        if (clickMode === 'navigate' && connected && !isDragging) {
            const rect = canvasRef.current.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const world = canvasToWorld(cx, cy);
            sendNavigationGoal(selectedRobotId, world.x, world.y);
        }
    };

    const handleWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(prev => Math.min(Math.max(prev * delta, 10), 200));
    };

    return (
        <div className="map-view" ref={containerRef}>
            <canvas
                ref={canvasRef}
                className="map-canvas"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleClick}
                onWheel={handleWheel}
            />

            <div className="map-controls">
                <button
                    className={`btn btn-icon ${clickMode === 'navigate' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setClickMode('navigate')}
                    title={t('navigation_mode')}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                </button>

                <button
                    className={`btn btn-icon ${clickMode === 'pan' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setClickMode('pan')}
                    title={t('pan_mode')}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 6a2 2 0 100-4 2 2 0 000 4zM10 12a2 2 0 100-4 2 2 0 000 4zM10 18a2 2 0 100-4 2 2 0 000 4z" />
                    </svg>
                </button>

                <div className="zoom-controls">
                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={() => setScale(prev => Math.min(prev * 1.2, 200))}
                        title={t('zoom_in')}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                    </button>

                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={() => setScale(prev => Math.max(prev * 0.8, 10))}
                        title={t('zoom_out')}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                    </button>

                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={() => { setScale(50); setOffset({ x: 0, y: 0 }); }}
                        title={t('reset_view')}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="map-info">
                <span>{t('scale')}: {scale.toFixed(0)} px/m</span>
                <span>{t('mode')}: {clickMode === 'navigate' ? t('click_to_nav') : t('drag_to_pan')}</span>
            </div>
        </div>
    );
};

export default MapView;
