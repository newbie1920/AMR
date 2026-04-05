import React, { useState, useCallback } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import SensorConfig from './SensorConfig';
import PIDTuner from './PIDTuner';
import translations from '../../translations';
import './RobotControl.css';

const RobotControl = () => {
    const {
        robots,
        selectedRobotId,
        sendVelocity,
        stopRobot,
        updateRobot,
        toggleSensor,
        toggleLed,
        settings,
        updateSettings,
        clearMap,
    } = useFleetStore();

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const selectedRobot = robots.find(r => r.id === selectedRobotId);

    // Speed setpoints from store
    const linearSpeed = selectedRobot?.linearSpeed || 0.3;
    const angularSpeed = selectedRobot?.angularSpeed || 2.0;

    const setLinearSpeed = (val) => updateRobot(selectedRobotId, { linearSpeed: val });
    const setAngularSpeed = (val) => updateRobot(selectedRobotId, { angularSpeed: val });


    const [ticksPerRev, setTicksPerRev] = useState(selectedRobot?.config?.ticksPerRev || 333);
    const [wheelWidth, setWheelWidth] = useState(selectedRobot?.config?.wheelWidth || 0.170);
    const [wheelDiameter, setWheelDiameter] = useState((selectedRobot?.config?.wheelRadius || 0.033) * 2000);
    const [invertLeftEncoder, setInvertLeftEncoder] = useState(selectedRobot?.config?.invertLeftEncoder || false);
    const [invertRightEncoder, setInvertRightEncoder] = useState(selectedRobot?.config?.invertRightEncoder || false);

    const [invertLeftMotor, setInvertLeftMotor] = useState(selectedRobot?.config?.invertLeftMotor || false);
    const [invertRightMotor, setInvertRightMotor] = useState(selectedRobot?.config?.invertRightMotor || false);

    const [maxLinear, setMaxLinear] = useState(selectedRobot?.maxLinearSpeed || 0.5);
    const [maxAngular, setMaxAngular] = useState(selectedRobot?.maxAngularSpeed || 1.0);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [profileName, setProfileName] = useState('');

    // DWA Planner params
    const [dwaMaxLinVel, setDwaMaxLinVel] = useState(selectedRobot?.config?.dwa_maxLinearVel || 0.2);
    const [dwaMaxAngVel, setDwaMaxAngVel] = useState(selectedRobot?.config?.dwa_maxAngularVel || 1.0);
    const [dwaMaxLinAcc, setDwaMaxLinAcc] = useState(selectedRobot?.config?.dwa_maxLinearAcc || 0.5);
    const [dwaMaxAngAcc, setDwaMaxAngAcc] = useState(selectedRobot?.config?.dwa_maxAngularAcc || 2.0);
    const [dwaGoalTol, setDwaGoalTol] = useState(selectedRobot?.config?.dwa_goalTolerance || 0.15);
    const [dwaSimTime, setDwaSimTime] = useState(selectedRobot?.config?.dwa_simTime || 1.5);
    const [dwaSaveSuccess, setDwaSaveSuccess] = useState(false);

    const {
        updateRobotConfig,
        resetRobotOdometry,
        resetRobotEncoders,
        saveRobotConfigProfile,
        deleteRobotConfigProfile,
        applyRobotConfigProfile
    } = useFleetStore();

    // Update local state when robot selection changes
    React.useEffect(() => {
        if (selectedRobot?.config) {
            setTicksPerRev(selectedRobot.config.ticksPerRev);
            setWheelWidth(selectedRobot.config.wheelWidth);
            setWheelDiameter(selectedRobot.config.wheelRadius * 2000);
            setInvertLeftEncoder(selectedRobot.config.invertLeftEncoder);
            setInvertRightEncoder(selectedRobot.config.invertRightEncoder);
            setInvertLeftMotor(selectedRobot.config.invertLeftMotor);
            setInvertRightMotor(selectedRobot.config.invertRightMotor);
            setMaxLinear(selectedRobot.maxLinearSpeed);
            setMaxAngular(selectedRobot.maxAngularSpeed);
            // DWA
            setDwaMaxLinVel(selectedRobot.config.dwa_maxLinearVel ?? 0.2);
            setDwaMaxAngVel(selectedRobot.config.dwa_maxAngularVel ?? 1.0);
            setDwaMaxLinAcc(selectedRobot.config.dwa_maxLinearAcc ?? 0.5);
            setDwaMaxAngAcc(selectedRobot.config.dwa_maxAngularAcc ?? 2.0);
            setDwaGoalTol(selectedRobot.config.dwa_goalTolerance ?? 0.15);
            setDwaSimTime(selectedRobot.config.dwa_simTime ?? 1.5);
        }
    }, [selectedRobot?.id, selectedRobot?.config, selectedRobot?.maxLinearSpeed, selectedRobot?.maxAngularSpeed]);

    const handleConfigUpdate = () => {
        if (!selectedRobotId) return;
        updateRobotConfig(selectedRobotId, {
            ticksPerRev,
            wheelWidth,
            wheelRadius: wheelDiameter / 2000,
            invertLeftEncoder,
            invertRightEncoder,
            invertLeftMotor,
            invertRightMotor,
            maxLinearSpeed: maxLinear,
            maxAngularSpeed: maxAngular,
            linearSpeed,
            angularSpeed
        });

        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
    };

    const handleSaveProfile = () => {
        if (!selectedRobotId) return;
        saveRobotConfigProfile(selectedRobotId, profileName);
        setProfileName('');
    };

    const handleControl = useCallback((linear, angular, isPressed) => {
        if (!selectedRobot?.connected) return;

        if (isPressed) {
            sendVelocity(selectedRobotId, linear, angular);
        } else {
            stopRobot(selectedRobotId);
        }
    }, [selectedRobot, selectedRobotId, sendVelocity, stopRobot]);

    const updateRobotSpeed = (type, value) => {
        if (!selectedRobotId) return;
        if (type === 'linear') setMaxLinear(value);
        else setMaxAngular(value);
    };

    if (!selectedRobot) {
        return (
            <div className="robot-control empty">
                <div className="empty-state">
                    <span className="empty-icon">🎮</span>
                    <p>{t('select_robot_to_manage')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="robot-control">
            <div className="control-header">
                <h3 className="panel-title">
                    {t('control')}: {selectedRobot.name}
                </h3>
                <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        className="btn btn-icon btn-ghost btn-sm"
                        onClick={() => resetRobotOdometry(selectedRobotId)}
                        title={t('robot_odom_reset')}
                    >
                        🔄
                    </button>
                    <button
                        className={`btn btn-icon btn-ghost btn-sm ${selectedRobot.ledEnabled ? 'active' : ''}`}
                        onClick={() => toggleLed(selectedRobotId)}
                        title={t('toggle_led')}
                        style={{ color: selectedRobot.ledEnabled ? '#ffdd00' : 'inherit', fontSize: '1.2rem' }}
                    >
                        {selectedRobot.ledEnabled ? '💡' : '🌑'}
                    </button>
                    <div className={`connection-status-badge ${selectedRobot.connected ? 'online' : 'offline'}`}>
                        <span className="pulse-dot"></span>
                        {selectedRobot.connected ? t('connected') : t('offline')}
                    </div>
                </div>
            </div>

            {/* Velocity Display */}
            <div className="velocity-display">
                <div className="velocity-item">
                    <span className="label">{t('linear_speed')}</span>
                    <span className="value">{selectedRobot.velocity?.linear?.toFixed(2) || '0.00'} m/s</span>
                </div>
                <div className="velocity-item">
                    <span className="label">{t('angular_speed')}</span>
                    <span className="value">{selectedRobot.velocity?.angular?.toFixed(2) || '0.00'} rad/s</span>
                </div>
                <div className="velocity-item">
                    <span className="label">{t('heading')}</span>
                    <span className="value">{selectedRobot.telemetry?.heading?.toFixed(1) || '0'}°</span>
                </div>
            </div>

            {/* Encoder Debug */}
            <div className="velocity-display" style={{ marginTop: '8px', gridTemplateColumns: '1fr 1fr' }}>
                <div className="velocity-item">
                    <span className="label">{t('ticks_left')}</span>
                    <span className="value">{selectedRobot.telemetry?.ticks?.left || 0}</span>
                </div>
                <div className="velocity-item">
                    <span className="label">{t('ticks_right')}</span>
                    <span className="value">{selectedRobot.telemetry?.ticks?.right || 0}</span>
                </div>
            </div>

            {/* Sensor Status & Toggles */}
            <SensorConfig />

            {/* PID Auto Tuning Section */}
            <PIDTuner />

            {/* ─── DWA Planner Section ──────────────────────────── */}
            <div className="robot-settings">
                <h4>{t('dwa_planner_title')}</h4>
                <small style={{ color: '#888', display: 'block', marginBottom: '12px' }}>
                    {t('dwa_planner_desc')}
                </small>

                <div className="settings-row">
                    <label>{t('max_lin_vel')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input type="range" className="speed-slider" min="0.05" max="0.25" step="0.01" value={dwaMaxLinVel}
                                onChange={(e) => setDwaMaxLinVel(parseFloat(e.target.value))} />
                            <input type="number" className="input small" step="0.01" value={dwaMaxLinVel}
                                onChange={(e) => setDwaMaxLinVel(parseFloat(e.target.value))} />
                            <span className="param-unit">m/s</span>
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('max_ang_vel')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input type="range" className="speed-slider" min="0.1" max="3.0" step="0.1" value={dwaMaxAngVel}
                                onChange={(e) => setDwaMaxAngVel(parseFloat(e.target.value))} />
                            <input type="number" className="input small" step="0.1" value={dwaMaxAngVel}
                                onChange={(e) => setDwaMaxAngVel(parseFloat(e.target.value))} />
                            <span className="param-unit">rad/s</span>
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('max_lin_acc')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input type="range" className="speed-slider" min="0.1" max="2.0" step="0.1" value={dwaMaxLinAcc}
                                onChange={(e) => setDwaMaxLinAcc(parseFloat(e.target.value))} />
                            <input type="number" className="input small" step="0.1" value={dwaMaxLinAcc}
                                onChange={(e) => setDwaMaxLinAcc(parseFloat(e.target.value))} />
                            <span className="param-unit">m/s²</span>
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('max_ang_acc')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input type="range" className="speed-slider" min="0.5" max="5.0" step="0.1" value={dwaMaxAngAcc}
                                onChange={(e) => setDwaMaxAngAcc(parseFloat(e.target.value))} />
                            <input type="number" className="input small" step="0.1" value={dwaMaxAngAcc}
                                onChange={(e) => setDwaMaxAngAcc(parseFloat(e.target.value))} />
                            <span className="param-unit">rad/s²</span>
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('goal_tolerance')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input type="range" className="speed-slider" min="0.05" max="0.5" step="0.01" value={dwaGoalTol}
                                onChange={(e) => setDwaGoalTol(parseFloat(e.target.value))} />
                            <input type="number" className="input small" step="0.01" value={dwaGoalTol}
                                onChange={(e) => setDwaGoalTol(parseFloat(e.target.value))} />
                            <span className="param-unit">m</span>
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('sim_time')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input type="range" className="speed-slider" min="0.5" max="3.0" step="0.1" value={dwaSimTime}
                                onChange={(e) => setDwaSimTime(parseFloat(e.target.value))} />
                            <input type="number" className="input small" step="0.1" value={dwaSimTime}
                                onChange={(e) => setDwaSimTime(parseFloat(e.target.value))} />
                            <span className="param-unit">s</span>
                        </div>
                    </div>
                </div>

                <button
                    className={`primary-btn ${dwaSaveSuccess ? 'success' : ''}`}
                    style={{ marginTop: '12px', width: '100%' }}
                    onClick={() => {
                        updateRobotConfig(selectedRobotId, {
                            dwa_maxLinearVel: dwaMaxLinVel,
                            dwa_maxAngularVel: dwaMaxAngVel,
                            dwa_maxLinearAcc: dwaMaxLinAcc,
                            dwa_maxAngularAcc: dwaMaxAngAcc,
                            dwa_goalTolerance: dwaGoalTol,
                            dwa_simTime: dwaSimTime,
                        });
                        setDwaSaveSuccess(true);
                        setTimeout(() => setDwaSaveSuccess(false), 2000);
                    }}
                >
                    {dwaSaveSuccess ? t('applied') : t('apply_dwa_config')}
                </button>
            </div>

            {/* Mapping Controls */}
            <div className="robot-settings" style={{ borderTop: 'none', marginTop: '0', paddingTop: '0' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                        className={`btn btn-sm ${settings.isMapping ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ border: settings.isMapping ? 'none' : '1px solid #44ffaa', color: settings.isMapping ? '#fff' : '#44ffaa' }}
                        onClick={() => updateSettings({ isMapping: !settings.isMapping })}
                    >
                        {settings.isMapping ? `🗺️ ${t('mapping_on')}` : `🗺️ ${t('start_mapping')}`}
                    </button>
                    {/* Auto Explore toggled with isMapping usually, but here is a dedicated button */}
                    <button
                        className={`btn btn-sm ${window.exploreActive ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ border: window.exploreActive ? 'none' : '1px solid #3b82f6', color: window.exploreActive ? '#fff' : '#3b82f6' }}
                        onClick={() => {
                            if (window.exploreActive) {
                                clearInterval(window.exploreInterval);
                                window.exploreActive = false;
                                stopRobot(selectedRobotId);
                            } else {
                                window.exploreActive = true;
                                if (!settings.isMapping) updateSettings({ isMapping: true });
                                
                                // Auto-drive logic
                                window.exploreInterval = setInterval(async () => {
                                    const storeModule = await import('../../stores/robotStore');
                                    const rStore = storeModule.useRobotStore.getState();
                                    const bm = rStore.getBehaviorManager(selectedRobotId);
                                    const robotState = rStore.robots[selectedRobotId];
                                    
                                    if (bm && robotState && !robotState.isNavigating) {
                                        const rPose = robotState.pose || {x:7.5, y:7.5, theta:0};
                                        const randomGoal = {
                                            x: rPose.x + (Math.random() - 0.5) * 4,
                                            y: rPose.y + (Math.random() - 0.5) * 4,
                                            theta: 0
                                        };
                                        bm.navigateTo(randomGoal);
                                    }
                                }, 3000);
                            }
                            // Force re-render Hack
                            setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 100);
                        }}
                    >
                        {window.exploreActive ? `🚀 Đang Tự Chạy` : `🚀 Tự Chạy Dò Map`}
                    </button>
                    {settings.isMapping && (
                        <button
                            className="btn btn-sm btn-ghost"
                            style={{ color: '#ef4444' }}
                            onClick={() => clearMap(selectedRobotId)}
                        >
                            🗑️ {t('clear_map')}
                        </button>
                    )}
                    <div style={{ fontSize: '10px', opacity: 0.7 }}>
                        Points: {selectedRobot.accumulatedMap?.length || 0}
                    </div>
                </div>
            </div>

            {/* IMU Data Display */}
            {selectedRobot.sensors?.imu && selectedRobot.telemetry?.imu && (
                <div className="velocity-display" style={{ marginTop: '8px', gridTemplateColumns: '1fr 1fr 1fr', fontSize: '10px', background: 'rgba(0,0,0,0.1)' }}>
                    <div className="velocity-item">
                        <span className="label">Acc X</span>
                        <span className="value">{selectedRobot.telemetry.imu.ax?.toFixed(2)}</span>
                    </div>
                    <div className="velocity-item">
                        <span className="label">Acc Y</span>
                        <span className="value">{selectedRobot.telemetry.imu.ay?.toFixed(2)}</span>
                    </div>
                    <div className="velocity-item">
                        <span className="label">Acc Z</span>
                        <span className="value">{selectedRobot.telemetry.imu.az?.toFixed(2)}</span>
                    </div>
                </div>
            )}

            {/* Joystick Controls */}
            <div className="joystick-section">
                <div className="joystick-grid">
                    {/* Forward-Left */}
                    <button
                        className="joystick-btn corner"
                        onMouseDown={() => handleControl(linearSpeed * 0.7, angularSpeed * 0.7, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(linearSpeed * 0.7, angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ↖
                    </button>

                    {/* Forward */}
                    <button
                        className="joystick-btn primary"
                        onMouseDown={() => handleControl(linearSpeed, 0, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(linearSpeed, 0, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ▲
                    </button>

                    {/* Forward-Right */}
                    <button
                        className="joystick-btn corner"
                        onMouseDown={() => handleControl(linearSpeed * 0.7, -angularSpeed * 0.7, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(linearSpeed * 0.7, -angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ↗
                    </button>

                    {/* Left */}
                    <button
                        className="joystick-btn primary"
                        onMouseDown={() => handleControl(0, angularSpeed, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(0, angularSpeed, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ◀
                    </button>

                    {/* Stop */}
                    <button
                        className="joystick-btn stop"
                        onClick={() => stopRobot(selectedRobotId)}
                        disabled={!selectedRobot.connected}
                    >
                        ⏹
                    </button>

                    {/* Right */}
                    <button
                        className="joystick-btn primary"
                        onMouseDown={() => handleControl(0, -angularSpeed, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(0, -angularSpeed, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ▶
                    </button>

                    {/* Backward-Left */}
                    <button
                        className="joystick-btn corner"
                        onMouseDown={() => handleControl(-linearSpeed * 0.7, -angularSpeed * 0.7, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(-linearSpeed * 0.7, -angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ↙
                    </button>

                    {/* Backward */}
                    <button
                        className="joystick-btn primary"
                        onMouseDown={() => handleControl(-linearSpeed, 0, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(-linearSpeed, 0, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ▼
                    </button>

                    {/* Backward-Right */}
                    <button
                        className="joystick-btn corner"
                        onMouseDown={() => handleControl(-linearSpeed * 0.7, angularSpeed * 0.7, true)}
                        onMouseUp={() => handleControl(0, 0, false)}
                        onMouseLeave={() => handleControl(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleControl(-linearSpeed * 0.7, angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleControl(0, 0, false); }}
                        disabled={!selectedRobot.connected}
                    >
                        ↘
                    </button>
                </div>
            </div>

            {/* Speed Controls */}
            <div className="speed-controls">
                <div className="speed-control">
                    <div className="speed-label">
                        <span>{t('linear_speed')}</span>
                        <span className="speed-value">{linearSpeed.toFixed(2)} m/s</span>
                    </div>
                    <input
                        type="range"
                        className="speed-slider"
                        min="0.1"
                        max={selectedRobot.maxLinearSpeed || 1.0}
                        step="0.05"
                        value={linearSpeed}
                        onChange={(e) => setLinearSpeed(parseFloat(e.target.value))}
                    />
                </div>

                <div className="speed-control">
                    <div className="speed-label">
                        <span>{t('angular_speed')}</span>
                        <span className="speed-value">{angularSpeed.toFixed(2)} rad/s</span>
                    </div>
                    <input
                        type="range"
                        className="speed-slider"
                        min="0"
                        max={selectedRobot.maxAngularSpeed || 10.0}
                        step="0.1"
                        value={angularSpeed}
                        onChange={(e) => setAngularSpeed(parseFloat(e.target.value))}
                    />
                </div>
            </div>

            {/* Robot Settings */}
            <div className="robot-settings">
                <h4>{t('robot_limits')}</h4>
                <div className="settings-row">
                    <label>{t('max_linear')}:</label>
                    <input
                        type="number"
                        className="input small"
                        step="0.01"
                        min="0.05"
                        max="0.25"
                        value={maxLinear}
                        onChange={(e) => updateRobotSpeed('linear', parseFloat(e.target.value))}
                    />
                    <span>m/s</span>
                </div>
                <div className="settings-row">
                    <label>{t('max_angular')}:</label>
                    <input
                        type="number"
                        className="input small"
                        step="0.1"
                        min="0"
                        max="3.0"
                        value={maxAngular}
                        onChange={(e) => updateRobotSpeed('angular', parseFloat(e.target.value))}
                    />
                    <span>rad/s</span>
                </div>
            </div>

            {/* Encoder Inversion */}
            <div className="robot-settings">
                <h4>{t('encoder_inversion')}</h4>
                <div className="settings-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={invertLeftEncoder}
                            onChange={(e) => setInvertLeftEncoder(e.target.checked)}
                        />
                        {t('ticks_left')}
                    </label>
                </div>
                <div className="settings-row">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={invertRightEncoder}
                            onChange={(e) => setInvertRightEncoder(e.target.checked)}
                        />
                        {t('ticks_right')}
                    </label>
                </div>

                {/* Motor Inversion */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #333' }}>
                    <small style={{ color: '#aaa', display: 'block', marginBottom: '8px' }}>{t('motor_inversion')}</small>
                    <div className="settings-row">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={invertLeftMotor}
                                onChange={(e) => {
                                    setInvertLeftMotor(e.target.checked);
                                    updateRobotConfig(selectedRobotId, { invertLeftMotor: e.target.checked });
                                }}
                            />
                            {t('linear')} (L)
                        </label>
                    </div>
                    <div className="settings-row">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={invertRightMotor}
                                onChange={(e) => {
                                    setInvertRightMotor(e.target.checked);
                                    updateRobotConfig(selectedRobotId, { invertRightMotor: e.target.checked });
                                }}
                            />
                            {t('linear')} (R)
                        </label>
                    </div>
                </div>

                {/* Reset Odometry */}
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #333' }}>
                    <button
                        className="btn btn-warning"
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                        onClick={() => resetRobotOdometry(selectedRobotId)}
                        disabled={!selectedRobot?.connected}
                    >
                        <i className="fi fi-br-refresh"></i>
                        {t('reset_odom')}
                    </button>
                    <small style={{ color: '#aaa', display: 'block', marginTop: '8px', textAlign: 'center' }}>
                        {t('reset_odom_desc')}
                    </small>
                </div>
            </div>

            {/* Calibration Settings */}
            <div className="robot-settings">
                <h4>{t('odom_calibration')}</h4>

                {/* Live Encoder Data (Added for Debugging) */}
                <div style={{ padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span>Left Ticks: <strong>{selectedRobot?.telemetry?.ticks?.left || 0}</strong></span>
                        <span>Right Ticks: <strong>{selectedRobot?.telemetry?.ticks?.right || 0}</strong></span>
                    </div>
                    <button
                        className="btn btn-secondary btn-sm"
                        style={{ width: '100%', marginTop: '4px' }}
                        onClick={() => resetRobotEncoders(selectedRobotId)}
                        disabled={!selectedRobot?.connected}
                    >
                        <i className="fi fi-br-rotate-right"></i> {t('reset_encoders')}
                    </button>
                </div>

                <div className="settings-row">
                    <label>{t('ticks_per_rev')}:</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input
                                type="range"
                                min="100"
                                max="2000"
                                step="1"
                                value={ticksPerRev}
                                onChange={(e) => setTicksPerRev(parseInt(e.target.value))}
                                className="speed-slider"
                            />
                            <input
                                type="number"
                                className="input small"
                                value={ticksPerRev}
                                onChange={(e) => setTicksPerRev(parseInt(e.target.value))}
                            />
                        </div>
                        <small className="hint-text">{t('ticks_per_rev_hint')}</small>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('wheel_width')} (Width):</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input
                                type="range"
                                min="0.1"
                                max="0.5"
                                step="0.001"
                                value={wheelWidth}
                                onChange={(e) => setWheelWidth(parseFloat(e.target.value))}
                                className="speed-slider"
                            />
                            <input
                                type="number"
                                className="input small"
                                step="0.001"
                                value={wheelWidth}
                                onChange={(e) => setWheelWidth(parseFloat(e.target.value))}
                            />
                        </div>
                        <small className="hint-text">{t('wheel_width_hint')}</small>
                    </div>
                </div>

                <div className="settings-row">
                    <label>{t('wheel_diameter')} (Diameter):</label>
                    <div className="control-group">
                        <div className="input-group">
                            <input
                                type="number"
                                className="input"
                                value={wheelDiameter.toFixed(1)}
                                onChange={(e) => setWheelDiameter(parseFloat(e.target.value) || 0)}
                            />
                            <span style={{ marginLeft: '8px', color: '#666' }}>mm</span>
                        </div>
                        <small className="hint-text">{t('wheel_diameter_hint')}</small>
                    </div>
                </div>
            </div>

            <div className="control-actions">
                <button className={`primary-btn ${saveSuccess ? 'success' : ''}`} onClick={handleConfigUpdate}>
                    {saveSuccess ? `${t('saved')}` : t('update_config')}
                </button>
                <button className="danger-btn" onClick={() => resetRobotOdometry(selectedRobotId)}>
                    {t('reset_map_odom')}
                </button>
            </div>

            {/* Config Profiles / History */}
            <div className="robot-settings">
                <h4>{t('config_profiles')}</h4>
                <div className="profile-save-box" style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
                    <input
                        type="text"
                        className="input"
                        placeholder={t('placeholder_profile')}
                        style={{ flex: 1 }}
                        value={profileName}
                        onChange={e => setProfileName(e.target.value)}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={handleSaveProfile}
                    >
                        {t('save_profile')}
                    </button>
                </div>

                <div className="profile-list" style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(!selectedRobot.configProfiles || selectedRobot.configProfiles.length === 0) ? (
                        <div style={{ textAlign: 'center', opacity: 0.5, padding: '20px', fontSize: '12px' }}>
                            {t('no_profiles')}
                        </div>
                    ) : (
                        selectedRobot.configProfiles.map(profile => (
                            <div key={profile.id} className="profile-card" style={{
                                background: 'rgba(255,255,255,0.05)',
                                padding: '10px',
                                borderRadius: '8px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                border: '1px solid rgba(255,255,255,0.1)'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <strong style={{ fontSize: '14px' }}>{profile.name}</strong>
                                    <small style={{ opacity: 0.6, fontSize: '10px' }}>
                                        {new Date(profile.timestamp).toLocaleString()}
                                    </small>
                                </div>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <button
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => applyRobotConfigProfile(selectedRobotId, profile.id)}
                                        title={t('apply')}
                                    >
                                        🔄 {t('apply')}
                                    </button>
                                    <button
                                        className="btn btn-sm btn-ghost"
                                        style={{ color: '#ef4444' }}
                                        onClick={() => deleteRobotConfigProfile(selectedRobotId, profile.id)}
                                        title={t('cancel')}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Keyboard hints */}
            <div className="keyboard-hints">
                <span className="hint-title">{t('keyboard')}:</span>
                <div className="hint-keys">
                    <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
                    <span>{t('move')}</span>
                    <kbd>Space</kbd>
                    <span>{t('stop')}</span>
                </div>
            </div>
        </div>
    );
};

export default RobotControl;
