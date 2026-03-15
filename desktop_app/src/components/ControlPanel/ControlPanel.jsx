import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './ControlPanel.css';

const ControlPanel = () => {
    const {
        connected,
        sendVelocity,
        stopRobot,
        robotVelocity,
        isNavigating,
        cancelNavigation
    } = useRobotStore();

    const { settings } = useFleetStore();

    const [linearSpeed, setLinearSpeed] = useState(0.3);
    const [angularSpeed, setAngularSpeed] = useState(0.5);
    const [activeKeys, setActiveKeys] = useState(new Set());
    const intervalRef = useRef(null);

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    // Keyboard control
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!connected) return;

            const key = e.key.toLowerCase();
            if (['w', 'a', 's', 'd', 'q', 'e', ' '].includes(key)) {
                e.preventDefault();
                setActiveKeys(prev => new Set([...prev, key]));
            }
        };

        const handleKeyUp = (e) => {
            const key = e.key.toLowerCase();
            setActiveKeys(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [connected]);

    // Send velocity commands based on active keys
    useEffect(() => {
        if (!connected) {
            clearInterval(intervalRef.current);
            return;
        }

        const sendCommand = () => {
            let linear = 0;
            let angular = 0;

            if (activeKeys.has('w')) linear += linearSpeed;
            if (activeKeys.has('s')) linear -= linearSpeed;
            if (activeKeys.has('a')) angular += angularSpeed;
            if (activeKeys.has('d')) angular -= angularSpeed;
            if (activeKeys.has('q')) { linear += linearSpeed * 0.7; angular += angularSpeed * 0.7; }
            if (activeKeys.has('e')) { linear += linearSpeed * 0.7; angular -= angularSpeed * 0.7; }
            if (activeKeys.has(' ')) { linear = 0; angular = 0; stopRobot(); return; }

            if (linear !== 0 || angular !== 0) {
                sendVelocity(linear, angular);
            } else if (activeKeys.size === 0) {
                stopRobot();
            }
        };

        intervalRef.current = setInterval(sendCommand, 100);

        return () => clearInterval(intervalRef.current);
    }, [connected, activeKeys, linearSpeed, angularSpeed, sendVelocity, stopRobot]);

    const handleJoystickButton = useCallback((linear, angular, isPressed) => {
        if (!connected) return;

        if (isPressed) {
            sendVelocity(linear, angular);
        } else {
            stopRobot();
        }
    }, [connected, sendVelocity, stopRobot]);

    return (
        <div className="control-panel">
            <div className="panel-header">
                <h3 className="panel-title">{t('robot_control')}</h3>
                {isNavigating && (
                    <button className="btn btn-danger btn-sm" onClick={cancelNavigation}>
                        {t('cancel_nav')}
                    </button>
                )}
            </div>

            {/* Velocity Display */}
            <div className="velocity-display">
                <div className="velocity-item">
                    <span className="velocity-label">{t('linear')}</span>
                    <span className="velocity-value">{robotVelocity.linear.toFixed(2)} m/s</span>
                </div>
                <div className="velocity-item">
                    <span className="velocity-label">{t('angular')}</span>
                    <span className="velocity-value">{robotVelocity.angular.toFixed(2)} rad/s</span>
                </div>
            </div>

            {/* Joystick Controls */}
            <div className="joystick-section">
                <div className="joystick-grid">
                    {/* Forward-Left */}
                    <button
                        className="joystick-btn"
                        onMouseDown={() => handleJoystickButton(linearSpeed * 0.7, angularSpeed * 0.7, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(linearSpeed * 0.7, angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M4 16L10 4L12 10L16 8L4 16Z" />
                        </svg>
                    </button>

                    {/* Forward */}
                    <button
                        className="joystick-btn large"
                        onMouseDown={() => handleJoystickButton(linearSpeed, 0, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(linearSpeed, 0, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 4L20 20H4L12 4Z" />
                        </svg>
                    </button>

                    {/* Forward-Right */}
                    <button
                        className="joystick-btn"
                        onMouseDown={() => handleJoystickButton(linearSpeed * 0.7, -angularSpeed * 0.7, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(linearSpeed * 0.7, -angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style={{ transform: 'scaleX(-1)' }}>
                            <path d="M4 16L10 4L12 10L16 8L4 16Z" />
                        </svg>
                    </button>

                    {/* Left */}
                    <button
                        className="joystick-btn large"
                        onMouseDown={() => handleJoystickButton(0, angularSpeed, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(0, angularSpeed, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'rotate(-90deg)' }}>
                            <path d="M12 4L20 20H4L12 4Z" />
                        </svg>
                    </button>

                    {/* Stop */}
                    <button
                        className="joystick-btn stop"
                        onClick={stopRobot}
                        onTouchStart={(e) => { e.preventDefault(); stopRobot(); }}
                        onTouchEnd={(e) => { e.preventDefault(); stopRobot(); }}
                        disabled={!connected}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                    </button>

                    {/* Right */}
                    <button
                        className="joystick-btn large"
                        onMouseDown={() => handleJoystickButton(0, -angularSpeed, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(0, -angularSpeed, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'rotate(90deg)' }}>
                            <path d="M12 4L20 20H4L12 4Z" />
                        </svg>
                    </button>

                    {/* Backward-Left */}
                    <button
                        className="joystick-btn"
                        onMouseDown={() => handleJoystickButton(-linearSpeed * 0.7, -angularSpeed * 0.7, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(-linearSpeed * 0.7, -angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style={{ transform: 'scaleY(-1)' }}>
                            <path d="M4 16L10 4L12 10L16 8L4 16Z" />
                        </svg>
                    </button>

                    {/* Backward */}
                    <button
                        className="joystick-btn large"
                        onMouseDown={() => handleJoystickButton(-linearSpeed, 0, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(-linearSpeed, 0, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ transform: 'rotate(180deg)' }}>
                            <path d="M12 4L20 20H4L12 4Z" />
                        </svg>
                    </button>

                    {/* Backward-Right */}
                    <button
                        className="joystick-btn"
                        onMouseDown={() => handleJoystickButton(-linearSpeed * 0.7, angularSpeed * 0.7, true)}
                        onMouseUp={() => handleJoystickButton(0, 0, false)}
                        onMouseLeave={() => handleJoystickButton(0, 0, false)}
                        onTouchStart={(e) => { e.preventDefault(); handleJoystickButton(-linearSpeed * 0.7, angularSpeed * 0.7, true); }}
                        onTouchEnd={(e) => { e.preventDefault(); handleJoystickButton(0, 0, false); }}
                        disabled={!connected}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" style={{ transform: 'scale(-1, -1)' }}>
                            <path d="M4 16L10 4L12 10L16 8L4 16Z" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Speed Controls */}
            <div className="speed-controls">
                <div className="speed-control">
                    <label className="speed-label">
                        <span>{t('linear_speed')}</span>
                        <span className="speed-value">{linearSpeed.toFixed(2)} m/s</span>
                    </label>
                    <input
                        type="range"
                        className="speed-slider"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={linearSpeed}
                        onChange={(e) => setLinearSpeed(parseFloat(e.target.value))}
                    />
                </div>

                <div className="speed-control">
                    <label className="speed-label">
                        <span>{t('angular_speed')}</span>
                        <span className="speed-value">{angularSpeed.toFixed(2)} rad/s</span>
                    </label>
                    <input
                        type="range"
                        className="speed-slider"
                        min="0.1"
                        max="2.0"
                        step="0.1"
                        value={angularSpeed}
                        onChange={(e) => setAngularSpeed(parseFloat(e.target.value))}
                    />
                </div>
            </div>

            {/* Keyboard Hints */}
            <div className="keyboard-hints">
                <span className="hint-title">{t('keyboard')}:</span>
                <div className="hint-keys">
                    <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
                    <span className="hint-text">{t('move')}</span>
                    <kbd>Space</kbd>
                    <span className="hint-text">{t('stop')}</span>
                </div>
            </div>
        </div>
    );
};

export default ControlPanel;
