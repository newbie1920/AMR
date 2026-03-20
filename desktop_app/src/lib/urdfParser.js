/**
 * urdfParser.js
 * =============
 * URDF XML Parser — thay thế robot_state_publisher / xacro
 *
 * Parses URDF (Unified Robot Description Format) XML to extract:
 *   - Links (visual geometry, collision, inertial)
 *   - Joints (revolute, prismatic, fixed, continuous)
 *   - Joint limits, origin transforms
 *   - Material colors
 *
 * Output: Structured JS object tree suitable for Three.js rendering
 *
 * USAGE:
 *   import { parseURDF } from './urdfParser';
 *
 *   const robot = parseURDF(urdfXmlString);
 *   // robot.name, robot.links, robot.joints, robot.tree
 */

// ─── URDF Joint Types ────────────────────────────────────────────────────────
export const JOINT_TYPE = {
    REVOLUTE: 'revolute',
    CONTINUOUS: 'continuous',
    PRISMATIC: 'prismatic',
    FIXED: 'fixed',
    FLOATING: 'floating',
    PLANAR: 'planar',
};

// ─── Parse Helpers ───────────────────────────────────────────────────────────
function parseVec3(str) {
    if (!str) return { x: 0, y: 0, z: 0 };
    const parts = str.trim().split(/\s+/).map(Number);
    return { x: parts[0] || 0, y: parts[1] || 0, z: parts[2] || 0 };
}

function parseOrigin(element) {
    if (!element) return { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } };
    const origin = element.querySelector('origin');
    if (!origin) return { xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } };
    return {
        xyz: parseVec3(origin.getAttribute('xyz')),
        rpy: parseVec3(origin.getAttribute('rpy')),
    };
}

function parseGeometry(geomElement) {
    if (!geomElement) return null;

    const box = geomElement.querySelector('box');
    if (box) {
        return {
            type: 'box',
            size: parseVec3(box.getAttribute('size')),
        };
    }

    const cylinder = geomElement.querySelector('cylinder');
    if (cylinder) {
        return {
            type: 'cylinder',
            radius: parseFloat(cylinder.getAttribute('radius')) || 0.05,
            length: parseFloat(cylinder.getAttribute('length')) || 0.1,
        };
    }

    const sphere = geomElement.querySelector('sphere');
    if (sphere) {
        return {
            type: 'sphere',
            radius: parseFloat(sphere.getAttribute('radius')) || 0.05,
        };
    }

    const mesh = geomElement.querySelector('mesh');
    if (mesh) {
        return {
            type: 'mesh',
            filename: mesh.getAttribute('filename') || '',
            scale: parseVec3(mesh.getAttribute('scale') || '1 1 1'),
        };
    }

    return null;
}

function parseMaterial(materialElement) {
    if (!materialElement) return { name: 'default', color: { r: 0.7, g: 0.7, b: 0.7, a: 1.0 } };

    const name = materialElement.getAttribute('name') || 'default';
    const color = materialElement.querySelector('color');

    if (color) {
        const rgba = color.getAttribute('rgba');
        if (rgba) {
            const parts = rgba.trim().split(/\s+/).map(Number);
            return {
                name,
                color: { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts[3] ?? 1 },
            };
        }
    }

    return { name, color: { r: 0.7, g: 0.7, b: 0.7, a: 1.0 } };
}

// ─── Parse Link ──────────────────────────────────────────────────────────────
function parseLink(linkElement) {
    const name = linkElement.getAttribute('name');

    // Visual
    const visualElement = linkElement.querySelector('visual');
    let visual = null;
    if (visualElement) {
        const geomEl = visualElement.querySelector('geometry');
        visual = {
            origin: parseOrigin(visualElement),
            geometry: parseGeometry(geomEl),
            material: parseMaterial(visualElement.querySelector('material')),
        };
    }

    // Collision
    const collisionElement = linkElement.querySelector('collision');
    let collision = null;
    if (collisionElement) {
        const geomEl = collisionElement.querySelector('geometry');
        collision = {
            origin: parseOrigin(collisionElement),
            geometry: parseGeometry(geomEl),
        };
    }

    // Inertial
    const inertialElement = linkElement.querySelector('inertial');
    let inertial = null;
    if (inertialElement) {
        const mass = inertialElement.querySelector('mass');
        inertial = {
            origin: parseOrigin(inertialElement),
            mass: mass ? parseFloat(mass.getAttribute('value')) || 0 : 0,
        };
    }

    return { name, visual, collision, inertial };
}

// ─── Parse Joint ─────────────────────────────────────────────────────────────
function parseJoint(jointElement) {
    const name = jointElement.getAttribute('name');
    const type = jointElement.getAttribute('type') || 'fixed';

    const parent = jointElement.querySelector('parent')?.getAttribute('link') || '';
    const child = jointElement.querySelector('child')?.getAttribute('link') || '';

    // Axis
    const axisEl = jointElement.querySelector('axis');
    const axis = axisEl ? parseVec3(axisEl.getAttribute('xyz')) : { x: 0, y: 0, z: 1 };

    // Limits
    const limitEl = jointElement.querySelector('limit');
    const limit = limitEl ? {
        lower: parseFloat(limitEl.getAttribute('lower')) || 0,
        upper: parseFloat(limitEl.getAttribute('upper')) || 0,
        effort: parseFloat(limitEl.getAttribute('effort')) || 0,
        velocity: parseFloat(limitEl.getAttribute('velocity')) || 0,
    } : null;

    return {
        name,
        type,
        parent,
        child,
        origin: parseOrigin(jointElement),
        axis,
        limit,
        currentPosition: 0, // used for animation
    };
}

// ─── Build Kinematic Tree ────────────────────────────────────────────────────
function buildTree(links, joints) {
    // Map link names to objects
    const linkMap = new Map();
    links.forEach(link => linkMap.set(link.name, { ...link, children: [] }));

    // Find the root link (not a child of any joint)
    const childLinkNames = new Set(joints.map(j => j.child));
    const rootLinks = links.filter(l => !childLinkNames.has(l.name));
    const rootName = rootLinks.length > 0 ? rootLinks[0].name : links[0]?.name;

    // Build parent-child relationships
    for (const joint of joints) {
        const parentNode = linkMap.get(joint.parent);
        const childNode = linkMap.get(joint.child);
        if (parentNode && childNode) {
            parentNode.children.push({
                joint,
                link: childNode,
            });
        }
    }

    return linkMap.get(rootName) || null;
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

/**
 * Parse URDF XML string into a structured robot description.
 * @param {string} urdfXml - Raw URDF XML content
 * @returns {object} Parsed robot description
 */
export function parseURDF(urdfXml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(urdfXml, 'application/xml');

    const robotElement = doc.querySelector('robot');
    if (!robotElement) {
        throw new Error('Invalid URDF: no <robot> element found.');
    }

    const robotName = robotElement.getAttribute('name') || 'unnamed_robot';

    // Parse all links
    const linkElements = robotElement.querySelectorAll(':scope > link');
    const links = Array.from(linkElements).map(parseLink);

    // Parse all joints
    const jointElements = robotElement.querySelectorAll(':scope > joint');
    const joints = Array.from(jointElements).map(parseJoint);

    // Parse top-level materials (shared material definitions)
    const materialElements = robotElement.querySelectorAll(':scope > material');
    const materials = {};
    materialElements.forEach(m => {
        const parsed = parseMaterial(m);
        materials[parsed.name] = parsed;
    });

    // Resolve material references in links
    for (const link of links) {
        if (link.visual?.material?.name && !link.visual.material.color) {
            const sharedMat = materials[link.visual.material.name];
            if (sharedMat) {
                link.visual.material = { ...sharedMat };
            }
        }
    }

    // Build kinematic tree
    const tree = buildTree(links, joints);

    return {
        name: robotName,
        links,
        joints,
        materials,
        tree,
        linkMap: new Map(links.map(l => [l.name, l])),
        jointMap: new Map(joints.map(j => [j.name, j])),
    };
}

/**
 * Set joint position (for animation).
 * @param {object} robot - Parsed robot from parseURDF
 * @param {string} jointName - Joint name
 * @param {number} position - Position value (radians for revolute, meters for prismatic)
 */
export function setJointPosition(robot, jointName, position) {
    const joint = robot.jointMap.get(jointName);
    if (!joint) return;

    // Clamp to limits if available
    if (joint.limit) {
        position = Math.max(joint.limit.lower, Math.min(joint.limit.upper, position));
    }
    joint.currentPosition = position;
}

/**
 * Get all movable joints.
 */
export function getMovableJoints(robot) {
    return robot.joints.filter(j =>
        j.type === JOINT_TYPE.REVOLUTE ||
        j.type === JOINT_TYPE.CONTINUOUS ||
        j.type === JOINT_TYPE.PRISMATIC
    );
}

/**
 * Generate a default AMR URDF for testing/demo.
 */
export function generateDefaultAMR_URDF() {
    return `<?xml version="1.0"?>
<robot name="amr_default">
  <!-- Base Link -->
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.05" rpy="0 0 0"/>
      <geometry><box size="0.4 0.3 0.1"/></geometry>
      <material name="chassis_color"><color rgba="0.2 0.2 0.3 1.0"/></material>
    </visual>
  </link>

  <!-- Left Wheel -->
  <link name="left_wheel">
    <visual>
      <geometry><cylinder radius="0.05" length="0.03"/></geometry>
      <material name="wheel_color"><color rgba="0.1 0.1 0.1 1.0"/></material>
    </visual>
  </link>
  <joint name="left_wheel_joint" type="continuous">
    <parent link="base_link"/>
    <child link="left_wheel"/>
    <origin xyz="0.0 0.17 0.0" rpy="-1.5708 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>

  <!-- Right Wheel -->
  <link name="right_wheel">
    <visual>
      <geometry><cylinder radius="0.05" length="0.03"/></geometry>
      <material name="wheel_color"><color rgba="0.1 0.1 0.1 1.0"/></material>
    </visual>
  </link>
  <joint name="right_wheel_joint" type="continuous">
    <parent link="base_link"/>
    <child link="right_wheel"/>
    <origin xyz="0.0 -0.17 0.0" rpy="-1.5708 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>

  <!-- Caster Wheel -->
  <link name="caster_wheel">
    <visual>
      <geometry><sphere radius="0.025"/></geometry>
      <material name="caster_color"><color rgba="0.3 0.3 0.3 1.0"/></material>
    </visual>
  </link>
  <joint name="caster_joint" type="fixed">
    <parent link="base_link"/>
    <child link="caster_wheel"/>
    <origin xyz="-0.15 0 -0.025" rpy="0 0 0"/>
  </joint>

  <!-- LiDAR -->
  <link name="lidar_link">
    <visual>
      <geometry><cylinder radius="0.04" length="0.05"/></geometry>
      <material name="lidar_color"><color rgba="0.0 0.6 0.9 1.0"/></material>
    </visual>
  </link>
  <joint name="lidar_joint" type="fixed">
    <parent link="base_link"/>
    <child link="lidar_link"/>
    <origin xyz="0.1 0 0.125" rpy="0 0 0"/>
  </joint>

  <!-- IMU -->
  <link name="imu_link">
    <visual>
      <geometry><box size="0.02 0.02 0.01"/></geometry>
      <material name="imu_color"><color rgba="0.0 0.8 0.3 1.0"/></material>
    </visual>
  </link>
  <joint name="imu_joint" type="fixed">
    <parent link="base_link"/>
    <child link="imu_link"/>
    <origin xyz="0 0 0.105" rpy="0 0 0"/>
  </joint>
</robot>`;
}

export default {
    parseURDF,
    setJointPosition,
    getMovableJoints,
    generateDefaultAMR_URDF,
    JOINT_TYPE,
};
