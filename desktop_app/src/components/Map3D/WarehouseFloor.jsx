import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { useMapStore } from '../../stores/mapStore';

const DEFAULT_SIZE = 15;

// Zone component
const Zone = ({ zone }) => {
    const meshRef = useRef();
    const zoneHeight = 0.1;

    // Convert 2D coords to 3D (x stays x, y becomes -z)
    const posX = zone.x + zone.width / 2;
    const posZ = -(zone.y + zone.height / 2);

    return (
        <group position={[posX, zoneHeight / 2, posZ]}>
            {/* Zone base */}
            <RoundedBox
                ref={meshRef}
                args={[zone.width - 0.1, zoneHeight, zone.height - 0.1]}
                radius={0.05}
                smoothness={4}
            >
                <meshStandardMaterial
                    color={zone.color}
                    transparent
                    opacity={0.3}
                    roughness={0.8}
                />
            </RoundedBox>

            {/* Zone border */}
            <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(zone.width, zoneHeight, zone.height)]} />
                <lineBasicMaterial color={zone.color} linewidth={2} />
            </lineSegments>
        </group>
    );
};

// Grid component
const Grid = ({ size, showGrid }) => {
    if (!showGrid) return null;

    return (
        <group position={[size / 2, 0.01, -size / 2]}>
            <gridHelper
                args={[size, size, '#2a2a4a', '#1a1a3a']}
            />
        </group>
    );
};

// Floor plane
const FloorPlane = ({ size, onClick, isSelectingWaypoint }) => {
    const meshRef = useRef();

    const handleClick = (e) => {
        e.stopPropagation();
        if (onClick) {
            onClick(e.point);
        }
    };

    return (
        <mesh
            ref={meshRef}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[size / 2, 0, -size / 2]}
            receiveShadow
            onClick={handleClick}
        >
            <planeGeometry args={[size, size]} />
            <meshStandardMaterial
                color="#0f0f1f"
                roughness={0.9}
                metalness={0.1}
            />
        </mesh>
    );
};

// Warehouse boundary
const WarehouseBoundary = ({ size }) => {
    const points = useMemo(() => {
        return [
            new THREE.Vector3(0, 0.05, 0),
            new THREE.Vector3(size, 0.05, 0),
            new THREE.Vector3(size, 0.05, -size),
            new THREE.Vector3(0, 0.05, -size),
            new THREE.Vector3(0, 0.05, 0),
        ];
    }, [size]);

    const lineGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return geometry;
    }, [points]);

    return (
        <line>
            <bufferGeometry attach="geometry" {...lineGeometry} />
            <lineBasicMaterial color="#444" linewidth={3} />
        </line>
    );
};

// Compass
const Compass = ({ size }) => {
    return (
        <group position={[size - 1, 0.1, -1]}>
            {/* North arrow */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.2, 0.5, 8]} />
                <meshStandardMaterial color="#e74c3c" />
            </mesh>
        </group>
    );
};

const WarehouseFloor = ({ size: propSize, showGrid = true, onFloorClick, isSelectingWaypoint }) => {
    const { zones: storeZones, width, height } = useMapStore();
    const size = propSize || width || DEFAULT_SIZE;
    const sizeH = height || size; 

    return (
        <group>
            {/* Main floor */}
            <FloorPlane
                size={Math.max(width, height)}
                onClick={onFloorClick}
                isSelectingWaypoint={isSelectingWaypoint}
            />

            {/* Grid */}
            <Grid size={Math.max(width, height)} showGrid={showGrid} />

            {/* Boundary */}
            <WarehouseBoundaryW sizeW={width} sizeH={height} />

            {/* Zones */}
            {storeZones.map(zone => (
                <Zone key={zone.id} zone={zone} />
            ))}

            {/* Compass */}
            <Compass size={width} />
        </group>
    );
};

// Helper for dynamic boundary
const WarehouseBoundaryW = ({ sizeW, sizeH }) => {
    const points = useMemo(() => {
        return [
            new THREE.Vector3(0, 0.05, 0),
            new THREE.Vector3(sizeW, 0.05, 0),
            new THREE.Vector3(sizeW, 0.05, -sizeH),
            new THREE.Vector3(0, 0.05, -sizeH),
            new THREE.Vector3(0, 0.05, 0),
        ];
    }, [sizeW, sizeH]);

    const lineGeometry = useMemo(() => {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return geometry;
    }, [points]);

    return (
        <line>
            <bufferGeometry attach="geometry" {...lineGeometry} />
            <lineBasicMaterial color="#444" linewidth={3} />
        </line>
    );
};

export default WarehouseFloor;
