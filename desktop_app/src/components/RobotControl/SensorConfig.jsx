import React from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './SensorConfig.css';

const ODOMETRY_SOURCES = (t) => [
    { value: 'encoder', label: t('encoder_only'), icon: '⚙️', description: t('encoder_desc') },
    { value: 'imu', label: t('imu_only'), icon: '🧭', description: t('imu_desc') },
    { value: 'fusion', label: t('sensor_fusion'), icon: '🔗', description: t('fusion_desc') },
    { value: 'all', label: t('all_sensors'), icon: '📡', description: t('all_desc') },
];

const SensorConfig = () => {
    const {
        robots,
        selectedRobotId,
        toggleSensor,
        setOdometrySource,
        settings,
    } = useFleetStore();

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const selectedRobot = robots.find(r => r.id === selectedRobotId);

    if (!selectedRobot) return null;

    const sensors = selectedRobot.sensors || { encoder: true, imu: false, lidar: false };
    const odometrySource = selectedRobot.odometrySource || 'encoder';

    const handleSensorToggle = (sensorType) => {
        toggleSensor(selectedRobotId, sensorType, !sensors[sensorType]);
    };

    const handleOdometryChange = (source) => {
        setOdometrySource(selectedRobotId, source);
    };

    const odomSources = ODOMETRY_SOURCES(t);

    return (
        <div className="sensor-config">
            <h4 className="config-title">
                <span className="title-icon">📊</span>
                {t('sensor_odom_config')}
            </h4>

            {/* Sensor Toggles */}
            <div className="sensor-toggles">
                <div className="sensor-toggle-row">
                    <button
                        className={`sensor-btn ${sensors.encoder ? 'active' : ''}`}
                        onClick={() => handleSensorToggle('encoder')}
                    >
                        <span className="sensor-icon">⚙️</span>
                        <span className="sensor-name">Encoder</span>
                        <span className={`sensor-status ${sensors.encoder ? 'on' : 'off'}`}>
                            {sensors.encoder ? 'ON' : 'OFF'}
                        </span>
                    </button>

                    <button
                        className={`sensor-btn ${sensors.imu ? 'active' : ''}`}
                        onClick={() => handleSensorToggle('imu')}
                    >
                        <span className="sensor-icon">🧭</span>
                        <span className="sensor-name">IMU</span>
                        <span className={`sensor-status ${sensors.imu ? 'on' : 'off'}`}>
                            {sensors.imu ? 'ON' : 'OFF'}
                        </span>
                    </button>

                    <button
                        className={`sensor-btn ${sensors.lidar ? 'active' : ''}`}
                        onClick={() => handleSensorToggle('lidar')}
                    >
                        <span className="sensor-icon">📡</span>
                        <span className="sensor-name">LiDAR</span>
                        <span className={`sensor-status ${sensors.lidar ? 'on' : 'off'}`}>
                            {sensors.lidar ? 'ON' : 'OFF'}
                        </span>
                    </button>
                </div>

                {/* Sensor Data Display */}
                <div className="sensor-data-preview">
                    {sensors.encoder && (
                        <div className="data-item">
                            <span className="data-label">Encoder:</span>
                            <span className="data-value">
                                L: {selectedRobot.telemetry?.ticks?.left || 0} |
                                R: {selectedRobot.telemetry?.ticks?.right || 0}
                            </span>
                        </div>
                    )}
                    {sensors.imu && selectedRobot.telemetry?.imu && (
                        <div className="data-item">
                            <span className="data-label">IMU:</span>
                            <span className="data-value">
                                {selectedRobot.telemetry.imu.stationary ? `🟢 ${t('stationary')}` : `🔵 ${t('moving')}`}
                            </span>
                        </div>
                    )}
                    {sensors.lidar && (
                        <div className="data-item">
                            <span className="data-label">LiDAR:</span>
                            <span className="data-value">{selectedRobot.lidarData?.length || 0} points</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Odometry Source Selection */}
            <div className="odometry-source-section">
                <label className="section-label">{t('odometry_source')}:</label>
                <div className="odometry-options">
                    {odomSources.map(source => (
                        <button
                            key={source.value}
                            className={`odometry-option ${odometrySource === source.value ? 'selected' : ''}`}
                            onClick={() => handleOdometryChange(source.value)}
                            title={source.description}
                        >
                            <span className="option-icon">{source.icon}</span>
                            <span className="option-label">{source.label}</span>
                            {odometrySource === source.value && (
                                <span className="check-mark">✓</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="source-description">
                    {odomSources.find(s => s.value === odometrySource)?.description}
                </div>
            </div>

            {/* Connection Status Warning */}
            {!selectedRobot.connected && (
                <div className="warning-box">
                    ⚠️ {t('warning_not_connected')}
                </div>
            )}
        </div>
    );
};

export default SensorConfig;
