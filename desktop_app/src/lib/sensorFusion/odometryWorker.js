/**
 * odometryWorker.js
 * =================
 * Web Worker — Forward Kinematics (Differential Drive)
 * Thay thế: robot_localization/ekf_node prediction step (ROS2)
 *
 * Chạy trên luồng phụ (Web Worker) để không block React UI.
 * Nhận encoder ticks từ main thread, tính toán pose (x, y, theta), gửi trả.
 *
 * Protocol (postMessage):
 *   IN:  { type: 'encoder', ticksL, ticksR, dt }
 *   IN:  { type: 'imu', theta, omega }
 *   IN:  { type: 'config', wheelRadius, wheelSeparation, ticksPerRev }
 *   IN:  { type: 'reset' }
 *   OUT: { type: 'odom', x, y, theta, v, omega, filtered: true }
 *   OUT: { type: 'raw_odom', x, y, theta, v, omega }
 */

// ─── Inline EKF (Worker cannot import modules in all environments) ──────────

function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

// Minimal matrix operations (Float64 for precision)
function zeros(n, m) { return Array.from({ length: n }, () => new Float64Array(m)); }
function eye(n) { const I = zeros(n, n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; }
function matMul(A, B) {
    const n = A.length, m = B.length, p = B[0].length;
    const C = zeros(n, p);
    for (let i = 0; i < n; i++)
        for (let j = 0; j < p; j++) {
            let s = 0;
            for (let k = 0; k < m; k++) s += A[i][k] * B[k][j];
            C[i][j] = s;
        }
    return C;
}
function transpose(A) {
    const n = A.length, m = A[0].length, T = zeros(m, n);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
    return T;
}
function matAdd(A, B) {
    const n = A.length, m = A[0].length, C = zeros(n, m);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) C[i][j] = A[i][j] + B[i][j];
    return C;
}
function matSub(A, B) {
    const n = A.length, m = A[0].length, C = zeros(n, m);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) C[i][j] = A[i][j] - B[i][j];
    return C;
}
function matInv(A) {
    const n = A.length;
    const M = Array.from({ length: n }, (_, i) => {
        const row = new Float64Array(2 * n);
        for (let j = 0; j < n; j++) row[j] = A[i][j];
        row[n + i] = 1;
        return row;
    });
    for (let col = 0; col < n; col++) {
        let maxRow = col;
        for (let row = col + 1; row < n; row++)
            if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        const pivot = M[col][col];
        if (Math.abs(pivot) < 1e-12) return eye(n);
        for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot;
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const f = M[row][col];
            for (let j = 0; j < 2 * n; j++) M[row][j] -= f * M[col][j];
        }
    }
    return Array.from({ length: n }, (_, i) => {
        const row = new Float64Array(n);
        for (let j = 0; j < n; j++) row[j] = M[i][n + j];
        return row;
    });
}
function colVec(arr) { return arr.map(v => new Float64Array([v])); }

// ─── Robot config ────────────────────────────────────────────────────────────

let config = {
    wheelRadius: 0.033,       // meters (default for typical AMR)
    wheelSeparation: 0.17,    // meters (distance between wheels)
    ticksPerRev: 1665,        // encoder ticks per revolution
};

// ─── Odometry state ──────────────────────────────────────────────────────────

let odomPose = { x: 0, y: 0, theta: 0, v: 0, omega: 0 };
let prevTicksL = null;
let prevTicksR = null;

// ─── EKF state (5-dim) ──────────────────────────────────────────────────────

const N = 5;
let ekf_x = new Float64Array(N);       // state [x, y, theta, v, omega]
let ekf_P = eye(N);                     // covariance
ekf_P[0][0] = 0.1; ekf_P[1][1] = 0.1; ekf_P[2][2] = 0.05;
ekf_P[3][3] = 0.01; ekf_P[4][4] = 0.01;

// Process noise
const Q = eye(N);
Q[0][0] = 0.001; Q[1][1] = 0.001; Q[2][2] = 0.001; Q[3][3] = 0.01; Q[4][4] = 0.01;

// Encoder measurement noise
const R_enc = eye(N);
R_enc[0][0] = 0.02; R_enc[1][1] = 0.02; R_enc[2][2] = 0.05;
R_enc[3][3] = 0.01; R_enc[4][4] = 0.02;

// IMU measurement noise (only theta and omega)
const R_imu = zeros(2, 2);
R_imu[0][0] = 0.01; R_imu[1][1] = 0.005;

// IMU observation matrix [2×5]
const H_imu = zeros(2, N);
H_imu[0][2] = 1; // theta
H_imu[1][4] = 1; // omega

// ─── EKF Predict ─────────────────────────────────────────────────────────────

function ekfPredict(dt) {
    if (dt <= 0 || dt > 1.0) return;

    const [x, y, theta, v, omega] = ekf_x;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);

    // State prediction
    ekf_x[0] = x + v * cosT * dt;
    ekf_x[1] = y + v * sinT * dt;
    ekf_x[2] = normalizeAngle(theta + omega * dt);

    // Jacobian
    const F = eye(N);
    F[0][2] = -v * sinT * dt;
    F[0][3] = cosT * dt;
    F[1][2] = v * cosT * dt;
    F[1][3] = sinT * dt;
    F[2][4] = dt;

    // P = F·P·Fᵀ + Q·dt
    const Q_s = zeros(N, N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) Q_s[i][j] = Q[i][j] * dt;
    ekf_P = matAdd(matMul(matMul(F, ekf_P), transpose(F)), Q_s);
}

// ─── EKF Update (generic) ───────────────────────────────────────────────────

function ekfUpdate(H, R, z_arr, angleIdx) {
    const z = colVec(z_arr);
    const x_col = colVec(Array.from(ekf_x));

    // Innovation
    const y = matSub(z, matMul(H, x_col));
    // Normalize angle innovations
    for (const idx of angleIdx) y[idx][0] = normalizeAngle(y[idx][0]);

    // S = H·P·Hᵀ + R
    const S = matAdd(matMul(matMul(H, ekf_P), transpose(H)), R);
    // K = P·Hᵀ·S⁻¹
    const K = matMul(matMul(ekf_P, transpose(H)), matInv(S));
    // x̂ = x̂ + K·y
    const Ky = matMul(K, y);
    for (let i = 0; i < N; i++) ekf_x[i] += Ky[i][0];
    ekf_x[2] = normalizeAngle(ekf_x[2]);

    // P = (I - K·H)·P
    ekf_P = matMul(matSub(eye(N), matMul(K, H)), ekf_P);

    // Symmetrize
    for (let i = 0; i < N; i++)
        for (let j = i + 1; j < N; j++) {
            const avg = (ekf_P[i][j] + ekf_P[j][i]) / 2;
            ekf_P[i][j] = avg; ekf_P[j][i] = avg;
        }
}

// ─── Forward Kinematics (Differential Drive) ────────────────────────────────

function computeOdometry(ticksL, ticksR, dt) {
    if (prevTicksL === null) {
        prevTicksL = ticksL;
        prevTicksR = ticksR;
        return null;
    }

    const deltaL = ticksL - prevTicksL;
    const deltaR = ticksR - prevTicksR;
    prevTicksL = ticksL;
    prevTicksR = ticksR;

    // Guard against huge jumps (encoder overflow or reset)
    if (Math.abs(deltaL) > 10000 || Math.abs(deltaR) > 10000) return null;

    // Distance traveled by each wheel
    const distL = (deltaL / config.ticksPerRev) * 2 * Math.PI * config.wheelRadius;
    const distR = (deltaR / config.ticksPerRev) * 2 * Math.PI * config.wheelRadius;

    // Linear and angular displacement
    const dCenter = (distL + distR) / 2.0;
    const dTheta = (distR - distL) / config.wheelSeparation;

    // Update pose using midpoint approximation
    const theta_mid = odomPose.theta + dTheta / 2.0;
    odomPose.x += dCenter * Math.cos(theta_mid);
    odomPose.y += dCenter * Math.sin(theta_mid);
    odomPose.theta = normalizeAngle(odomPose.theta + dTheta);

    // Velocities
    if (dt > 0) {
        odomPose.v = dCenter / dt;
        odomPose.omega = dTheta / dt;
    }

    return { ...odomPose };
}

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = function (e) {
    const msg = e.data;

    switch (msg.type) {
        case 'encoder': {
            const dt = msg.dt || 0.1;
            const raw = computeOdometry(msg.ticksL, msg.ticksR, dt);
            if (!raw) break;

            // Post raw odometry
            self.postMessage({ type: 'raw_odom', ...raw });

            // EKF: predict + encoder update
            ekfPredict(dt);
            ekfUpdate(eye(N), R_enc, [raw.x, raw.y, raw.theta, raw.v, raw.omega], [2]);

            // Post filtered odometry
            self.postMessage({
                type: 'odom',
                x: ekf_x[0],
                y: ekf_x[1],
                theta: ekf_x[2],
                v: ekf_x[3],
                omega: ekf_x[4],
                filtered: true,
            });
            break;
        }

        case 'imu': {
            // IMU update only (no predict — that comes with encoder data)
            ekfUpdate(H_imu, R_imu, [msg.theta, msg.omega || 0], [0]);

            self.postMessage({
                type: 'odom',
                x: ekf_x[0],
                y: ekf_x[1],
                theta: ekf_x[2],
                v: ekf_x[3],
                omega: ekf_x[4],
                filtered: true,
            });
            break;
        }

        case 'config': {
            if (msg.wheelRadius) config.wheelRadius = msg.wheelRadius;
            if (msg.wheelSeparation) config.wheelSeparation = msg.wheelSeparation;
            if (msg.ticksPerRev) config.ticksPerRev = msg.ticksPerRev;
            break;
        }

        case 'reset': {
            odomPose = { x: 0, y: 0, theta: 0, v: 0, omega: 0 };
            prevTicksL = null;
            prevTicksR = null;
            ekf_x.fill(0);
            ekf_P = eye(N);
            ekf_P[0][0] = 0.1; ekf_P[1][1] = 0.1; ekf_P[2][2] = 0.05;
            ekf_P[3][3] = 0.01; ekf_P[4][4] = 0.01;
            self.postMessage({ type: 'odom', x: 0, y: 0, theta: 0, v: 0, omega: 0, filtered: true });
            break;
        }

        case 'set_pose': {
            odomPose.x = msg.x ?? odomPose.x;
            odomPose.y = msg.y ?? odomPose.y;
            odomPose.theta = msg.theta ?? odomPose.theta;
            ekf_x[0] = odomPose.x;
            ekf_x[1] = odomPose.y;
            ekf_x[2] = odomPose.theta;
            break;
        }
    }
};

// Signal ready
self.postMessage({ type: 'ready' });
