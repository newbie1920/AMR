import { useEffect } from 'react';
import { useFleetStore } from '../stores/fleetStore';
import { useRobotStore } from '../stores/robotStore';
import { useMissionStore } from '../stores/missionStore';
import { NAV_STATE } from './navController';

/**
 * useWorkflowEngine
 * Periodically processes tasks and workflows in the fleetStore state,
 * integrating with the behaviorManager of each robot.
 */
export function useWorkflowEngine() {
    useEffect(() => {
        const interval = setInterval(() => {
            const fleetState = useFleetStore.getState();
            const robotState = useRobotStore.getState();
            const isPaused = useMissionStore.getState().isAssignmentPaused;

            if (isPaused) return;

            fleetState.robots.forEach(robot => {
                if (!robot.connected) return;

                const bm = robotState.getBehaviorManager(robot.id);
                if (!bm) return;

                const navState = bm._navController?.getState() || NAV_STATE.IDLE;

                // If robot is currently idle and has pending tasks, start next task
                if (!robot.currentTask && robot.taskQueue?.length > 0 && (navState === NAV_STATE.IDLE || navState === NAV_STATE.GOAL_REACHED || navState === NAV_STATE.CANCELLED || navState === NAV_STATE.FAILED)) {
                    // Start next task
                    const nextTask = robot.taskQueue[0];
                    useFleetStore.setState(state => ({
                        robots: state.robots.map(r => r.id === robot.id ? {
                            ...r,
                            currentTask: nextTask,
                            taskQueue: r.taskQueue.slice(1)
                        } : r)
                    }));

                    // Map Task to Goal or WP Sequence
                    if (nextTask.type === 'move') {
                        bm.startMission([{ x: nextTask.x, y: nextTask.y, theta: 0, task: nextTask.action }]);
                    } else if (nextTask.type === 'wait') {
                        // Sleep for duration
                        bm._navController._setState(NAV_STATE.FOLLOWING);
                        setTimeout(() => {
                            bm._navController._setState(NAV_STATE.GOAL_REACHED);
                        }, nextTask.duration || 3000);
                    } else if (nextTask.type === 'action') {
                        console.log(`[TaskEngine] Executing immediate action for ${robot.id}: ${nextTask.action}`);
                        // Mock action execution
                        setTimeout(() => bm._navController._setState(NAV_STATE.GOAL_REACHED), 2000);
                    }
                }

                // If robot has a currentTask, check if it's done
                if (robot.currentTask) {
                    if (navState === NAV_STATE.GOAL_REACHED) {
                        console.log(`[TaskEngine] Task completed: ${robot.currentTask.name}`);
                        // Clear task, let next cycle pick up the next
                        useFleetStore.setState(state => ({
                            robots: state.robots.map(r => r.id === robot.id ? { ...r, currentTask: null } : r)
                        }));
                        bm._navController._setState(NAV_STATE.IDLE); // Reset state to prevent immediate re-trigger
                    } else if (navState === NAV_STATE.FAILED || navState === NAV_STATE.CANCELLED) {
                        console.warn(`[TaskEngine] Task failed/cancelled: ${robot.currentTask.name}`);
                        useFleetStore.setState(state => ({
                            robots: state.robots.map(r => r.id === robot.id ? { ...r, currentTask: null } : r)
                        }));
                    }
                }
            });

            // Very simple Workflow Loop
            const activeWFs = fleetState.activeWorkflows || [];
            if (activeWFs.length > 0) {
                // Execute active workflows here...
                activeWFs.forEach(awf => {
                    const wf = (fleetState.workflows || []).find(w => w.id === awf.workflowId);
                    if (!wf || !wf.steps) return;

                    // This requires more complex state management, 
                    // simplified for now: just queue all steps initially
                    if (awf.currentStep === 0 && wf.steps.length > 0) {
                        const targetRobotId = awf.robotAssignments?.default || fleetState.selectedRobotId;
                        if (targetRobotId) {
                            wf.steps.forEach(step => {
                                fleetState.addTaskToRobot(targetRobotId, step);
                            });
                        }

                        useFleetStore.setState(state => ({
                            activeWorkflows: state.activeWorkflows.map(a =>
                                a.id === awf.id ? { ...a, currentStep: wf.steps.length } : a
                            )
                        }));
                    }
                });
            }

        }, 1000);

        return () => clearInterval(interval);
    }, []);
}
