import React, { useState, useEffect, useRef } from 'react';
import WaypointMapView from './WaypointMapView';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';

const CreateTaskModal = ({
    onClose,
    onCreate,
    onSelectWaypoint,
    isSelectingWaypoint,
    onCancelWaypointSelect,
    initialData = null,
}) => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [step, setStep] = useState(1);
    const [taskData, setTaskData] = useState(() => {
        if (initialData) {
            return {
                name: initialData.name || '',
                waypoints: (initialData.waypoints || []).map(wp => ({
                    ...wp,
                    travelTimeEnabled: !!wp.travelTime,
                    travelTime: wp.travelTime || 60,
                    thetaEnabled: !!wp.theta,
                    theta: wp.theta || 0
                })),
                targetTime: initialData.targetTime || 0,
                targetTimeEnabled: !!initialData.targetTime,
                scheduleEnabled: !!initialData.scheduledAt,
                scheduleTime: initialData.scheduledAt
                    ? new Date(initialData.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
                    : '',
            };
        }
        return {
            name: '',
            waypoints: [],
            targetTime: 0,
            targetTimeEnabled: false,
            scheduleEnabled: false,
            scheduleTime: '',
        };
    });

    const [duration, setDuration] = useState(() => {
        if (initialData && initialData.targetTime) {
            const h = Math.floor(initialData.targetTime / 3600);
            const m = Math.floor((initialData.targetTime % 3600) / 60);
            const s = initialData.targetTime % 60;
            return { h, m, s };
        }
        return { h: 0, m: 1, s: 0 };
    });

    const [selectedWpIdx, setSelectedWpIdx] = useState(null);

    // Handle waypoint from map click
    useEffect(() => {
        const handleWaypointAdded = (event) => {
            const point = event.detail;
            addWaypoint(point.x, point.y);
        };

        window.addEventListener('waypointAdded', handleWaypointAdded);
        return () => window.removeEventListener('waypointAdded', handleWaypointAdded);
    }, [taskData.waypoints]);

    const addWaypoint = (x, y) => {
        const newWp = {
            x, y,
            action: 'move',
            duration: 0,
            theta: 0,
            thetaEnabled: false,
            travelTime: 60, // Default 1 min
            travelTimeEnabled: false,
            scheduledAt: null
        };
        const newWaypoints = [...taskData.waypoints, newWp];
        setTaskData(prev => ({ ...prev, waypoints: newWaypoints }));
        setSelectedWpIdx(newWaypoints.length - 1);
    };

    const removeWaypoint = (index) => {
        setTaskData(prev => ({
            ...prev,
            waypoints: prev.waypoints.filter((_, i) => i !== index)
        }));
        if (selectedWpIdx === index) {
            setSelectedWpIdx(null);
        } else if (selectedWpIdx > index) {
            setSelectedWpIdx(selectedWpIdx - 1);
        }
    };

    const updateWaypoint = (index, updates) => {
        setTaskData(prev => ({
            ...prev,
            waypoints: prev.waypoints.map((wp, i) =>
                i === index ? { ...wp, ...updates } : wp
            )
        }));
    };

    const handleCreate = () => {
        if (taskData.waypoints.length < 1) {
            alert(t('at_least_one_point'));
            return;
        }

        const totalSeconds = (duration.h * 3600) + (duration.m * 60) + duration.s;

        let scheduledAt = null;
        if (taskData.scheduleEnabled && taskData.scheduleTime) {
            const [hours, minutes] = taskData.scheduleTime.split(':').map(Number);
            const now = new Date();
            const scheduleDate = new Date();
            scheduleDate.setHours(hours, minutes, 0, 0);
            if (scheduleDate <= now) scheduleDate.setDate(scheduleDate.getDate() + 1);
            scheduledAt = scheduleDate.getTime();
        }

        onCreate({
            ...taskData,
            targetTime: taskData.targetTimeEnabled ? totalSeconds : null,
            scheduledAt,
            waypoints: taskData.waypoints.map(wp => ({
                ...wp,
                travelTime: wp.travelTimeEnabled ? wp.travelTime : null,
                theta: wp.thetaEnabled ? wp.theta : null
            }))
        });
    };

    const getActionIcon = (action) => {
        switch (action) {
            case 'load': return '📥';
            case 'unload': return '📤';
            case 'wait': return '⏳';
            default: return '📍';
        }
    };

    const handleWheelNumber = (e, value, onChange, min = 0, max = Infinity) => {
        const delta = e.deltaY > 0 ? -1 : 1;
        let newValue = (parseInt(value) || 0) + delta;
        if (newValue < min) newValue = min;
        if (newValue > max) newValue = max;
        onChange(newValue);
    };

    const handleWheelTime = (e, value, onChange) => {
        if (!value) return;
        const [h, m] = value.split(':').map(Number);
        const delta = e.deltaY > 0 ? -1 : 1;
        let totalMinutes = h * 60 + m + delta;
        if (totalMinutes < 0) totalMinutes = 24 * 60 - 1;
        if (totalMinutes >= 24 * 60) totalMinutes = 0;

        const newH = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
        const newM = (totalMinutes % 60).toString().padStart(2, '0');
        onChange(`${newH}:${newM}`);
    };

    const handleWheelTimestamp = (e, timestamp, onChange) => {
        const delta = e.deltaY > 0 ? -60000 : 60000;
        onChange(timestamp + delta);
    };

    // Helper hook-like logic for non-passive wheel events
    const useNonPassiveWheel = (callback) => {
        const ref = useRef(null);
        useEffect(() => {
            const el = ref.current;
            if (!el) return;
            const handler = (e) => {
                // Only trigger if focused to prevent accidental scrolls
                if (document.activeElement !== el) return;
                e.preventDefault();
                callback(e);
            };
            el.addEventListener('wheel', handler, { passive: false });
            return () => el.removeEventListener('wheel', handler);
        }, [callback]);
        return ref;
    };

    // Refs for all wheelable inputs in Step 2 & 3
    const wheelRefs = {
        wpH: useNonPassiveWheel(e => {
            if (selectedWpIdx === null) return;
            const currentSeconds = taskData.waypoints[selectedWpIdx].travelTime || 0;
            const h = Math.floor(currentSeconds / 3600);
            const m = Math.floor((currentSeconds % 3600) / 60);
            const s = currentSeconds % 60;
            handleWheelNumber(e, h, val => updateWaypoint(selectedWpIdx, { travelTime: val * 3600 + m * 60 + s }), 0);
        }),
        wpM: useNonPassiveWheel(e => {
            if (selectedWpIdx === null) return;
            const currentSeconds = taskData.waypoints[selectedWpIdx].travelTime || 0;
            const h = Math.floor(currentSeconds / 3600);
            const m = Math.floor((currentSeconds % 3600) / 60);
            const s = currentSeconds % 60;
            handleWheelNumber(e, m, val => updateWaypoint(selectedWpIdx, { travelTime: h * 3600 + val * 60 + s }), 0, 59);
        }),
        wpS: useNonPassiveWheel(e => {
            if (selectedWpIdx === null) return;
            const currentSeconds = taskData.waypoints[selectedWpIdx].travelTime || 0;
            const h = Math.floor(currentSeconds / 3600);
            const m = Math.floor((currentSeconds % 3600) / 60);
            const s = currentSeconds % 60;
            handleWheelNumber(e, s, val => updateWaypoint(selectedWpIdx, { travelTime: h * 3600 + m * 60 + val }), 0, 59);
        }),
        wpSchedule: useNonPassiveWheel(e => {
            if (selectedWpIdx === null || !taskData.waypoints[selectedWpIdx].scheduledAt) return;
            handleWheelTimestamp(e, taskData.waypoints[selectedWpIdx].scheduledAt, val => {
                const newWps = [...taskData.waypoints];
                newWps[selectedWpIdx].scheduledAt = val;
                setTaskData({ ...taskData, waypoints: newWps });
            });
        }),
        globalSchedule: useNonPassiveWheel(e => {
            handleWheelTime(e, taskData.scheduleTime, val => setTaskData({ ...taskData, scheduleTime: val }));
        }),
        globalH: useNonPassiveWheel(e => {
            handleWheelNumber(e, duration.h, val => setDuration(prev => ({ ...prev, h: val })), 0);
        }),
        globalM: useNonPassiveWheel(e => {
            handleWheelNumber(e, duration.m, val => setDuration(prev => ({ ...prev, m: val })), 0, 59);
        }),
        globalS: useNonPassiveWheel(e => {
            handleWheelNumber(e, duration.s, val => setDuration(prev => ({ ...prev, s: val })), 0, 59);
        }),
        wpTheta: useNonPassiveWheel(e => {
            if (selectedWpIdx === null) return;
            let current = taskData.waypoints[selectedWpIdx].theta || 0;
            const delta = e.deltaY > 0 ? -1 : 1;
            let newVal = (current + delta) % 360;
            if (newVal < 0) newVal += 360;
            updateWaypoint(selectedWpIdx, { theta: newVal });
        })
    };

    return (
        <div className="modal-overlay" onClick={() => { if (typeof onClose === 'function') onClose(); }}>
            <div className="modal-content create-task-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: step === 2 ? '1100px' : '700px', width: '95%' }}>
                {/* Header */}
                <div className="modal-header">
                    <h3>{initialData ? t('edit_task_title') : t('create_task_title')}</h3>
                    <button className="btn btn-ghost btn-icon" onClick={() => { if (typeof onClose === 'function') onClose(); }}>✕</button>
                </div>

                {/* Progress steps */}
                <div className="step-indicator">
                    {[1, 2, 3].map(s => (
                        <div
                            key={s}
                            className={`step ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`}
                            onClick={() => s < step && setStep(s)}
                        >
                            <span className="step-number">{s}</span>
                            <span className="step-label">
                                {s === 1 ? t('step_name') : s === 2 ? t('step_waypoints') : t('step_timing')}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="modal-body" style={{ minHeight: '450px' }}>
                    {/* Step 1: Name */}
                    {step === 1 && (
                        <div className="step-content">
                            <div className="form-group">
                                <label>{t('task_name_label')}</label>
                                <input
                                    type="text"
                                    className="input input-lg"
                                    placeholder={t('task_name_placeholder')}
                                    value={taskData.name}
                                    onChange={e => setTaskData({ ...taskData, name: e.target.value })}
                                    autoFocus
                                />
                            </div>
                        </div>
                    )}

                    {/* Step 2: Waypoints */}
                    {step === 2 && (
                        <div className="step-content waypoints-step" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
                            <div className="map-view-section">
                                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label>{t('route_label')} ({taskData.waypoints.length} {t('points')})</label>
                                    <button className="btn btn-sm btn-ghost" onClick={() => setTaskData({ ...taskData, waypoints: [] })}>🗑️ {t('clear_all')}</button>
                                </div>
                                <WaypointMapView
                                    waypoints={taskData.waypoints}
                                    onAddWaypoint={addWaypoint}
                                    onRemoveWaypoint={removeWaypoint}
                                />
                                <div className="wp-mini-list" style={{ marginTop: '12px', display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
                                    {taskData.waypoints.map((wp, idx) => (
                                        <div
                                            key={idx}
                                            className={`wp-mini-card ${selectedWpIdx === idx ? 'selected' : ''}`}
                                            onClick={() => setSelectedWpIdx(idx)}
                                            style={{
                                                padding: '8px 12px',
                                                background: selectedWpIdx === idx ? 'rgba(0, 212, 255, 0.2)' : 'rgba(255,255,255,0.05)',
                                                border: `1px solid ${selectedWpIdx === idx ? '#00d4ff' : 'transparent'}`,
                                                borderRadius: '6px', cursor: 'pointer', minWidth: '80px', textAlign: 'center'
                                            }}
                                        >
                                            <strong>#{idx + 1}</strong>
                                            <div style={{ fontSize: '10px', opacity: 0.7 }}>{wp.action}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="wp-config-side" style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                {selectedWpIdx !== null ? (
                                    <>
                                        <h4 style={{ margin: '0 0 16px 0', color: '#00d4ff' }}>{t('setup_point')} {selectedWpIdx + 1}</h4>
                                        <div className="form-group">
                                            <label>{t('action_label')}</label>
                                            <select
                                                className="input"
                                                value={taskData.waypoints[selectedWpIdx].action}
                                                onChange={e => {
                                                    const newWps = [...taskData.waypoints];
                                                    newWps[selectedWpIdx].action = e.target.value;
                                                    setTaskData({ ...taskData, waypoints: newWps });
                                                }}
                                            >
                                                <option value="move">{t('action_move')}</option>
                                                <option value="load">{t('action_load')}</option>
                                                <option value="unload">{t('action_unload')}</option>
                                                <option value="wait">{t('action_wait')}</option>
                                            </select>
                                        </div>

                                        <div className="form-group" style={{ marginTop: '16px' }}>
                                            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={!!taskData.waypoints[selectedWpIdx].thetaEnabled}
                                                    onChange={e => updateWaypoint(selectedWpIdx, { thetaEnabled: e.target.checked })}
                                                />
                                                {t('required_angle')}
                                            </label>

                                            {taskData.waypoints[selectedWpIdx].thetaEnabled && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <input
                                                        type="number" className="input" min="0" max="359" placeholder={t('angle_placeholder')}
                                                        style={{ flex: 1 }}
                                                        ref={wheelRefs.wpTheta}
                                                        value={taskData.waypoints[selectedWpIdx].theta || 0}
                                                        onChange={e => {
                                                            let val = parseInt(e.target.value) || 0;
                                                            if (val < 0) val = 0;
                                                            if (val > 359) val = 359;
                                                            updateWaypoint(selectedWpIdx, { theta: val });
                                                        }}
                                                    />
                                                    <span style={{ opacity: 0.6 }}>°</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="form-group" style={{ marginTop: '16px' }}>
                                            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={!!taskData.waypoints[selectedWpIdx].travelTimeEnabled}
                                                    onChange={e => updateWaypoint(selectedWpIdx, { travelTimeEnabled: e.target.checked })}
                                                />
                                                {t('custom_travel_time')}
                                            </label>

                                            {taskData.waypoints[selectedWpIdx].travelTimeEnabled && (
                                                <>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <div style={{ flex: 1 }}>
                                                            <input
                                                                type="number" className="input" min="0" placeholder={t('hour_label')}
                                                                ref={wheelRefs.wpH}
                                                                value={Math.floor((taskData.waypoints[selectedWpIdx].travelTime || 0) / 3600)}
                                                                onChange={e => {
                                                                    const h = parseInt(e.target.value) || 0;
                                                                    const m = Math.floor(((taskData.waypoints[selectedWpIdx].travelTime || 0) % 3600) / 60);
                                                                    const s = (taskData.waypoints[selectedWpIdx].travelTime || 0) % 60;
                                                                    updateWaypoint(selectedWpIdx, { travelTime: h * 3600 + m * 60 + s });
                                                                }}
                                                            />
                                                            <small style={{ fontSize: '10px', opacity: 0.6 }}>{t('hour_full')}</small>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <input
                                                                type="number" className="input" min="0" max="59" placeholder={t('min_label')}
                                                                ref={wheelRefs.wpM}
                                                                value={Math.floor(((taskData.waypoints[selectedWpIdx].travelTime || 0) % 3600) / 60)}
                                                                onChange={e => {
                                                                    const h = Math.floor((taskData.waypoints[selectedWpIdx].travelTime || 0) / 3600);
                                                                    const m = parseInt(e.target.value) || 0;
                                                                    const s = (taskData.waypoints[selectedWpIdx].travelTime || 0) % 60;
                                                                    updateWaypoint(selectedWpIdx, { travelTime: h * 3600 + m * 60 + s });
                                                                }}
                                                            />
                                                            <small style={{ fontSize: '10px', opacity: 0.6 }}>{t('min_full')}</small>
                                                        </div>
                                                        <div style={{ flex: 1 }}>
                                                            <input
                                                                type="number" className="input" min="0" max="59" placeholder={t('sec_label')}
                                                                ref={wheelRefs.wpS}
                                                                value={(taskData.waypoints[selectedWpIdx].travelTime || 0) % 60}
                                                                onChange={e => {
                                                                    const h = Math.floor((taskData.waypoints[selectedWpIdx].travelTime || 0) / 3600);
                                                                    const m = Math.floor(((taskData.waypoints[selectedWpIdx].travelTime || 0) % 3600) / 60);
                                                                    const s = parseInt(e.target.value) || 0;
                                                                    updateWaypoint(selectedWpIdx, { travelTime: h * 3600 + m * 60 + s });
                                                                }}
                                                            />
                                                            <small style={{ fontSize: '10px', opacity: 0.6 }}>{t('sec_full')}</small>
                                                        </div>
                                                    </div>
                                                    <small className="input-hint">{t('travel_time_hint')}</small>
                                                </>
                                            )}
                                        </div>

                                        <div className="form-group" style={{ marginTop: '16px' }}>
                                            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={!!taskData.waypoints[selectedWpIdx].scheduledAt}
                                                    onChange={e => {
                                                        const newWps = [...taskData.waypoints];
                                                        if (e.target.checked) {
                                                            const date = new Date();
                                                            date.setMinutes(date.getMinutes() + 1);
                                                            newWps[selectedWpIdx].scheduledAt = date.getTime();
                                                        } else {
                                                            newWps[selectedWpIdx].scheduledAt = null;
                                                        }
                                                        setTaskData({ ...taskData, waypoints: newWps });
                                                    }}
                                                />
                                                {t('schedule_at_point')}
                                            </label>
                                            {taskData.waypoints[selectedWpIdx].scheduledAt && (
                                                <input
                                                    type="time" className="input" style={{ marginTop: '8px' }}
                                                    ref={wheelRefs.wpSchedule}
                                                    value={new Date(taskData.waypoints[selectedWpIdx].scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                                                    onChange={e => {
                                                        const [h, m] = e.target.value.split(':').map(Number);
                                                        const date = new Date();
                                                        date.setHours(h, m, 0, 0);
                                                        if (date < new Date()) date.setDate(date.getDate() + 1);
                                                        const newWps = [...taskData.waypoints];
                                                        newWps[selectedWpIdx].scheduledAt = date.getTime();
                                                        setTaskData({ ...taskData, waypoints: newWps });
                                                    }}
                                                />
                                            )}
                                        </div>
                                        <button className="btn btn-danger btn-sm btn-full" style={{ marginTop: '20px' }} onClick={() => removeWaypoint(selectedWpIdx)}>{t('delete_point')}</button>
                                    </>
                                ) : (
                                    <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '100px' }}>
                                        <span style={{ fontSize: '24px', display: 'block', marginBottom: '10px' }}>📍</span>
                                        {t('select_point_hint')}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Step 3: Global Config */}
                    {step === 3 && (
                        <div className="step-content">
                            <div className="form-group">
                                <label>{t('global_schedule_title')}</label>
                                <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px' }}>
                                    <input
                                        type="checkbox"
                                        checked={taskData.scheduleEnabled}
                                        onChange={e => setTaskData({ ...taskData, scheduleEnabled: e.target.checked })}
                                    />
                                    {t('activate_schedule')}
                                </label>
                                {taskData.scheduleEnabled && (
                                    <input
                                        type="time" className="input"
                                        ref={wheelRefs.globalSchedule}
                                        value={taskData.scheduleTime}
                                        onChange={e => setTaskData({ ...taskData, scheduleTime: e.target.value })}
                                    />
                                )}
                            </div>

                            <div className="form-group" style={{ marginTop: '24px' }}>
                                <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                                    <input
                                        type="checkbox"
                                        checked={taskData.targetTimeEnabled}
                                        onChange={e => setTaskData({ ...taskData, targetTimeEnabled: e.target.checked })}
                                    />
                                    {t('activate_target_time')}
                                </label>

                                {taskData.targetTimeEnabled && (
                                    <>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <div style={{ flex: 1 }}>
                                                <input
                                                    type="number" className="input" min="0" placeholder={t('hour_label')}
                                                    ref={wheelRefs.globalH}
                                                    value={duration.h}
                                                    onChange={e => setDuration({ ...duration, h: parseInt(e.target.value) || 0 })}
                                                />
                                                <small style={{ fontSize: '10px', opacity: 0.6 }}>{t('hour_full')}</small>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <input
                                                    type="number" className="input" min="0" max="59" placeholder={t('min_label')}
                                                    ref={wheelRefs.globalM}
                                                    value={duration.m}
                                                    onChange={e => setDuration({ ...duration, m: parseInt(e.target.value) || 0 })}
                                                />
                                                <small style={{ fontSize: '10px', opacity: 0.6 }}>{t('min_full')}</small>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <input
                                                    type="number" className="input" min="0" max="59" placeholder={t('sec_label')}
                                                    ref={wheelRefs.globalS}
                                                    value={duration.s}
                                                    onChange={e => setDuration({ ...duration, s: parseInt(e.target.value) || 0 })}
                                                />
                                                <small style={{ fontSize: '10px', opacity: 0.6 }}>{t('sec_full')}</small>
                                            </div>
                                        </div>
                                        <small className="input-hint">{t('target_time_global_hint')}</small>
                                    </>
                                )}
                            </div>

                            <div className="summary-section" style={{ marginTop: '30px', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
                                <h4>{t('mission_summary')}</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div>
                                        <p><strong>{t('mission_name_label')}</strong> {taskData.name || '---'}</p>
                                        <p><strong>{t('point_count_label')}</strong> {taskData.waypoints.length}</p>
                                    </div>
                                    <div>
                                        <p><strong>{t('sequence_label')}</strong> {taskData.waypoints.map((_, i) => i + 1).join(' → ')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    {step > 1 && (
                        <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>← {t('back')}</button>
                    )}
                    <div className="footer-spacer" style={{ flex: 1 }}></div>
                    {step < 3 ? (
                        <button
                            className="btn btn-primary"
                            disabled={step === 2 && taskData.waypoints.length === 0}
                            onClick={() => setStep(step + 1)}
                        >
                            {t('continue')} →
                        </button>
                    ) : (
                        <button
                            className="btn btn-success"
                            onClick={handleCreate}
                        >
                            ✓ {initialData ? t('update') : t('create_task')}
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
};

export default CreateTaskModal;
