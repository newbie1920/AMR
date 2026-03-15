# TASK: Refactor AMR ESP32 Motor Control Firmware

You are a robotics firmware engineer.
Refactor the provided ESP32 AMR robot firmware to make the motor control stable and simpler.

The current firmware has **too many overlapping control systems**, causing unstable behavior and ineffective correction when driving straight.

Current system contains:

* Feedforward control
* Individual wheel PI controllers
* Deadband compensation
* Stall boost
* Cross-coupled control (virtual axle)
* Straight-line integral correction
* Distance-based encoder error correction

These systems are **overlapping and conflicting**, making PID ineffective.

Your task is to **simplify and redesign the control architecture** using a **standard differential drive velocity control approach used in robotics (ROS style)**.

---

# GOALS

1. Maintain stable velocity tracking for each wheel.
2. Keep robot driving straight when both wheels have equal velocity.
3. Remove complex and unstable correction logic.
4. Make firmware easier to tune and maintain.

---

# REQUIRED CONTROL ARCHITECTURE

Implement the following control structure:

Target velocities
→ Wheel velocity PID controllers
→ Optional small cross-wheel synchronization
→ PWM output

Control loop frequency: **50Hz**

---

# REMOVE COMPLETELY

Delete these systems from the firmware:

* straightIntegral
* straightBaseL / straightBaseR
* distance-based straight correction
* absolute encoder distance comparison
* Kd_straight
* stall detection reset logic
* complex virtual axle logic
* encoder baseline tracking

The robot **must not use accumulated encoder distance to correct straight motion**.

Straight correction must be **velocity based only**.

---

# KEEP THESE COMPONENTS

Keep the following components:

* Encoder quadrature interrupts
* Velocity calculation from ticks
* Feedforward gain
* PI velocity control for each wheel
* Deadband compensation
* Websocket / WiFi interface
* Odometry calculation

---

# NEW MOTOR CONTROL ALGORITHM

Implement this structure:

Step 1 — Compute velocity error

```
errL = targetLeftVel - vL_meas
errR = targetRightVel - vR_meas
```

Step 2 — Integrator

```
intLeft += errL * deltaT
intRight += errR * deltaT
```

Clamp integrator to prevent windup.

---

Step 3 — Feedforward + PI control

```
pwmLeft  = ffGain * targetLeftVel  + Kp * errL + Ki * intLeft
pwmRight = ffGain * targetRightVel + Kp * errR + Ki * intRight
```

---

# ADD SIMPLE STRAIGHT-LINE SYNCHRONIZATION

When robot is moving straight:

Condition:

```
abs(targetLeftVel - targetRightVel) < 0.1
```

Apply velocity synchronization:

```
syncError = vL_meas - vR_meas

pwmLeft  -= Kp_sync * syncError
pwmRight += Kp_sync * syncError
```

Use:

```
Kp_sync ≈ 2.0
```

This ensures both wheels maintain equal speed without using accumulated distance.

---

# DEADZONE HANDLING

Keep deadband offset logic but apply it only after PID:

```
if pwm > 0:
    pwm += minPWM
else if pwm < 0:
    pwm -= minPWM
```

Remove stall boost logic entirely.

---

# IMPORTANT REQUIREMENTS

1. Control loop must remain **50Hz**
2. Encoder ISR logic must stay unchanged
3. Odometry must remain compatible with current system
4. PWM output must still use `setMotor()`
5. Motor inversion flags must remain supported

---

# OPTIONAL IMPROVEMENT

Add configuration parameter:

```
float Kp_sync = 2.0;
```

Expose it in config messages so it can be tuned from the app.

---

# EXPECTED RESULT

After refactor:

* Robot drives straight without drift
* PID tuning becomes simple
* Code complexity is greatly reduced
* Firmware becomes easier to maintain

The final firmware should keep the same hardware interface but have **cleaner and more stable motor control logic**.
