/**
 * lidarDriver.js
 * ==============
 * LiDAR Scan Driver — thay thế sensor_msgs/LaserScan publisher trong ROS2
 *
 * Hỗ trợ:
 *   - RPLIDAR A1/A2/A3 (SLAMTEC) — qua Web Serial API (Chrome/Electron)
 *   - Mock mode — sinh scan giả lập để test khi không có LiDAR
 *
 * Output (tương đương sensor_msgs/LaserScan):
 *   {
 *     type: 'scan',
 *     stamp: Date.now(),
 *     angle_min:  -Math.PI,    // rad
 *     angle_max:   Math.PI,    // rad
 *     angle_increment: ...,    // rad/step
 *     range_min:  0.15,        // m
 *     range_max:  12.0,        // m
 *     ranges:     Float32Array, // m (360 measurements)
 *     intensities: Float32Array,
 *   }
 *
 * USAGE:
 *   import lidarDriver from './lidarDriver';
 *   await lidarDriver.connectSerial();     // opens browser serial picker
 *   lidarDriver.onScan((scan) => { ... }); // subscribe to scan data
 *   lidarDriver.startMock();               // use mock data without hardware
 */

// ─── RPLIDAR Protocol Constants ───────────────────────────────────────────────
const RPLIDAR_SYNC_BYTE1 = 0xA5;
const RPLIDAR_SYNC_BYTE2 = 0x5A;
const RPLIDAR_CMD_STOP = 0x25;
const RPLIDAR_CMD_RESET = 0x40;
const RPLIDAR_CMD_SCAN = 0x20;   // Standard scan
const RPLIDAR_CMD_EXPRESS_SCAN = 0x82;   // Express scan (faster but complex)
const RPLIDAR_CMD_GET_INFO = 0x50;
const RPLIDAR_CMD_GET_HEALTH = 0x52;

const SCAN_POINTS_PER_REV = 360;         // Approximate; actual varies
const RANGE_MIN = 0.15;                  // m
const RANGE_MAX = 12.0;                  // m

// ─── Scan data class ──────────────────────────────────────────────────────────
class LaserScan {
    constructor(numPoints = SCAN_POINTS_PER_REV) {
        this.type = 'scan';
        this.stamp = 0;
        this.frame_id = 'lidar_link';     // TF frame (từ tfTree)
        this.angle_min = -Math.PI;
        this.angle_max = Math.PI;
        this.angle_increment = (2 * Math.PI) / numPoints;
        this.range_min = RANGE_MIN;
        this.range_max = RANGE_MAX;
        this.ranges = new Float32Array(numPoints).fill(RANGE_MAX);
        this.intensities = new Float32Array(numPoints).fill(0);
        this.numPoints = numPoints;
    }
}

// ─── Main Driver Class ────────────────────────────────────────────────────────
class LidarDriver {
    constructor() {
        this._port = null;
        this._reader = null;
        this._writer = null;
        this._running = false;
        this._mockTimer = null;
        this._listeners = [];

        // Rolling scan buffer (accumulate points until full revolution)
        this._scanBuffer = [];
        this._lastAngle = null;
        this._currentScan = new LaserScan();

        // Stats
        this.stats = { scansPerSec: 0, pointsPerScan: 0, _frames: 0, _lastStatTime: Date.now() };
    }

    // ─── Connection ─────────────────────────────────────────────────────────────

    /**
     * connectSerial()
     * Kết nối qua Web Serial API (Electron/Chrome).
     * Tương đương: ros2 run rplidar_ros rplidar_node
     */
    async connectSerial(baudRate = 115200) {
        if (!navigator.serial) {
            throw new Error('Web Serial API not supported. Use Electron or Chrome with flag.');
        }

        // Opens browser's serial port picker
        this._port = await navigator.serial.requestPort({
            filters: [
                { usbVendorId: 0x10C4 },  // Silicon Labs CP2102 (common on RPLIDAR)
                { usbVendorId: 0x0403 },  // FTDI
            ]
        });

        await this._port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none' });

        this._writer = this._port.writable.getWriter();
        this._running = true;

        console.log('[LiDAR] Serial port opened.');

        // Start background read loop
        this._readLoop();

        // Init RPLIDAR
        await this._sendCommand(RPLIDAR_CMD_RESET);
        await this._sleep(100);
        await this._sendCommand(RPLIDAR_CMD_SCAN);

        console.log('[LiDAR] Scanning started.');
        return true;
    }

    /**
     * connectMockSerial(portPath)
     * For Electron (Node.js) — use node-serialport directly.
     * Alternative to Web Serial API.
     *
     * @param {string} portPath - e.g. 'COM3', '/dev/ttyUSB0'
     */
    async connectElectron(portPath = 'COM3') {
        // Uses Electron IPC to access serial port via main process
        // Main process needs to set up node-serialport and forward data via IPC
        if (window.electronAPI && window.electronAPI.lidar) {
            window.electronAPI.lidar.onData((chunk) => {
                this._processRawChunk(new Uint8Array(chunk));
            });
            await window.electronAPI.lidar.open(portPath, 115200);
            await window.electronAPI.lidar.sendCmd(RPLIDAR_CMD_RESET);
            await this._sleep(100);
            await window.electronAPI.lidar.sendCmd(RPLIDAR_CMD_SCAN);
            this._running = true;
            console.log('[LiDAR] Electron serial connected:', portPath);
        } else {
            console.warn('[LiDAR] electronAPI.lidar not available. Using mock mode.');
            this.startMock();
        }
    }

    disconnect() {
        this._running = false;
        clearInterval(this._mockTimer);
        if (this._writer) {
            this._sendCommand(RPLIDAR_CMD_STOP).catch(() => { });
            this._writer.releaseLock();
        }
        if (this._reader) this._reader.cancel().catch(() => { });
        if (this._port) this._port.close().catch(() => { });
        this._port = this._reader = this._writer = null;
        console.log('[LiDAR] Disconnected.');
    }

    // ─── Serial read loop ────────────────────────────────────────────────────────

    async _readLoop() {
        this._reader = this._port.readable.getReader();
        try {
            while (this._running) {
                const { value, done } = await this._reader.read();
                if (done) break;
                if (value) this._processRawChunk(value);
            }
        } catch (err) {
            if (this._running) console.error('[LiDAR] Read error:', err);
        } finally {
            this._reader.releaseLock();
        }
    }

    // ─── RPLIDAR packet parser ───────────────────────────────────────────────────
    //
    // RPLIDAR Standard Scan packet format (5 bytes per measurement):
    //   Byte 0: Quality[6:2] | S̄|S (start of new scan)
    //   Byte 1: Angle[6:0] | Checkbit=1
    //   Byte 2: Angle[14:7]
    //   Byte 3: Distance[7:0]
    //   Byte 4: Distance[15:8]
    //
    _parseBuffer = new Uint8Array(5);
    _parseBufPos = 0;
    _newScanStarted = false;

    _processRawChunk(chunk) {
        for (let i = 0; i < chunk.length; i++) {
            const byte = chunk[i];
            this._parseBuffer[this._parseBufPos++] = byte;

            if (this._parseBufPos === 5) {
                this._parseMeasurement(this._parseBuffer);
                this._parseBufPos = 0;
            }

            // Sync: detect start of new packet (bit0 XOR bit1 == 1)
            if (this._parseBufPos === 1) {
                const startBit = (byte >> 0) & 1;
                const startComp = (byte >> 1) & 1;
                if ((startBit ^ startComp) !== 1) {
                    // Out of sync — reset buffer
                    this._parseBufPos = 0;
                }
            }
        }
    }

    _parseMeasurement(buf) {
        const startFlag = (buf[0] >> 0) & 1;
        const quality = (buf[0] >> 2) & 0x3F;
        const angleMSB = buf[2];
        const angleLSB = (buf[1] >> 1) & 0x7F;
        const angleRaw = ((angleMSB << 7) | angleLSB);
        const angleDeg = angleRaw / 64.0;
        const angleRad = angleDeg * Math.PI / 180;

        const distRaw = (buf[4] << 8) | buf[3];
        const distM = distRaw / 4000.0;  // mm/4 → meters

        // New revolution detected → emit previous scan
        if (startFlag && this._lastAngle !== null && angleDeg < this._lastAngle) {
            this._emitScan();
        }
        this._lastAngle = angleDeg;

        // Only accept valid measurements
        if (distM >= RANGE_MIN && distM <= RANGE_MAX && quality > 0) {
            this._scanBuffer.push({ angleRad, distM, quality });
        }
    }

    _emitScan() {
        if (this._scanBuffer.length < 60) return; // Not enough points

        // Build LaserScan from accumulated points
        const scan = new LaserScan(360);
        scan.stamp = Date.now();

        for (const pt of this._scanBuffer) {
            // Map angle to index in [0, 359]
            let idx = Math.round(((pt.angleRad + Math.PI) / (2 * Math.PI)) * 360) % 360;
            if (idx < 0) idx += 360;
            scan.ranges[idx] = Math.min(scan.ranges[idx], pt.distM);
            scan.intensities[idx] = pt.quality;
        }

        this._scanBuffer = [];
        this._updateStats(scan.numPoints);
        this._notify(scan);
    }

    // ─── Mock mode (tương đương Gazebo LiDAR plugin) ─────────────────────────────

    /**
     * startMock(options)
     * Generates synthetic scan data for testing without hardware.
     * Tương đương: Gazebo ray sensor plugin
     */
    startMock(options = {}) {
        const {
            hz = 10,
            numObstacles = 4,
            roomSize = 5.0,   // m — square room
        } = options;

        console.log('[LiDAR] Mock mode started (no hardware).');
        this._running = true;
        let t = 0;

        this._mockTimer = setInterval(() => {
            const scan = new LaserScan(360);
            scan.stamp = Date.now();

            // Simulate a room with some obstacles
            for (let i = 0; i < 360; i++) {
                const angle = -Math.PI + (i / 360) * 2 * Math.PI;
                let minDist = RANGE_MAX;

                // Room walls (square)
                const wallDist = this._rayBoxIntersection(angle, roomSize / 2);
                minDist = Math.min(minDist, wallDist);

                // Random circular obstacles
                for (let o = 0; o < numObstacles; o++) {
                    const obstAngle = (o / numObstacles) * 2 * Math.PI + t * 0.01;
                    const obstDist = 1.5 + o * 0.5;
                    const obstRadius = 0.15;
                    const da = angle - obstAngle;
                    // Simple circle approximation
                    const d = obstDist - obstRadius / Math.max(0.01, Math.abs(Math.sin(da)));
                    if (d > 0 && Math.abs(da) < Math.asin(obstRadius / obstDist)) {
                        minDist = Math.min(minDist, d);
                    }
                }

                scan.ranges[i] = minDist + (Math.random() * 0.02 - 0.01); // ±1cm noise
                scan.intensities[i] = 200;
            }

            t++;
            this._updateStats(360);
            this._notify(scan);
        }, 1000 / hz);
    }

    stopMock() {
        clearInterval(this._mockTimer);
        this._mockTimer = null;
        this._running = false;
    }

    // Ray vs axis-aligned box intersection (for mock walls)
    _rayBoxIntersection(angle, halfSize) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        let minT = RANGE_MAX;
        if (Math.abs(cos) > 1e-6) {
            const t1 = (halfSize) / cos;
            const t2 = (-halfSize) / cos;
            if (t1 > 0) minT = Math.min(minT, t1);
            if (t2 > 0) minT = Math.min(minT, t2);
        }
        if (Math.abs(sin) > 1e-6) {
            const t1 = (halfSize) / sin;
            const t2 = (-halfSize) / sin;
            if (t1 > 0) minT = Math.min(minT, t1);
            if (t2 > 0) minT = Math.min(minT, t2);
        }
        return Math.max(RANGE_MIN, Math.min(RANGE_MAX, minT));
    }

    // ─── Subscription (tương đương /scan topic subscribe) ─────────────────────────

    onScan(callback) {
        this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter(l => l !== callback); };
    }

    _notify(scan) {
        this._listeners.forEach(cb => { try { cb(scan); } catch (e) { console.error(e); } });
    }

    // ─── Serial helpers ───────────────────────────────────────────────────────────

    async _sendCommand(cmd) {
        if (!this._writer) return;
        const packet = new Uint8Array([RPLIDAR_SYNC_BYTE1, cmd]);
        await this._writer.write(packet);
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ─── Stats ────────────────────────────────────────────────────────────────────

    _updateStats(pointCount) {
        this.stats._frames++;
        this.stats.pointsPerScan = pointCount;
        const now = Date.now();
        const elapsed = (now - this.stats._lastStatTime) / 1000;
        if (elapsed >= 1.0) {
            this.stats.scansPerSec = Math.round(this.stats._frames / elapsed);
            this.stats._frames = 0;
            this.stats._lastStatTime = now;
        }
    }

    getStats() { return { ...this.stats, running: this._running }; }
}

export default LidarDriver;
export { LaserScan, RANGE_MIN, RANGE_MAX };
