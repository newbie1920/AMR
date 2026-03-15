import React, { useState } from 'react';
import { useMissionStore } from '../../stores/missionStore';
import { useFleetStore } from '../../stores/fleetStore';
import './MissionPlanner.css';

const MissionPlanner = () => {
    const {
        missions,
        addMission,
        assignMission,
        cancelMission,
        removeMission,
        clearCompletedMissions,
    } = useMissionStore();

    const { robots } = useFleetStore();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newMission, setNewMission] = useState({
        name: '',
        targetTime: 60,
        waypoints: [],
    });
    const [isAddingWaypoint, setIsAddingWaypoint] = useState(false);

    const handleCreateMission = () => {
        if (newMission.waypoints.length < 2) {
            alert('Nhiệm vụ cần ít nhất 2 điểm!');
            return;
        }

        const missionId = addMission(
            newMission.name || `Nhiệm vụ ${missions.length + 1}`,
            newMission.waypoints,
            newMission.targetTime > 0 ? newMission.targetTime : null
        );

        setNewMission({ name: '', targetTime: 60, waypoints: [] });
        setShowCreateModal(false);
    };

    const handleAssignToRobot = (missionId, robotId) => {
        const success = assignMission(missionId, robotId, robots);
        if (!success) {
            alert('Không thể giao nhiệm vụ! Kiểm tra robot và đường đi.');
        }
    };

    const addWaypoint = (x, y, action = 'move') => {
        setNewMission(prev => ({
            ...prev,
            waypoints: [...prev.waypoints, { x, y, action, duration: 2 }]
        }));
    };

    const removeWaypoint = (index) => {
        setNewMission(prev => ({
            ...prev,
            waypoints: prev.waypoints.filter((_, i) => i !== index)
        }));
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'pending': return '#6b7280';
            case 'active': return '#3b82f6';
            case 'completed': return '#10b981';
            case 'failed': return '#ef4444';
            default: return '#6b7280';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'pending': return '⏸';
            case 'active': return '▶';
            case 'completed': return '✓';
            case 'failed': return '✕';
            default: return '○';
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const getElapsedTime = (mission) => {
        if (!mission.startedAt) return 0;
        const endTime = mission.completedAt || Date.now();
        return (endTime - mission.startedAt) / 1000;
    };

    return (
        <div className="mission-planner">
            <div className="planner-header">
                <h3 className="panel-title">📋 Nhiệm vụ</h3>
                <div className="header-actions">
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={clearCompletedMissions}
                        title="Xóa nhiệm vụ hoàn thành"
                    >
                        🗑️
                    </button>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setShowCreateModal(true)}
                    >
                        + Tạo nhiệm vụ
                    </button>
                </div>
            </div>

            <div className="mission-list">
                {missions.length === 0 ? (
                    <div className="empty-missions">
                        <span className="empty-icon">📦</span>
                        <p>Chưa có nhiệm vụ</p>
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={() => setShowCreateModal(true)}
                        >
                            Tạo nhiệm vụ đầu tiên
                        </button>
                    </div>
                ) : (
                    [...missions]
                        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                        .map(mission => (
                            <div
                                key={mission.id}
                                className={`mission-card status-${mission.status}`}
                            >
                                <div className="mission-header">
                                    <div className="mission-title">
                                        <span
                                            className="status-icon"
                                            style={{ color: getStatusColor(mission.status) }}
                                        >
                                            {getStatusIcon(mission.status)}
                                        </span>
                                        <span className="mission-name">{mission.name}</span>
                                    </div>
                                    <button
                                        className="btn btn-icon btn-sm btn-danger"
                                        onClick={() => removeMission(mission.id)}
                                        title="Xóa"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="mission-info">
                                    <div className="info-row">
                                        <span className="label">Điểm:</span>
                                        <span className="value">{mission.waypoints.length}</span>
                                    </div>
                                    <div className="info-row">
                                        <span className="label">Quãng đường:</span>
                                        <span className="value">
                                            {mission.plannedPath.length > 0
                                                ? `~${(mission.estimatedTime * mission.optimizedVelocity).toFixed(1)}m`
                                                : 'Chưa tính'}
                                        </span>
                                    </div>
                                    {mission.targetTime && (
                                        <div className="info-row">
                                            <span className="label">Thời gian:</span>
                                            <span className="value">
                                                {mission.status === 'active' || mission.status === 'completed'
                                                    ? `${formatTime(getElapsedTime(mission))} / ${formatTime(mission.targetTime)}`
                                                    : formatTime(mission.targetTime)}
                                            </span>
                                        </div>
                                    )}
                                    <div className="info-row">
                                        <span className="label">Vận tốc:</span>
                                        <span className="value">{mission.optimizedVelocity.toFixed(2)} m/s</span>
                                    </div>
                                </div>

                                {mission.status === 'pending' && (
                                    <div className="mission-actions">
                                        <select
                                            className="robot-select"
                                            onChange={(e) => {
                                                if (e.target.value) {
                                                    handleAssignToRobot(mission.id, e.target.value);
                                                }
                                            }}
                                            defaultValue=""
                                        >
                                            <option value="">Chọn robot...</option>
                                            {robots
                                                .filter(r => r.connected)
                                                .map(robot => (
                                                    <option key={robot.id} value={robot.id}>
                                                        {robot.name}
                                                    </option>
                                                ))}
                                        </select>
                                    </div>
                                )}

                                {mission.status === 'active' && (
                                    <div className="mission-actions">
                                        <div className="progress-info">
                                            <span>
                                                Điểm {mission.currentWaypointIndex + 1}/{mission.waypoints.length}
                                            </span>
                                            <div className="progress-bar">
                                                <div
                                                    className="progress-fill"
                                                    style={{
                                                        width: `${(mission.currentWaypointIndex / mission.waypoints.length) * 100}%`
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            className="btn btn-sm btn-danger"
                                            onClick={() => cancelMission(mission.id)}
                                        >
                                            Hủy
                                        </button>
                                    </div>
                                )}

                                {mission.status === 'completed' && (
                                    <div className="mission-result">
                                        <span className="result-label">✓ Hoàn thành trong</span>
                                        <span className="result-time">{formatTime(getElapsedTime(mission))}</span>
                                    </div>
                                )}
                            </div>
                        ))
                )}
            </div>

            {/* Create Mission Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content mission-modal" onClick={e => e.stopPropagation()}>
                        <h3>Tạo nhiệm vụ mới</h3>

                        <div className="form-group">
                            <label>Tên nhiệm vụ</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="VD: Lấy hàng từ A đến B"
                                value={newMission.name}
                                onChange={e => setNewMission({ ...newMission, name: e.target.value })}
                            />
                        </div>

                        <div className="form-group">
                            <label>Thời gian hoàn thành (giây)</label>
                            <input
                                type="number"
                                className="input"
                                min="0"
                                step="5"
                                value={newMission.targetTime}
                                onChange={e => setNewMission({ ...newMission, targetTime: parseInt(e.target.value) || 0 })}
                            />
                            <small>Để 0 nếu không giới hạn thời gian</small>
                        </div>

                        <div className="form-group">
                            <label>Điểm đi qua ({newMission.waypoints.length})</label>
                            <div className="waypoint-list">
                                {newMission.waypoints.map((wp, index) => (
                                    <div key={index} className="waypoint-item">
                                        <span className="wp-number">{index + 1}</span>
                                        <span className="wp-coords">
                                            ({wp.x.toFixed(1)}, {wp.y.toFixed(1)})
                                        </span>
                                        <select
                                            className="wp-action"
                                            value={wp.action}
                                            onChange={e => {
                                                const updated = [...newMission.waypoints];
                                                updated[index].action = e.target.value;
                                                setNewMission({ ...newMission, waypoints: updated });
                                            }}
                                        >
                                            <option value="move">Di chuyển</option>
                                            <option value="load">Bốc hàng</option>
                                            <option value="unload">Trả hàng</option>
                                            <option value="wait">Chờ</option>
                                        </select>
                                        <button
                                            className="btn btn-icon btn-sm btn-danger"
                                            onClick={() => removeWaypoint(index)}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                className={`btn btn-sm ${isAddingWaypoint ? 'btn-success' : 'btn-secondary'}`}
                                onClick={() => setIsAddingWaypoint(!isAddingWaypoint)}
                            >
                                {isAddingWaypoint ? '✓ Click vào bản đồ' : '+ Thêm điểm'}
                            </button>
                        </div>

                        <div className="modal-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setShowCreateModal(false);
                                    setIsAddingWaypoint(false);
                                }}
                            >
                                Hủy
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateMission}
                                disabled={newMission.waypoints.length < 2}
                            >
                                Tạo nhiệm vụ
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MissionPlanner;
