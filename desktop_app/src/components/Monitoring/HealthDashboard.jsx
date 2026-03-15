/**
 * HealthDashboard.jsx
 * ===================
 * Hiển thị tần suất dữ liệu (Hz) và trạng thái hệ thống.
 * Tương đương: ros2 topic hz / diagnostics
 */

import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './HealthDashboard.css';

const HealthDashboard = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const { robots, selectedRobotId } = useRobotStore();
    const robot = robots[selectedRobotId] || {};
    const systemHealth = robot.systemHealth || {};
    const systemHz = robot.systemHz || {};

    const getStatusColor = (status) => {
        switch (status) {
            case 'OK': return '#10b981';
            case 'WARNING': return '#f59e0b';
            case 'ERROR': return '#ef4444';
            default: return '#6b7280';
        }
    };

    return (
        <div className="health-dashboard">
            <h4 className="section-title">{t('system_health')}</h4>
            <div className="health-grid">
                {Object.keys(systemHealth).map(module => (
                    <div key={module} className="health-card">
                        <div className="module-info">
                            <span className="module-name">{module.toUpperCase()}</span>
                            <span
                                className="status-indicator"
                                style={{ backgroundColor: getStatusColor(systemHealth[module]) }}
                            ></span>
                        </div>
                        <div className="module-metrics">
                            <span className="hz-value">{systemHz[module] || 0}</span>
                            <span className="hz-unit">Hz</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HealthDashboard;
