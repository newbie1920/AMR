import React, { useRef, useEffect, useCallback } from 'react';
import { useMapStore } from '../../stores/mapStore';
import './WaypointMapView.css';

const WaypointMapView = ({ waypoints, onAddWaypoint, onRemoveWaypoint }) => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const { width: WAREHOUSE_SIZE, height: WAREHOUSE_HEIGHT, zones: warehouseZones } = useMapStore();

    const scaleRef = React.useRef(30); // Dynamic pixels per meter

    // Convert world coordinates to canvas coordinates
    const worldToCanvas = useCallback((wx, wy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const scale = scaleRef.current;

        return {
            x: centerX + (wx - WAREHOUSE_SIZE / 2) * scale,
            y: centerY - (wy - WAREHOUSE_HEIGHT / 2) * scale
        };
    }, []);

    // Convert canvas coordinates to world coordinates
    const canvasToWorld = useCallback((cx, cy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const scale = scaleRef.current;

        return {
            x: (cx - centerX) / scale + WAREHOUSE_SIZE / 2,
            y: -(cy - centerY) / scale + WAREHOUSE_HEIGHT / 2
        };
    }, []);

    // Draw the map
    const drawMap = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#0a0a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw warehouse boundary
        const topLeft = worldToCanvas(0, WAREHOUSE_HEIGHT);
        const bottomRight = worldToCanvas(WAREHOUSE_SIZE, 0);

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 2;
        ctx.strokeRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y
        );

        // Draw grid
        ctx.strokeStyle = '#1a1a3a';
        ctx.lineWidth = 1;

        for (let i = 0; i <= WAREHOUSE_SIZE; i++) {
            const start = worldToCanvas(i, 0);
            const end = worldToCanvas(i, WAREHOUSE_HEIGHT);
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
        }

        for (let i = 0; i <= WAREHOUSE_HEIGHT; i++) {
            const startH = worldToCanvas(0, i);
            const endH = worldToCanvas(WAREHOUSE_SIZE, i);
            ctx.beginPath();
            ctx.moveTo(startH.x, startH.y);
            ctx.lineTo(endH.x, endH.y);
            ctx.stroke();
        }

        // Draw warehouse zones
        warehouseZones.forEach(zone => {
            const topLeft = worldToCanvas(zone.x, zone.y + zone.height);
            const bottomRight = worldToCanvas(zone.x + zone.width, zone.y);

            // Zone background
            ctx.fillStyle = zone.color + '20';
            ctx.fillRect(
                topLeft.x,
                topLeft.y,
                bottomRight.x - topLeft.x,
                bottomRight.y - topLeft.y
            );

            // Zone border
            ctx.strokeStyle = zone.color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(
                topLeft.x,
                topLeft.y,
                bottomRight.x - topLeft.x,
                bottomRight.y - topLeft.y
            );

            // Zone label
            const centerPos = worldToCanvas(
                zone.x + zone.width / 2,
                zone.y + zone.height / 2
            );
            ctx.fillStyle = zone.color;
            ctx.font = 'bold 10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(zone.label || zone.id, centerPos.x, centerPos.y);
        });

        // Draw path connecting waypoints
        if (waypoints.length > 1) {
            ctx.strokeStyle = '#00d4ff80';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();

            const firstPoint = worldToCanvas(waypoints[0].x, waypoints[0].y);
            ctx.moveTo(firstPoint.x, firstPoint.y);

            for (let i = 1; i < waypoints.length; i++) {
                const point = worldToCanvas(waypoints[i].x, waypoints[i].y);
                ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw waypoint markers
        waypoints.forEach((wp, index) => {
            const pos = worldToCanvas(wp.x, wp.y);

            // Glow effect
            const gradient = ctx.createRadialGradient(
                pos.x, pos.y, 0,
                pos.x, pos.y, 20
            );
            gradient.addColorStop(0, '#00d4ff66');
            gradient.addColorStop(1, 'transparent');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 20, 0, Math.PI * 2);
            ctx.fill();

            // Marker circle
            ctx.fillStyle = '#00d4ff';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
            ctx.fill();

            // Number
            ctx.fillStyle = '#000';
            ctx.font = 'bold 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((index + 1).toString(), pos.x, pos.y);

            // Draw heading arrow if enabled
            if (wp.thetaEnabled) {
                const angleRad = -(wp.theta || 0) * (Math.PI / 180);
                const arrowLength = 25;
                const headSize = 8;

                ctx.strokeStyle = '#00d4ff';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                const endX = pos.x + Math.cos(angleRad) * arrowLength;
                const endY = pos.y + Math.sin(angleRad) * arrowLength;
                ctx.lineTo(endX, endY);
                ctx.stroke();

                // Arrow head
                ctx.beginPath();
                ctx.moveTo(endX, endY);
                ctx.lineTo(
                    endX - headSize * Math.cos(angleRad - Math.PI / 6),
                    endY - headSize * Math.sin(angleRad - Math.PI / 6)
                );
                ctx.moveTo(endX, endY);
                ctx.lineTo(
                    endX - headSize * Math.cos(angleRad + Math.PI / 6),
                    endY - headSize * Math.sin(angleRad + Math.PI / 6)
                );
                ctx.stroke();
            }

            // Action icon
            const actionIcons = {
                load: '📥',
                unload: '📤',
                wait: '⏳',
                move: '📍'
            };
            const icon = actionIcons[wp.action] || '📍';
            ctx.font = '16px Arial';
            ctx.fillText(icon, pos.x, pos.y - 25);
        });

    }, [waypoints, worldToCanvas]);

    // Resize canvas
    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;

            const width = container.clientWidth;
            const height = container.clientHeight;

            canvas.width = width;
            canvas.height = height;

            // Calculate dynamic scale to fit 15x15m with some padding
            scaleRef.current = Math.min(width, height) / (WAREHOUSE_SIZE + 2);

            drawMap();
        };

        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [drawMap]);

    // Redraw when waypoints change
    useEffect(() => {
        drawMap();
    }, [drawMap]);

    // Handle click to add waypoint
    const handleClick = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Check if clicked on existing waypoint (for removal)
        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];
            const pos = worldToCanvas(wp.x, wp.y);
            const distance = Math.sqrt(
                Math.pow(cx - pos.x, 2) + Math.pow(cy - pos.y, 2)
            );
            if (distance < 12) {
                // Clicked on waypoint - remove it
                if (onRemoveWaypoint) {
                    onRemoveWaypoint(i);
                }
                return;
            }
        }

        // Convert to world coordinates
        const worldPos = canvasToWorld(cx, cy);

        // Check if within warehouse bounds
        if (worldPos.x >= 0 && worldPos.x <= WAREHOUSE_SIZE &&
            worldPos.y >= 0 && worldPos.y <= WAREHOUSE_HEIGHT) {
            if (onAddWaypoint) {
                onAddWaypoint(worldPos.x, worldPos.y);
            }
        }
    };

    return (
        <div className="waypoint-map-view" ref={containerRef}>
            <canvas
                ref={canvasRef}
                className="waypoint-canvas"
                onClick={handleClick}
                style={{ cursor: 'crosshair' }}
            />
        </div>
    );
};

export default WaypointMapView;
