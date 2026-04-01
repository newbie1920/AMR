import React from 'react';
import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './StatusBar.css';

const StatusBar = () => {
    const { robots, selectedRobotId, clearTraveledPath } = useRobotStore();
    const robot = robots[selectedRobotId] || {
        connected: false,
        robotPose: { x: 0, y: 0, theta: 0 },
        telemetry: { heading: 0, distance: 0, acceleration: 0 },
        robotVelocity: { linear: 0, angular: 0 },
        latencyMs: 0,
        batteryLevel: 0,
        activeBehavior: 'N/A',
        status: { wifi_rssi: 0, heap_free: 0 }
    };

    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const {
        connected,
        telemetry,
        robotVelocity,
        latencyMs,
        activeBehavior,
        status,
        battery
    } = robot;

    // ... rest of the component

    return (
        <div className="status-bar">
            <div className="status-section">
                <div className="status-item">
                    <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
                    <span className="status-label">ESP32:</span>
                    <span className="status-value">{connected ? t('online') : t('offline')}</span>
                </div>

                <div className="status-divider"></div>

                <div className="status-item">
                    <span className="status-label">{t('heading')}:</span>
                    <span className="status-value mono">{telemetry.heading.toFixed(1)}°</span>
                </div>

                <div className="status-divider"></div>

                <div className="status-item">
                    <span className="status-label">{t('stats')}:</span>
                    <span className="status-value mono">
                        {t('dist')}: {telemetry.distance.toFixed(2)}m | {t('acc')}: {telemetry.acceleration.toFixed(2)}m/s²
                    </span>
                </div>

                <div className="status-divider"></div>

                <div className="status-item">
                    <span className="status-label">{t('current_vel')}:</span>
                    <span className="status-value mono">
                        L: {robotVelocity.linear.toFixed(2)} | A: {robotVelocity.angular.toFixed(2)}
                    </span>
                </div>

                <div className="status-divider"></div>

                <div className="status-item">
                    <span className="status-label">{t('ping')}:</span>
                    <span className={`status-value mono latency-${latencyMs < 50 ? 'good' : latencyMs < 150 ? 'warn' : 'bad'}`}>
                        {latencyMs}ms
                    </span>
                </div>

                <div className="status-divider"></div>

                <div className="status-item">
                    <span className="status-label">{t('behavior')}:</span>
                    <span className="status-value behavior-tag">
                        { (activeBehavior && typeof activeBehavior === 'object') 
                            ? (activeBehavior.name || 'Idle') 
                            : (activeBehavior ? (t(activeBehavior.toLowerCase()) || activeBehavior) : 'N/A')
                        }
                    </span>
                </div>

                <div className="status-divider"></div>

                <div className="status-item">
                    <span className="status-label">RSSI:</span>
                    <span className="status-value mono">{status.wifi_rssi} dBm</span>
                </div>
            </div>

            <div className="status-section">
                <button
                    className="status-btn"
                    onClick={clearTraveledPath}
                    title={t('clear_path_desc')}
                >
                    {t('clear_path')}
                </button>

                <div className="status-divider"></div>

                <div className="status-item battery">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1.172a2 2 0 01-1.414-.586l-.828-.828A2 2 0 0011.172 2H8.828a2 2 0 00-1.414.586l-.828.828A2 2 0 015.172 4H4z" />
                    </svg>
                    <span className={`battery-level ${battery < 20 ? 'low' : ''}`}>
                        {battery}%
                    </span>
                </div>
            </div>
        </div>
    );
};

export default StatusBar;
