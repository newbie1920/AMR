import React, { useMemo } from 'react';
import * as THREE from 'three';

const LidarRenderer3D = ({ robot, showAccumulated = true }) => {
    const points = robot.lidarData || [];
    const accumulatedPoints = robot.accumulatedMap || [];
    const robotPose = robot.pose || { x: 0, y: 0, theta: 0 };

    // Real-time scan geometry (red dots showing current LiDAR sweep)
    const scanGeometry = useMemo(() => {
        if (points.length === 0) return null;
        // Filter valid points
        const validPoints = points.filter(p => p.distance > 0.05 && p.distance < 6.0);
        if (validPoints.length === 0) return null;
        
        const positions = new Float32Array(validPoints.length * 3);
        validPoints.forEach((point, i) => {
            const angleRad = (point.angle * Math.PI) / 180 + robotPose.theta;
            const wx = robotPose.x + point.distance * Math.cos(angleRad);
            const wy = robotPose.y + point.distance * Math.sin(angleRad);
            positions[i * 3] = wx;
            positions[i * 3 + 1] = 0.15; // Slightly above ground
            positions[i * 3 + 2] = -wy;  // Map Y to -Z (Three.js coord)
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geo;
    }, [points, robotPose]);

    // Accumulated map geometry (green dots showing built map)
    const mapGeometry = useMemo(() => {
        if (accumulatedPoints.length === 0) return null;
        const positions = new Float32Array(accumulatedPoints.length * 3);
        accumulatedPoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = 0.08;
            positions[i * 3 + 2] = -(point.y ?? point.z ?? 0);
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geo;
    }, [accumulatedPoints, accumulatedPoints.length]);

    return (
        <group>
            {/* Real-time scan (Bright Red) */}
            {scanGeometry && (
                <points geometry={scanGeometry}>
                    <pointsMaterial color="#ff4444" size={0.08} sizeAttenuation={true} transparent opacity={0.9} />
                </points>
            )}

            {/* Accumulated map (Green — the actual built map) */}
            {showAccumulated && mapGeometry && (
                <points geometry={mapGeometry}>
                    <pointsMaterial color="#4ade80" size={0.05} sizeAttenuation={true} transparent opacity={0.6} />
                </points>
            )}
        </group>
    );
};

export default LidarRenderer3D;
