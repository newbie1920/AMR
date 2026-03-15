import React, { useState, useEffect, useRef } from 'react';
import { useFleetStore } from '../../stores/fleetStore';
import RobotControl from '../RobotControl/RobotControl';
import TaskPanel from '../TaskPanel/TaskPanel';
import HealthDashboard from '../Monitoring/HealthDashboard';
import ParamSettings from '../ControlPanel/ParamSettings';
import ReservationStatus from '../Monitoring/ReservationStatus';
import TopicMonitor from '../TopicMonitor/TopicMonitor';
import TFViewer from '../TFViewer/TFViewer';
import NodeGraph from '../NodeGraph/NodeGraph';
import CostmapViewer from '../CostmapViewer/CostmapViewer';
import BagPlayer from '../BagPlayer/BagPlayer';
import LifecyclePanel from '../LifecyclePanel/LifecyclePanel';
import NavPanel from '../NavPanel/NavPanel';
import translations from '../../translations';
import './RightSidebar.css';

// ─── Tab Groups ───────────────────────────────────────────────────────────────
const TAB_GROUPS = [
    {
        label: 'control',
        tabs: [
            { id: 'control', icon: '🎮', label: 'robot_control' },
            { id: 'task', icon: '📋', label: 'tasks_workflows' },
            { id: 'nav', icon: '🧭', label: 'navigation' },
        ],
    },
    {
        label: 'monitor',
        tabs: [
            { id: 'monitor', icon: '📊', label: 'monitor' },
            { id: 'topics', icon: '📡', label: 'topics_tab' },
            { id: 'lifecycle', icon: '🔄', label: 'lifecycle_tab' },
        ],
    },
    {
        label: 'advanced',
        tabs: [
            { id: 'tf', icon: '🌐', label: 'tf_tree' },
            { id: 'graph', icon: '🔗', label: 'node_graph' },
            { id: 'costmap', icon: '🗺️', label: 'costmap_tab' },
            { id: 'bag', icon: '⏺', label: 'bag_tab' },
        ],
    },
];

// Flatten all tabs for easy sequential navigation (e.g. mouse wheel)
const ALL_TABS = TAB_GROUPS.flatMap(group => group.tabs);


const RightSidebar = ({
    onSelectWaypoint,
    isSelectingWaypoint,
    onCancelWaypointSelect
}) => {
    const { settings } = useFleetStore();
    const [activeTab, setActiveTab] = useState('control');

    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const tabsRef = useRef(null);

    // Handle mouse wheel over tabs to scroll horizontally
    const handleTabWheel = (e) => {
        if (tabsRef.current) {
            // Map vertical scroll (deltaY) to horizontal scroll (scrollLeft)
            const delta = e.deltaY || e.deltaX;
            if (Math.abs(delta) > 5) {
                e.preventDefault();
                tabsRef.current.scrollLeft += delta;
            }
        }
    };

    // Attach non-passive wheel listener
    useEffect(() => {
        const el = tabsRef.current;
        if (el) {
            el.addEventListener('wheel', handleTabWheel, { passive: false });
            return () => el.removeEventListener('wheel', handleTabWheel);
        }
    }, [activeTab]);

    const renderTabContent = () => {
        switch (activeTab) {
            case 'control':
                return <RobotControl />;
            case 'task':
                return (
                    <TaskPanel
                        onSelectWaypoint={onSelectWaypoint}
                        isSelectingWaypoint={isSelectingWaypoint}
                        onCancelWaypointSelect={onCancelWaypointSelect}
                    />
                );
            case 'monitor':
                return (
                    <div className="monitor-tab-content">
                        <HealthDashboard />
                        <div style={{ margin: '12px 0' }}></div>
                        <ReservationStatus />
                        <div style={{ margin: '12px 0' }}></div>
                        <ParamSettings />
                    </div>
                );
            case 'topics':
                return <TopicMonitor />;
            case 'tf':
                return <TFViewer />;
            case 'graph':
                return <NodeGraph />;
            case 'costmap':
                return <CostmapViewer />;
            case 'bag':
                return <BagPlayer />;
            case 'lifecycle':
                return <LifecyclePanel />;
            case 'nav':
                return <NavPanel />;
            default:
                return null;
        }
    };

    return (
        <div className="right-sidebar-container">
            {/* Grouped Tabs */}
            <div className="sidebar-tabs" ref={tabsRef}>
                {TAB_GROUPS.map((group, gi) => (
                    <React.Fragment key={group.label}>
                        {gi > 0 && <div className="tab-group-separator" />}
                        <div className="tab-group-label">{t(group.label)}</div>
                        {group.tabs.map(tab => (
                            <button
                                key={tab.id}
                                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                                title={t(tab.label)}
                            >
                                <span className="tab-icon">{tab.icon}</span>
                                <span className="tab-label">{t(tab.label)}</span>
                            </button>
                        ))}
                    </React.Fragment>
                ))}
            </div>

            {/* Tab Content */}
            <div className="sidebar-content">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default RightSidebar;
