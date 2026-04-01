import React, { useState } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';

const TaskCard = ({ mission, robots, missions, onAssign, onCancel, onRemove, onStart, onStop, onEdit, onReset }) => {
    const { settings } = useFleetStore();
    const [showAssign, setShowAssign] = useState(false);
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;
    const robotStore = useRobotStore();
    const robotState = mission.assignedRobotId ? robotStore.robots[mission.assignedRobotId] : null;


    const getStatusIcon = () => {
        switch (mission.status) {
            case 'pending': return '⏸';
            case 'assigned': return '🤖';
            case 'active': return '▶';
            case 'completed': return '✓';
            case 'failed': return '✕';
            default: return '○';
        }
    };

    const getStatusColor = () => {
        switch (mission.status) {
            case 'pending': return '#6b7280';
            case 'assigned': return '#7c3aed';
            case 'active': return '#3b82f6';
            case 'completed': return '#10b981';
            case 'failed': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getElapsedTime = () => {
        if (!mission.startedAt) return 0;
        const endTime = mission.completedAt || Date.now();
        return (endTime - mission.startedAt) / 1000;
    };

    const getProgress = () => {
        if (mission.waypoints.length === 0) return 0;
        return (mission.currentWaypointIndex / mission.waypoints.length) * 100;
    };

    const assignedRobot = robots.find(r => r.id === mission.assignedRobotId);
    const isAssignedRobotOnline = assignedRobot?.connected && assignedRobot?.status !== 'offline';
    const availableRobots = robots.filter(r => r.connected && !missions?.some(m =>
        m.status === 'active' && m.assignedRobotId === r.id
    ));

    const getActionIcon = (action) => {
        switch (action) {
            case 'load': return '📥';
            case 'unload': return '📤';
            case 'wait': return '⏳';
            default: return '📍';
        }
    };

    return (
        <div className={`task-card status-${mission.status}`}>
            {/* Header */}
            <div className="task-card-header">
                <div className="task-info">
                    <span
                        className="status-icon"
                        style={{ color: getStatusColor() }}
                    >
                        {getStatusIcon()}
                    </span>
                    <span className="task-name">{mission.name}</span>
                </div>
                <div className="header-actions" style={{ display: 'flex', gap: '4px' }}>
                    {mission.status === 'pending' && (
                        <button
                            className="btn btn-icon btn-ghost btn-sm"
                            onClick={onEdit}
                            title={t('edit')}
                        >
                            ✏️
                        </button>
                    )}
                    <button
                        className="btn btn-icon btn-ghost btn-sm"
                        onClick={onRemove}
                        title={t('delete')}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Waypoints preview */}
            <div className="task-waypoints">
                {mission.waypoints.slice(0, 4).map((wp, idx) => (
                    <span key={idx} className="waypoint-badge" title={`(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`}>
                        {getActionIcon(wp.action)}
                    </span>
                ))}
                {mission.waypoints.length > 4 && (
                    <span className="waypoint-more">+{mission.waypoints.length - 4}</span>
                )}
            </div>

            {/* Meta info */}
            <div className="task-meta">
                <span className="meta-item">
                    <span className="meta-icon">📍</span>
                    {mission.waypoints.length} {t('points')}
                </span>
                {mission.targetTime > 0 && (
                    <span className="meta-item">
                        <span className="meta-icon">⏱️</span>
                        {formatTime(mission.targetTime)}
                    </span>
                )}
                <span className="meta-item">
                    <span className="meta-icon">🚀</span>
                    {mission.waypointConfigs?.[mission.currentWaypointIndex]?.targetVelocity.toFixed(2) || mission.optimizedVelocity.toFixed(2)} m/s
                </span>
                {mission.scheduledAt && (
                    <span className="meta-item" style={{ color: '#7c3aed', fontWeight: 'bold' }}>
                        <span className="meta-icon">📅</span>
                        {new Date(mission.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                )}
                {mission.status === 'active' && mission.waypoints[mission.currentWaypointIndex]?.scheduledAt && (
                    <span className="meta-item" style={{ color: '#10b981', fontWeight: 'bold' }}>
                        <span className="meta-icon">⏳ {t('reach_point')}</span>
                        {new Date(mission.waypoints[mission.currentWaypointIndex].scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                )}
            </div>

            {/* Status-specific content */}
            {mission.status === 'pending' && (
                <div className="task-actions">
                    {showAssign ? (
                        <div className="assign-dropdown">
                            <select
                                className="robot-select"
                                onChange={(e) => {
                                    if (e.target.value) {
                                        onAssign(e.target.value);
                                        setShowAssign(false);
                                    }
                                }}
                                defaultValue=""
                                autoFocus
                            >
                                <option value="">{t('select_robot_dots')}</option>
                                {robots
                                    .filter(r => r.connected)
                                    .map(robot => (
                                        <option key={robot.id} value={robot.id}>
                                            {robot.name}
                                        </option>
                                    ))}
                            </select>
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setShowAssign(false)}
                            >
                                ✕
                            </button>
                        </div>
                    ) : (
                        <button
                            className={`btn btn-primary btn-sm btn-full`}
                            onClick={() => setShowAssign(true)}
                        >
                            <span className="btn-icon">🤖</span>
                            {t('assign_robot')}
                        </button>
                    )}
                </div>
            )}

            {mission.status === 'assigned' && (
                <div className="task-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        className="btn btn-primary btn-sm flex-1"
                        onClick={onStart}
                        disabled={!isAssignedRobotOnline}
                        title={!isAssignedRobotOnline ? t('robot_offline') : (mission.currentWaypointIndex > 0 ? (t('resume') || 'Resume') : t('start'))}
                    >
                        <span className="btn-icon">▶</span>
                        {mission.currentWaypointIndex > 0 ? (t('resume') || 'Resume') : t('start')}
                    </button>
                    {mission.currentWaypointIndex > 0 && (
                        <button
                            className="btn btn-warning btn-sm"
                            onClick={onReset}
                            title={t('reset') || 'Reset'}
                        >
                            🔄
                        </button>
                    )}
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={onCancel}
                    >
                        {t('unassign')}
                    </button>
                </div>
            )}

            {mission.status === 'active' && (
                <div className="task-progress-section">
                    <div className="progress-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="robot-tag" style={{ backgroundColor: assignedRobot?.color + '20', borderColor: assignedRobot?.color }}>
                                {assignedRobot?.name || 'Robot'}
                            </span>
                            {robotState && (
                                <>
                                    <span className="behavior-tag" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                        { (robotState.activeBehavior && typeof robotState.activeBehavior === 'object') 
                                            ? (robotState.activeBehavior.name || 'Idle') 
                                            : (robotState.activeBehavior ? (t(robotState.activeBehavior.toLowerCase()) || robotState.activeBehavior) : 'Idle')
                                        }
                                    </span>
                                    <span className={`status-indicator status-${robotState.navigationStatus}`} style={{ fontSize: '10px' }}>
                                        {t('nav_' + robotState.navigationStatus) || robotState.navigationStatus}
                                    </span>
                                </>
                            )}
                        </div>
                        <span className="progress-text">
                            {mission.currentWaypointIndex + 1}/{mission.waypoints.length}
                        </span>
                    </div>
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{
                                width: `${getProgress()}%`,
                                backgroundColor: assignedRobot?.color || '#3b82f6'
                            }}
                        />
                    </div>
                    <div className="progress-footer">
                        <span className="elapsed-time">{formatTime(getElapsedTime())}</span>
                        {mission.targetTime > 0 && (
                            <span className="target-time">/ {formatTime(mission.targetTime)}</span>
                        )}
                    </div>
                    <div className="task-actions" style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        <button
                            className="btn btn-secondary btn-sm flex-1"
                            onClick={onStop}
                        >
                            <span className="btn-icon">⏸</span>
                            {t('stop')}
                        </button>
                        <button
                            className="btn btn-danger btn-sm"
                            onClick={onCancel}
                        >
                            {t('cancel_mission')}
                        </button>
                    </div>
                </div>
            )}

            {mission.status === 'completed' && (
                <div className="task-result">
                    <span className="result-icon">✓</span>
                    <span className="result-text">
                        {t('completed_in')} {formatTime(getElapsedTime())}
                    </span>
                </div>
            )}

            {mission.status === 'failed' && (
                <div className="task-result failed" style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="result-icon">✕</span>
                    <span className="result-text">{t('canceled')}</span>
                    <button 
                        className="btn btn-primary btn-sm" 
                        style={{ marginLeft: 'auto' }}
                        onClick={onReset}
                        title={t('reset') || 'Reset'}
                    >
                        🔄 {t('reset') || 'Reset'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default TaskCard;
