import React, { useState, useEffect } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import robotBridge from '../../lib/robotBridge';
import translations from '../../translations';
import './PIDTuner.css';

const PIDTuner = () => {
    const { robots, selectedRobotId, settings, updateRobotConfig } = useFleetStore();
    const selectedRobot = robots.find(r => r.id === selectedRobotId);

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [dataLeft, setDataLeft] = useState([]);
    const [dataRight, setDataRight] = useState([]);

    // PID defaults
    const [kp, setKp] = useState(selectedRobot?.config?.kp || 3.0);
    const [ki, setKi] = useState(selectedRobot?.config?.ki || 3.0);

    // Motor tuning params
    const [ffGain, setFfGain] = useState(selectedRobot?.config?.ff_gain || 20.0);
    const [minPwm, setMinPwm] = useState(selectedRobot?.config?.min_pwm || 50);
    const [cmdTimeout, setCmdTimeout] = useState(selectedRobot?.config?.cmd_timeout || 500);

    // Virtual Axle params
    const [kpStraight, setKpStraight] = useState(selectedRobot?.config?.kp_straight || 1.5);
    const [kiStraight, setKiStraight] = useState(selectedRobot?.config?.ki_straight || 0.05);

    // Live PWM values

    // Live PWM values
    const [pwmL, setPwmL] = useState(0);
    const [pwmR, setPwmR] = useState(0);

    const [isPaused, setIsPaused] = useState(false);

    const MAX_POINTS = 100;

    // Sync motor params from robot config when selection changes
    useEffect(() => {
        if (selectedRobot?.config) {
            setFfGain(selectedRobot.config.ff_gain ?? 2.5);
            setMinPwm(selectedRobot.config.min_pwm ?? 55);
            setCmdTimeout(selectedRobot.config.cmd_timeout ?? 500);
            setKpStraight(selectedRobot.config.kp_straight ?? 1.5);
            setKiStraight(selectedRobot.config.ki_straight ?? 0.05);
            setKp(selectedRobot.config.kp ?? 3.0);
            setKi(selectedRobot.config.ki ?? 3.0);
        }
    }, [selectedRobot?.id, selectedRobot?.config]);

    useEffect(() => {
        if (!selectedRobotId || isPaused) return;

        const handleTelem = (msg) => {
            const now = new Date();
            const timeStr = `${now.getSeconds()}.${Math.floor(now.getMilliseconds() / 100)}`;

            // PWM monitor
            if (msg.pwmL !== undefined) setPwmL(msg.pwmL);
            if (msg.pwmR !== undefined) setPwmR(msg.pwmR);

            if (msg.vL_t !== undefined && msg.vL_r !== undefined) {
                setDataLeft(prev => {
                    const newPoint = {
                        time: timeStr,
                        Target: Number(msg.vL_t).toFixed(2),
                        Real: Number(msg.vL_r).toFixed(2)
                    };
                    const newData = [...prev, newPoint];
                    if (newData.length > MAX_POINTS) newData.shift();
                    return newData;
                });
            }

            if (msg.vR_t !== undefined && msg.vR_r !== undefined) {
                setDataRight(prev => {
                    const newPoint = {
                        time: timeStr,
                        Target: Number(msg.vR_t).toFixed(2),
                        Real: Number(msg.vR_r).toFixed(2)
                    };
                    const newData = [...prev, newPoint];
                    if (newData.length > MAX_POINTS) newData.shift();
                    return newData;
                });
            }
        };

        const unsubscribe = robotBridge.subscribe(selectedRobotId, 'telem', handleTelem);
        return () => unsubscribe();
    }, [selectedRobotId, isPaused]);

    const pushPID = (p, i) => {
        if (!selectedRobotId) return;
        robotBridge.sendConfig(selectedRobotId, {
            kp: parseFloat(p),
            ki: parseFloat(i),
            kd: 0.0 // Removed from UI
        });
    };

    const handleApplyPID = () => pushPID(kp, ki);

    const handleApplyMotor = () => {
        if (!selectedRobotId) return;
        updateRobotConfig(selectedRobotId, {
            ff_gain: parseFloat(ffGain),
            min_pwm: parseInt(minPwm),
            cmd_timeout: parseInt(cmdTimeout),
        });
    };

    const handleApplySync = () => {
        if (!selectedRobotId) return;
        updateRobotConfig(selectedRobotId, {
            kp_straight: parseFloat(kpStraight),
            ki_straight: parseFloat(kiStraight)
        });
    };

    if (!selectedRobot) return null;

    const pwmLPct = Math.min(100, Math.abs(pwmL) / 255 * 100);
    const pwmRPct = Math.min(100, Math.abs(pwmR) / 255 * 100);

    return (
        <div className="pid-tuner-container">
            <h4 className="config-title">
                <span className="title-icon">⚡</span>
                {t('pid_tuner')}
            </h4>

            {/* ─── PWM Monitor ────────────────────────────────────── */}
            <div className="pwm-monitor">
                <div className="pwm-monitor-title">{t('pwm_monitor')}</div>
                <div className="pwm-bars">
                    <div className="pwm-bar-group">
                        <div className="pwm-label">L: {pwmL}</div>
                        <div className="pwm-bar-track">
                            <div
                                className={`pwm-bar-fill ${pwmL < 0 ? 'reverse' : ''}`}
                                style={{ width: `${pwmLPct}%` }}
                            />
                        </div>
                    </div>
                    <div className="pwm-bar-group">
                        <div className="pwm-label">R: {pwmR}</div>
                        <div className="pwm-bar-track">
                            <div
                                className={`pwm-bar-fill ${pwmR < 0 ? 'reverse' : ''}`}
                                style={{ width: `${pwmRPct}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── PID Controls ───────────────────────────────────── */}
            <div className="pid-controls-panel">
                <div className="pid-slider-group">
                    <div className="pid-label-row">
                        <label>{t('kp_label') || 'Kp'}</label>
                        <input type="number" className="pid-num-input" value={kp} step="0.1" onChange={(e) => setKp(e.target.value)} />
                    </div>
                    <input type="range" min="0" max="150" step="0.5" value={kp} onChange={(e) => setKp(e.target.value)} />
                </div>
                <div className="pid-slider-group">
                    <div className="pid-label-row">
                        <label>{t('ki_label') || 'Ki'}</label>
                        <input type="number" className="pid-num-input" value={ki} step="0.1" onChange={(e) => setKi(e.target.value)} />
                    </div>
                    <input type="range" min="0" max="50" step="0.5" value={ki} onChange={(e) => setKi(e.target.value)} />
                </div>
                <div className="pid-actions">
                    <button className="apply-pid-btn" onClick={handleApplyPID}>
                        {t('apply_pid')}
                    </button>
                    <button className="pause-chart-btn" onClick={() => setIsPaused(!isPaused)}>
                        {isPaused ? `▶ ${t('resume_chart')}` : `⏸ ${t('pause_chart')}`}
                    </button>
                </div>
            </div>

            {/* ─── Motor Tuning ───────────────────────────────────── */}
            <div className="motor-tuning-panel">
                <div className="motor-tuning-title">{t('motor_parameters')}</div>
                <div className="motor-param-row">
                    <label>{t('ff_gain')}</label>
                    <input type="number" className="pid-num-input" value={ffGain} step="0.5" min="0" max="50"
                        onChange={(e) => setFfGain(e.target.value)} />
                    <input type="range" min="0" max="50" step="0.5" value={ffGain}
                        onChange={(e) => setFfGain(e.target.value)} />
                </div>
                <div className="motor-param-row">
                    <label>{t('min_pwm_label')}</label>
                    <input type="number" className="pid-num-input" value={minPwm} step="1" min="0" max="150"
                        onChange={(e) => setMinPwm(e.target.value)} />
                    <input type="range" min="0" max="150" step="1" value={minPwm}
                        onChange={(e) => setMinPwm(e.target.value)} />
                </div>
                <div className="motor-param-row">
                    <label>{t('cmd_timeout_label')}</label>
                    <input type="number" className="pid-num-input" value={cmdTimeout} step="50" min="100" max="5000"
                        onChange={(e) => setCmdTimeout(e.target.value)} />
                    <span className="param-unit">ms</span>
                </div>
                <button className="apply-pid-btn" onClick={handleApplyMotor} style={{ marginTop: '8px' }}>
                    {t('apply_motor_config')}
                </button>
            </div>

            {/* ─── Virtual Axle Tuning ──────────────────────────────── */}
            <div className="motor-tuning-panel" style={{ borderTop: '1px dashed #444', marginTop: '16px', paddingTop: '16px' }}>
                <div className="motor-tuning-title" style={{ color: '#44ffaa' }}>
                    {t('virtual_axle_title')}
                </div>
                <div className="motor-param-row">
                    <label>{t('kp_straight_label')}</label>
                    <input type="number" className="pid-num-input" value={kpStraight} step="0.1" min="0" max="10"
                        onChange={(e) => setKpStraight(e.target.value)} />
                    <input type="range" min="0" max="10" step="0.1" value={kpStraight}
                        onChange={(e) => setKpStraight(e.target.value)} />
                </div>
                <div className="motor-param-row">
                    <label>{t('ki_straight_label')}</label>
                    <input type="number" className="pid-num-input" value={kiStraight} step="0.01" min="0" max="1"
                        onChange={(e) => setKiStraight(e.target.value)} />
                    <input type="range" min="0" max="1" step="0.01" value={kiStraight}
                        onChange={(e) => setKiStraight(e.target.value)} />
                </div>


                <button className="apply-pid-btn" onClick={handleApplySync} style={{ marginTop: '16px', background: '#224466', borderColor: '#44aaff' }}>
                    {t('apply_sync')}
                </button>
            </div>

            {/* ─── Charts ────────────────────────────────────────── */}
            <div className="pid-charts-grid">
                <div className="chart-box">
                    <h5 className="chart-title">{t('left_motor')} (rad/s)</h5>
                    <div className="chart-wrapper">
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={dataLeft} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                                <XAxis dataKey="time" stroke="#888" tick={{ fontSize: 10 }} />
                                <YAxis stroke="#888" tick={{ fontSize: 10 }} domain={['dataMin - 1', 'dataMax + 1']} />
                                <Tooltip contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }} />
                                <Legend wrapperStyle={{ fontSize: '12px' }} />
                                <Line name={t('target')} type="monotone" dataKey="Target" stroke="#ff4d4f" strokeWidth={2} dot={false} isAnimationActive={false} />
                                <Line name={t('real')} type="monotone" dataKey="Real" stroke="#1890ff" strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="chart-box">
                    <h5 className="chart-title">{t('right_motor')} (rad/s)</h5>
                    <div className="chart-wrapper">
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={dataRight} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                                <XAxis dataKey="time" stroke="#888" tick={{ fontSize: 10 }} />
                                <YAxis stroke="#888" tick={{ fontSize: 10 }} domain={['dataMin - 1', 'dataMax + 1']} />
                                <Tooltip contentStyle={{ backgroundColor: '#1e1e1e', border: '1px solid #333' }} />
                                <Legend wrapperStyle={{ fontSize: '12px' }} />
                                <Line name={t('target')} type="monotone" dataKey="Target" stroke="#ff4d4f" strokeWidth={2} dot={false} isAnimationActive={false} />
                                <Line name={t('real')} type="monotone" dataKey="Real" stroke="#1890ff" strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PIDTuner;
