import React, { useState, useEffect, useRef } from 'react';
import { useRobotStore } from '../../stores/robotStore';
import './SerialMonitorModal.css';

const SerialMonitorModal = ({ isOpen, onClose }) => {
    const { selectedRobotId, robots } = useRobotStore();
    const [logs, setLogs] = useState([]);
    const [status, setStatus] = useState('disconnected');
    const [logFile, setLogFile] = useState('');
    const logsEndRef = useRef(null);
    const modalRef = useRef(null);

    // Auto-scroll
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        if (!isOpen || !selectedRobotId) return;

        const robot = robots[selectedRobotId];
        // The default hostname is the robotId (e.g. amr.local or IP)
        // Let's assume the WebSocket connected to it, so we extract the IP from robotBridge or use robotId
        // `ws://${robotId}:81` was used. So `robotId` acts as the hostname/IP.
        const ip = robotId;

        // Reset state
        setLogs([]);
        setStatus('connecting');

        // Setup IPC listeners
        window.electronAPI.onMonitorData((data) => {
            setLogs(prev => [...prev, data].slice(-200)); // Keep last 200 chunks to prevent memory bloat
        });

        window.electronAPI.onMonitorStatus((msg) => {
            setStatus(msg.status);
            if (msg.file) setLogFile(msg.file);
        });

        // Start
        window.electronAPI.startMonitor({ ip, robotId: selectedRobotId });

        return () => {
            window.electronAPI.stopMonitor();
            setStatus('disconnected');
        };
    }, [isOpen, selectedRobotId]);

    if (!isOpen) return null;

    const robot = robots[selectedRobotId];

    return (
        <div className="serial-monitor-overlay" onClick={onClose}>
            <div className="serial-monitor-modal" onClick={e => e.stopPropagation()} ref={modalRef}>
                <div className="modal-header">
                    <h3>Telnet Monitor - {selectedRobotId}</h3>
                    <div className="status-badge">
                        Status: <span className={`status-${status}`}>{status}</span>
                    </div>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>
                
                {logFile && (
                    <div className="log-file-info">
                        Saving logs to: <code>{logFile}</code>
                    </div>
                )}

                <div className="logs-container">
                    {logs.length === 0 && status !== 'connected' && (
                        <div className="empty-logs">Connecting to {selectedRobotId}:23...</div>
                    )}
                    <pre className="logs-content">
                        {logs.join('')}
                        <div ref={logsEndRef} />
                    </pre>
                </div>
                
                <div className="modal-footer">
                    <button 
                        className="btn secondary" 
                        onClick={() => setLogs([])}
                    >
                        Clear Display
                    </button>
                    <button className="btn primary" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SerialMonitorModal;
