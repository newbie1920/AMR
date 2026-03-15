/**
 * NodeGraph.jsx
 * =============
 * Computation Graph Visualizer — thay thế rqt_graph
 *
 * Features:
 *   - Visual node/topic connection diagram
 *   - Nodes: NavController, LidarDriver, SLAM, Costmap, Planner, etc.
 *   - Edges = topic subscriptions
 *   - Live activity indicators (Hz-based glow)
 */

import React, { useState, useEffect, useMemo } from 'react';
import topicManager from '../../lib/topicManager';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './NodeGraph.css';

// Node definitions (AMR system architecture graph)
const SYSTEM_NODES = [
    { id: 'lidar', name: 'LiDAR Driver', icon: '📡', group: 'sensor', publishes: ['/scan'], subscribes: [] },
    { id: 'slam', name: 'SLAM', icon: '🗺', group: 'nav', publishes: ['/map', '/amcl_pose'], subscribes: ['/scan', '/odom'] },
    { id: 'costmap', name: 'Costmap2D', icon: '🟧', group: 'nav', publishes: ['/costmap'], subscribes: ['/map', '/scan'] },
    { id: 'global_plan', name: 'Global Planner', icon: '🛤', group: 'nav', publishes: ['/plan'], subscribes: ['/costmap', '/goal_pose'] },
    { id: 'local_plan', name: 'DWA Planner', icon: '🔄', group: 'nav', publishes: ['/local_plan', '/cmd_vel'], subscribes: ['/plan', '/odom', '/costmap'] },
    { id: 'nav_ctrl', name: 'NavController', icon: '🧭', group: 'nav', publishes: ['/goal_pose'], subscribes: ['/amcl_pose'] },
    { id: 'behavior', name: 'BehaviorManager', icon: '🌳', group: 'control', publishes: [], subscribes: ['/robot/status'] },
    { id: 'robot_base', name: 'Robot Base', icon: '🤖', group: 'hw', publishes: ['/odom', '/battery_state'], subscribes: ['/cmd_vel'] },
    { id: 'tf', name: 'TF Publisher', icon: '🌐', group: 'core', publishes: ['/tf', '/tf_static'], subscribes: ['/odom'] },
    { id: 'health', name: 'HealthMonitor', icon: '💓', group: 'diag', publishes: ['/diagnostics'], subscribes: ['/scan', '/odom'] },
    { id: 'fleet', name: 'FleetManager', icon: '🏭', group: 'fleet', publishes: ['/fleet/status'], subscribes: ['/robot/status', '/diagnostics'] },
    { id: 'mission', name: 'MissionPlanner', icon: '📋', group: 'fleet', publishes: [], subscribes: ['/fleet/status', '/amcl_pose'] },
];

const GROUP_COLORS = {
    sensor: '#f59e0b',
    nav: '#06b6d4',
    control: '#8b5cf6',
    hw: '#ef4444',
    core: '#10b981',
    diag: '#6366f1',
    fleet: '#ec4899',
};

const NodeGraph = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [activeTopics, setActiveTopics] = useState({});
    const [hoveredNode, setHoveredNode] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [showLabels, setShowLabels] = useState(true);

    // Refresh topic activity
    useEffect(() => {
        const interval = setInterval(() => {
            const topics = topicManager.listTopics();
            const hzMap = {};
            topics.forEach(t => { hzMap[t.name] = t.hz; });
            setActiveTopics(hzMap);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Build connections from nodes
    const connections = useMemo(() => {
        const conns = [];
        for (const node of SYSTEM_NODES) {
            for (const topic of node.publishes) {
                // Find subscribers
                for (const sub of SYSTEM_NODES) {
                    if (sub.subscribes.includes(topic)) {
                        conns.push({
                            from: node.id,
                            to: sub.id,
                            topic,
                            hz: activeTopics[topic] || 0,
                        });
                    }
                }
            }
        }
        return conns;
    }, [activeTopics]);

    const highlightedConns = selectedNode ? connections.filter(
        c => c.from === selectedNode || c.to === selectedNode
    ) : [];

    return (
        <div className="node-graph">
            <div className="ng-header">
                <h4 className="ng-title">
                    <span className="ng-icon">🔗</span>
                    {t('node_graph_title')}
                </h4>
                <div className="ng-controls">
                    <label className="ng-toggle">
                        <input
                            type="checkbox"
                            checked={showLabels}
                            onChange={() => setShowLabels(!showLabels)}
                        />
                        <span className="ng-toggle-label">{t('labels')}</span>
                    </label>
                    <span className="ng-count">{SYSTEM_NODES.length} {t('nodes')}</span>
                </div>
            </div>

            {/* Graph View */}
            <div className="ng-canvas">
                <div className="ng-node-grid">
                    {SYSTEM_NODES.map(node => {
                        const isActive = node.publishes.some(t => (activeTopics[t] || 0) > 0);
                        const isSelected = selectedNode === node.id;
                        const isHovered = hoveredNode === node.id;
                        const isHighlighted = !selectedNode ||
                            highlightedConns.some(c => c.from === node.id || c.to === node.id);
                        const groupColor = GROUP_COLORS[node.group] || '#6b7280';

                        return (
                            <div
                                key={node.id}
                                className={`ng-node ${isActive ? 'active' : 'inactive'} ${isSelected ? 'selected' : ''} ${isHighlighted ? '' : 'dimmed'}`}
                                style={{
                                    '--node-color': groupColor,
                                    borderColor: isSelected ? groupColor : undefined,
                                }}
                                onMouseEnter={() => setHoveredNode(node.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                                onClick={() => setSelectedNode(isSelected ? null : node.id)}
                            >
                                <div className="ng-node-icon">{node.icon}</div>
                                <div className="ng-node-name">{node.name}</div>
                                {isActive && <div className="ng-node-pulse" style={{ background: groupColor }} />}
                                {showLabels && (
                                    <div className="ng-node-topics">
                                        {node.publishes.map(t => (
                                            <span key={t} className="ng-topic-badge pub">
                                                ⬆ {t} {activeTopics[t] ? `${activeTopics[t]}Hz` : ''}
                                            </span>
                                        ))}
                                        {node.subscribes.slice(0, 3).map(t => (
                                            <span key={t} className="ng-topic-badge sub">
                                                ⬇ {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Selected Node Detail */}
            {selectedNode && (
                <div className="ng-detail">
                    {(() => {
                        const node = SYSTEM_NODES.find(n => n.id === selectedNode);
                        if (!node) return null;
                        return (
                            <>
                                <div className="ng-detail-header">
                                    <span className="ng-detail-icon">{node.icon}</span>
                                    <span className="ng-detail-name">{node.name}</span>
                                    <span className="ng-detail-group" style={{ color: GROUP_COLORS[node.group] }}>
                                        {node.group}
                                    </span>
                                </div>
                                <div className="ng-detail-topics">
                                    <div className="ng-detail-section">
                                        <span className="ng-detail-label">{t('publishes')}</span>
                                        {node.publishes.length === 0 ? (
                                            <span className="ng-detail-none">{t('none')}</span>
                                        ) : (
                                            node.publishes.map(tData => (
                                                <div key={tData} className="ng-detail-topic">
                                                    <span className="ng-dot pub">•</span>
                                                    <span>{tData}</span>
                                                    <span className="ng-detail-hz">{activeTopics[tData] || 0} Hz</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    <div className="ng-detail-section">
                                        <span className="ng-detail-label">{t('subscribes')}</span>
                                        {node.subscribes.length === 0 ? (
                                            <span className="ng-detail-none">{t('none')}</span>
                                        ) : (
                                            node.subscribes.map(tData => (
                                                <div key={tData} className="ng-detail-topic">
                                                    <span className="ng-dot sub">•</span>
                                                    <span>{tData}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </div>
            )}
        </div>
    );
};

export default NodeGraph;
