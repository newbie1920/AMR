/**
 * telemetryRecorder.js
 * =====================
 * Telemetry Recorder — thay thế ros2 bag record
 * 
 * Tính năng:
 *   - Lắng nghe telemetry từ robot (robotBridge).
 *   - Lưu dữ liệu vào memory (ring buffer) hoặc xuất ra JSON/CSV.
 *   - Metadata: timestamp, robotId, event type.
 */

import robotBridge, { MSG } from './robotBridge';

class TelemetryRecorder {
    constructor() {
        this._buffer = [];
        this._maxBufferSize = 10000; // ~10-20 min @ 10Hz
        this._isRecording = false;
        this._robotId = null;
        this._unsub = null;
    }

    start(robotId = 'robot_1') {
        if (this._isRecording) return;
        this._robotId = robotId;
        this._isRecording = true;
        this._buffer = [];

        console.log(`[Recorder] Started recording for ${robotId}`);

        this._unsub = robotBridge.subscribe(robotId, MSG.TELEM, (msg) => {
            this._buffer.push({
                ts: Date.now(),
                type: 'telem',
                data: msg
            });
            if (this._buffer.length > this._maxBufferSize) this._buffer.shift();
        });
    }

    stop() {
        if (!this._isRecording) return;
        if (this._unsub) this._unsub();
        this._isRecording = false;
        console.log(`[Recorder] Stopped. Total records: ${this._buffer.length}`);
    }

    /**
     * exportCSV()
     * Xuất dữ liệu ra định dạng CSV để dùng trong Excel/Python.
     */
    exportCSV() {
        if (this._buffer.length === 0) return '';

        // Header
        const keys = ['ts', 'x', 'y', 'theta', 'vx', 'wz'];
        let csv = keys.join(',') + '\n';

        for (let entry of this._buffer) {
            const d = entry.data;
            const row = [
                entry.ts,
                d.x || 0,
                d.y || 0,
                d.theta || 0,
                d.vx || 0,
                d.wz || 0
            ];
            csv += row.join(',') + '\n';
        }
        return csv;
    }

    getBuffer() { return this._buffer; }
}

const recorder = new TelemetryRecorder();
export default recorder;
