/**
 * FleetStatusBar.jsx (Premium Upgrade)
 * =====================================
 * Bottom status bar — upgraded with sparklines, battery, latency, and emergency stop
 *
 * Enhancements:
 *   - Mini sparkline graph for fleet velocity
 *   - Battery level indicators with color coding
 *   - Network latency per robot with quality indicator
 *   - Emergency stop with confirmation modal
 *   - Glassmorphism styling
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import { useMissionStore } from '../../stores/missionStore';
import translations from '../../translations';
import './FleetStatusBar.css';

// ─── Mini Sparkline ──────────────────────────────────────────────────────────
const Sparkline = ({ data = [], width = 60, height = 18, color = '#00d4ff' }) => {
    if (data.length < 2) return <div style={{ width, height }} />;

    const max = Math.max(...data, 0.01);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 2) - 1;
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg width={width} height={height} className="sparkline-svg">
            <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
            <circle
                cx={(data.length - 1) / (data.length - 1) * width}
                cy={height - ((data[data.length - 1] - min) / range) * (height - 2) - 1}
                r="2"
                fill={color}
            />
        </svg>
    );
};

// ─── Battery Indicator ───────────────────────────────────────────────────────
const BatteryIndicator = ({ level = 100, charging = false }) => {
    const getColor = () => {
        if (level > 60) return '#10b981';
        if (level > 30) return '#f59e0b';
        return '#ef4444';
    };

    return (
        <div className="battery-indicator" title={`${level}%${charging ? ' (charging)' : ''}`}>
            <div className="battery-shell">
                <div
                    className="battery-fill"
                    style={{ width: `${level}%`, background: getColor() }}
                />
                {charging && <span className="battery-bolt">⚡</span>}
            </div>
            <span className="battery-text">{level}%</span>
        </div>
    );
};

// ─── Latency Dot ─────────────────────────────────────────────────────────────
const LatencyDot = ({ ms = 0 }) => {
    let quality, color;
    if (ms < 50) { quality = 'good'; color = '#10b981'; }
    else if (ms < 150) { quality = 'fair'; color = '#f59e0b'; }
    else { quality = 'poor'; color = '#ef4444'; }

    return (
        <span className={`latency-dot latency-${quality}`} title={`Latency: ${ms}ms`}>
            <span className="latency-ring" style={{ borderColor: color }} />
            <span className="latency-ms">{ms}ms</span>
        </span>
    );
};

// ─── Main Component ──────────────────────────────────────────────────────────
const FleetStatusBar = () => {
    const {
        robots,
        selectedRobotId,
        activeWorkflows,
        stopAllRobots,
        settings,
        clearTraveledPath,
    } = useFleetStore();

    const clearTraveledPathInStores = (robotId) => {
        // Clear from fleet store
        clearTraveledPath(robotId);
        // Clear from robot store explicitly if mapped
        try {
            const rStore = useRobotStore.getState();
            if (rStore.clearTraveledPath) rStore.clearTraveledPath(robotId);
        } catch (e) { }
    };

    const { isAssignmentPaused, toggleAssignmentPaused } = useMissionStore();

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
    const [velocityHistory, setVelocityHistory] = useState([]);

    const connectedCount = robots.filter(r => r.connected).length;
    const workingCount = robots.filter(r => r.status === 'working' || r.status === 'moving').length;
    const selectedRobot = robots.find(r => r.id === selectedRobotId);

    // Track velocity history for sparkline
    useEffect(() => {
        const interval = setInterval(() => {
            if (selectedRobot?.velocity?.linear != null) {
                setVelocityHistory(prev => {
                    const next = [...prev, selectedRobot.velocity.linear];
                    return next.length > 30 ? next.slice(-30) : next;
                });
            }
        }, 500);
        return () => clearInterval(interval);
    }, [selectedRobot?.velocity?.linear]);

    const handleEmergencyStop = useCallback(() => {
        stopAllRobots();
        setShowEmergencyConfirm(false);
    }, [stopAllRobots]);

    return (
        <div className="fleet-status-bar glass-card">
            {/* Fleet Overview */}
            <div className="status-section fleet-overview">
                <div className="status-item">
                    <span className="status-label">{t('fleet')}</span>
                    <span className="status-value">
                        <span className={`indicator ${connectedCount > 0 ? 'online' : ''}`}>●</span>
                        {connectedCount}/{robots.length} {t('online')}
                    </span>
                </div>
                <div className="status-item">
                    <span className="status-label">{t('active')}</span>
                    <span className="status-value">{workingCount} {t('working')}</span>
                </div>
                <div className="status-item">
                    <span className="status-label">{t('workflows')}</span>
                    <span className="status-value">{activeWorkflows.length} {t('running')}</span>
                </div>
            </div>

            {/* Selected Robot Info */}
            {selectedRobot && (
                <div className="status-section selected-robot">
                    <div className="robot-badge" style={{ borderColor: selectedRobot.color }}>
                        <span className="robot-color" style={{ backgroundColor: selectedRobot.color }} />
                        <span className="robot-name">{selectedRobot.name}</span>
                    </div>

                    {selectedRobot.connected ? (
                        <>
                            {/* Velocity + sparkline */}
                            <div className="status-item status-item-sparkline">
                                <span className="status-label">{t('velocity')}</span>
                                <div className="status-value-row">
                                    <span className="status-value mono">
                                        {selectedRobot.velocity?.linear?.toFixed(2) || '0.00'} m/s
                                    </span>
                                    <Sparkline data={velocityHistory} color={selectedRobot.color || '#00d4ff'} />
                                </div>
                            </div>

                            {/* Position */}
                            <div className="status-item">
                                <span className="status-label">{t('position')}</span>
                                <span className="status-value mono">
                                    ({selectedRobot.pose?.x?.toFixed(2) || '0'}, {selectedRobot.pose?.y?.toFixed(2) || '0'})
                                </span>
                            </div>

                            {/* Battery */}
                            <div className="status-item">
                                <BatteryIndicator
                                    level={selectedRobot.telemetry?.battery ?? 100}
                                    charging={selectedRobot.telemetry?.charging ?? false}
                                />
                            </div>

                            {/* Latency */}
                            <div className="status-item">
                                <LatencyDot ms={selectedRobot.telemetry?.latency ?? 0} />
                            </div>

                            {/* Status */}
                            <div className="status-item">
                                <span className={`status-badge status-${selectedRobot.status}`}>
                                    {t(selectedRobot.status) || selectedRobot.status}
                                </span>
                            </div>
                        </>
                    ) : (
                        <span className="offline-notice">{t('offline')}</span>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="status-section status-actions">
                {/* Emergency Stop */}
                {showEmergencyConfirm ? (
                    <div className="emergency-confirm">
                        <span className="emergency-text">{t('confirm_estop')}</span>
                        <button className="btn btn-danger btn-sm" onClick={handleEmergencyStop}>
                            ✓ YES
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowEmergencyConfirm(false)}>
                            ✕ NO
                        </button>
                    </div>
                ) : (
                    <button
                        className="btn-emergency"
                        onClick={() => setShowEmergencyConfirm(true)}
                        title={t('estop_desc')}
                    >
                        🛑 {t('estop')}
                    </button>
                )}

                <div className="divider-vertical" />

                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                        const fs = useFleetStore.getState();
                        if (fs.clearAllTraveledPaths) fs.clearAllTraveledPaths();
                    }}
                    title={t('clear_all_paths_desc')}
                >
                    🧺 {t('clear_all_paths')}
                </button>

                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => selectedRobotId && clearTraveledPathInStores(selectedRobotId)}
                    title={t('clear_path_desc')}
                >
                    🧹 {t('clear_path')}
                </button>

                <div className="divider-vertical" />

                <button
                    className={`btn btn-sm ${isAssignmentPaused ? 'btn-warning' : 'btn-secondary'}`}
                    onClick={toggleAssignmentPaused}
                    title={isAssignmentPaused ? t('resume_desc') : t('pause_desc')}
                >
                    {isAssignmentPaused ? `▶ ${t('resume')}` : `⏸ ${t('pause')}`}
                </button>

                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => window.location.reload()}
                    title="Reload App"
                >
                    🔄
                </button>
            </div>
        </div>
    );
};

export default FleetStatusBar;
