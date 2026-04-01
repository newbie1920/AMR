/**
 * ekfFilter.js
 * ============
 * Extended Kalman Filter — Sensor Fusion (Encoder + IMU)
 * Thay thế: robot_localization/ekf_node (ROS2)
 *
 * State vector [5×1]:
 *   x     — position X (meters, map frame)
 *   y     — position Y (meters, map frame)
 *   theta — heading (radians)
 *   v     — linear velocity (m/s)
 *   omega — angular velocity (rad/s)
 *
 * Prediction model: Differential Drive kinematics
 *   x'     = x + v * cos(theta) * dt
 *   y'     = y + v * sin(theta) * dt
 *   theta' = theta + omega * dt
 *   v'     = v      (constant velocity model)
 *   omega' = omega  (constant angular velocity model)
 *
 * Measurement sources:
 *   1. Encoder Odometry → observes (x, y, theta, v, omega)
 *   2. IMU              → observes (theta, omega) with higher precision heading
 *
 * Output:
 *   filteredState = { x, y, theta, v, omega, covariance }
 *
 * USAGE:
 *   import { EKFilter } from './ekfFilter';
 *   const ekf = new EKFilter();
 *
 *   // In your 10Hz loop:
 *   ekf.predict(dt);
 *   ekf.updateEncoder({ x, y, theta, v, omega });
 *   ekf.updateIMU({ theta, omega });
 *   const state = ekf.getState(); // { x, y, theta, v, omega }
 */

// ─── Matrix utilities (lightweight, no external deps) ────────────────────────

/**
 * Create zero matrix NxM
 */
function zeros(n, m) {
    return Array.from({ length: n }, () => new Float64Array(m));
}

/**
 * Create identity matrix NxN
 */
function eye(n) {
    const I = zeros(n, n);
    for (let i = 0; i < n; i++) I[i][i] = 1;
    return I;
}

/**
 * Matrix multiplication A[n×m] × B[m×p] → C[n×p]
 */
function matMul(A, B) {
    const n = A.length, m = B.length, p = B[0].length;
    const C = zeros(n, p);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < p; j++) {
            let sum = 0;
            for (let k = 0; k < m; k++) sum += A[i][k] * B[k][j];
            C[i][j] = sum;
        }
    }
    return C;
}

/**
 * Matrix transpose A[n×m] → Aᵀ[m×n]
 */
function transpose(A) {
    const n = A.length, m = A[0].length;
    const T = zeros(m, n);
    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++)
            T[j][i] = A[i][j];
    return T;
}

/**
 * Matrix addition A + B (same dimensions)
 */
function matAdd(A, B) {
    const n = A.length, m = A[0].length;
    const C = zeros(n, m);
    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++)
            C[i][j] = A[i][j] + B[i][j];
    return C;
}

/**
 * Matrix subtraction A - B
 */
function matSub(A, B) {
    const n = A.length, m = A[0].length;
    const C = zeros(n, m);
    for (let i = 0; i < n; i++)
        for (let j = 0; j < m; j++)
            C[i][j] = A[i][j] - B[i][j];
    return C;
}

/**
 * Invert a small matrix (up to 5×5) using Gauss-Jordan elimination
 */
function matInv(A) {
    const n = A.length;
    // Augmented matrix [A | I]
    const M = Array.from({ length: n }, (_, i) => {
        const row = new Float64Array(2 * n);
        for (let j = 0; j < n; j++) row[j] = A[i][j];
        row[n + i] = 1;
        return row;
    });

    for (let col = 0; col < n; col++) {
        // Partial pivoting
        let maxRow = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];

        const pivot = M[col][col];
        if (Math.abs(pivot) < 1e-12) {
            // Singular — return identity as fallback
            return eye(n);
        }

        for (let j = 0; j < 2 * n; j++) M[col][j] /= pivot;

        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = M[row][col];
            for (let j = 0; j < 2 * n; j++) M[row][j] -= factor * M[col][j];
        }
    }

    // Extract inverse from augmented part
    return Array.from({ length: n }, (_, i) => {
        const row = new Float64Array(n);
        for (let j = 0; j < n; j++) row[j] = M[i][n + j];
        return row;
    });
}

/**
 * Column vector from array
 */
function colVec(arr) {
    return arr.map(v => new Float64Array([v]));
}

/**
 * Column vector to flat array
 */
function vecToArray(v) {
    return v.map(row => row[0]);
}

// ─── Angle normalization ─────────────────────────────────────────────────────

function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

// ─── EKF Class ───────────────────────────────────────────────────────────────

const STATE_DIM = 5; // [x, y, theta, v, omega]

class EKFilter {
    constructor(options = {}) {
        // State vector
        this._x = new Float64Array(STATE_DIM); // [x, y, theta, v, omega]

        // Covariance matrix P [5×5]
        this._P = eye(STATE_DIM);
        this._P[0][0] = 0.1;  // x uncertainty
        this._P[1][1] = 0.1;  // y uncertainty
        this._P[2][2] = 0.05; // theta uncertainty
        this._P[3][3] = 0.01; // v uncertainty
        this._P[4][4] = 0.01; // omega uncertainty

        // Process noise Q — tunable
        this._Q = eye(STATE_DIM);
        this._Q[0][0] = options.qx ?? 0.001;     // x process noise
        this._Q[1][1] = options.qy ?? 0.001;     // y process noise
        this._Q[2][2] = options.qtheta ?? 0.001;  // theta process noise
        this._Q[3][3] = options.qv ?? 0.01;       // v process noise
        this._Q[4][4] = options.qomega ?? 0.01;   // omega process noise

        // Encoder measurement noise R_enc [5×5]
        this._R_enc = eye(STATE_DIM);
        this._R_enc[0][0] = options.rEncX ?? 0.02;      // encoder x noise
        this._R_enc[1][1] = options.rEncY ?? 0.02;      // encoder y noise
        this._R_enc[2][2] = options.rEncTheta ?? 0.05;   // encoder theta noise (high — drift!)
        this._R_enc[3][3] = options.rEncV ?? 0.01;       // encoder v noise
        this._R_enc[4][4] = options.rEncOmega ?? 0.02;   // encoder omega noise

        // IMU measurement noise R_imu [2×2] — observes theta and omega only
        this._R_imu = zeros(2, 2);
        this._R_imu[0][0] = options.rImuTheta ?? 0.01;  // IMU theta noise (good!)
        this._R_imu[1][1] = options.rImuOmega ?? 0.005; // IMU omega noise (very good!)

        // IMU observation matrix H_imu [2×5]
        // Observes: theta (state index 2) and omega (state index 4)
        this._H_imu = zeros(2, STATE_DIM);
        this._H_imu[0][2] = 1; // theta
        this._H_imu[1][4] = 1; // omega

        // Encoder observation matrix H_enc [5×5] = Identity
        // Observes all states
        this._H_enc = eye(STATE_DIM);

        this._lastPredictTime = null;
    }

    // ─── Prediction Step ──────────────────────────────────────────────────────

    /**
     * predict(dt)
     * Advance state estimate by dt seconds using motion model.
     *
     * Motion model (Differential Drive):
     *   x'     = x + v·cos(θ)·dt
     *   y'     = y + v·sin(θ)·dt
     *   θ'     = θ + ω·dt
     *   v'     = v
     *   ω'     = ω
     *
     * Jacobian F = ∂f/∂x:
     *   | 1  0  -v·sin(θ)·dt  cos(θ)·dt  0 |
     *   | 0  1   v·cos(θ)·dt  sin(θ)·dt  0 |
     *   | 0  0   1             0          dt|
     *   | 0  0   0             1          0 |
     *   | 0  0   0             0          1 |
     */
    predict(dt) {
        if (dt <= 0 || dt > 1.0) return; // Safety guard

        const [x, y, theta, v, omega] = this._x;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // 1. State prediction: x̂ = f(x)
        this._x[0] = x + v * cosT * dt;           // x
        this._x[1] = y + v * sinT * dt;           // y
        this._x[2] = normalizeAngle(theta + omega * dt); // theta
        // v and omega held constant (kinematic model)

        // 2. Jacobian F
        const F = eye(STATE_DIM);
        F[0][2] = -v * sinT * dt;   // dx/dθ
        F[0][3] = cosT * dt;        // dx/dv
        F[1][2] = v * cosT * dt;    // dy/dθ
        F[1][3] = sinT * dt;        // dy/dv
        F[2][4] = dt;               // dθ/dω

        // 3. Covariance prediction: P = F·P·Fᵀ + Q
        const FP = matMul(F, this._P);
        const FPFt = matMul(FP, transpose(F));

        // Scale Q by dt for proper noise accumulation
        const Q_scaled = zeros(STATE_DIM, STATE_DIM);
        for (let i = 0; i < STATE_DIM; i++)
            for (let j = 0; j < STATE_DIM; j++)
                Q_scaled[i][j] = this._Q[i][j] * dt;

        this._P = matAdd(FPFt, Q_scaled);
    }

    // ─── Encoder Update ──────────────────────────────────────────────────────

    /**
     * updateEncoder(measurement)
     * Full state update from encoder odometry.
     *
     * @param {{ x, y, theta, v, omega }} measurement
     */
    updateEncoder(measurement) {
        const z = colVec([
            measurement.x,
            measurement.y,
            measurement.theta,
            measurement.v ?? 0,
            measurement.omega ?? 0,
        ]);

        this._kalmanUpdate(this._H_enc, this._R_enc, z, true);
    }

    // ─── IMU Update ──────────────────────────────────────────────────────────

    /**
     * updateIMU(measurement)
     * Partial state update from IMU (heading + angular velocity).
     *
     * @param {{ theta, omega }} measurement
     */
    updateIMU(measurement) {
        const z = colVec([
            measurement.theta,
            measurement.omega ?? 0,
        ]);

        this._kalmanUpdate(this._H_imu, this._R_imu, z, false);
    }

    // ─── Generic Kalman Update ───────────────────────────────────────────────

    /**
     * Standard EKF update:
     *   y = z - H·x̂            (innovation)
     *   S = H·P·Hᵀ + R         (innovation covariance)
     *   K = P·Hᵀ·S⁻¹           (Kalman gain)
     *   x̂ = x̂ + K·y            (state update)
     *   P = (I - K·H)·P        (covariance update)
     */
    _kalmanUpdate(H, R, z, normalizeTheta = false) {
        const n = H.length;    // measurement dimension
        const x_col = colVec(Array.from(this._x));

        // Innovation y = z - H·x̂
        const Hx = matMul(H, x_col);
        const y = matSub(z, Hx);

        // Normalize angle in innovation if needed
        if (normalizeTheta) {
            y[2][0] = normalizeAngle(y[2][0]); // theta innovation
        } else if (n === 2) {
            y[0][0] = normalizeAngle(y[0][0]); // IMU theta innovation
        }

        // S = H·P·Hᵀ + R
        const HP = matMul(H, this._P);
        const HPHt = matMul(HP, transpose(H));
        const S = matAdd(HPHt, R);

        // K = P·Hᵀ·S⁻¹
        const S_inv = matInv(S);
        const PHt = matMul(this._P, transpose(H));
        const K = matMul(PHt, S_inv);

        // x̂ = x̂ + K·y
        const Ky = matMul(K, y);
        for (let i = 0; i < STATE_DIM; i++) {
            this._x[i] += Ky[i][0];
        }
        this._x[2] = normalizeAngle(this._x[2]); // Keep theta valid

        // P = (I - K·H)·P
        const KH = matMul(K, H);
        const IKH = matSub(eye(STATE_DIM), KH);
        this._P = matMul(IKH, this._P);

        // Ensure symmetry (numerical stability)
        for (let i = 0; i < STATE_DIM; i++) {
            for (let j = i + 1; j < STATE_DIM; j++) {
                const avg = (this._P[i][j] + this._P[j][i]) / 2;
                this._P[i][j] = avg;
                this._P[j][i] = avg;
            }
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * getState()
     * Returns filtered state estimate.
     *
     * @returns {{ x, y, theta, v, omega, covariance: Float64Array[] }}
     */
    getState() {
        return {
            x: this._x[0],
            y: this._x[1],
            theta: this._x[2],
            v: this._x[3],
            omega: this._x[4],
            covariance: this._P,
        };
    }

    /**
     * setState(state)
     * Manually set the filter state (e.g. from setPoseEstimate).
     */
    setState(state) {
        this._x[0] = state.x ?? this._x[0];
        this._x[1] = state.y ?? this._x[1];
        this._x[2] = state.theta ?? this._x[2];
        this._x[3] = state.v ?? this._x[3];
        this._x[4] = state.omega ?? this._x[4];
    }

    /**
     * reset()
     * Reset filter to initial state.
     */
    reset() {
        this._x.fill(0);
        this._P = eye(STATE_DIM);
        this._P[0][0] = 0.1;
        this._P[1][1] = 0.1;
        this._P[2][2] = 0.05;
        this._P[3][3] = 0.01;
        this._P[4][4] = 0.01;
    }

    /**
     * getUncertainty()
     * Returns diagonal of covariance (per-state uncertainty).
     */
    getUncertainty() {
        return {
            x: Math.sqrt(this._P[0][0]),
            y: Math.sqrt(this._P[1][1]),
            theta: Math.sqrt(this._P[2][2]),
            v: Math.sqrt(this._P[3][3]),
            omega: Math.sqrt(this._P[4][4]),
        };
    }

    /**
     * tuneNoise(params)
     * Live-tune the process/measurement noise at runtime.
     */
    tuneNoise(params) {
        if (params.Q) {
            for (let i = 0; i < STATE_DIM; i++) {
                if (params.Q[i] !== undefined) this._Q[i][i] = params.Q[i];
            }
        }
        if (params.R_enc) {
            for (let i = 0; i < STATE_DIM; i++) {
                if (params.R_enc[i] !== undefined) this._R_enc[i][i] = params.R_enc[i];
            }
        }
        if (params.R_imu) {
            if (params.R_imu[0] !== undefined) this._R_imu[0][0] = params.R_imu[0];
            if (params.R_imu[1] !== undefined) this._R_imu[1][1] = params.R_imu[1];
        }
    }
}

export default EKFilter;
export { EKFilter, normalizeAngle };
