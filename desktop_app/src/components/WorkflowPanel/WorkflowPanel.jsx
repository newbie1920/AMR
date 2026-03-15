import React, { useState } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './WorkflowPanel.css';

const TASK_TYPES = [
    { id: 'move', labelKey: 'move', icon: '➡️' },
    { id: 'wait', labelKey: 'wait_duration', icon: '⏱️' },
    { id: 'action', labelKey: 'action', icon: '⚙️' },
];

const WorkflowPanel = () => {
    const {
        robots,
        workflows,
        activeWorkflows,
        createWorkflow,
        deleteWorkflow,
        startWorkflow,
        stopWorkflow,
        addTaskToRobot,
        selectedRobotId,
        settings,
    } = useFleetStore();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [newWorkflow, setNewWorkflow] = useState({
        name: '',
        description: '',
        steps: [],
        isLoop: false,
    });
    const [newTask, setNewTask] = useState({
        type: 'move',
        name: '',
        x: 0,
        y: 0,
        duration: 3000,
        action: '',
    });

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const handleCreateWorkflow = () => {
        if (!newWorkflow.name.trim()) return;
        createWorkflow(newWorkflow);
        setNewWorkflow({ name: '', description: '', steps: [], isLoop: false });
        setShowCreateModal(false);
    };

    const handleAddTask = () => {
        if (!selectedRobotId) return;
        addTaskToRobot(selectedRobotId, {
            ...newTask,
            name: newTask.name || `${t(newTask.type)} task`,
        });
        setNewTask({ type: 'move', name: '', x: 0, y: 0, duration: 3000, action: '' });
        setShowTaskModal(false);
    };

    const handleStartWorkflow = (workflowId) => {
        if (!selectedRobotId) {
            alert(t('select_robot_to_manage'));
            return;
        }
        startWorkflow(workflowId, { default: selectedRobotId });
    };

    const selectedRobot = robots.find(r => r.id === selectedRobotId);

    return (
        <div className="workflow-panel">
            <div className="panel-header">
                <h3 className="panel-title">📋 {t('tasks_workflows')}</h3>
            </div>

            {/* Quick Task Section */}
            <div className="section">
                <div className="section-header">
                    <h4>{t('quick_task')}</h4>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setShowTaskModal(true)}
                        disabled={!selectedRobotId}
                    >
                        + {t('add_task')}
                    </button>
                </div>

                {selectedRobot ? (
                    <div className="task-queue">
                        {selectedRobot.currentTask && (
                            <div className="task-item current">
                                <span className="task-icon">⚡</span>
                                <div className="task-info">
                                    <span className="task-name">{selectedRobot.currentTask.name}</span>
                                    <span className="task-status">{t('running')}</span>
                                </div>
                            </div>
                        )}

                        {selectedRobot.taskQueue?.length > 0 ? (
                            selectedRobot.taskQueue.map((task, index) => (
                                <div key={task.id} className="task-item pending">
                                    <span className="task-index">{index + 1}</span>
                                    <div className="task-info">
                                        <span className="task-name">{task.name}</span>
                                        <span className="task-type">{t(task.type)}</span>
                                    </div>
                                </div>
                            ))
                        ) : !selectedRobot.currentTask && (
                            <div className="empty-queue">
                                {t('no_tasks_queued')} {selectedRobot.name}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="empty-queue">
                        {t('select_robot_to_manage')}
                    </div>
                )}
            </div>

            {/* Workflows Section */}
            <div className="section">
                <div className="section-header">
                    <h4>{t('workflows')}</h4>
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setShowCreateModal(true)}
                    >
                        + {t('create')}
                    </button>
                </div>

                <div className="workflow-list">
                    {workflows.length === 0 ? (
                        <div className="empty-workflows">
                            <p>{t('no_workflows')}</p>
                            <span>{t('create_automated')}</span>
                        </div>
                    ) : (
                        workflows.map(workflow => {
                            const isActive = activeWorkflows.some(aw => aw.workflowId === workflow.id);
                            return (
                                <div key={workflow.id} className={`workflow-item ${isActive ? 'active' : ''}`}>
                                    <div className="workflow-info">
                                        <span className="workflow-name">{workflow.name}</span>
                                        <span className="workflow-steps">
                                            {workflow.steps?.length || 0} {t('steps')}
                                            {workflow.isLoop && ` • ${t('loop')}`}
                                        </span>
                                    </div>
                                    <div className="workflow-actions">
                                        {isActive ? (
                                            <button
                                                className="btn btn-sm btn-danger"
                                                onClick={() => {
                                                    const active = activeWorkflows.find(aw => aw.workflowId === workflow.id);
                                                    if (active) stopWorkflow(active.id);
                                                }}
                                            >
                                                {t('stop')}
                                            </button>
                                        ) : (
                                            <button
                                                className="btn btn-sm btn-success"
                                                onClick={() => handleStartWorkflow(workflow.id)}
                                            >
                                                {t('start')}
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => deleteWorkflow(workflow.id)}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Active Workflows Section */}
            {activeWorkflows.length > 0 && (
                <div className="section">
                    <h4>{t('active')} ({activeWorkflows.length})</h4>
                    <div className="active-workflows">
                        {activeWorkflows.map(aw => {
                            const workflow = workflows.find(w => w.id === aw.workflowId);
                            return (
                                <div key={aw.id} className="active-workflow-item">
                                    <span className="pulse-indicator" />
                                    <span>{workflow?.name || t('unknown')}</span>
                                    <span className="step-progress">
                                        {t('step')} {aw.currentStep + 1}/{workflow?.steps?.length || 0}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Create Workflow Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>{t('create_workflow')}</h3>

                        <div className="form-group">
                            <label>{t('name')} *</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="..."
                                value={newWorkflow.name}
                                onChange={e => setNewWorkflow({ ...newWorkflow, name: e.target.value })}
                            />
                        </div>

                        <div className="form-group">
                            <label>{t('description')}</label>
                            <textarea
                                className="input textarea"
                                placeholder="..."
                                rows="2"
                                value={newWorkflow.description}
                                onChange={e => setNewWorkflow({ ...newWorkflow, description: e.target.value })}
                            />
                        </div>

                        <div className="form-group checkbox-group">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={newWorkflow.isLoop}
                                    onChange={e => setNewWorkflow({ ...newWorkflow, isLoop: e.target.checked })}
                                />
                                {t('loop_continuously')}
                            </label>
                        </div>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                                {t('cancel')}
                            </button>
                            <button className="btn btn-primary" onClick={handleCreateWorkflow}>
                                {t('create')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Task Modal */}
            {showTaskModal && (
                <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>{t('add_task')} {selectedRobot?.name}</h3>

                        <div className="form-group">
                            <label>{t('task_type')}</label>
                            <div className="task-type-selector">
                                {TASK_TYPES.map(type => (
                                    <button
                                        key={type.id}
                                        className={`task-type-btn ${newTask.type === type.id ? 'selected' : ''}`}
                                        onClick={() => setNewTask({ ...newTask, type: type.id })}
                                    >
                                        <span>{type.icon}</span>
                                        <span>{t(type.labelKey)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="form-group">
                            <label>{t('task_name')}</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="..."
                                value={newTask.name}
                                onChange={e => setNewTask({ ...newTask, name: e.target.value })}
                            />
                        </div>

                        {newTask.type === 'move' && (
                            <div className="form-group">
                                <label>{t('target_position')}</label>
                                <div className="position-inputs">
                                    <input
                                        type="number"
                                        className="input"
                                        placeholder="X"
                                        step="0.1"
                                        value={newTask.x}
                                        onChange={e => setNewTask({ ...newTask, x: parseFloat(e.target.value) || 0 })}
                                    />
                                    <input
                                        type="number"
                                        className="input"
                                        placeholder="Y"
                                        step="0.1"
                                        value={newTask.y}
                                        onChange={e => setNewTask({ ...newTask, y: parseFloat(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                        )}

                        {newTask.type === 'wait' && (
                            <div className="form-group">
                                <label>{t('wait_duration')}</label>
                                <input
                                    type="number"
                                    className="input"
                                    placeholder="3000"
                                    step="500"
                                    min="500"
                                    value={newTask.duration}
                                    onChange={e => setNewTask({ ...newTask, duration: parseInt(e.target.value) || 3000 })}
                                />
                            </div>
                        )}

                        {newTask.type === 'action' && (
                            <div className="form-group">
                                <label>{t('action')}</label>
                                <select
                                    className="input"
                                    value={newTask.action}
                                    onChange={e => setNewTask({ ...newTask, action: e.target.value })}
                                >
                                    <option value="">{t('select_action')}</option>
                                    <option value="load">{t('load_cargo')}</option>
                                    <option value="unload">{t('unload_cargo')}</option>
                                    <option value="scan">{t('scan_area')}</option>
                                    <option value="charge">{t('charge_dock')}</option>
                                </select>
                            </div>
                        )}

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowTaskModal(false)}>
                                {t('cancel')}
                            </button>
                            <button className="btn btn-primary" onClick={handleAddTask}>
                                {t('add')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkflowPanel;
