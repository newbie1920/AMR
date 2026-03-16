import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Sphere } from '@react-three/drei';
import * as THREE from 'three';

const PathRenderer3D = ({ robot, mission }) => {
    const pathRef = useRef();
    const PATH_HEIGHT = 0.05;

    // Create traveled path points
    const traveledPathPoints = useMemo(() => {
        if (!robot.traveledPath || robot.traveledPath.length < 2) return [];

        return robot.traveledPath.map(point => [
            point.x,
            PATH_HEIGHT,
            -point.y // Map Y to -Z to match Robot3D
        ]);
    }, [robot.traveledPath]);

    // Create planned path points from mission
    const plannedPathPoints = useMemo(() => {
        if (!mission?.plannedPath || mission.plannedPath.length < 2) return [];

        return mission.plannedPath.map(point => [
            point.x,
            PATH_HEIGHT + 0.02,
            -point.y // Map Y to -Z to match Robot3D
        ]);
    }, [mission?.plannedPath]);

    // Waypoint markers
    const waypointMarkers = useMemo(() => {
        if (!mission?.waypoints) return [];
        return mission.waypoints;
    }, [mission?.waypoints]);

    // Get waypoint color based on action
    const getWaypointColor = (action) => {
        switch (action) {
            case 'load': return '#3498db';
            case 'unload': return '#e74c3c';
            case 'wait': return '#f39c12';
            default: return '#10b981';
        }
    };

    return (
        <group>
            {/* Traveled path - solid gradient line */}
            {traveledPathPoints.length >= 2 && (
                <Line
                    points={traveledPathPoints}
                    color={robot.color || '#00d4ff'}
                    lineWidth={3}
                    transparent
                    opacity={0.6}
                />
            )}

            {/* Planned path - dashed line */}
            {plannedPathPoints.length >= 2 && (
                <Line
                    points={plannedPathPoints}
                    color="#ffffff"
                    lineWidth={2}
                    dashed
                    dashSize={0.2}
                    gapSize={0.1}
                    transparent
                    opacity={0.5}
                />
            )}

            {/* Waypoint markers */}
            {waypointMarkers.map((waypoint, index) => {
                const isCompleted = mission && index < mission.currentWaypointIndex;
                const isCurrent = mission && index === mission.currentWaypointIndex;
                const color = getWaypointColor(waypoint.action);

                return (
                    <group
                        key={`waypoint-${index}`}
                        position={[waypoint.x, PATH_HEIGHT + 0.1, -waypoint.y]}
                    >
                        {/* Waypoint base */}
                        <Sphere args={[0.1, 16, 16]}>
                            <meshStandardMaterial
                                color={isCompleted ? '#10b981' : color}
                                transparent
                                opacity={isCompleted ? 0.5 : 1}
                            />
                        </Sphere>

                        {/* Current waypoint indicator */}
                        {isCurrent && (
                            <Sphere args={[0.15, 16, 16]}>
                                <meshBasicMaterial
                                    color={color}
                                    transparent
                                    opacity={0.3}
                                />
                            </Sphere>
                        )}

                        {/* Waypoint number */}
                        <mesh position={[0, 0.2, 0]}>
                            <sphereGeometry args={[0.05, 8, 8]} />
                            <meshBasicMaterial color="#ffffff" />
                        </mesh>
                    </group>
                );
            })}

            {/* Connection lines between waypoints */}
            {waypointMarkers.length >= 2 && (
                <Line
                    points={waypointMarkers.map(wp => [wp.x, PATH_HEIGHT + 0.1, -wp.y])}
                    color="#ffffff"
                    lineWidth={1}
                    transparent
                    opacity={0.3}
                    dashed
                    dashSize={0.1}
                    gapSize={0.05}
                />
            )}
        </group>
    );
};

export default PathRenderer3D;
