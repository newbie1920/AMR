import React, { useState, useEffect, useCallback } from 'react';
import lifecycleManager, { LIFECYCLE_STATE } from '../../lib/lifecycleManager';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './LifecyclePanel.css';

const STATE_COLORS = {
    [LIFECYCLE_STATE.UNCONFIGURED]: '#6b7280',
    [LIFECYCLE_STATE.INACTIVE]: '#f59e0b',
    [LIFECYCLE_STATE.ACTIVE]: '#10b981',
    [LIFECYCLE_STATE.FINALIZED]: '#6366f1',
    [LIFECYCLE_STATE.ERROR]: '#ef4444',
    [LIFECYCLE_STATE.TRANSITIONING]: '#06b6d4',
};

const STATE_ICONS = {
    [LIFECYCLE_STATE.UNCONFIGURED]: '⚪',
    [LIFECYCLE_STATE.INACTIVE]: '🟡',
    [LIFECYCLE_STATE.ACTIVE]: '🟢',
    [LIFECYCLE_STATE.FINALIZED]: '🔵',
    [LIFECYCLE_STATE.ERROR]: '🔴',
    [LIFECYCLE_STATE.TRANSITIONING]: '⏳',
};

const LifecyclePanel = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [nodes, setNodes] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null);
    const [isTransitioning, setIsTransitioning] = useState(false);

    useEffect(() => {
        setNodes(lifecycleManager.listNodes());
        const unsub = lifecycleManager.onChange(setNodes);
        return unsub;
    }, []);

    const handleTransition = useCallback(async (nodeName, transition) => {
        setIsTransitioning(true);
        try {
            await lifecycleManager.transition(nodeName, transition);
        } catch (err) {
            console.error(`Transition failed: ${err.message}`);
        }
        setIsTransitioning(false);
    }, []);

    const handleActivateAll = useCallback(async () => {
        setIsTransitioning(true);
        await lifecycleManager.activateAll();
        setIsTransitioning(false);
    }, []);

    const selectedNodeData = selectedNode ? lifecycleManager.getNodeState(selectedNode) : null;

    return (
        <div className="lifecycle-panel">
            <div className="lcp-header">
                <h4 className="lcp-title">
                    <span className="lcp-icon">🔄</span>
                    {t('lifecycle')}
                </h4>
                <button
                    className="lcp-btn lcp-btn-activate-all"
                    onClick={handleActivateAll}
                    disabled={isTransitioning}
                >
                    ▶ {t('activate_all')}
                </button>
            </div>

            {/* State Machine Diagram */}
            <div className="lcp-state-diagram">
                {['UNCONFIGURED', 'INACTIVE', 'ACTIVE', 'FINALIZED'].map((state, i) => (
                    <React.Fragment key={state}>
                        <div className="lcp-state-node">
                            <span className="lcp-state-dot" style={{ background: STATE_COLORS[state] }} />
                            <span className="lcp-state-name">{t(`state_${state.toLowerCase()}`)}</span>
                        </div>
                        {i < 3 && <span className="lcp-state-arrow">→</span>}
                    </React.Fragment>
                ))}
            </div>

            {/* Node List */}
            <div className="lcp-node-list">
                {nodes.length === 0 ? (
                    <div className="lcp-empty">{t('no_lifecycle_nodes')}</div>
                ) : (
                    nodes.map(node => (
                        <div
                            key={node.name}
                            className={`lcp-node-row ${selectedNode === node.name ? 'selected' : ''}`}
                            onClick={() => setSelectedNode(selectedNode === node.name ? null : node.name)}
                        >
                            <div className="lcp-node-info">
                                <span className="lcp-node-icon">{STATE_ICONS[node.state]}</span>
                                <span className="lcp-node-name">{node.name}</span>
                            </div>
                            <span
                                className="lcp-node-state"
                                style={{ color: STATE_COLORS[node.state] }}
                            >
                                {t(`state_${node.state.toLowerCase()}`)}
                            </span>
                            {node.state === LIFECYCLE_STATE.ERROR && (
                                <span className="lcp-error-msg" title={node.errorMessage}>
                                    ⚠ {node.errorMessage?.slice(0, 30)}
                                </span>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Selected Node Detail */}
            {selectedNodeData && (
                <div className="lcp-detail">
                    <div className="lcp-detail-header">
                        <span className="lcp-detail-name">
                            {STATE_ICONS[selectedNodeData.state]} {selectedNodeData.name}
                        </span>
                        <span className="lcp-detail-state" style={{ color: STATE_COLORS[selectedNodeData.state] }}>
                            {t(`state_${selectedNodeData.state.toLowerCase()}`)}
                        </span>
                    </div>

                    {/* Transition Buttons */}
                    <div className="lcp-transitions">
                        {selectedNodeData.availableTransitions.map(tr => (
                            <button
                                key={tr}
                                className={`lcp-trans-btn lcp-trans-${tr}`}
                                onClick={() => handleTransition(selectedNodeData.name, tr)}
                                disabled={isTransitioning}
                            >
                                {t(tr)}
                            </button>
                        ))}
                    </div>

                    {/* History */}
                    {selectedNodeData.transitionHistory.length > 0 && (
                        <div className="lcp-history">
                            <span className="lcp-history-title">History</span>
                            <div className="lcp-history-list">
                                {selectedNodeData.transitionHistory.slice(-8).reverse().map((h, i) => (
                                    <div key={i} className="lcp-history-item">
                                        <span className="lcp-hist-time">
                                            {new Date(h.timestamp).toLocaleTimeString()}
                                        </span>
                                        <span className="lcp-hist-from" style={{ color: STATE_COLORS[h.from] }}>
                                            {t(`state_${h.from.toLowerCase()}`)}
                                        </span>
                                        <span className="lcp-hist-arrow">→</span>
                                        <span className="lcp-hist-to" style={{ color: STATE_COLORS[h.to] }}>
                                            {t(`state_${h.to.toLowerCase()}`)}
                                        </span>
                                        <span className="lcp-hist-label">{t(h.transition)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default LifecyclePanel;
