/**
 * NavPanel.jsx
 * ============
 * Advanced Navigation Controls — thay thế Nav2 panel (RViz2)
 *
 * Features:
 *   - Set Pose Estimate (AMCL initial pose)
 *   - NavigateToPose goal
 *   - NavigateThroughPoses (waypoint sequence)
 *   - Nav state indicator + cancel
 *   - Velocity smoother controls
 *   - Recovery behavior triggers
 *   - Path stats (distance, ETA)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './NavPanel.css';

// Nav states (duplicated from navController for standalone use)
const NAV_DISPLAY = (t) => ({
    IDLE: { icon: '⬜', color: '#6b7280', label: t('nav_idle') },
    PLANNING: { icon: '🔄', color: '#f59e0b', label: t('nav_planning') },
    FOLLOWING: { icon: '▶', color: '#3b82f6', label: t('nav_following') },
    GOAL_REACHED: { icon: '✅', color: '#10b981', label: t('nav_reached') },
    STUCK: { icon: '⚠', color: '#ef4444', label: t('nav_stuck') },
    FAILED: { icon: '❌', color: '#ef4444', label: t('nav_failed') },
    CANCELLED: { icon: '⏹', color: '#6b7280', label: t('nav_cancelled') },
});

const NavPanel = ({ navController, onSetGoal, onSelectPose }) => {
    const { robots, selectedRobotId, settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const selectedRobot = robots.find(r => r.id === selectedRobotId);
    const robotPose = selectedRobot?.pose || null;

    const [navState, setNavState] = useState('IDLE');
    const [path, setPath] = useState([]);
    const [goalInput, setGoalInput] = useState({ x: '', y: '', theta: '0' });
    const [waypointList, setWaypointList] = useState([]);
    const [showWaypointMode, setShowWaypointMode] = useState(false);
    const [velocityParams, setVelocityParams] = useState({
        maxLinear: 0.5,
        maxAngular: 1.0,
        smoothFactor: 0.8,
    });

    // Listen to nav state
    useEffect(() => {
        if (!navController) return;
        const unsub = navController.onState(({ state, path: p }) => {
            setNavState(state);
            if (p) setPath(p);
        });
        return unsub;
    }, [navController]);

    // Path statistics
    const pathDistance = path.reduce((dist, pt, i) => {
        if (i === 0) return 0;
        const prev = path[i - 1];
        return dist + Math.hypot(pt.x - prev.x, pt.y - prev.y);
    }, 0);

    const estimatedETA = velocityParams.maxLinear > 0
        ? pathDistance / velocityParams.maxLinear
        : 0;

    const handleSendGoal = useCallback(() => {
        const x = parseFloat(goalInput.x);
        const y = parseFloat(goalInput.y);
        const theta = parseFloat(goalInput.theta) || 0;
        if (isNaN(x) || isNaN(y)) return;

        if (navController) {
            navController.setGoal({ x, y, theta });
        }
        onSetGoal?.({ x, y, theta });
    }, [goalInput, navController, onSetGoal]);

    const handleCancel = useCallback(() => {
        navController?.cancel();
    }, [navController]);

    const handleAddWaypoint = useCallback(() => {
        const x = parseFloat(goalInput.x);
        const y = parseFloat(goalInput.y);
        const theta = parseFloat(goalInput.theta) || 0;
        if (isNaN(x) || isNaN(y)) return;
        setWaypointList(prev => [...prev, { x, y, theta, id: Date.now() }]);
        setGoalInput({ x: '', y: '', theta: '0' });
    }, [goalInput]);

    const handleRemoveWaypoint = useCallback((id) => {
        setWaypointList(prev => prev.filter(w => w.id !== id));
    }, []);

    const handleNavigateThroughPoses = useCallback(async () => {
        if (!navController || waypointList.length === 0) return;

        // Navigate through each waypoint sequentially
        for (const wp of waypointList) {
            navController.setGoal({ x: wp.x, y: wp.y, theta: wp.theta });
            // Wait for goal to be reached or failed
            await new Promise((resolve) => {
                const unsub = navController.onState(({ state }) => {
                    if (state === 'GOAL_REACHED' || state === 'FAILED' || state === 'CANCELLED' || state === 'STUCK') {
                        unsub();
                        resolve(state);
                    }
                });
            });
            if (navController.getState() !== 'GOAL_REACHED') break;
        }
    }, [navController, waypointList]);

    const navDisplay = NAV_DISPLAY(t);
    const stateDisplay = navDisplay[navState] || navDisplay.IDLE;

    if (!selectedRobot) {
        return (
            <div className="nav-panel">
                <div className="np-header">
                    <h4 className="np-title"><span className="np-icon">🧭</span> {t('navigation')}</h4>
                </div>
                <div style={{ textAlign: 'center', padding: '32px 16px', opacity: 0.5 }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🤖</div>
                    <p style={{ margin: 0, fontSize: '13px' }}>{t('select_robot_nav')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="nav-panel">
            {/* Header */}
            <div className="np-header">
                <h4 className="np-title">
                    <span className="np-icon">🧭</span>
                    {t('navigation')}
                </h4>
                <div className="np-state" style={{ color: stateDisplay.color }}>
                    <span>{stateDisplay.icon}</span>
                    <span>{stateDisplay.label}</span>
                </div>
            </div>

            {/* Current Pose */}
            {robotPose && (
                <div className="np-pose-section">
                    <span className="np-section-label">{t('current_pose')}</span>
                    <div className="np-pose-values">
                        <span className="np-pose-val">X: <b>{robotPose.x?.toFixed(3)}</b></span>
                        <span className="np-pose-val">Y: <b>{robotPose.y?.toFixed(3)}</b></span>
                        <span className="np-pose-val">θ: <b>{(robotPose.theta * 180 / Math.PI)?.toFixed(1)}°</b></span>
                    </div>
                </div>
            )}

            {/* Goal Input */}
            <div className="np-goal-section">
                <span className="np-section-label">
                    {showWaypointMode ? t('add_waypoint') : t('nav_goal')}
                </span>
                <div className="np-goal-row">
                    <input
                        type="number"
                        placeholder="X"
                        value={goalInput.x}
                        onChange={(e) => setGoalInput(prev => ({ ...prev, x: e.target.value }))}
                        className="np-input"
                        step="0.1"
                    />
                    <input
                        type="number"
                        placeholder="Y"
                        value={goalInput.y}
                        onChange={(e) => setGoalInput(prev => ({ ...prev, y: e.target.value }))}
                        className="np-input"
                        step="0.1"
                    />
                    <input
                        type="number"
                        placeholder="θ"
                        value={goalInput.theta}
                        onChange={(e) => setGoalInput(prev => ({ ...prev, theta: e.target.value }))}
                        className="np-input np-input-theta"
                        step="0.1"
                    />
                </div>
                <div className="np-goal-actions">
                    {showWaypointMode ? (
                        <button className="np-btn np-btn-add" onClick={handleAddWaypoint}>
                            + {t('add_waypoint')}
                        </button>
                    ) : (
                        <button className="np-btn np-btn-go" onClick={handleSendGoal}>
                            🚀 {t('navigate')}
                        </button>
                    )}
                    <button
                        className={`np-btn np-btn-mode ${showWaypointMode ? 'active' : ''}`}
                        onClick={() => setShowWaypointMode(!showWaypointMode)}
                    >
                        {showWaypointMode ? `🎯 ${t('single')}` : `📍 ${t('multi')}`}
                    </button>
                    {onSelectPose && (
                        <button className="np-btn np-btn-pick" onClick={onSelectPose}>
                            🖱 {t('pick_on_map')}
                        </button>
                    )}
                </div>
            </div>

            {/* Waypoint List (Multi-pose mode) */}
            {showWaypointMode && waypointList.length > 0 && (
                <div className="np-waypoint-list">
                    <span className="np-section-label">
                        {t('waypoints')} ({waypointList.length})
                    </span>
                    {waypointList.map((wp, i) => (
                        <div key={wp.id} className="np-waypoint-item">
                            <span className="np-wp-num">{i + 1}</span>
                            <span className="np-wp-coords">
                                ({wp.x.toFixed(2)}, {wp.y.toFixed(2)}, {wp.theta.toFixed(1)}°)
                            </span>
                            <button
                                className="np-wp-remove"
                                onClick={() => handleRemoveWaypoint(wp.id)}
                            >✕</button>
                        </div>
                    ))}
                    <button className="np-btn np-btn-go" onClick={handleNavigateThroughPoses}>
                        ▶ {t('navigate_all')}
                    </button>
                </div>
            )}

            {/* Path Stats */}
            {path.length > 0 && (
                <div className="np-stats">
                    <div className="np-stat">
                        <span className="np-stat-label">{t('distance')}</span>
                        <span className="np-stat-value">{pathDistance.toFixed(2)} m</span>
                    </div>
                    <div className="np-stat">
                        <span className="np-stat-label">ETA</span>
                        <span className="np-stat-value">{estimatedETA.toFixed(1)} s</span>
                    </div>
                    <div className="np-stat">
                        <span className="np-stat-label">{t('waypoints')}</span>
                        <span className="np-stat-value">{path.length}</span>
                    </div>
                </div>
            )}

            {/* Cancel / Recovery */}
            <div className="np-controls">
                <button
                    className="np-btn np-btn-cancel"
                    onClick={handleCancel}
                    disabled={navState === 'IDLE' || navState === 'CANCELLED'}
                >
                    ⏹ {t('cancel_navigation')}
                </button>
            </div>

            {/* Velocity Smoother */}
            <div className="np-velocity-section">
                <span className="np-section-label">{t('velocity_limits')}</span>
                <div className="np-vel-row">
                    <label className="np-vel-label">{t('max_linear')}</label>
                    <input
                        type="range"
                        min="0.1"
                        max="1.5"
                        step="0.05"
                        value={velocityParams.maxLinear}
                        onChange={(e) => setVelocityParams(p => ({ ...p, maxLinear: parseFloat(e.target.value) }))}
                        className="np-vel-range"
                    />
                    <span className="np-vel-value">{velocityParams.maxLinear.toFixed(2)} m/s</span>
                </div>
                <div className="np-vel-row">
                    <label className="np-vel-label">{t('max_angular')}</label>
                    <input
                        type="range"
                        min="0.1"
                        max="3.0"
                        step="0.1"
                        value={velocityParams.maxAngular}
                        onChange={(e) => setVelocityParams(p => ({ ...p, maxAngular: parseFloat(e.target.value) }))}
                        className="np-vel-range"
                    />
                    <span className="np-vel-value">{velocityParams.maxAngular.toFixed(1)} rad/s</span>
                </div>
                <div className="np-vel-row">
                    <label className="np-vel-label">{t('smoothing')}</label>
                    <input
                        type="range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={velocityParams.smoothFactor}
                        onChange={(e) => setVelocityParams(p => ({ ...p, smoothFactor: parseFloat(e.target.value) }))}
                        className="np-vel-range"
                    />
                    <span className="np-vel-value">{velocityParams.smoothFactor.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};

export default NavPanel;
