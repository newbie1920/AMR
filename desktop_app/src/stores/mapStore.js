import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const useMapStore = create(
    persist(
        (set, get) => ({
            width: 15, // meters
            height: 15, // meters
            resolution: 0.1, // meters per cell (for future grid use)

            // Zones (Loading, Storage, etc.)
            zones: [
                { id: 'loading', x: 1, y: 1, width: 3, height: 3, type: 'loading', label: 'Loading', color: '#3498db' },
                { id: 'unloading', x: 11, y: 1, width: 3, height: 3, type: 'unloading', label: 'Unloading', color: '#e74c3c' },
                { id: 'storage1', x: 1, y: 6, width: 4, height: 4, type: 'storage', label: 'Storage 1', color: '#95a5a6' },
                { id: 'storage2', x: 6, y: 6, width: 4, height: 4, type: 'storage', label: 'Storage 2', color: '#95a5a6' },
                { id: 'storage3', x: 11, y: 6, width: 3, height: 4, type: 'storage', label: 'Storage 3', color: '#95a5a6' },
                { id: 'charging', x: 1, y: 12, width: 2, height: 2, type: 'charging', label: 'Charging', color: '#f39c12' },
            ],

            // Robot docks (fixed start positions)
            docks: [
                { id: 'dock1', x: 2, y: 2, theta: 0, robotId: 'AMR-1', label: 'Robot 1 Dock' },
                { id: 'dock2', x: 13, y: 2, theta: 90, robotId: 'AMR-2', label: 'Robot 2 Dock' },
                { id: 'dock3', x: 13, y: 13, theta: 180, robotId: 'AMR-3', label: 'Robot 3 Dock' },
            ],

            // Static obstacles (Walls, Shelves)
            obstacles: [],

            // Actions
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

            resetMap: () => set({
                width: 15,
                height: 15,
                zones: [],
                obstacles: [],
                docks: []
            })
        }),
        {
            name: 'amr-map-storage',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
