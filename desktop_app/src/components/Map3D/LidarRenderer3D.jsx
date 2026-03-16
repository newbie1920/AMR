import React, { useMemo } from 'react';
import * as THREE from 'three';

const LidarRenderer3D = ({ robot, showAccumulated = true }) => {
    const points = robot.lidarData || [];
    const accumulatedPoints = robot.accumulatedMap || [];
    const robotPose = robot.pose || { x: 0, y: 0, theta: 0 };

    // Real-time scan geometry
    const scanGeometry = useMemo(() => {
        if (points.length === 0) return null;
        const positions = new Float32Array(points.length * 3);
        points.forEach((point, i) => {
            const angleRad = (point.angle * Math.PI) / 180 + robotPose.theta;
            const lidarX_2D = robotPose.x + point.distance * Math.cos(angleRad);
            const lidarY_2D = robotPose.y + point.distance * Math.sin(angleRad);
            const x = lidarX_2D;
            const z = -lidarY_2D; // Map Y to -Z to match Robot3D
            positions[i * 3] = x;
            positions[i * 3 + 1] = 0.15;
            positions[i * 3 + 2] = z;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geo;
    }, [points, robotPose]);

    // Accumulated map geometry
    const mapGeometry = useMemo(() => {
        if (accumulatedPoints.length === 0) return null;
        const positions = new Float32Array(accumulatedPoints.length * 3);
        accumulatedPoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = 0.1;
            positions[i * 3 + 2] = -point.y || -point.z; // Handle both y and z fields for accumulated points
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geo;
    }, [accumulatedPoints]);

    return (
        <group>
            {/* Real-time scan (Bright Red) */}
            {scanGeometry && (
                <points geometry={scanGeometry}>
                    <pointsMaterial color="#ff3333" size={0.06} sizeAttenuation={true} transparent opacity={0.9} />
                </points>
            )}

            {/* Accumulated map (Faded Blue/Cyan) */}
            {showAccumulated && mapGeometry && (
                <points geometry={mapGeometry}>
                    <pointsMaterial color="#44ffaa" size={0.04} sizeAttenuation={true} transparent opacity={0.4} />
                </points>
            )}
        </group>
    );
};

export default LidarRenderer3D;
