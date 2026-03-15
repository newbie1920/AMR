import React, { useState } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './FleetPanel.css';

// IPv4 Extraction Helper (more robust)
const cleanIP = (str) => {
    if (!str) return { ip: '', port: null };
    const s = str.trim();

    // Match IP:PORT (e.g. 192.168.1.130:81)
    const ipPortMatch = s.match(/\b((?:\d{1,3}\.){3}\d{1,3}):(\d+)\b/);
    if (ipPortMatch) {
        return { ip: ipPortMatch[1], port: parseInt(ipPortMatch[2]) };
    }

    // Match just IP
    const ipMatch = s.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) return { ip: ipMatch[0], port: null };

    // Match amr.local:port
    const localPortMatch = s.match(/\b([\w-]+\.local):(\d+)\b/);
    if (localPortMatch) {
        return { ip: localPortMatch[1], port: parseInt(localPortMatch[2]) };
    }

    // Match amr.local
    const localMatch = s.match(/\b[\w-]+\.local\b/);
    if (localMatch) return { ip: localMatch[0], port: null };

    return { ip: s.replace(/\s+/g, ''), port: null };
};

// ─── Mini Battery Bar ─────────────────────────────────────────────────────────
const MiniBattery = ({ level = 100 }) => {
    const color = level > 60 ? '#10b981' : level > 30 ? '#f59e0b' : '#ef4444';
    return (
        <div className="mini-battery" title={`Battery: ${level}%`}>
            <div className="mini-battery-shell">
                <div className="mini-battery-fill" style={{ width: `${level}%`, background: color }} />
            </div>
            <span className="mini-battery-text" style={{ color }}>{level}%</span>
        </div>
    );
};

const FleetPanel = () => {
    const {
        robots,
        selectedRobotId,
        selectRobot,
        addRobot,
        updateRobot,
        removeRobot,
        connectRobot,
        disconnectRobot,
        connectAllRobots,
        disconnectAllRobots,
        snapToDock,
        settings,
    } = useFleetStore();

    const [showAddModal, setShowAddModal] = useState(false);
    const [newRobotForm, setNewRobotForm] = useState({
        name: '',
        ip: '192.168.1.',
        port: 81,
    });

    const [editingIPRobotId, setEditingIPRobotId] = useState(null);
    const [editIPValue, setEditIPValue] = useState('');

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const handleAddRobot = () => {
        let { ip, port } = cleanIP(newRobotForm.ip);
        let finalPort = port || parseInt(newRobotForm.port) || 81;

        // SMART FIX: If user put the last octet in the port field by mistake
        // e.g. IP="192.168.1", Port="130" -> merge to "192.168.1.130", port 81
        if (ip.split('.').length === 3 && finalPort > 100 && finalPort < 255) {
            ip = `${ip}.${finalPort}`;
            finalPort = 81; // Reset to default robot port
        }

        if (!ip) return;

        const newId = addRobot({
            name: (newRobotForm.name || `AMR-${robots.length + 1}`).trim(),
            ip: ip,
            port: finalPort,
        });

        // Auto connect after adding
        setTimeout(() => connectRobot(newId), 500);

        setNewRobotForm({ name: '', ip: '192.168.1.', port: 81 });
        setShowAddModal(false);
    };

    const handleIPPaste = (e) => {
        const paste = e.clipboardData.getData('text');
        const { ip, port } = cleanIP(paste);
        if (ip) {
            e.preventDefault();
            setNewRobotForm(prev => ({
                ...prev,
                ip: ip,
                port: port || prev.port
            }));
        }
    };

    const startEditingIP = (e, robot) => {
        e.stopPropagation();
        if (robot.connected) return; // Can't edit while connected
        setEditingIPRobotId(robot.id);
        setEditIPValue(robot.ip);
    };

    const saveIPEdit = () => {
        if (editingIPRobotId) {
            const { ip } = cleanIP(editIPValue);
            updateRobot(editingIPRobotId, { ip: ip || editIPValue });
            setEditingIPRobotId(null);
        }
    };

    const cancelIPEdit = () => {
        setEditingIPRobotId(null);
    };

    // Sort: connected robots first
    const sortedRobots = [...robots].sort((a, b) => {
        if (a.connected === b.connected) return 0;
        return a.connected ? -1 : 1;
    });

    return (
        <div className="fleet-panel">
            <div className="fleet-header">
                <h2 className="panel-title">
                    <span className="icon">🤖</span>
                    {t('fleet')} ({robots.length})
                </h2>
                <div className="fleet-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => setShowAddModal(true)}>
                        + {t('add')}
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={connectAllRobots}>
                        {t('connect_all')}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={disconnectAllRobots}>
                        - {t('disconnect_all')}
                    </button>
                </div>
            </div>

            <div className="robot-list">
                {robots.length === 0 ? (
                    <div className="empty-fleet">
                        <div className="empty-icon">🛰️</div>
                        <p>{t('no_robots')}</p>
                        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                            {t('add_first_robot')}
                        </button>
                    </div>
                ) : (
                    sortedRobots.map(robot => (
                        <div
                            key={robot.id}
                            className={`robot-card ${selectedRobotId === robot.id ? 'selected' : ''} ${robot.velocity?.linear > 0.01 ? 'robot-moving' : ''}`}
                            onClick={() => selectRobot(robot.id)}
                        >
                            <div
                                className="robot-color-indicator"
                                style={{ backgroundColor: robot.color }}
                            />

                            <div className="robot-info">
                                <div className="robot-name-row">
                                    <span className="robot-name">{robot.name}</span>
                                    <div className={`connection-badge-v2 ${robot.connected ? 'online' : 'offline'}`}>
                                        <span className="pulse-dot"></span>
                                        {robot.connected ? t('connected') : t('offline')}
                                    </div>
                                </div>

                                <div className="robot-details">
                                    {editingIPRobotId === robot.id ? (
                                        <input
                                            autoFocus
                                            className="ip-edit-input"
                                            value={editIPValue}
                                            onChange={e => setEditIPValue(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveIPEdit();
                                                if (e.key === 'Escape') cancelIPEdit();
                                            }}
                                            onBlur={saveIPEdit}
                                            onClick={e => e.stopPropagation()}
                                        />
                                    ) : (
                                        <span
                                            className={`robot-ip ${!robot.connected ? 'editable' : ''}`}
                                            onClick={e => startEditingIP(e, robot)}
                                            title={!robot.connected ? t('click_to_edit') : ''}
                                        >
                                            {robot.ip}:{robot.port}
                                        </span>
                                    )}
                                    {robot.connected && robot.lastSeen && (
                                        <span className="last-seen">
                                            {t('last_seen')}: {Math.floor((Date.now() - robot.lastSeen) / 1000)}s {t('ago')}
                                        </span>
                                    )}
                                </div>

                                {robot.connected && (
                                    <div className="robot-telemetry-mini">
                                        <div className="telem-item">
                                            <span className="label">{t('status')}</span>
                                            <span className={`value status-${robot.status}`}>{t(robot.status) || robot.status}</span>
                                        </div>
                                        <div className="telem-item">
                                            <MiniBattery level={robot.battery ?? 100} />
                                        </div>
                                        {(robot.velocity?.linear > 0.01 || robot.velocity?.angular > 0.01) && (
                                            <div className="telem-item velocity-badge">
                                                <span className="vel-icon">▶</span>
                                                <span className="vel-value">{robot.velocity?.linear?.toFixed(2)} m/s</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="robot-actions" onClick={e => e.stopPropagation()}>
                                {robot.connected ? (
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={() => disconnectRobot(robot.id)}
                                        title={t('disconnect_all')}
                                    >
                                        ⏹
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-sm btn-success"
                                        onClick={() => connectRobot(robot.id)}
                                        title={t('connect_all')}
                                    >
                                        ⚡
                                    </button>
                                )}
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => snapToDock(robot.id)}
                                    title={t('snap_to_dock')}
                                >
                                    🏠
                                </button>
                                <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => removeRobot(robot.id)}
                                    title={t('remove')}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Add Robot Modal */}
            {
                showAddModal && (
                    <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                        <div className="modal-content" onClick={e => e.stopPropagation()}>
                            <h3>{t('add_new_robot')}</h3>

                            <div className="form-group">
                                <label>{t('robot_name')}</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder={`AMR-${robots.length + 1}`}
                                    value={newRobotForm.name}
                                    onChange={e => setNewRobotForm({ ...newRobotForm, name: e.target.value })}
                                />
                            </div>

                            <div className="form-group">
                                <label>{t('ip_address')} *</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="192.168.1.xxx"
                                    value={newRobotForm.ip}
                                    onChange={e => setNewRobotForm({ ...newRobotForm, ip: e.target.value })}
                                    onPaste={handleIPPaste}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') handleAddRobot();
                                    }}
                                />
                                <small className="form-hint">{t('ip_field_help')}</small>
                            </div>

                            <div className="form-group">
                                <label>{t('websocket_port')}</label>
                                <input
                                    type="number"
                                    className="input"
                                    placeholder="81"
                                    value={newRobotForm.port}
                                    onChange={e => setNewRobotForm({ ...newRobotForm, port: e.target.value })}
                                />
                            </div>

                            <div className="modal-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowAddModal(false)}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAddRobot}
                                >
                                    {t('add_new_robot')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default FleetPanel;
