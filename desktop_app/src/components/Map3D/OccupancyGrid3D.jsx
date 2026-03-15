/**
 * OccupancyGrid3D.jsx
 * ==================
 * Renders the SLAM/Costmap as a 3D Plane using a dynamic texture.
 * Tương đương rviz "Map" or "Costmap" display.
 */

import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

const OccupancyGrid3D = ({ grid, opacity = 1.0, color = "#ffffff", yOffset = 0.01 }) => {
    const meshRef = useRef();
    const textureRef = useRef();

    // Create texture from grid data
    const texture = useMemo(() => {
        if (!grid || !grid.data) return null;

        const { width, height, data } = grid;
        const size = width * height;
        const rgbaData = new Uint8Array(size * 4);

        for (let i = 0; i < size; i++) {
            const val = data[i];
            const i4 = i * 4;

            if (val === -1) { // Unknown
                rgbaData[i4] = 100;
                rgbaData[i4 + 1] = 100;
                rgbaData[i4 + 2] = 120;
                rgbaData[i4 + 3] = 0; // Transparent unknown
            } else if (val === 100) { // Occupied
                rgbaData[i4] = 0;
                rgbaData[i4 + 1] = 0;
                rgbaData[i4 + 2] = 0;
                rgbaData[i4 + 3] = 255;
            } else if (val === 0) { // Free
                rgbaData[i4] = 255;
                rgbaData[i4 + 1] = 255;
                rgbaData[i4 + 2] = 255;
                rgbaData[i4 + 3] = 255;
            } else { // Cost values (1-99)
                rgbaData[i4] = 255;
                rgbaData[i4 + 1] = 255 - val * 2;
                rgbaData[i4 + 2] = 255 - val * 2;
                rgbaData[i4 + 3] = 200;
            }
        }

        const tex = new THREE.DataTexture(rgbaData, width, height, THREE.RGBAFormat);
        tex.needsUpdate = true;
        return tex;
    }, [grid]);

    useEffect(() => {
        if (texture) texture.needsUpdate = true;
    }, [grid]);

    if (!grid || !texture) return null;

    const { width, height, resolution, origin } = grid;
    const worldWidth = width * resolution;
    const worldHeight = height * resolution;

    return (
        <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[
                origin.x + worldWidth / 2,
                yOffset,
                origin.y + worldHeight / 2
            ]}
            ref={meshRef}
        >
            <planeGeometry args={[worldWidth, worldHeight]} />
            <meshBasicMaterial
                map={texture}
                color={color}
                transparent={true}
                opacity={opacity}
                side={THREE.DoubleSide}
                depthWrite={false}
            />
        </mesh>
    );
};

export default OccupancyGrid3D;
