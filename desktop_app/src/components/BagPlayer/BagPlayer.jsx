import React, { useState, useEffect, useCallback } from 'react';
import bagRecorder from '../../lib/bagRecorder';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './BagPlayer.css';

const SPEED_OPTIONS = [0.25, 0.5, 1.0, 2.0, 4.0];

const BagPlayer = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [state, setState] = useState(bagRecorder.getState());
    const [bags, setBags] = useState([]);
    const [showBagList, setShowBagList] = useState(false);
    const [recordTopicFilter, setRecordTopicFilter] = useState('');

    // Subscribe to state changes
    useEffect(() => {
        const unsub = bagRecorder.onChange(setState);
        return unsub;
    }, []);

    // Load bag list
    const refreshBags = useCallback(async () => {
        const list = await bagRecorder.listBags();
        setBags(list);
    }, []);

    useEffect(() => { refreshBags(); }, [refreshBags]);

    // Handlers
    const handleStartRecord = useCallback(async () => {
        const topics = recordTopicFilter.trim()
            ? recordTopicFilter.split(',').map(t => t.trim()).filter(Boolean)
            : [];
        await bagRecorder.startRecording(topics);
        setRecordTopicFilter('');
    }, [recordTopicFilter]);

    const handleStopRecord = useCallback(async () => {
        await bagRecorder.stopRecording();
        refreshBags();
    }, [refreshBags]);

    const handleLoadBag = useCallback(async (bagId) => {
        await bagRecorder.loadBag(bagId);
        setShowBagList(false);
    }, []);

    const handleDeleteBag = useCallback(async (e, bagId) => {
        e.stopPropagation();
        await bagRecorder.deleteBag(bagId);
        refreshBags();
    }, [refreshBags]);

    const handleExport = useCallback(async (e, bagId) => {
        e.stopPropagation();
        const data = await bagRecorder.exportBag(bagId);
        if (!data) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bagId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const formatTime = (ms) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        const frac = Math.floor((ms % 1000) / 100);
        return `${m}:${sec.toString().padStart(2, '0')}.${frac}`;
    };

    return (
        <div className="bag-player">
            {/* Header */}
            <div className="bp-header">
                <h4 className="bp-title">
                    <span className="bp-icon">⏺</span>
                    {t('bag_recorder')}
                </h4>
            </div>

            {/* Recording Controls */}
            <div className="bp-record-section">
                {state.isRecording ? (
                    <div className="bp-recording-status">
                        <div className="bp-rec-indicator">
                            <span className="bp-rec-dot" />
                            <span className="bp-rec-label">{t('rec')}</span>
                            <span className="bp-rec-time">{formatTime(state.recordingDuration)}</span>
                        </div>
                        <div className="bp-rec-info">
                            <span>{state.recordingMessageCount} {t('msgs')}</span>
                            <span>·</span>
                            <span>{state.recordingTopics.length} {t('topics_label')}</span>
                        </div>
                        <button className="bp-btn bp-btn-stop" onClick={handleStopRecord}>
                            ⏹ {t('stop')}
                        </button>
                    </div>
                ) : (
                    <div className="bp-record-controls">
                        <input
                            type="text"
                            className="bp-topic-input"
                            placeholder={t('topics_placeholder')}
                            value={recordTopicFilter}
                            onChange={(e) => setRecordTopicFilter(e.target.value)}
                        />
                        <button className="bp-btn bp-btn-record" onClick={handleStartRecord}>
                            ⏺ {t('record')}
                        </button>
                    </div>
                )}
            </div>

            {/* Playback Section */}
            <div className="bp-playback-section">
                <div className="bp-playback-header">
                    <span className="bp-section-title">📂 {t('playback')}</span>
                    <button className="bp-btn bp-btn-sm" onClick={() => { setShowBagList(!showBagList); refreshBags(); }}>
                        {showBagList ? `✕ ${t('close')}` : `📁 ${t('bags')}`}
                    </button>
                </div>

                {/* Bag List */}
                {showBagList && (
                    <div className="bp-bag-list">
                        {bags.length === 0 ? (
                            <div className="bp-empty">{t('no_bags')}</div>
                        ) : (
                            bags.map(bag => (
                                <div key={bag.id} className="bp-bag-item" onClick={() => handleLoadBag(bag.id)}>
                                    <div className="bp-bag-info">
                                        <span className="bp-bag-name">{bag.name}</span>
                                        <span className="bp-bag-meta">
                                            {bag.messageCount} {t('msgs')} · {formatTime(bag.duration)} ·
                                            {bag.topics?.length || 0} {t('topics_label')}
                                        </span>
                                    </div>
                                    <div className="bp-bag-actions">
                                        <button className="bp-btn-icon" onClick={(e) => handleExport(e, bag.id)} title={t('export_json')}>📥</button>
                                        <button className="bp-btn-icon bp-btn-danger" onClick={(e) => handleDeleteBag(e, bag.id)} title={t('delete')}>🗑</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Loaded Bag Info + Controls */}
                {state.loadedBag && (
                    <div className="bp-loaded-bag">
                        <div className="bp-loaded-info">
                            <span className="bp-loaded-name">{state.loadedBag.name}</span>
                            <span className="bp-loaded-meta">
                                {bagRecorder.loadedMessageCount} {t('msgs')}
                            </span>
                        </div>

                        {/* Timeline */}
                        <div className="bp-timeline">
                            <span className="bp-time">{formatTime(state.playbackTime)}</span>
                            <input
                                type="range"
                                className="bp-scrubber"
                                min={0}
                                max={1000}
                                value={Math.floor(state.playbackProgress * 1000)}
                                onChange={(e) => bagRecorder.seekTo(e.target.value / 1000)}
                            />
                            <span className="bp-time">{formatTime(state.totalDuration)}</span>
                        </div>

                        {/* Transport Controls */}
                        <div className="bp-transport">
                            <button
                                className="bp-btn bp-btn-transport"
                                onClick={() => bagRecorder.stop()}
                                title={t('stop')}
                            >⏹</button>

                            <button
                                className="bp-btn bp-btn-transport bp-btn-play"
                                onClick={() => state.isPaused || !state.isPlaying ? bagRecorder.play() : bagRecorder.pause()}
                            >
                                {state.isPlaying && !state.isPaused ? '⏸' : '▶'}
                            </button>

                            {/* Speed selector */}
                            <div className="bp-speed">
                                {SPEED_OPTIONS.map(s => (
                                    <button
                                        key={s}
                                        className={`bp-speed-btn ${state.playbackSpeed === s ? 'active' : ''}`}
                                        onClick={() => bagRecorder.setSpeed(s)}
                                    >
                                        {s}x
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BagPlayer;
