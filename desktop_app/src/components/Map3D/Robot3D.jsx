/**
 * Robot3D.jsx (Upgraded with URDF support)
 * =========================================
 * 3D Robot Visualization — thay thế RViz2 Robot Model display
 *
 * Enhancements over original:
 *   - URDF-based rendering (parsed from urdfParser.js)
 *   - Animated joints (wheels spin based on velocity)
 *   - Material colors from URDF
 *   - Fallback to classic render if no URDF loaded
 *   - LiDAR visualization ring
 */

import React, { useRef, useMemo, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cylinder, Sphere, Ring, Box, Html } from '@react-three/drei';
import * as THREE from 'three';
import { parseURDF, generateDefaultAMR_URDF } from '../../lib/urdfParser';

// ─── URDF Geometry → Three.js Mesh ──────────────────────────────────────────
const URDFGeometry = ({ geometry, material, origin }) => {
    if (!geometry) return null;

    // ROS (X, Y, Z) → Three (X, Z, Y) mapping
    // ROS Z is up, Three Y is up.
    const position = origin
        ? [origin.xyz.x, origin.xyz.z, origin.xyz.y]
        : [0, 0, 0];

    // ROS RPY → Three Euler (XYZ)
    // This is an approximation; ideally we use Quaternions
    const rotation = origin
        ? [origin.rpy.x, origin.rpy.z, origin.rpy.y]
        : [0, 0, 0];

    const color = material?.color
        ? new THREE.Color(material.color.r, material.color.g, material.color.b)
        : new THREE.Color(0.5, 0.5, 0.5);

    switch (geometry.type) {
        case 'box':
            // ROS Box size (x, y, z) → Three Box args (W, H, D)
            // Three Width = ROS X
            // Three Height = ROS Z (up)
            // Three Depth = ROS Y
            return (
                <Box args={[geometry.size.x, geometry.size.z, geometry.size.y]} position={position} rotation={rotation} castShadow>
                    <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
                </Box>
            );
        case 'cylinder':
            // Three Cylinder is Y-up by default.
            // ROS Cylinder is Z-up. 
            // We rotate Three Cylinder by PI/2 on X to make it lie on the ROS XY plane or stand on Z.
            // Actually, if ROS Z is up, then Three Y is already correct for Cylinder height.
            // BUT Cylinder origin in Three is center.
            return (
                <Cylinder args={[geometry.radius, geometry.radius, geometry.length, 16]} position={position} rotation={rotation} castShadow>
                    <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
                </Cylinder>
            );
        case 'sphere':
            return (
                <Sphere args={[geometry.radius, 16, 16]} position={position} rotation={rotation} castShadow>
                    <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
                </Sphere>
            );
        default:
            return null;
    }
};

// ─── URDF Link Tree → Recursive Three.js groups ─────────────────────────────
const URDFNode = ({ node, jointRefs, velocity }) => {
    if (!node) return null;

    return (
        <group>
            {/* Render this link's visual */}
            {node.visual && (
                <URDFGeometry
                    geometry={node.visual.geometry}
                    material={node.visual.material}
                    origin={node.visual.origin}
                />
            )}

            {/* Render children (joint → child link) */}
            {node.children?.map(child => {
                const jointOrigin = child.joint.origin;
                // ROS (X, Y, Z) → Three (X, Z, Y) mapping
                const pos = jointOrigin ? [jointOrigin.xyz.x, jointOrigin.xyz.z, jointOrigin.xyz.y] : [0, 0, 0];
                const rot = jointOrigin ? [jointOrigin.rpy.x, jointOrigin.rpy.z, jointOrigin.rpy.y] : [0, 0, 0];

                return (
                    <group
                        key={child.joint.name}
                        position={pos}
                        rotation={rot}
                        ref={ref => {
                            if (ref && jointRefs) jointRefs.current[child.joint.name] = ref;
                        }}
                    >
                        <URDFNode
                            node={child.link}
                            jointRefs={jointRefs}
                            velocity={velocity}
                        />
                    </group>
                );
            })}
        </group>
    );
};

// ─── Main Robot3D Component ──────────────────────────────────────────────────
const Robot3D = ({ robot, isSelected, onClick, hideInFirstPerson = false, urdfXml = null }) => {
    const groupRef = useRef();
    const bodyRef = useRef();
    const leftWheelRef = useRef();
    const rightWheelRef = useRef();
    const selectionRingRef = useRef();
    const glowRef = useRef();
    const jointRefs = useRef({});

    // Parse URDF (memoized)
    const parsedURDF = useMemo(() => {
        try {
            const xml = urdfXml || generateDefaultAMR_URDF();
            return parseURDF(xml);
        } catch (err) {
            console.warn('[Robot3D] URDF parse failed, using fallback:', err.message);
            return null;
        }
    }, [urdfXml]);

    const useURDF = parsedURDF && parsedURDF.tree;

    // Robot dimensions (fallback)
    const BODY_RADIUS = 0.25;
    const BODY_HEIGHT = 0.15;
    const WHEEL_RADIUS = 0.06;
    const WHEEL_WIDTH = 0.03;

    // Get status color
    const getStatusColor = () => {
        if (!robot.connected) return '#666666';
        switch (robot.status) {
            case 'moving': return '#3b82f6';
            case 'working': return '#f59e0b';
            case 'error': return '#ef4444';
            default: return '#10b981';
        }
    };

    // Animation loop
    useFrame((state, delta) => {
        if (!groupRef.current || !robot.pose) return;

        // Smooth interpolation to target position
        const pose = robot.pose;
        if (!pose || isNaN(pose.x) || isNaN(pose.y)) return;

        const current = groupRef.current.position;
        const lerpFactor = 0.1;

        current.x = THREE.MathUtils.lerp(current.x, pose.x, lerpFactor);
        current.z = THREE.MathUtils.lerp(current.z, pose.y, lerpFactor);

        // Rotate robot to face direction (pose.theta is in radians)
        if (groupRef.current && !isNaN(pose.theta)) {
            // pose.theta is already corrected in robotStore.js (firmware negation undone)
            // Three.js Y-rotation matches standard math convention here
            const targetRotation = pose.theta;
            groupRef.current.rotation.y = THREE.MathUtils.lerp(
                groupRef.current.rotation.y,
                targetRotation,
                0.2
            );
        }

        // Animate wheels (URDF joints or fallback)
        const linear = robot.velocity?.linear || 0;
        const angular = robot.velocity?.angular || 0;
        const separation = 0.17; // Should match firmware
        const radius = 0.033;

        const wheelSpeedL = ((linear - angular * separation / 2) / radius) * delta;
        const wheelSpeedR = ((linear + angular * separation / 2) / radius) * delta;

        if (useURDF) {
            // Animate URDF wheel joints
            const jointPairs = [
                { name: 'left_wheel_joint', speed: wheelSpeedL },
                { name: 'right_wheel_joint', speed: wheelSpeedR }
            ];
            for (const pair of jointPairs) {
                const jRef = jointRefs.current[pair.name];
                if (jRef) {
                    jRef.rotation.z += pair.speed;
                }
            }
        } else {
            // Fallback wheel animation
            if (leftWheelRef.current && rightWheelRef.current) {
                leftWheelRef.current.rotation.x += wheelSpeedL;
                rightWheelRef.current.rotation.x += wheelSpeedR;
            }
        }

        // Animate selection ring
        if (selectionRingRef.current && isSelected) {
            selectionRingRef.current.rotation.z += delta * 2;
        }

        // Pulse glow effect
        if (glowRef.current) {
            const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.2 + 0.8;
            glowRef.current.material.opacity = robot.connected ? pulse * 0.5 : 0.1;
        }
    });

    // Initial position (captured once at mount to avoid snapping during re-renders)
    const initialPos = useRef(robot.pose || { x: 7.5, y: 7.5 }).current;

    return (
        <group
            ref={groupRef}
            position={[initialPos.x, useURDF ? 0 : (BODY_HEIGHT / 2 + WHEEL_RADIUS), initialPos.y]}
            onClick={(e) => {
                e.stopPropagation();
                onClick?.();
            }}
            visible={!hideInFirstPerson}
        >
            {/* Selection ring */}
            {isSelected && (
                <Ring
                    ref={selectionRingRef}
                    args={[BODY_RADIUS + 0.1, BODY_RADIUS + 0.15, 32]}
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[0, -BODY_HEIGHT / 2 + 0.02, 0]}
                >
                    <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
                </Ring>
            )}

            {/* Robot Label */}
            <Html
                position={[0, BODY_HEIGHT + 0.3, 0]}
                center
                distanceFactor={8}
                style={{
                    color: '#fff',
                    background: 'rgba(0,0,0,0.6)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    borderLeft: `3px solid ${robot.connected ? (robot.color || '#00d4ff') : '#666'}`
                }}
            >
                {robot.name || 'AMR'}
            </Html>

            {/* Nose (Orientation indicator for fallback) */}
            {!useURDF && (
                <Box args={[0.1, 0.05, 0.05]} position={[BODY_RADIUS, 0, 0]}>
                    <meshStandardMaterial color="#ffffff" />
                </Box>
            )}

            {/* Glow effect */}
            <Sphere ref={glowRef} args={[BODY_RADIUS * 2, 16, 16]}>
                <meshBasicMaterial
                    color={robot.color || '#00d4ff'}
                    transparent
                    opacity={0.3}
                    side={THREE.BackSide}
                />
            </Sphere>

            {/* ──── URDF-based rendering ──── */}
            {useURDF ? (
                <group rotation={[0, 0, 0]}>
                    <URDFNode
                        node={parsedURDF.tree}
                        jointRefs={jointRefs}
                        velocity={robot.velocity}
                    />
                </group>
            ) : (
                /* ──── Fallback classic rendering ──── */
                <>
                    {/* Robot body */}
                    <Cylinder
                        ref={bodyRef}
                        args={[BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT, 32]}
                        castShadow
                    >
                        <meshStandardMaterial
                            color={robot.connected ? (robot.color || '#00d4ff') : '#444'}
                            roughness={0.3}
                            metalness={0.7}
                        />
                    </Cylinder>

                    {/* Top plate */}
                    <Cylinder
                        args={[BODY_RADIUS * 0.9, BODY_RADIUS * 0.9, 0.02, 32]}
                        position={[0, BODY_HEIGHT / 2 + 0.01, 0]}
                    >
                        <meshStandardMaterial color="#1a1a2e" roughness={0.5} metalness={0.5} />
                    </Cylinder>

                    {/* Direction arrow */}
                    <group position={[BODY_RADIUS * 0.6, BODY_HEIGHT / 2 + 0.02, 0]} rotation={[0, 0, -Math.PI / 2]}>
                        <mesh>
                            <coneGeometry args={[0.04, 0.1, 8]} />
                            <meshStandardMaterial color="#ffffff" />
                        </mesh>
                    </group>

                    {/* Left wheel */}
                    <group position={[0, -BODY_HEIGHT / 2 + WHEEL_RADIUS, -BODY_RADIUS - WHEEL_WIDTH / 2]}>
                        <Cylinder
                            ref={leftWheelRef}
                            args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 16]}
                            rotation={[Math.PI / 2, 0, 0]}
                            castShadow
                        >
                            <meshStandardMaterial color="#333" roughness={0.8} />
                        </Cylinder>
                    </group>

                    {/* Right wheel */}
                    <group position={[0, -BODY_HEIGHT / 2 + WHEEL_RADIUS, BODY_RADIUS + WHEEL_WIDTH / 2]}>
                        <Cylinder
                            ref={rightWheelRef}
                            args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 16]}
                            rotation={[Math.PI / 2, 0, 0]}
                            castShadow
                        >
                            <meshStandardMaterial color="#333" roughness={0.8} />
                        </Cylinder>
                    </group>
                </>
            )}

            {/* Status LED (always shown) */}
            <Sphere
                args={[0.03, 16, 16]}
                position={[0, BODY_HEIGHT / 2 + 0.04, 0]}
            >
                <meshBasicMaterial color={getStatusColor()} />
            </Sphere>
        </group>
    );
};

export default Robot3D;
