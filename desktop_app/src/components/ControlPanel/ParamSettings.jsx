/**
 * ParamSettings.jsx
 * =================
 * Giao diện tinh chỉnh tham số hệ thống.
 * Tương đương: ros2 param edit / rqt_reconfigure
 */

import React, { useState, useEffect } from 'react';
import paramServer from '../../lib/paramServer';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './ParamSettings.css';

const ParamSettings = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [params, setParams] = useState(paramServer.getAll());

    useEffect(() => {
        const unsub = paramServer.subscribe(() => {
            setParams(paramServer.getAll());
        });
        return unsub;
    }, []);

    const handleChange = (key, value) => {
        const numVal = parseFloat(value);
        paramServer.set(key, isNaN(numVal) ? value : numVal);
    };

    return (
        <div className="param-settings">
            <h4 className="section-title">{t('param_settings')}</h4>
            <div className="params-list">
                {Object.entries(params).map(([key, value]) => (
                    <div key={key} className="param-item">
                        <label className="param-label">{key.replaceAll('_', ' ')}</label>
                        <input
                            type={typeof value === 'number' ? 'number' : 'text'}
                            step="0.05"
                            className="param-input"
                            value={value}
                            onChange={(e) => handleChange(key, e.target.value)}
                        />
                    </div>
                ))}
            </div>
            <p className="param-hint">{t('param_hint')}</p>
        </div>
    );
};

export default ParamSettings;
