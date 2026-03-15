/**
 * TFViewer.jsx
 * ============
 * Transform Tree Visualizer — thay thế rqt_tf_tree / tf2_echo
 *
 * Features:
 *   - Interactive tree diagram: map → odom → base_link → lidar/imu
 *   - Live transform values (x, y, z, roll, pitch, yaw)
 *   - Frame-to-frame lookup tool
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './TFViewer.css';

// TF tree structure definition
const TF_TREE_STRUCTURE = [
    {
        frame: 'map',
        children: [
            {
                frame: 'odom',
                children: [
                    {
                        frame: 'base_footprint',
                        children: [
                            {
                                frame: 'base_link',
                                children: [
                                    { frame: 'lidar_link', children: [] },
                                    { frame: 'imu_link', children: [] },
                                    { frame: 'left_wheel_link', children: [] },
                                    { frame: 'right_wheel_link', children: [] },
                                    { frame: 'caster_link', children: [] },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
];

const TFViewer = () => {
    const { robots, selectedRobotId } = useRobotStore();
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const robot = robots[selectedRobotId] || {};
    const tfTree = robot.tfTree || null;

    const [expandedFrames, setExpandedFrames] = useState(new Set(['map', 'odom', 'base_footprint', 'base_link']));
    const [selectedLookup, setSelectedLookup] = useState({ from: 'map', to: 'base_link' });
    const [lookupResult, setLookupResult] = useState(null);
    const [allFrames, setAllFrames] = useState({});

    // Refresh TF data periodically
    useEffect(() => {
        if (!tfTree) return;
        const interval = setInterval(() => {
            try {
                const frames = tfTree.getAllFrames();
                setAllFrames(frames || {});
            } catch (e) {
                setAllFrames({});
            }
        }, 250); // 4Hz
        return () => clearInterval(interval);
    }, [tfTree]);

    const handleLookup = useCallback(() => {
        if (!tfTree) return;
        try {
            const result = tfTree.lookupTransform(selectedLookup.from, selectedLookup.to);
            setLookupResult(result);
        } catch (e) {
            setLookupResult({ error: e.message });
        }
    }, [tfTree, selectedLookup]);

    const toggleExpand = (frame) => {
        setExpandedFrames(prev => {
            const next = new Set(prev);
            if (next.has(frame)) next.delete(frame);
            else next.add(frame);
            return next;
        });
    };

    const formatNum = (n) => (n || 0).toFixed(3);

    return (
        <div className="tf-viewer">
            {/* Header */}
            <div className="tfv-header">
                <h4 className="tfv-title">
                    <span className="tfv-icon">🌐</span>
                    {t('tf_viewer')}
                </h4>
                <span className="tfv-badge">
                    {Object.keys(allFrames).length > 0
                        ? `${Object.keys(allFrames).length} ${t('frames')}`
                        : t('no_tf_data')}
                </span>
            </div>

            {!tfTree ? (
                <div className="tfv-empty">{t('select_robot_tf')}</div>
            ) : (
                <>
                    {/* Tree View */}
                    <div className="tfv-tree">
                        {TF_TREE_STRUCTURE.map(node => (
                            <TFNode
                                key={node.frame}
                                node={node}
                                depth={0}
                                expanded={expandedFrames}
                                onToggle={toggleExpand}
                                allFrames={allFrames}
                            />
                        ))}
                    </div>

                    {/* Lookup Tool */}
                    <div className="tfv-lookup">
                        <div className="tfv-lookup-header">
                            <span className="tfv-lookup-title">🔍 {t('frame_lookup')}</span>
                        </div>
                        <div className="tfv-lookup-controls">
                            <select
                                value={selectedLookup.from}
                                onChange={(e) => setSelectedLookup(prev => ({ ...prev, from: e.target.value }))}
                                className="tfv-select"
                            >
                                {['map', 'odom', 'base_footprint', 'base_link', 'lidar_link', 'imu_link'].map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                            <span className="tfv-arrow">→</span>
                            <select
                                value={selectedLookup.to}
                                onChange={(e) => setSelectedLookup(prev => ({ ...prev, to: e.target.value }))}
                                className="tfv-select"
                            >
                                {['map', 'odom', 'base_footprint', 'base_link', 'lidar_link', 'imu_link'].map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))}
                            </select>
                            <button className="tfv-lookup-btn" onClick={handleLookup}>{t('lookup')}</button>
                        </div>

                        {lookupResult && (
                            <div className="tfv-lookup-result">
                                {lookupResult.error ? (
                                    <span className="tfv-error">{lookupResult.error}</span>
                                ) : (
                                    <div className="tfv-result-grid">
                                        <div className="tfv-result-section">
                                            <span className="tfv-result-label">{t('translation')}</span>
                                            <div className="tfv-result-values">
                                                <span>x: <b>{formatNum(lookupResult.translation?.x)}</b></span>
                                                <span>y: <b>{formatNum(lookupResult.translation?.y)}</b></span>
                                                <span>z: <b>{formatNum(lookupResult.translation?.z)}</b></span>
                                            </div>
                                        </div>
                                        <div className="tfv-result-section">
                                            <span className="tfv-result-label">{t('rotation')}</span>
                                            <div className="tfv-result-values">
                                                <span>R: <b>{formatNum(lookupResult.rotation?.roll)}</b></span>
                                                <span>P: <b>{formatNum(lookupResult.rotation?.pitch)}</b></span>
                                                <span>Y: <b>{formatNum(lookupResult.rotation?.yaw)}</b></span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// ─── Tree Node Component ─────────────────────────────────────────────────────
const TFNode = ({ node, depth, expanded, onToggle, allFrames }) => {
    const isExpanded = expanded.has(node.frame);
    const hasChildren = node.children.length > 0;
    const frameData = allFrames[node.frame];

    return (
        <div className="tfv-node" style={{ paddingLeft: `${depth * 16}px` }}>
            <div className="tfv-node-row" onClick={() => hasChildren && onToggle(node.frame)}>
                <span className="tfv-expand-icon">
                    {hasChildren ? (isExpanded ? '▼' : '▶') : '•'}
                </span>
                <span className={`tfv-frame-name ${frameData ? 'active' : 'stale'}`}>
                    {node.frame}
                </span>
                {frameData && (
                    <span className="tfv-frame-data">
                        ({frameData.x?.toFixed(2)}, {frameData.y?.toFixed(2)})
                    </span>
                )}
            </div>
            {isExpanded && hasChildren && (
                <div className="tfv-children">
                    {node.children.map(child => (
                        <TFNode
                            key={child.frame}
                            node={child}
                            depth={depth + 1}
                            expanded={expanded}
                            onToggle={onToggle}
                            allFrames={allFrames}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default TFViewer;
