import React, { useState } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import './TaskManager.css';

const TaskManager = () => {
    const { tasks, addTask, removeTask, startTask, completeTask, currentTask, connected } = useRobotStore();
    const [showAddTask, setShowAddTask] = useState(false);
    const [newTask, setNewTask] = useState({ name: '', x: 0, y: 0, description: '' });

    const handleAddTask = () => {
        if (!newTask.name.trim()) return;

        addTask({
            name: newTask.name,
            x: parseFloat(newTask.x) || 0,
            y: parseFloat(newTask.y) || 0,
            description: newTask.description
        });

        setNewTask({ name: '', x: 0, y: 0, description: '' });
        setShowAddTask(false);
    };

    const getStatusBadge = (status) => {
        const badges = {
            pending: { class: 'badge-info', text: 'Pending' },
            running: { class: 'badge-warning', text: 'Running' },
            completed: { class: 'badge-success', text: 'Completed' },
            failed: { class: 'badge-error', text: 'Failed' }
        };
        const badge = badges[status] || badges.pending;
        return <span className={`badge ${badge.class}`}>{badge.text}</span>;
    };

    return (
        <div className="task-manager">
            <div className="panel-header">
                <h3 className="panel-title">Tasks</h3>
                <button
                    className="btn btn-primary btn-sm"
                    onClick={() => setShowAddTask(!showAddTask)}
                >
                    {showAddTask ? 'Cancel' : '+ Add Task'}
                </button>
            </div>

            {/* Add Task Form */}
            {showAddTask && (
                <div className="add-task-form animate-fadeIn">
                    <input
                        type="text"
                        className="input"
                        placeholder="Task name"
                        value={newTask.name}
                        onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                    />

                    <div className="coordinates-row">
                        <div className="coordinate-input">
                            <label>X</label>
                            <input
                                type="number"
                                className="input"
                                step="0.1"
                                value={newTask.x}
                                onChange={(e) => setNewTask({ ...newTask, x: e.target.value })}
                            />
                        </div>
                        <div className="coordinate-input">
                            <label>Y</label>
                            <input
                                type="number"
                                className="input"
                                step="0.1"
                                value={newTask.y}
                                onChange={(e) => setNewTask({ ...newTask, y: e.target.value })}
                            />
                        </div>
                    </div>

                    <textarea
                        className="input textarea"
                        placeholder="Description (optional)"
                        rows="2"
                        value={newTask.description}
                        onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    />

                    <button className="btn btn-success" onClick={handleAddTask}>
                        Create Task
                    </button>
                </div>
            )}

            {/* Task List */}
            <div className="task-list">
                {(!tasks || tasks.length === 0) ? (
                    <div className="no-tasks">
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="6" y="10" width="36" height="32" rx="4" />
                            <path d="M15 22L21 28L33 16" />
                            <path d="M6 18H42" />
                        </svg>
                        <p>No tasks yet</p>
                        <span>Click "Add Task" to create one</span>
                    </div>
                ) : (
                    tasks && tasks.map(task => (
                        <div
                            key={task.id}
                            className={`task-item ${task.status} ${currentTask?.id === task.id ? 'active' : ''}`}
                        >
                            <div className="task-header">
                                <span className="task-name">{task.name}</span>
                                {getStatusBadge(task.status)}
                            </div>

                            <div className="task-location">
                                <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                </svg>
                                <span>({task.x.toFixed(2)}, {task.y.toFixed(2)})</span>
                            </div>

                            {task.description && (
                                <p className="task-description">{task.description}</p>
                            )}

                            <div className="task-actions">
                                {task.status === 'pending' && (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => startTask(task.id)}
                                        disabled={!connected}
                                    >
                                        Start
                                    </button>
                                )}

                                {task.status === 'running' && (
                                    <button
                                        className="btn btn-success btn-sm"
                                        onClick={() => completeTask(task.id)}
                                    >
                                        Complete
                                    </button>
                                )}

                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => removeTask(task.id)}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default TaskManager;
