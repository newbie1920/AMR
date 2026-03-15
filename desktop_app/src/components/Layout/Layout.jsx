import React, { useState, useEffect } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './Layout.css';

const Layout = ({ children }) => {
    const {
        robots,
        settings,
        updateSettings,
        connectAllRobots,
        disconnectAllRobots
    } = useFleetStore();

    const [showSettings, setShowSettings] = useState(false);
    const [clock, setClock] = useState('');

    // Realtime clock
    useEffect(() => {
        const tick = () => {
            const now = new Date();
            setClock(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    const connectedCount = robots.filter(r => r.connected).length;
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const toggleLanguage = () => {
        updateSettings({ language: lang === 'en' ? 'vi' : 'en' });
    };

    return (
        <div className="layout">
            {/* Header */}
            <header className="header">
                <div className="header-left">
                    <div className="logo">
                        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                            <circle cx="16" cy="16" r="14" stroke="url(#logoGradient)" strokeWidth="2" />
                            <circle cx="16" cy="16" r="6" fill="url(#logoGradient)" />
                            <path d="M16 4V8M16 24V28M4 16H8M24 16H28" stroke="url(#logoGradient)" strokeWidth="2" strokeLinecap="round" />
                            <defs>
                                <linearGradient id="logoGradient" x1="0" y1="0" x2="32" y2="32">
                                    <stop stopColor="#00d4ff" />
                                    <stop offset="1" stopColor="#7c3aed" />
                                </linearGradient>
                            </defs>
                        </svg>
                        <span className="logo-text">{t('fleet_control_center')}</span>
                    </div>
                </div>

                <div className="header-center">
                    <div className="fleet-status">
                        <span className={`status-dot ${connectedCount > 0 ? 'connected' : 'disconnected'}`}></span>
                        <span className="status-text">
                            {connectedCount > 0
                                ? `${connectedCount}/${robots.length} ${t('robots_online')}`
                                : `${robots.length} ${t('robots_offline')}`
                            }
                        </span>
                    </div>
                    <div className="header-clock">{clock}</div>
                </div>

                <div className="header-right">
                    <button
                        className="btn btn-secondary lang-toggle"
                        onClick={toggleLanguage}
                        title={lang === 'en' ? 'Tiếng Việt' : 'English'}
                    >
                        <span className="lang-icon">🌐</span>
                        <span className="lang-text">{lang === 'en' ? 'EN' : 'VI'}</span>
                    </button>

                    <button
                        className="btn btn-secondary"
                        onClick={connectAllRobots}
                        disabled={robots.length === 0}
                    >
                        ⚡ {t('connect_all')}
                    </button>

                    <button
                        className="btn btn-secondary"
                        onClick={disconnectAllRobots}
                        disabled={connectedCount === 0}
                    >
                        ⏹ {t('disconnect_all')}
                    </button>

                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={() => setShowSettings(!showSettings)}
                        title={t('settings')}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* Settings Panel */}
            {showSettings && (
                <div className="settings-panel">
                    <div className="settings-header">
                        <h3>{t('fleet_settings')}</h3>
                        <button
                            className="btn btn-icon btn-secondary"
                            onClick={() => setShowSettings(false)}
                        >
                            ✕
                        </button>
                    </div>
                    <div className="settings-content">
                        <div className="setting-item">
                            <label>{t('default_linear_speed')}</label>
                            <input
                                type="number"
                                className="input"
                                step="0.1"
                                min="0.1"
                                max="1.0"
                                value={settings.defaultLinearSpeed}
                                onChange={(e) => updateSettings({
                                    defaultLinearSpeed: parseFloat(e.target.value)
                                })}
                            />
                        </div>
                        <div className="setting-item">
                            <label>{t('default_angular_speed')}</label>
                            <input
                                type="number"
                                className="input"
                                step="0.1"
                                min="0.1"
                                max="2.0"
                                value={settings.defaultAngularSpeed}
                                onChange={(e) => updateSettings({
                                    defaultAngularSpeed: parseFloat(e.target.value)
                                })}
                            />
                        </div>
                        <div className="setting-item checkbox">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={settings.autoReconnect}
                                    onChange={(e) => updateSettings({
                                        autoReconnect: e.target.checked
                                    })}
                                />
                                {t('auto_reconnect')}
                            </label>
                        </div>
                        <div className="setting-item">
                            <label>{t('telemetry_interval')}</label>
                            <input
                                type="number"
                                className="input"
                                step="50"
                                min="100"
                                max="1000"
                                value={settings.telemetryInterval}
                                onChange={(e) => updateSettings({
                                    telemetryInterval: parseInt(e.target.value)
                                })}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="main">
                {children}
            </main>
        </div>
    );
};

export default Layout;
