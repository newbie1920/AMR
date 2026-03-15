/**
 * CostmapViewer.jsx
 * =================
 * Costmap Visualization Panel — thay thế RViz2 Costmap display
 *
 * Features:
 *   - 2D overhead view with color-coded cost layers
 *   - Toggle layers: Static, Obstacle, Inflation, Fleet
 *   - Overlay robot footprint + path
 *   - Click to inspect cell cost
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './CostmapViewer.css';

// Cost-to-color mapping (RViz2 style)
const costToColor = (cost) => {
    if (cost < 0) return 'rgba(128, 128, 128, 0.3)'; // Unknown
    if (cost === 0) return 'rgba(0, 0, 0, 0)';       // Free
    if (cost < 50) return `rgba(0, 200, 255, ${cost / 100})`; // Low cost
    if (cost < 100) return `rgba(255, 200, 0, ${cost / 150 + 0.3})`; // Medium
    if (cost < 200) return `rgba(255, 80, 0, ${cost / 255 + 0.2})`;  // High
    if (cost < 253) return `rgba(255, 0, 0, ${cost / 255})`;         // Very high
    if (cost === 253) return 'rgba(255, 0, 0, 0.9)';  // Inscribed
    if (cost === 254) return 'rgba(200, 0, 200, 1)';  // Lethal
    return 'rgba(0, 0, 0, 0.4)';                      // Unknown
};

const CostmapViewer = () => {
    const { robots, selectedRobotId } = useRobotStore();
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const robot = robots[selectedRobotId] || {};
    const costmap = robot.costmap || null;
    const canvasRef = useRef(null);
    const [inspectedCell, setInspectedCell] = useState(null);
    const [viewScale, setViewScale] = useState(4);
    const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });

    const [layers, setLayers] = useState({
        static: true,
        obstacle: true,
        inflation: true,
        fleet: true,
        path: true,
        robot: true,
    });

    const toggleLayer = (layer) => {
        setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
    };

    // Render costmap to canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !costmap) return;

        const ctx = canvas.getContext('2d');
        const data = costmap.data || costmap.grid;
        const width = costmap.width || 0;
        const height = costmap.height || 0;
        const resolution = costmap.resolution || 0.05;

        if (!data || !width || !height) return;

        canvas.width = width * viewScale;
        canvas.height = height * viewScale;

        // Clear
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw costmap cells
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const cost = data[idx];
                if (cost === 0 && !layers.static) continue;

                const color = costToColor(cost);
                if (color === 'rgba(0, 0, 0, 0)') continue;

                ctx.fillStyle = color;
                ctx.fillRect(x * viewScale, (height - 1 - y) * viewScale, viewScale, viewScale);
            }
        }

        // Draw grid lines (if scale is large enough)
        if (viewScale >= 6) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 0.5;
            for (let x = 0; x <= width; x++) {
                ctx.beginPath();
                ctx.moveTo(x * viewScale, 0);
                ctx.lineTo(x * viewScale, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y <= height; y++) {
                ctx.beginPath();
                ctx.moveTo(0, y * viewScale);
                ctx.lineTo(canvas.width, y * viewScale);
                ctx.stroke();
            }
        }

        // Draw robot position
        if (layers.robot && robot.pose) {
            const robotGrid = costmap.worldToGrid?.(robot.pose.x, robot.pose.y);
            if (robotGrid) {
                const rx = robotGrid.x * viewScale + viewScale / 2;
                const ry = (height - 1 - robotGrid.y) * viewScale + viewScale / 2;
                const radius = Math.max(viewScale * 2, 6);

                // Robot circle
                ctx.beginPath();
                ctx.arc(rx, ry, radius, 0, 2 * Math.PI);
                ctx.fillStyle = 'rgba(0, 255, 150, 0.4)';
                ctx.fill();
                ctx.strokeStyle = '#00ff96';
                ctx.lineWidth = 2;
                ctx.stroke();

                // Heading arrow
                const heading = robot.pose.theta || 0;
                const arrowLen = radius * 1.5;
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.lineTo(
                    rx + Math.cos(-heading) * arrowLen,
                    ry + Math.sin(-heading) * arrowLen
                );
                ctx.strokeStyle = '#00ff96';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        // Draw path
        if (layers.path && robot.currentPath?.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 2]);

            for (let i = 0; i < robot.currentPath.length; i++) {
                const pt = robot.currentPath[i];
                const g = costmap.worldToGrid?.(pt.x, pt.y);
                if (!g) continue;
                const px = g.x * viewScale + viewScale / 2;
                const py = (height - 1 - g.y) * viewScale + viewScale / 2;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

    }, [costmap, layers, viewScale, robot.pose, robot.currentPath]);

    // Click to inspect cell
    const handleCanvasClick = useCallback((e) => {
        if (!costmap || !canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = Math.floor((e.clientX - rect.left) / viewScale);
        const cy = costmap.height - 1 - Math.floor((e.clientY - rect.top) / viewScale);
        const idx = cy * costmap.width + cx;
        const cost = costmap.data?.[idx] ?? costmap.grid?.[idx] ?? -1;
        const world = costmap.gridToWorld?.(cx, cy) || { x: cx * costmap.resolution, y: cy * costmap.resolution };

        setInspectedCell({
            gridX: cx, gridY: cy,
            worldX: world.x?.toFixed(3),
            worldY: world.y?.toFixed(3),
            cost,
            costLabel: cost === 0 ? t('free') : cost === 254 ? t('lethal') : cost === 253 ? t('inscribed') : cost < 0 ? t('unknown') : `${cost}`,
        });
    }, [costmap, viewScale, t]);

    return (
        <div className="costmap-viewer">
            <div className="cmv-header">
                <h4 className="cmv-title">
                    <span className="cmv-icon">🗺</span>
                    {t('costmap_viewer')}
                </h4>
                <div className="cmv-zoom">
                    <button onClick={() => setViewScale(s => Math.max(1, s - 1))} className="cmv-zoom-btn">−</button>
                    <span className="cmv-zoom-value">{viewScale}x</span>
                    <button onClick={() => setViewScale(s => Math.min(12, s + 1))} className="cmv-zoom-btn">+</button>
                </div>
            </div>

            {/* Layer Toggles */}
            <div className="cmv-layers">
                {Object.keys(layers).map(layer => (
                    <label key={layer} className={`cmv-layer-toggle ${layers[layer] ? 'active' : ''}`}>
                        <input
                            type="checkbox"
                            checked={layers[layer]}
                            onChange={() => toggleLayer(layer)}
                        />
                        <span className={`cmv-layer-dot ${layer}`} />
                        <span className="cmv-layer-name">{layer}</span>
                    </label>
                ))}
            </div>

            {/* Canvas */}
            <div className="cmv-canvas-container">
                {!costmap ? (
                    <div className="cmv-empty">{t('no_costmap_data')}</div>
                ) : (
                    <canvas
                        ref={canvasRef}
                        className="cmv-canvas"
                        onClick={handleCanvasClick}
                    />
                )}
            </div>

            {/* Cell Inspector */}
            {inspectedCell && (
                <div className="cmv-inspector">
                    <div className="cmv-inspector-row">
                        <span className="cmv-insp-label">{t('grid')}</span>
                        <span className="cmv-insp-value">({inspectedCell.gridX}, {inspectedCell.gridY})</span>
                    </div>
                    <div className="cmv-inspector-row">
                        <span className="cmv-insp-label">{t('world')}</span>
                        <span className="cmv-insp-value">({inspectedCell.worldX}, {inspectedCell.worldY}) m</span>
                    </div>
                    <div className="cmv-inspector-row">
                        <span className="cmv-insp-label">{t('cost')}</span>
                        <span className="cmv-insp-value" style={{ color: inspectedCell.cost >= 253 ? '#ff4444' : inspectedCell.cost > 100 ? '#ff8800' : '#10b981' }}>
                            {inspectedCell.costLabel}
                        </span>
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="cmv-legend">
                <span className="cmv-legend-item"><span className="cmv-lg-dot" style={{ background: '#00c8ff' }} />{t('low')}</span>
                <span className="cmv-legend-item"><span className="cmv-lg-dot" style={{ background: '#ffc800' }} />{t('medium')}</span>
                <span className="cmv-legend-item"><span className="cmv-lg-dot" style={{ background: '#ff5000' }} />{t('high')}</span>
                <span className="cmv-legend-item"><span className="cmv-lg-dot" style={{ background: '#ff0000' }} />{t('lethal')}</span>
                <span className="cmv-legend-item"><span className="cmv-lg-dot" style={{ background: '#c800c8' }} />{t('inscribed')}</span>
            </div>
        </div>
    );
};

export default CostmapViewer;
