/**
 * testSyncService.js
 * =================
 * Test script for syncService map merging logic.
 */

import syncService from './syncService.js';

function createMockMap(width, height, value) {
    return {
        width,
        height,
        resolution: 0.05,
        origin: { x: 0, y: 0 },
        data: new Int8Array(width * height).fill(value)
    };
}

async function runTest() {
    console.log('[Test] Starting syncService merge test...');

    // 1. Robot 1 pushes a map (all free space)
    const map1 = createMockMap(10, 10, 0);
    map1.data[55] = 100; // One obstacle
    await syncService.pushMap('robot_1', map1);

    let currentGlobal = syncService.getGlobalMap();
    console.assert(currentGlobal.data[55] === 100, 'Robot 1 obstacle should be present');
    console.assert(currentGlobal.contributors.includes('robot_1'), 'Robot 1 should be contributor');

    // 2. Robot 2 pushes another map (overlapping)
    const map2 = createMockMap(10, 10, -1); // Mostly unknown
    map2.data[56] = 100; // Different obstacle
    map2.data[55] = 0;   // Robot 2 thinks it's free? (Conflict)
    await syncService.pushMap('robot_2', map2);

    currentGlobal = syncService.getGlobalMap();
    console.assert(currentGlobal.data[56] === 100, 'Robot 2 obstacle should be present');
    // Max-pooling logic: map1 fixed 55=100, map2 says 55=0. 100 > 0, so 100 should remain.
    console.assert(currentGlobal.data[55] === 100, 'Lethal obstacle should persist over free space (Safe Merge)');
    console.assert(currentGlobal.contributors.includes('robot_2'), 'Robot 2 should be contributor');

    console.log('[Test] syncService merge test PASSED');
}

runTest().catch(console.error);
