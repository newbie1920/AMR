import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Default mock warehouse layout
const DEFAULT_ZONES = [
    { id: 'loading', x: 1, y: 1, width: 3, height: 3, type: 'loading', label: 'Loading', color: '#3498db' },
    { id: 'unloading', x: 11, y: 1, width: 3, height: 3, type: 'unloading', label: 'Unloading', color: '#e74c3c' },
    { id: 'storage1', x: 1, y: 6, width: 4, height: 4, type: 'storage', label: 'Storage 1', color: '#95a5a6' },
    { id: 'storage2', x: 6, y: 6, width: 4, height: 4, type: 'storage', label: 'Storage 2', color: '#95a5a6' },
    { id: 'storage3', x: 11, y: 6, width: 3, height: 4, type: 'storage', label: 'Storage 3', color: '#95a5a6' },
    { id: 'charging', x: 1, y: 12, width: 2, height: 2, type: 'charging', label: 'Charging', color: '#f39c12' },
];
const DEFAULT_DOCKS = [
    { id: 'dock1', x: 2, y: 2, theta: 0, robotId: 'AMR-1', label: 'Robot 1 Dock' },
    { id: 'dock2', x: 13, y: 2, theta: 90, robotId: 'AMR-2', label: 'Robot 2 Dock' },
    { id: 'dock3', x: 13, y: 13, theta: 180, robotId: 'AMR-3', label: 'Robot 3 Dock' },
];

/**
 * Chuyển point cloud SLAM thành vùng chướng ngại vật dạng grid.
 * Trả về danh sách obstacle zones để đưa vào PathPlanner.
 */
function convertSlamToObstacles(points, cellSize = 0.3) {
    if (!points || points.length === 0) return [];

    // Build occupancy grid
    const occupied = new Map(); // 'gx,gy' -> count
    for (const p of points) {
        const gx = Math.floor(p.x / cellSize);
        const gy = Math.floor(p.y / cellSize);
        const key = `${gx},${gy}`;
        occupied.set(key, (occupied.get(key) || 0) + 1);
    }

    // Remove low-density cells (noise)
    const MIN_HITS = 2;
    const obstacles = [];
    for (const [key, count] of occupied) {
        if (count < MIN_HITS) continue;
        const [gx, gy] = key.split(',').map(Number);
        obstacles.push({
            id: `slam_obs_${gx}_${gy}`,
            x: gx * cellSize,
            y: gy * cellSize,
            width: cellSize,
            height: cellSize,
            type: 'obstacle',
            label: 'Wall',
            color: '#6b7280',
        });
    }
    return obstacles;
}

/**
 * Tính bounding box từ point cloud
 */
function computeBounds(points) {
    if (!points || points.length === 0) return { width: 15, height: 15, offsetX: 0, offsetY: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const padding = 2; // 2m viền
    return {
        width: Math.ceil(maxX - minX + padding * 2),
        height: Math.ceil(maxY - minY + padding * 2),
        offsetX: minX - padding,
        offsetY: minY - padding,
    };
}

export const useMapStore = create(
    persist(
        (set, get) => ({
            width: 15, // meters
            height: 15, // meters
            resolution: 0.1, // meters per cell (for future grid use)

            // Current map source: 'mock' or 'slam'
            activeMapSource: 'mock',
            // ID of active SLAM map (null = mock warehouse)
            activeMapId: null,
            // Metadata of active SLAM map
            activeMapName: '',

            // Zones (Loading, Storage, etc.)
            zones: [...DEFAULT_ZONES],

            // Robot docks (fixed start positions)
            docks: [...DEFAULT_DOCKS],

            // Static obstacles (Walls, Shelves)
            obstacles: [],

            // ========== SLAM Map Storage ==========
            // Danh sách map SLAM đã lưu (metadata only, points lưu localStorage riêng)
            savedSlamMaps: [],

            /**
             * Lưu map SLAM mới hoặc cập nhật map đang mở
             * @param {string} name - Tên map
             * @param {Array} points - [{x, y}, ...]
             * @param {string|null} existingId - Nếu != null → ghi đè map cũ ("vẽ tiếp")
             * @returns {string} mapId
             */
            saveSlamMap: (name, points, existingId = null) => {
                if (!points || points.length === 0) {
                    console.warn('[MapStore] Không có điểm nào để lưu');
                    return null;
                }

                const mapId = existingId || `slam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const bounds = computeBounds(points);
                const compressedPoints = points.map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) }));

                // Lưu points vào localStorage riêng (tránh state quá lớn)
                localStorage.setItem(`slam_map_data_${mapId}`, JSON.stringify(compressedPoints));

                const mapEntry = {
                    id: mapId,
                    name: name || `Map ${new Date().toLocaleDateString('vi')}`,
                    timestamp: Date.now(),
                    pointCount: compressedPoints.length,
                    bounds,
                };

                set(state => {
                    const existing = state.savedSlamMaps.findIndex(m => m.id === mapId);
                    let newList;
                    if (existing >= 0) {
                        // Cập nhật map cũ
                        newList = [...state.savedSlamMaps];
                        newList[existing] = mapEntry;
                    } else {
                        newList = [...state.savedSlamMaps, mapEntry];
                    }
                    // Giữ tối đa 20 maps
                    while (newList.length > 20) {
                        const removeId = newList[0].id;
                        localStorage.removeItem(`slam_map_data_${removeId}`);
                        newList.shift();
                    }
                    return { savedSlamMaps: newList };
                });

                console.log(`[MapStore] 💾 Đã lưu map SLAM: "${mapEntry.name}" (${compressedPoints.length} pts)`);
                return mapId;
            },

            /**
             * Tải points của map SLAM từ localStorage
             */
            loadSlamMapPoints: (mapId) => {
                const data = localStorage.getItem(`slam_map_data_${mapId}`);
                return data ? JSON.parse(data) : [];
            },

            /**
             * Xóa map SLAM đã lưu
             */
            deleteSlamMap: (mapId) => {
                localStorage.removeItem(`slam_map_data_${mapId}`);
                set(state => ({
                    savedSlamMaps: state.savedSlamMaps.filter(m => m.id !== mapId),
                    // Nếu đang dùng map này → quay về mock
                    ...(state.activeMapId === mapId ? {
                        activeMapId: null,
                        activeMapSource: 'mock',
                        activeMapName: '',
                        width: 15,
                        height: 15,
                        zones: [...DEFAULT_ZONES],
                        docks: [...DEFAULT_DOCKS],
                        obstacles: [],
                    } : {})
                }));
                console.log(`[MapStore] 🗑️ Đã xóa map: ${mapId}`);
            },

            /**
             * Đổi tên map SLAM
             */
            renameSlamMap: (mapId, newName) => {
                set(state => ({
                    savedSlamMaps: state.savedSlamMaps.map(m =>
                        m.id === mapId ? { ...m, name: newName } : m
                    ),
                    ...(state.activeMapId === mapId ? { activeMapName: newName } : {})
                }));
            },

            /**
             * KÍCH HOẠT map SLAM: dùng nó như warehouse để giao nhiệm vụ.
             * Chuyển đổi points → obstacles, tính bounds → cập nhật dimensions.
             */
            activateSlamMap: (mapId) => {
                const mapMeta = get().savedSlamMaps.find(m => m.id === mapId);
                if (!mapMeta) {
                    console.warn(`[MapStore] Map ${mapId} không tồn tại`);
                    return false;
                }

                const points = get().loadSlamMapPoints(mapId);
                if (points.length === 0) {
                    console.warn(`[MapStore] Map ${mapId} không có dữ liệu`);
                    return false;
                }

                const bounds = computeBounds(points);
                const obstacles = convertSlamToObstacles(points);

                set({
                    activeMapSource: 'slam',
                    activeMapId: mapId,
                    activeMapName: mapMeta.name,
                    width: bounds.width,
                    height: bounds.height,
                    zones: [], // Map SLAM không có zones mặc định (user tự thêm sau)
                    docks: [],
                    obstacles,
                });

                console.log(`[MapStore] ✅ Đã kích hoạt map "${mapMeta.name}" (${bounds.width}×${bounds.height}m, ${obstacles.length} obstacles)`);
                return true;
            },

            /**
             * Quay về mock warehouse
             */
            activateMockMap: () => {
                set({
                    activeMapSource: 'mock',
                    activeMapId: null,
                    activeMapName: '',
                    width: 15,
                    height: 15,
                    zones: [...DEFAULT_ZONES],
                    docks: [...DEFAULT_DOCKS],
                    obstacles: [],
                });
                console.log('[MapStore] 🏭 Đã chuyển về map warehouse giả lập');
            },

            // ========== Original Actions ==========
            setDimensions: (width, height) => set({ width, height }),
            setZones: (zones) => set({ zones }),
            setDocks: (docks) => set({ docks }),

            addZone: (zone) => set(state => ({
                zones: [...state.zones, { ...zone, id: zone.id || `zone_${Date.now()}` }]
            })),

            updateZone: (id, updates) => set(state => ({
                zones: state.zones.map(z => z.id === id ? { ...z, ...updates } : z)
            })),

            removeZone: (id) => set(state => ({
                zones: state.zones.filter(z => z.id !== id)
            })),

            addObstacle: (obstacle) => set(state => ({
                obstacles: [...state.obstacles, { ...obstacle, id: obstacle.id || `obs_${Date.now()}` }]
            })),

            updateObstacle: (id, updates) => set(state => ({
                obstacles: state.obstacles.map(o => o.id === id ? { ...o, ...updates } : o)
            })),

            removeObstacle: (id) => set(state => ({
                obstacles: state.obstacles.filter(o => o.id !== id)
            })),

            // Check if coordinates are within map bounds
            isWithinBounds: (x, y) => {
                const state = get();
                return x >= 0 && x <= state.width && y >= 0 && y <= state.height;
            },

            // Get map boundaries
            getBounds: () => {
                const state = get();
                return {
                    minX: 0,
                    maxX: state.width,
                    minY: 0,
                    maxY: state.height,
                    width: state.width,
                    height: state.height
                };
            },

            // Clamp coordinates to bounds
            clampToBounds: (x, y) => {
                const state = get();
                return {
                    x: Math.max(0, Math.min(x, state.width)),
                    y: Math.max(0, Math.min(y, state.height))
                };
            },

            resetMap: () => set({
                width: 15,
                height: 15,
                activeMapSource: 'mock',
                activeMapId: null,
                activeMapName: '',
                zones: [...DEFAULT_ZONES],
                docks: [...DEFAULT_DOCKS],
                obstacles: [],
            })
        }),
        {
            name: 'amr-map-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                width: state.width,
                height: state.height,
                activeMapSource: state.activeMapSource,
                activeMapId: state.activeMapId,
                activeMapName: state.activeMapName,
                zones: state.zones,
                docks: state.docks,
                obstacles: state.obstacles,
                savedSlamMaps: state.savedSlamMaps,
            }),
        }
    )
);
