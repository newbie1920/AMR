import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useMapStore } from './mapStore';
import { useRobotStore } from './robotStore';

/**
 * Path Planning & Task Management Store
 * Handles mission planning, pathfinding, collision avoidance, and velocity optimization
 */

// A* Pathfinding Algorithm
class PathPlanner {
    constructor(warehouseSize = 50, gridResolution = 0.5) {
        this.size = warehouseSize;
        this.resolution = gridResolution;
        this.grid = this.createGrid();
    }

    createGrid() {
        const cols = Math.floor(this.size / this.resolution);
        const rows = Math.floor(this.size / this.resolution);
        const grid = [];

        for (let y = 0; y < rows; y++) {
            grid[y] = [];
            for (let x = 0; x < cols; x++) {
                grid[y][x] = { x, y, walkable: true, cost: 1 };
            }
        }
        return grid;
    }

    setObstacles(zones) {
        // Mark warehouse zones as obstacles or high-cost areas
        zones.forEach(zone => {
            const start = this.worldToGrid(zone.x, zone.y);
            const end = this.worldToGrid(zone.x + zone.width, zone.y + zone.height);

            for (let y = start.y; y <= end.y; y++) {
                for (let x = start.x; x <= end.x; x++) {
                    if (this.grid[y] && this.grid[y][x]) {
                        if (zone.type === 'obstacle') {
                            this.grid[y][x].walkable = false;
                        } else {
                            this.grid[y][x].cost = zone.cost || 5;
                        }
                    }
                }
            }
        });
    }

    worldToGrid(x, y) {
        const cols = Math.floor(this.size / this.resolution);
        const rows = Math.floor(this.size / this.resolution);
        let gx = Math.floor((x + this.size / 2) / this.resolution);
        let gy = Math.floor((y + this.size / 2) / this.resolution);

        // Clamp to avoid out-of-bounds at the very edges
        gx = Math.max(0, Math.min(gx, cols - 1));
        gy = Math.max(0, Math.min(gy, rows - 1));

        return { x: gx, y: gy };
    }

    gridToWorld(gx, gy) {
        return {
            x: gx * this.resolution - this.size / 2 + this.resolution / 2,
            y: gy * this.resolution - this.size / 2 + this.resolution / 2
        };
    }

    heuristic(a, b) {
        // Manhattan distance
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    getNeighbors(node) {
        const neighbors = [];
        const directions = [
            { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, // Cardinal
            { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 } // Diagonal
        ];

        directions.forEach(dir => {
            const nx = node.x + dir.x;
            const ny = node.y + dir.y;

            if (this.grid[ny] && this.grid[ny][nx] && this.grid[ny][nx].walkable) {
                neighbors.push(this.grid[ny][nx]);
            }
        });

        return neighbors;
    }

    findPath(start, goal, occupiedPositions = []) {
        const tempBlocked = [];
        const startGrid = this.worldToGrid(start.x, start.y);
        const goalGrid = this.worldToGrid(goal.x, goal.y);

        // Temporarily mark occupied positions (ensure we don't double-block or block start/goal)
        occupiedPositions.forEach(pos => {
            const grid = this.worldToGrid(pos.x, pos.y);

            // Don't block if it's the start or goal position
            if (grid.x === startGrid.x && grid.y === startGrid.y) return;
            if (grid.x === goalGrid.x && grid.y === goalGrid.y) return;

            // Check if within bounds
            if (this.grid[grid.y] && this.grid[grid.y][grid.x]) {
                const cell = this.grid[grid.y][grid.x];
                // Only block if not already blocked by a robot in this pass
                if (!tempBlocked.some(b => b.x === grid.x && b.y === grid.y)) {
                    tempBlocked.push({ x: grid.x, y: grid.y, original: cell.walkable });
                    cell.walkable = false;
                }
            }
        });

        const startNode = this.grid[startGrid.y] ? this.grid[startGrid.y][startGrid.x] : null;
        const goalNode = this.grid[goalGrid.y] ? this.grid[goalGrid.y][goalGrid.x] : null;

        if (!startNode || !goalNode) {
            console.warn("PathPlanner: Start or Goal outside of bounds", {
                start: { world: start, grid: startGrid },
                goal: { world: goal, grid: goalGrid },
                gridDims: { rows: this.grid.length, cols: this.grid[0]?.length }
            });
            return null;
        }

        if (!startNode.walkable || !goalNode.walkable) {
            console.warn("PathPlanner: Start or Goal is not walkable", {
                start: { world: start, grid: startGrid, walkable: startNode.walkable },
                goal: { world: goal, grid: goalGrid, walkable: goalNode.walkable },
                tempBlockedCount: tempBlocked.length
            });

            // Restore blocked positions before returning
            tempBlocked.forEach(b => {
                if (this.grid[b.y] && this.grid[b.y][b.x]) {
                    this.grid[b.y][b.x].walkable = b.original;
                }
            });
            return null;
        }

        const openSet = [startNode];
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();

        gScore.set(startNode, 0);
        fScore.set(startNode, this.heuristic(startGrid, goalGrid));

        while (openSet.length > 0) {
            // Get node with lowest fScore
            openSet.sort((a, b) => (fScore.get(a) || Infinity) - (fScore.get(b) || Infinity));
            const current = openSet.shift();

            if (current === goalNode) {
                // Reconstruct path
                const path = [];
                let temp = current;
                while (temp) {
                    const worldPos = this.gridToWorld(temp.x, temp.y);
                    path.unshift(worldPos);
                    temp = cameFrom.get(temp);
                }

                // Restore blocked positions
                tempBlocked.forEach(b => {
                    this.grid[b.y][b.x].walkable = b.original;
                });

                return this.smoothPath(path);
            }

            closedSet.add(current);

            this.getNeighbors(current).forEach(neighbor => {
                if (closedSet.has(neighbor)) return;

                const tentativeGScore = (gScore.get(current) || Infinity) + neighbor.cost;

                if (!openSet.includes(neighbor)) {
                    openSet.push(neighbor);
                } else if (tentativeGScore >= (gScore.get(neighbor) || Infinity)) {
                    return;
                }

                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeGScore);
                fScore.set(neighbor, tentativeGScore + this.heuristic(neighbor, goalNode));
            });
        }

        // Restore blocked positions
        tempBlocked.forEach(b => {
            if (this.grid[b.y] && this.grid[b.y][b.x]) {
                this.grid[b.y][b.x].walkable = b.original;
            }
        });

        console.warn("PathPlanner: A* search exhausted - no path exists", {
            start: startGrid,
            goal: goalGrid,
            blockedCount: tempBlocked.length,
            openSetSize: openSet.length,
            closedSetSize: closedSet.size
        });

        return null; // No path found
    }

    smoothPath(path) {
        if (path.length <= 2) return path;

        const smoothed = [path[0]];
        let current = 0;

        while (current < path.length - 1) {
            let farthest = current + 1;

            for (let i = current + 2; i < path.length; i++) {
                if (this.hasLineOfSight(path[current], path[i])) {
                    farthest = i;
                }
            }

            smoothed.push(path[farthest]);
            current = farthest;
        }

        return smoothed;
    }

    hasLineOfSight(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const steps = Math.max(Math.abs(dx), Math.abs(dy)) / this.resolution;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = a.x + dx * t;
            const y = a.y + dy * t;
            const grid = this.worldToGrid(x, y);

            if (!this.grid[grid.y] || !this.grid[grid.y][grid.x] || !this.grid[grid.y][grid.x].walkable) {
                return false;
            }
        }

        return true;
    }

    calculatePathLength(path) {
        let length = 0;
        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i - 1].x;
            const dy = path[i].y - path[i - 1].y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
        return length;
    }
}

// Mission Task Structure
export const createMission = (name, waypoints, targetTime = null) => ({
    id: `mission_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    waypoints, // Array of {x, y, action, duration}
    targetTime, // Target completion time in seconds
    status: 'pending', // pending, assigned, active, completed, failed
    assignedRobotId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    completedAt: null,
    currentWaypointIndex: 0,
    plannedPath: [],
    estimatedTime: 0,
    optimizedVelocity: 0.3,
    scheduledAt: null, // Timestamp for scheduled start
});

const deriveWaypointTheta = (current, next, fallbackTheta = 0) => {
    if (typeof current?.theta === 'number' && Number.isFinite(current.theta)) {
        const theta = current.theta;
        const looksLikeDegrees = current?.thetaEnabled || Math.abs(theta) > (Math.PI * 2 + 0.001);
        return looksLikeDegrees ? (theta * Math.PI / 180) : theta;
    }

    if (next && Number.isFinite(next.x) && Number.isFinite(next.y)) {
        const dx = next.x - current.x;
        const dy = next.y - current.y;
        if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
            return Math.atan2(dy, dx);
        }
    }

    return fallbackTheta;
};

const normalizeMissionWaypoints = (waypoints, fallbackTheta = 0) => {
    return (waypoints || []).map((wp, index, arr) => ({
        ...wp,
        task: wp.task ?? wp.action ?? null,
        theta: deriveWaypointTheta(wp, arr[index + 1], fallbackTheta),
    }));
};

export const useMissionStore = create(
    persist(
        (set, get) => ({
            missions: [],
            pathPlanner: new PathPlanner(100, 0.5),
            missionUpdateInterval: null,
            isAssignmentPaused: false,

            // Toggle assignment paused state
            toggleAssignmentPaused: () => {
                const current = get().isAssignmentPaused;
                const next = !current;
                set({ isAssignmentPaused: next });
                
                console.log(`[MissionStore] Assignment ${next ? 'PAUSED' : 'RESUMED'}`);

                // Pause/Resume all active missions
                const activeMissions = get().missions.filter(m => m.status === 'active');
                activeMissions.forEach(m => {
                    if (m.assignedRobotId) {
                        if (next) { // Next state is PAUSED
                            useRobotStore.getState().pauseMission(m.assignedRobotId);
                        } else { // Next state is RESUMED
                            useRobotStore.getState().resumeMission(m.assignedRobotId);
                        }
                    }
                });
            },

            // Add a new mission
            addMission: (name, waypoints, targetTime = null, scheduledAt = null) => {
                const mission = createMission(name, waypoints, targetTime);
                if (scheduledAt) mission.scheduledAt = scheduledAt;

                set(state => ({
                    missions: [...state.missions, mission]
                }));
                return mission.id;
            },

            // Update existing mission
            updateMission: (missionId, updates) => {
                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId ? { ...m, ...updates, updatedAt: Date.now() } : m
                    )
                }));
            },

            // Assign mission to robot and plan path
            assignMission: (missionId, robotId, robots) => {
                if (get().isAssignmentPaused) {
                    alert('Hệ thống đang tạm dừng giao nhiệm vụ!');
                    return false;
                }
                const mission = get().missions.find(m => m.id === missionId);
                const robot = robots.find(r => r.id === robotId);

                // Sync map data
                const mapStore = useMapStore.getState();
                const pathPlanner = get().pathPlanner;

                if (!mission || !robot) return false;

                // Check if all waypoints are within map bounds
                const bounds = mapStore.getBounds();
                const outOfBoundsWaypoints = mission.waypoints.filter(wp => !mapStore.isWithinBounds(wp.x, wp.y));
                
                if (outOfBoundsWaypoints.length > 0) {
                    const msg = `⚠️ Phát hiện ${outOfBoundsWaypoints.length} điểm nằm ngoài bản đồ (${bounds.width}×${bounds.height}m):\n` +
                        outOfBoundsWaypoints.map((wp, i) => `  • (${wp.x.toFixed(1)}, ${wp.y.toFixed(1)})`).join('\n') +
                        `\n\nHãy chỉnh sửa many ụm vụ trước khi giao.`;
                    alert(msg);
                    console.warn('Mission has out-of-bounds waypoints:', outOfBoundsWaypoints);
                    return false;
                }

                // Calculate required grid size based on robot pose and all waypoints
                const waypointsMax = mission.waypoints.reduce((acc, w) =>
                    Math.max(acc, Math.abs(w.x), Math.abs(w.y)), 0);
                const robotMax = Math.max(Math.abs(robot.pose.x), Math.abs(robot.pose.y));
                const requiredRadius = Math.max(waypointsMax, robotMax) + 10; // 10m buffer
                const requiredSize = requiredRadius * 2;

                // Reset grid costs/walkability first, and ENSURE SIZE IS SUFFICIENT
                if (pathPlanner.size < requiredSize) {
                    console.log(`PathPlanner: Upgrading grid size to ${Math.ceil(requiredSize)}m (±${Math.ceil(requiredRadius)}m range)...`);
                    pathPlanner.size = Math.ceil(requiredSize);
                    pathPlanner.grid = pathPlanner.createGrid();
                }

                pathPlanner.grid.flat().forEach(cell => {
                    if (cell) {
                        cell.walkable = true;
                        cell.cost = 1;
                    }
                });
                pathPlanner.setObstacles([...mapStore.zones, ...mapStore.obstacles]);

                if (!mission || !robot) return false;

                // Get other robots' positions for collision avoidance
                const otherRobots = robots
                    .filter(r => r.id !== robotId && r.connected && r.pose)
                    .map(r => r.pose);

                // Plan path through all waypoints
                const fullPath = [];
                let currentPos = robot.pose;
                let totalDistance = 0;

                for (let i = 0; i < mission.waypoints.length; i++) {
                    const waypoint = mission.waypoints[i];
                    const segmentPath = get().pathPlanner.findPath(
                        currentPos,
                        { x: waypoint.x, y: waypoint.y },
                        otherRobots
                    );

                    if (!segmentPath) {
                        console.error(`Cannot find path to waypoint ${i}`, {
                            from: currentPos,
                            to: { x: waypoint.x, y: waypoint.y },
                            robotId,
                            gridSize: pathPlanner.size,
                            fromGrid: pathPlanner.worldToGrid(currentPos.x, currentPos.y),
                            toGrid: pathPlanner.worldToGrid(waypoint.x, waypoint.y)
                        });
                        return false;
                    }

                    // Add segment to full path (skip first point if not first segment)
                    if (i > 0) segmentPath.shift();
                    fullPath.push(...segmentPath);

                    totalDistance += get().pathPlanner.calculatePathLength(segmentPath);
                    currentPos = { x: waypoint.x, y: waypoint.y };
                }

                // Calculate optimal velocity based on targetTime
                let missionOptimizedVelocity = mission.optimizedVelocity || 0.3;
                if (mission.targetTime && mission.targetTime > 0) {
                    missionOptimizedVelocity = totalDistance / (mission.targetTime * 0.9); // 90% buffer for turns/tasks
                    missionOptimizedVelocity = Math.min(missionOptimizedVelocity, robot.maxLinearSpeed || 0.5);
                    missionOptimizedVelocity = Math.max(missionOptimizedVelocity, 0.1);
                }

                // Calculate optimal velocity for each segment
                const waypointConfigs = [];
                currentPos = robot.pose;

                for (let i = 0; i < mission.waypoints.length; i++) {
                    const waypoint = mission.waypoints[i];
                    const segmentPath = get().pathPlanner.findPath(
                        currentPos,
                        { x: waypoint.x, y: waypoint.y },
                        otherRobots
                    );

                    const dist = get().pathPlanner.calculatePathLength(segmentPath || []);
                    let v = missionOptimizedVelocity;

                    if (waypoint.travelTime && waypoint.travelTime > 0) {
                        v = dist / (waypoint.travelTime * 0.8);
                        v = Math.min(v, robot.maxLinearSpeed || 0.5);
                        v = Math.max(v, 0.1);
                    }

                    waypointConfigs.push({
                        targetVelocity: v,
                        distance: dist
                    });
                    currentPos = { x: waypoint.x, y: waypoint.y };
                }

                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId
                            ? {
                                ...m,
                                assignedRobotId: robotId,
                                status: 'assigned',
                                plannedPath: fullPath,
                                waypointConfigs,
                                estimatedTime: totalDistance / missionOptimizedVelocity,
                                optimizedVelocity: missionOptimizedVelocity,
                                updatedAt: Date.now(),
                            }
                            : m
                    )
                }));

                return true;
            },

            // Start assigned mission
            startMission: async (missionId) => {
                if (get().isAssignmentPaused) {
                    alert('Hệ thống đang tạm dừng! Vui lòng nhấn Tiếp tục để bắt đầu nhiệm vụ.');
                    return false;
                }
                const mission = get().missions.find(m => m.id === missionId);
                console.log(`[MissionStore] startMission trigger cho: ${missionId}`, mission);

                if (!mission?.assignedRobotId) {
                    console.warn(`[MissionStore] Mission không được gán robotId`);
                    return false;
                }

                let robotStore = useRobotStore.getState();
                let bm = robotStore.getBehaviorManager(mission.assignedRobotId);
                let liveRobot = robotStore.robots?.[mission.assignedRobotId];

                // Retry logic: if BM not found yet, wait a bit and try again (handles connection lag)
                if (!bm || !liveRobot?.connected) {
                    console.log(`[MissionStore] Behavior backend chưa sẵn sàng, retrying in 500ms...`);
                    await new Promise(r => setTimeout(r, 500));
                    robotStore = useRobotStore.getState();
                    bm = robotStore.getBehaviorManager(mission.assignedRobotId);
                    liveRobot = robotStore.robots?.[mission.assignedRobotId];
                }

                console.log(`[MissionStore] Lấy BehaviorManager cho robot ${mission.assignedRobotId}:`, !!bm);

                if (!liveRobot?.connected) {
                    console.warn(`[MissionStore] Robot ${mission.assignedRobotId} chưa connected trong robotStore, hủy startMission.`);
                    alert('Robot chưa kết nối thực sự tới bộ điều khiển điều hướng. Hãy kết nối lại robot rồi nhấn Bắt đầu lần nữa.');
                    return false;
                }

                if (!bm) {
                    console.warn(`[MissionStore] KHÔNG THỂ TÌM THẤY BehaviorManager cho robot: ${mission.assignedRobotId}`);
                    alert('Không tìm thấy bộ điều khiển nhiệm vụ của robot. Hãy reconnect robot rồi thử lại.');
                    return false;
                }

                const startPoseTheta = liveRobot.pose?.theta ?? 0;
                const normalizedWaypoints = normalizeMissionWaypoints(mission.waypoints, startPoseTheta);

                bm.onMissionProgress((index) => {
                    get().updateMission(missionId, { currentWaypointIndex: index });
                });
                bm.onMissionComplete(() => {
                    get().updateMission(missionId, {
                        status: 'completed',
                        completedAt: Date.now()
                    });
                });

                console.log(`[MissionStore] Calling bm.startMission với ${normalizedWaypoints.length} waypoints`, normalizedWaypoints);
                try {
                    bm.startMission(normalizedWaypoints);
                } catch (e) {
                    console.error(`[MissionStore] Lỗi khi gọi bm.startMission`, e);
                    alert('Không thể bắt đầu nhiệm vụ. Kiểm tra log điều hướng và thử reconnect robot.');
                    return false;
                }

                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId
                            ? {
                                ...m,
                                status: 'active',
                                startedAt: m.startedAt || Date.now(),
                                updatedAt: Date.now(),
                                waypoints: normalizedWaypoints
                            }
                            : m
                    )
                }));

                return true;
            },

            // Stop/Pause active mission
            stopMission: (missionId) => {
                const mission = get().missions.find(m => m.id === missionId);
                if (mission?.assignedRobotId) {
                    useRobotStore.getState().stopMission(mission.assignedRobotId);
                }

                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId
                            ? { ...m, status: 'assigned', updatedAt: Date.now() }
                            : m
                    )
                }));
            },

            // Pause an individual mission
            pauseMission: (missionId) => {
                const mission = get().missions.find(m => m.id === missionId);
                if (mission?.assignedRobotId) {
                    useRobotStore.getState().pauseMission(mission.assignedRobotId);
                }

                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId ? { ...m, status: 'paused', updatedAt: Date.now() } : m
                    )
                }));
            },

            // Resume an individual mission
            resumeMission: (missionId) => {
                const mission = get().missions.find(m => m.id === missionId);
                if (mission?.assignedRobotId) {
                    useRobotStore.getState().resumeMission(mission.assignedRobotId);
                }

                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId ? { ...m, status: 'active', updatedAt: Date.now() } : m
                    )
                }));
            },

            // Update mission progress
            updateMissionProgress: (missionId, robotPose) => {
                const mission = get().missions.find(m => m.id === missionId);
                if (!mission || mission.status !== 'active') return;

                const currentWaypoint = mission.waypoints[mission.currentWaypointIndex];
                if (!currentWaypoint) return;

                // Check if reached current waypoint
                const dx = robotPose.x - currentWaypoint.x;
                const dy = robotPose.y - currentWaypoint.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Check if orientation is also required
                let orientationReached = true;
                if (currentWaypoint.thetaEnabled) {
                    const targetRad = (currentWaypoint.theta || 0) * (Math.PI / 180);
                    let angleDiff = targetRad - robotPose.theta;
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                    orientationReached = Math.abs(angleDiff) < 0.15; // Within ~8.5 degrees
                }

                if (distance < 0.3 && orientationReached) { // Within 30cm and oriented
                    // Move to next waypoint
                    const nextIndex = mission.currentWaypointIndex + 1;

                    if (nextIndex >= mission.waypoints.length) {
                        // Mission completed
                        set(state => ({
                            missions: state.missions.map(m =>
                                m.id === missionId
                                    ? {
                                        ...m,
                                        status: 'completed',
                                        completedAt: Date.now(),
                                        updatedAt: Date.now(),
                                        currentWaypointIndex: nextIndex
                                    }
                                    : m
                            )
                        }));
                    } else {
                        set(state => ({
                            missions: state.missions.map(m =>
                                m.id === missionId
                                    ? { ...m, currentWaypointIndex: nextIndex, updatedAt: Date.now() }
                                    : m
                            )
                        }));
                    }
                }
            },

            // Cancel mission
            cancelMission: (missionId) => {
                const mission = get().missions.find(m => m.id === missionId);
                if (mission?.assignedRobotId) {
                    useRobotStore.getState().stopMission(mission.assignedRobotId);
                }
                set(state => ({
                    missions: state.missions.map(m =>
                        m.id === missionId
                            ? { ...m, status: 'failed', completedAt: Date.now(), updatedAt: Date.now() }
                            : m
                    )
                }));
            },

            // Reset/Restart a mission
            resetMission: (missionId) => {
                const mission = get().missions.find(m => m.id === missionId);
                
                // If assigned to a robot, reset that robot's odometry too for a clean restart
                if (mission?.assignedRobotId) {
                    const fleetStore = require('./fleetStore').useFleetStore;
                    fleetStore.getState().resetRobotOdometry(mission.assignedRobotId);
                    useRobotStore.getState().stopMission(mission.assignedRobotId);
                }

                set(state => ({
                    missions: state.missions.map(m => {
                        if (m.id !== missionId) return m;
                        return {
                            ...m,
                            status: m.assignedRobotId ? 'assigned' : 'pending',
                            currentWaypointIndex: 0,
                            startedAt: null,
                            completedAt: null,
                            updatedAt: Date.now()
                        };
                    })
                }));
            },

            // Remove mission
            removeMission: (missionId) => {
                set(state => ({
                    missions: state.missions.filter(m => m.id !== missionId)
                }));
            },

            // Get active mission for robot
            getActiveMission: (robotId) => {
                return get().missions.find(
                    m => m.assignedRobotId === robotId && m.status === 'active'
                );
            },

            // Clear completed missions
            clearCompletedMissions: () => {
                set(state => ({
                    missions: state.missions.filter(m => m.status !== 'completed')
                }));
            },

            // Replan path (for dynamic obstacle avoidance)
            replanMission: (missionId, robots) => {
                const mission = get().missions.find(m => m.id === missionId);
                if (!mission || (mission.status !== 'active' && mission.status !== 'assigned')) return;

                const robot = robots.find(r => r.id === mission.assignedRobotId);
                if (!robot) return;

                get().assignMission(missionId, mission.assignedRobotId, robots);
            },

            // Mission Control Loop - Drives robots to their targets with collision avoidance
            runMissionControl: (robots, sendVelocity) => {
                if (get().isAssignmentPaused) return;

                const now = Date.now();
                const activeMissions = get().missions.filter(m =>
                    m.status === 'active' && (!m.scheduledAt || m.scheduledAt <= now)
                );

                activeMissions.forEach(mission => {
                    const robot = robots.find(r => r.id === mission.assignedRobotId);
                    if (!robot || !robot.connected) return;

                    const currentWaypoint = mission.waypoints[mission.currentWaypointIndex];
                    if (!currentWaypoint) return;

                    // Support per-waypoint scheduling
                    if (currentWaypoint.scheduledAt && currentWaypoint.scheduledAt > now) {
                        sendVelocity(robot.id, 0, 0); // Wait for schedule
                        return;
                    }

                    // Get segment-specific velocity
                    const config = mission.waypointConfigs?.[mission.currentWaypointIndex];
                    const targetLinearVelocity = config?.targetVelocity || mission.optimizedVelocity || 0.3;
                    let speedFactor = 1.0;
                    let isBlocked = false;

                    const CRITICAL_DIST = 0.6; // Meters - Stop
                    const WARNING_DIST = 1.2;  // Meters - Slow down

                    robots.forEach(other => {
                        if (other.id === robot.id || !other.connected) return;

                        const dx = other.pose.x - robot.pose.x;
                        const dy = other.pose.y - robot.pose.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);

                        if (dist < WARNING_DIST) {
                            // Check if other robot is in front (approx. +/- 60 degrees)
                            const angleToOther = Math.atan2(dy, dx);
                            let angleDiff = angleToOther - robot.pose.theta;
                            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

                            if (Math.abs(angleDiff) < Math.PI / 3) {
                                if (dist < CRITICAL_DIST) {
                                    isBlocked = true;
                                } else {
                                    // Slow down proportionally
                                    const factor = (dist - CRITICAL_DIST) / (WARNING_DIST - CRITICAL_DIST);
                                    speedFactor = Math.min(speedFactor, factor);
                                }
                            }
                        }
                    });

                    if (isBlocked) {
                        sendVelocity(robot.id, 0, 0); // Emergency stop
                        return; // Wait for path to clear
                    }
                    // ---------------------------------

                    // Calculate distance and heading to waypoint
                    const dx = currentWaypoint.x - robot.pose.x;
                    const dy = currentWaypoint.y - robot.pose.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    // Target angle in radians
                    const targetAngle = Math.atan2(dy, dx);

                    // Angle difference normalized to [-PI, PI]
                    let angleDiff = targetAngle - robot.pose.theta;
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

                    let linear = 0;
                    let angular = 0;

                    // Decision logic:
                    // 1. If at the waypoint position and need specific rotation
                    if (distance < 0.3 && currentWaypoint.thetaEnabled) {
                        const targetRad = (currentWaypoint.theta || 0) * (Math.PI / 180);
                        let angleToHeading = targetRad - robot.pose.theta;
                        while (angleToHeading > Math.PI) angleToHeading -= 2 * Math.PI;
                        while (angleToHeading < -Math.PI) angleToHeading += 2 * Math.PI;

                        if (Math.abs(angleToHeading) > 0.10) {
                            angular = Math.sign(angleToHeading) * Math.min(robot.maxAngularSpeed || 1.0, 0.4);
                            linear = 0;
                        }
                    }
                    // 2. Rotate to face waypoint first
                    else if (Math.abs(angleDiff) > 0.3) {
                        // Too much angle, just rotate in place
                        angular = Math.sign(angleDiff) * (robot.maxAngularSpeed || 1.0) * 0.5;
                        linear = 0;
                    } else {
                        // Getting closer to heading, can move forward
                        linear = targetLinearVelocity * speedFactor;
                        angular = angleDiff * 1.5; // P-controller for heading

                        // Slow down as we reach the point
                        if (distance < 0.5) {
                            linear *= (distance / 0.5);
                        }
                    }

                    // Send command to physical robot
                    sendVelocity(robot.id, linear, angular);

                    // Update progress state (checked in updateMissionProgress but easier to trigger here if needed)
                    get().updateMissionProgress(mission.id, robot.pose);
                });
            },
        }),
        {
            name: 'mission-storage',
            partialize: (state) => ({
                missions: state.missions,
            }),
        }
    )
);
