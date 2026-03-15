/**
 * TopicMonitor.jsx
 * ================
 * Topic Introspection Panel — thay thế rqt_topic + ros2 topic list/echo/hz
 *
 * Features:
 *   - Live topic list with msg types, pub/sub counts, Hz
 *   - Click to echo topic data in JSON viewer
 *   - Hz sparkline per topic
 *   - Search/filter bar
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import topicManager from '../../lib/topicManager';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './TopicMonitor.css';

const TopicMonitor = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [topics, setTopics] = useState([]);
    const [searchFilter, setSearchFilter] = useState('');
    const [selectedTopic, setSelectedTopic] = useState(null);
    const [echoMessages, setEchoMessages] = useState([]);
    const [isEchoing, setIsEchoing] = useState(false);
    const echoUnsub = useRef(null);
    const echoContainerRef = useRef(null);

    // Refresh topic list every second
    useEffect(() => {
        const interval = setInterval(() => {
            setTopics(topicManager.listTopics());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Auto-scroll echo container
    useEffect(() => {
        if (echoContainerRef.current) {
            echoContainerRef.current.scrollTop = echoContainerRef.current.scrollHeight;
        }
    }, [echoMessages]);

    const filteredTopics = topics.filter(t =>
        t.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        t.msgType.toLowerCase().includes(searchFilter.toLowerCase())
    );

    const handleSelectTopic = useCallback((topicName) => {
        // Stop previous echo
        if (echoUnsub.current) {
            echoUnsub.current();
            echoUnsub.current = null;
        }
        setSelectedTopic(topicName);
        setEchoMessages([]);
        setIsEchoing(false);
    }, []);

    const handleToggleEcho = useCallback(() => {
        if (isEchoing) {
            if (echoUnsub.current) {
                echoUnsub.current();
                echoUnsub.current = null;
            }
            setIsEchoing(false);
        } else if (selectedTopic) {
            echoUnsub.current = topicManager.echoTopic(selectedTopic, (msg) => {
                setEchoMessages(prev => {
                    const next = [...prev, {
                        timestamp: Date.now(),
                        data: msg,
                    }];
                    // Keep last 100 messages
                    return next.length > 100 ? next.slice(-100) : next;
                });
            });
            setIsEchoing(true);
        }
    }, [isEchoing, selectedTopic]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (echoUnsub.current) echoUnsub.current();
        };
    }, []);

    const selectedInfo = selectedTopic ? topicManager.getTopicInfo(selectedTopic) : null;

    return (
        <div className="topic-monitor">
            {/* Header */}
            <div className="tm-header">
                <h4 className="tm-title">
                    <span className="tm-icon">📡</span>
                    {t('topic_monitor')}
                </h4>
                <span className="tm-count">{topics.length} {t('topics')}</span>
            </div>

            {/* Search */}
            <div className="tm-search">
                <input
                    type="text"
                    placeholder={t('filter_topics')}
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="tm-search-input"
                />
            </div>

            {/* Topic List */}
            <div className="tm-topic-list">
                {filteredTopics.length === 0 ? (
                    <div className="tm-empty">
                        {topics.length === 0
                            ? t('no_topics_active')
                            : t('no_topics_match')}
                    </div>
                ) : (
                    filteredTopics.map(tData => (
                        <div
                            key={tData.name}
                            className={`tm-topic-row ${selectedTopic === tData.name ? 'selected' : ''}`}
                            onClick={() => handleSelectTopic(tData.name)}
                        >
                            <div className="tm-topic-info">
                                <span className="tm-topic-name">{tData.name}</span>
                                <span className="tm-topic-type">{tData.msgType}</span>
                            </div>
                            <div className="tm-topic-stats">
                                <span className="tm-hz">
                                    <span className="tm-hz-value">{tData.hz}</span>
                                    <span className="tm-hz-unit">Hz</span>
                                </span>
                                <span className="tm-pub-sub">
                                    <span className="tm-pub" title={t('publishers')}>⬆{tData.pubCount}</span>
                                    <span className="tm-sub" title={t('subscribers')}>⬇{tData.subCount}</span>
                                </span>
                            </div>
                            {/* Hz Sparkline */}
                            <div className="tm-sparkline">
                                <HzSparkline history={topicManager.getHzHistory(tData.name)} />
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Topic Detail / Echo Panel */}
            {selectedTopic && (
                <div className="tm-detail-panel">
                    <div className="tm-detail-header">
                        <div className="tm-detail-title">
                            <span className="tm-detail-name">{selectedTopic}</span>
                            {selectedInfo && (
                                <span className="tm-detail-meta">
                                    {selectedInfo.msgType} · {selectedInfo.hz} Hz ·
                                    {selectedInfo.latencyMs.toFixed(2)}ms {t('latency')}
                                </span>
                            )}
                        </div>
                        <button
                            className={`tm-echo-btn ${isEchoing ? 'active' : ''}`}
                            onClick={handleToggleEcho}
                        >
                            {isEchoing ? `⏹ ${t('stop_echo')}` : `▶ ${t('echo')}`}
                        </button>
                    </div>

                    {/* Echo Messages */}
                    <div className="tm-echo-container" ref={echoContainerRef}>
                        {echoMessages.length === 0 ? (
                            <div className="tm-echo-empty">
                                {isEchoing
                                    ? t('waiting_for_messages')
                                    : t('click_echo_to_start')}
                            </div>
                        ) : (
                            echoMessages.map((msg, i) => (
                                <div key={i} className="tm-echo-msg">
                                    <span className="tm-echo-time">
                                        {new Date(msg.timestamp).toLocaleTimeString()}
                                    </span>
                                    <pre className="tm-echo-data">
                                        {JSON.stringify(msg.data, null, 2)}
                                    </pre>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Hz Sparkline Component ──────────────────────────────────────────────────
const HzSparkline = ({ history = [] }) => {
    if (history.length < 2) return null;

    const width = 60;
    const height = 16;
    const max = Math.max(...history, 1);
    const step = width / (history.length - 1);

    const points = history.map((val, i) =>
        `${i * step},${height - (val / max) * height}`
    ).join(' ');

    return (
        <svg width={width} height={height} className="sparkline-svg">
            <polyline
                points={points}
                fill="none"
                stroke="var(--color-accent-primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

export default TopicMonitor;
