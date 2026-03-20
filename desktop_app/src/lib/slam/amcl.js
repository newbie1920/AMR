/**
 * amcl.js
 * =======
 * Adaptive Monte Carlo Localization (Particle Filter)
 * Thay thế: nav2_amcl
 * 
 * Thuật toán:
 *   1. Init: Rải một đám particles (hạt) quanh pose dự kiến.
 *   2. Motion Update: Mỗi hạt di chuyển theo odometry + gaussian noise.
 *   3. Sensor Update (Likelihood): Tính trọng số (weight) cho mỗi hạt.
 *      Hạt nào có LiDAR scan khớp với map nhất -> weight cao.
 *   4. Resampling: Chọn lại các hạt dựa trên weight (hạt tốt được nhân bản, hạt xấu bị loại).
 *   5. Output: Trung bình cộng của các hạt -> slam_pose (map → odom).
 *
 * USAGE:
 *   import amcl from './amcl';
 *   amcl.init(map, initialPose);
 *   lidarDriver.onScan((scan) => {
 *     const pose = amcl.update(scan, odomDelta);
 *   });
 */

class Particle {
    constructor(x, y, theta, w = 1.0) {
        this.x = x;
        this.y = y;
        this.theta = theta;
        this.w = w;
    }
}

class AMCL {
    constructor() {
        this._particles = [];
        this._particleCount = 100; // Cân bằng giữa chính xác và performance JS
        this._map = null;
        this._pose = { x: 0, y: 0, theta: 0 };

        // Noise params
        this._alpha1 = 0.2; // rotation noise from rotation
        this._alpha2 = 0.2; // rotation noise from translation
        this._alpha3 = 0.2; // translation noise from translation
        this._alpha4 = 0.2; // translation noise from rotation

        this._initialized = false;
    }

    /**
     * init(map, pose)
     * Khởi tạo swarm particles quanh một vị trí.
     */
    init(map, pose, sigma = 0.2) {
        this._map = map;
        this._pose = pose;
        this._particles = [];

        for (let i = 0; i < this._particleCount; i++) {
            this._particles.push(new Particle(
                pose.x + this._randn() * sigma,
                pose.y + this._randn() * sigma,
                pose.theta + this._randn() * (sigma * 2),
                1.0 / this._particleCount
            ));
        }
        this._initialized = true;
        console.log(`[AMCL] Swarm initialized with ${this._particleCount} particles.`);
    }

    /**
     * update(scan, odomDelta)
     * @param {LaserScan} scan 
     * @param {{ dx, dy, dtheta }} odomDelta - Khoảng di chuyển từ lần update trước
     */
    update(scan, odomDelta) {
        if (!this._initialized) return null;

        // 1. Motion Update
        this._motionUpdate(odomDelta);

        // 2. Sensor Update (Weighting)
        this._sensorUpdate(scan);

        // 3. Resampling
        this._resample();

        // 4. Estimate Pose
        this._pose = this._estimatePose();
        return this._pose;
    }

    _motionUpdate(delta) {
        for (let p of this._particles) {
            // Add noise to movement
            const dx = delta.dx + this._randn() * this._alpha3 * Math.abs(delta.dx);
            const dy = delta.dy + this._randn() * this._alpha3 * Math.abs(delta.dy);
            const dtheta = delta.dtheta + this._randn() * this._alpha1 * Math.abs(delta.dtheta);

            // Update particle pose (unicycle-ish)
            const cos = Math.cos(p.theta);
            const sin = Math.sin(p.theta);
            p.x += dx * cos - dy * sin;
            p.y += dx * sin + dy * cos;
            p.theta += dtheta;
        }
    }

    _sensorUpdate(scan) {
        const grid = this._map.data;
        const res = this._map.resolution;
        const ox = this._map.origin.x;
        const oy = this._map.origin.y;
        const w = this._map.width;
        const h = this._map.height;

        let totalWeight = 0;

        for (let p of this._particles) {
            let weight = 1.0;
            const cos = Math.cos(p.theta);
            const sin = Math.sin(p.theta);

            // Sub-sample scan to save CPU (ví dụ lấy 10 tia)
            const step = Math.max(1, Math.floor(scan.ranges.length / 10));
            for (let i = 0; i < scan.ranges.length; i += step) {
                const r = scan.ranges[i];
                if (!isFinite(r) || r < scan.range_min || r > scan.range_max) continue;

                const angle = scan.angle_min + i * scan.angle_increment;
                const wx = p.x + r * Math.cos(p.theta + angle);
                const wy = p.y + r * Math.sin(p.theta + angle);

                // Convert world to grid
                const cx = Math.floor((wx - ox) / res);
                const cy = Math.floor((wy - oy) / res);

                if (cx >= 0 && cx < w && cy >= 0 && cy < h) {
                    const mapVal = grid[cy * w + cx];
                    if (mapVal === 100) {
                        weight *= 1.5; // Khớp với vật cản -> tăng weight
                    } else if (mapVal === 0) {
                        weight *= 0.5; // Không khớp -> giảm weight
                    }
                } else {
                    weight *= 0.1; // Out of map
                }
            }
            p.w = weight;
            totalWeight += weight;
        }

        // Normalize weights
        if (totalWeight > 0) {
            for (let p of this._particles) p.w /= totalWeight;
        } else {
            // Reset weight if lost
            for (let p of this._particles) p.w = 1.0 / this._particleCount;
        }
    }

    _resample() {
        const newParticles = [];
        const count = this._particles.length;

        // Stochastic universal sampling (Low variance sampler)
        const M_inv = 1.0 / count;
        let r = Math.random() * M_inv;
        let c = this._particles[0].w;
        let i = 0;

        for (let m = 0; m < count; m++) {
            const u = r + m * M_inv;
            while (u > c && i < count - 1) {
                i++;
                c += this._particles[i].w;
            }
            const p = this._particles[i];
            newParticles.push(new Particle(p.x, p.y, p.theta));
        }
        this._particles = newParticles;
    }

    _estimatePose() {
        let tx = 0, ty = 0, cosSum = 0, sinSum = 0;
        for (let p of this._particles) {
            tx += p.x;
            ty += p.y;
            cosSum += Math.cos(p.theta);
            sinSum += Math.sin(p.theta);
        }
        const count = this._particles.length;
        return {
            x: tx / count,
            y: ty / count,
            theta: Math.atan2(sinSum, cosSum)
        };
    }

    _randn() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
}

const amclInstance = new AMCL();
export default amclInstance;
