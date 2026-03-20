/**
 * behaviorTree.js
 * ===============
 * Lightweight Behavior Tree Engine — thay thế Nav2 BT Navigator
 * 
 * BT Nodes:
 *   - Action (Leaf): Thực hiện lệnh (di chuyển, quay, đợi).
 *   - Condition (Leaf): Kiểm tra trạng thái (đã đến đích? pin yếu?).
 *   - Sequence (Composite): Chạy các con lần lượt, dừng nếu 1 con FAIL.
 *   - Selector (Composite): Chạy các con lần lượt, dừng nếu 1 con SUCCESS.
 *   - Repeat (Decorator): Lặp con N lần.
 *
 * USAGE:
 *   const tree = new BTNode.Sequence([
 *     new CheckBatteryCondition(),
 *     new BTNode.Selector([
 *       new NavigateAction(goal),
 *       new RecoverySequence()
 *     ])
 *   ]);
 *   tree.tick();
 */

export const BT_STATUS = {
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    FAILURE: 'FAILURE'
};

class Node {
    constructor(name = 'Node') {
        this.name = name;
    }
    async tick(context) { return BT_STATUS.FAILURE; }
}

// ─── Composites ──────────────────────────────────────────────────────────────

class Sequence extends Node {
    constructor(children, name = 'Sequence') {
        super(name);
        this.children = children;
        this.currentIndex = 0;
    }
    async tick(context) {
        for (let i = this.currentIndex; i < this.children.length; i++) {
            const status = await this.children[i].tick(context);
            if (status === BT_STATUS.RUNNING) {
                this.currentIndex = i;
                return BT_STATUS.RUNNING;
            }
            if (status === BT_STATUS.FAILURE) {
                this.currentIndex = 0;
                return BT_STATUS.FAILURE;
            }
        }
        this.currentIndex = 0;
        return BT_STATUS.SUCCESS;
    }
}

class Selector extends Node {
    constructor(children, name = 'Selector') {
        super(name);
        this.children = children;
        this.currentIndex = 0;
    }
    async tick(context) {
        for (let i = this.currentIndex; i < this.children.length; i++) {
            const status = await this.children[i].tick(context);
            if (status === BT_STATUS.RUNNING) {
                this.currentIndex = i;
                return BT_STATUS.RUNNING;
            }
            if (status === BT_STATUS.SUCCESS) {
                this.currentIndex = 0;
                return BT_STATUS.SUCCESS;
            }
        }
        this.currentIndex = 0;
        return BT_STATUS.FAILURE;
    }
}

// ─── Decorators ─────────────────────────────────────────────────────────────

class Inverter extends Node {
    constructor(child, name = 'Inverter') {
        super(name);
        this.child = child;
    }
    async tick(context) {
        const status = await this.child.tick(context);
        if (status === BT_STATUS.SUCCESS) return BT_STATUS.FAILURE;
        if (status === BT_STATUS.FAILURE) return BT_STATUS.SUCCESS;
        return BT_STATUS.RUNNING;
    }
}

// ─── Leaf Nodes (Base) ──────────────────────────────────────────────────────

class ActionNode extends Node {
    constructor(actionFn, name = 'Action') {
        super(name);
        this.actionFn = actionFn;
    }
    async tick(context) {
        return await this.actionFn(context);
    }
}

class ConditionNode extends Node {
    constructor(conditionFn, name = 'Condition') {
        super(name);
        this.conditionFn = conditionFn;
    }
    async tick(context) {
        return (await this.conditionFn(context)) ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE;
    }
}

// ─── Export ────────────────────────────────────────────────────────────────

export const BT = {
    Sequence,
    Selector,
    Inverter,
    Action: ActionNode,
    Condition: ConditionNode
};
