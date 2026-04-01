import React, { useState } from 'react';
import { useMissionStore } from '../../stores/missionStore';
import { useFleetStore } from '../../stores/fleetStore';
import { useToast } from '../Toast/Toast';
import TaskCard from './TaskCard';
import CreateTaskModal from './CreateTaskModal';
import translations from '../../translations';
import './TaskPanel.css';

const TaskPanel = ({ onSelectWaypoint, isSelectingWaypoint, onCancelWaypointSelect }) => {
    const {
        missions,
        addMission,
        assignMission,
        startMission,
        stopMission,
        cancelMission,
        removeMission,
        clearCompletedMissions,
        updateMission,
        resetMission,
    } = useMissionStore();

    const { robots, settings } = useFleetStore();
    const toast = useToast();

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [editingMissionId, setEditingMissionId] = useState(null);
    const [activeFilter, setActiveFilter] = useState('all');

    // Get counts
    const pendingCount = missions.filter(m => m.status === 'pending').length;
    const activeCount = missions.filter(m => m.status === 'active').length;
    const completedCount = missions.filter(m => m.status === 'completed').length;

    // Filter missions
    const filteredMissions = missions.filter(m => {
        if (activeFilter === 'all') return true;
        return m.status === activeFilter;
    });

    // Sort: active first, then pending, then completed
    const sortedMissions = [...filteredMissions].sort((a, b) => {
        const order = { active: 0, pending: 1, completed: 2, failed: 3 };
        const statusDiff = (order[a.status] ?? 4) - (order[b.status] ?? 4);
        if (statusDiff !== 0) return statusDiff;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const handleSaveTask = (taskData) => {
        if (editingMissionId) {
            updateMission(editingMissionId, {
                name: taskData.name,
                waypoints: taskData.waypoints,
                targetTime: taskData.targetTime,
                scheduledAt: taskData.scheduledAt,
            });
            setEditingMissionId(null);
        } else {
            addMission(
                taskData.name,
                taskData.waypoints,
                taskData.targetTime > 0 ? taskData.targetTime : null,
                taskData.scheduledAt
            );
        }
        setShowCreateModal(false);
    };

    const handleEditTask = (missionId) => {
        setEditingMissionId(missionId);
        setShowCreateModal(true);
    };

    const handleAssignRobot = (missionId, robotId) => {
        const success = assignMission(missionId, robotId, robots);
        if (!success) {
            toast.error(t('assign_failed'));
        } else {
            toast.success(t('assign_success'));
        }
    };

    // Task templates
    const taskTemplates = [
        {
            id: 'pickup-a-b',
            name: t('pickup_a_b'),
            icon: '📦',
            waypoints: [
                { x: 2.5, y: 2.5, action: 'load', duration: 5 },
                { x: 12.5, y: 2.5, action: 'unload', duration: 5 },
            ],
            targetTime: 60,
        },
        {
            id: 'charging',
            name: t('go_to_charge'),
            icon: '⚡',
            waypoints: [
                { x: 2, y: 13, action: 'wait', duration: 300 },
            ],
            targetTime: 0,
        },
        {
            id: 'patrol',
            name: t('warehouse_patrol'),
            icon: '🔍',
            waypoints: [
                { x: 2.5, y: 2.5, action: 'move', duration: 0 },
                { x: 12.5, y: 2.5, action: 'move', duration: 0 },
                { x: 12.5, y: 8, action: 'move', duration: 0 },
                { x: 2.5, y: 8, action: 'move', duration: 0 },
                { x: 2, y: 13, action: 'move', duration: 0 },
            ],
            targetTime: 120,
        },
    ];

    const handleUseTemplate = (template) => {
        const missionId = addMission(
            template.name,
            template.waypoints,
            template.targetTime > 0 ? template.targetTime : null
        );
    };

    return (
        <div className="task-panel">
            {/* Header */}
            <div className="task-panel-header">
                <h3 className="panel-title">
                    <span className="title-icon">📋</span>
                    {t('missions')}
                </h3>
                <div className="header-actions">
                    <button
                        className="btn btn-icon btn-ghost"
                        onClick={clearCompletedMissions}
                        title={t('clear_completed')}
                    >
                        🗑️
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="task-stats">
                <div
                    className={`stat-item ${activeFilter === 'pending' ? 'active' : ''}`}
                    onClick={() => setActiveFilter(activeFilter === 'pending' ? 'all' : 'pending')}
                >
                    <span className="stat-value">{pendingCount}</span>
                    <span className="stat-label">{t('pending_label')}</span>
                </div>
                <div
                    className={`stat-item ${activeFilter === 'active' ? 'active' : ''}`}
                    onClick={() => setActiveFilter(activeFilter === 'active' ? 'all' : 'active')}
                >
                    <span className="stat-value">{activeCount}</span>
                    <span className="stat-label">{t('active_label')}</span>
                </div>
                <div
                    className={`stat-item ${activeFilter === 'completed' ? 'active' : ''}`}
                    onClick={() => setActiveFilter(activeFilter === 'completed' ? 'all' : 'completed')}
                >
                    <span className="stat-value">{completedCount}</span>
                    <span className="stat-label">{t('completed_label')}</span>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="quick-actions">
                <button
                    className="btn btn-primary btn-full"
                    onClick={() => setShowCreateModal(true)}
                >
                    <span className="btn-icon">+</span>
                    {t('create_task')}
                </button>
            </div>

            {/* Templates */}
            <div className="task-templates">
                <div className="templates-header">
                    <span className="templates-title">{t('quick_templates')}</span>
                </div>
                <div className="templates-grid">
                    {taskTemplates.map(template => (
                        <button
                            key={template.id}
                            className="template-btn"
                            onClick={() => handleUseTemplate(template)}
                            title={template.name}
                        >
                            <span className="template-icon">{template.icon}</span>
                            <span className="template-name">{template.name}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Task List */}
            <div className="task-list">
                {sortedMissions.length === 0 ? (
                    <div className="empty-tasks">
                        <span className="empty-icon">📦</span>
                        <p>{t('no_missions')}</p>
                        <button
                            className="btn btn-sm btn-primary"
                            onClick={() => setShowCreateModal(true)}
                        >
                            {t('create_first_mission')}
                        </button>
                    </div>
                ) : (
                    sortedMissions.map(mission => (
                        <TaskCard
                            key={mission.id}
                            mission={mission}
                            robots={robots}
                            missions={missions}
                            onAssign={(robotId) => handleAssignRobot(mission.id, robotId)}
                            onStart={() => startMission(mission.id)}
                            onStop={() => stopMission(mission.id)}
                            onCancel={() => cancelMission(mission.id)}
                            onEdit={() => handleEditTask(mission.id)}
                            onRemove={() => removeMission(mission.id)}
                            onReset={() => resetMission(mission.id)}
                        />
                    ))
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <CreateTaskModal
                    onClose={() => {
                        setShowCreateModal(false);
                        setEditingMissionId(null);
                    }}
                    onCreate={handleSaveTask}
                    initialData={missions.find(m => m.id === editingMissionId)}
                    onSelectWaypoint={onSelectWaypoint}
                    isSelectingWaypoint={isSelectingWaypoint}
                    onCancelWaypointSelect={onCancelWaypointSelect}
                />
            )}
        </div>
    );
};

export default TaskPanel;
