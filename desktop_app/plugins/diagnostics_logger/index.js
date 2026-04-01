/**
 * Sample Plugin: diagnostics_logger
 * ==================================
 * Plugin mẫu minh họa kiến trúc Plugin Architecture.
 *
 * Chức năng:
 *   - Subscribe /odom topic → log tốc độ trung bình
 *   - Subscribe /scan topic → log số điểm LiDAR
 *   - Advertise service /diagnostics/report → trả về health report
 *   - Publish /diagnostics topic mỗi 5 giây
 *
 * Đây là ví dụ thực tế về cách plugin tương tác với robot
 * thông qua EventBus (Pub/Sub + Services).
 */

let _unsubs = [];
let _timer = null;
let _stats = {
    odomCount: 0,
    scanCount: 0,
    avgSpeed: 0,
    avgScanPoints: 0,
    startTime: null,
    speedSamples: [],
};

export default {
    name: 'diagnostics_logger',
    version: '1.0.0',
    description: 'Logs robot diagnostics (speed, scan quality) and publishes health reports.',
    author: 'AMR System',

    /**
     * init(eventBus)
     * Called by pluginManager when the plugin is activated.
     * eventBus provides publish/subscribe/advertiseService.
     */
    init(eventBus) {
        _stats.startTime = Date.now();

        // 1. Subscribe to /odom — track velocity
        const unsubOdom = eventBus.subscribe('/odom', (msg) => {
            _stats.odomCount++;
            if (msg.twist) {
                _stats.speedSamples.push(Math.abs(msg.twist.linear));
                if (_stats.speedSamples.length > 100) _stats.speedSamples.shift();
                _stats.avgSpeed = _stats.speedSamples.reduce((a, b) => a + b, 0) / _stats.speedSamples.length;
            }
        });
        _unsubs.push(unsubOdom);

        // 2. Subscribe to /scan — track LiDAR health
        const unsubScan = eventBus.subscribe('/scan', (msg) => {
            _stats.scanCount++;
            if (msg.ranges) {
                const validRanges = msg.ranges.filter(r => r > 0 && isFinite(r));
                _stats.avgScanPoints = validRanges.length;
            }
        });
        _unsubs.push(unsubScan);

        // 3. Advertise diagnostic service
        eventBus.advertiseService('/diagnostics/report', async () => {
            const uptime = Math.round((Date.now() - _stats.startTime) / 1000);
            return {
                uptime_sec: uptime,
                odom_messages: _stats.odomCount,
                scan_messages: _stats.scanCount,
                avg_speed_mps: Math.round(_stats.avgSpeed * 1000) / 1000,
                avg_scan_points: _stats.avgScanPoints,
                health: _stats.scanCount > 0 ? 'OK' : 'NO_LIDAR',
            };
        });

        // 4. Periodic diagnostics publish
        _timer = setInterval(() => {
            const uptime = Math.round((Date.now() - _stats.startTime) / 1000);
            eventBus.publish('/diagnostics', {
                plugin: 'diagnostics_logger',
                uptime_sec: uptime,
                odom_hz: Math.round(_stats.odomCount / Math.max(1, uptime) * 10) / 10,
                scan_hz: Math.round(_stats.scanCount / Math.max(1, uptime) * 10) / 10,
                avg_speed: Math.round(_stats.avgSpeed * 1000) / 1000,
                health: _stats.scanCount > 0 ? 'OK' : 'NO_LIDAR',
            });
        }, 5000);

        console.log('[DiagnosticsLogger] Plugin activated.');
    },

    /**
     * destroy()
     * Called by pluginManager when the plugin is deactivated.
     */
    destroy() {
        for (const unsub of _unsubs) {
            try { unsub(); } catch (_) { /* ignore */ }
        }
        _unsubs = [];

        if (_timer) {
            clearInterval(_timer);
            _timer = null;
        }

        _stats = {
            odomCount: 0, scanCount: 0, avgSpeed: 0,
            avgScanPoints: 0, startTime: null, speedSamples: [],
        };

        console.log('[DiagnosticsLogger] Plugin destroyed.');
    },
};
