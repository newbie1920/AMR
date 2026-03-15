import json
import asyncio
import websockets
import math
from controller import Robot

class AMRWebotsController:
    def __init__(self, robot_id="robot_1"):
        self.robot = Robot()
        self.robot_id = robot_id
        self.timestep = int(self.robot.getBasicTimeStep())
        
        # Devices from URDF
        self.left_motor = self.robot.getDevice('left_wheel_joint')
        self.right_motor = self.robot.getDevice('right_wheel_joint')
        self.lidar = self.robot.getDevice('lidar')
        self.imu = self.robot.getDevice('imu_sensor')
        self.gps = self.robot.getDevice('gps') # GPS for ground truth odom
        
        # Setup motors
        self.left_motor.setPosition(float('inf'))
        self.right_motor.setPosition(float('inf'))
        self.left_motor.setVelocity(0.0)
        self.right_motor.setVelocity(0.0)
        
        # Enable sensors
        self.lidar.enable(self.timestep)
        self.imu.enable(self.timestep)
        if self.gps: self.gps.enable(self.timestep)
        
        # Robot parameters (from URDF)
        self.wheel_radius = 0.05
        self.wheel_separation = 0.3
        
        self.target_v = 0.0
        self.target_w = 0.0
        
    def _compute_wheel_speeds(self, v, w):
        left = (v - w * self.wheel_separation / 2.0) / self.wheel_radius
        right = (v + w * self.wheel_separation / 2.0) / self.wheel_radius
        return left, right

    async def _handle_client(self, websocket, path):
        print(f"[{self.robot_id}] App connected.")
        try:
            async for message in websocket:
                data = json.loads(message)
                if data['type'] == 'cmd_vel':
                    self.target_v = data['linear']
                    self.target_w = data['angular']
                    left, right = self._compute_wheel_speeds(self.target_v, self.target_w)
                    self.left_motor.setVelocity(left)
                    self.right_motor.setVelocity(right)
                elif data['type'] == 'cmd' and data['cmd'] == 'e_stop':
                    self.left_motor.setVelocity(0)
                    self.right_motor.setVelocity(0)
        except websockets.ConnectionClosed:
            print(f"[{self.robot_id}] App disconnected.")

    async def _broadcast_telem(self, websocket):
        while True:
            # 1. Step Webots simulation
            if self.robot.step(self.timestep) == -1:
                break
            
            # 2. Collect Data
            pos = self.gps.getValues() if self.gps else [0, 0, 0]
            orient = self.imu.getRollPitchYaw() if self.imu else [0, 0, 0]
            
            telem = {
                "type": "telem",
                "ts": int(self.robot.getTime() * 1000),
                "x": pos[0],
                "y": pos[1],
                "theta": orient[2], # Yaw
                "vx": self.target_v,
                "wz": self.target_w,
                "imu": {
                    "roll": orient[0],
                    "pitch": orient[1],
                    "yaw": orient[2]
                }
            }
            
            try:
                await websocket.send(json.dumps(telem))
            except:
                break
            
            await asyncio.sleep(0.05) # 20Hz broadcast

    async def main(self, port=81):
        async with websockets.serve(self._handle_client, "0.0.0.0", port):
            print(f"[{self.robot_id}] Simulation Server started on port {port}")
            await asyncio.Future() # run forever

if __name__ == "__main__":
    import os
    robot_id = os.getenv('ROBOT_ID', 'robot_1')
    port = int(os.getenv('SIM_PORT', 81))
    controller = AMRWebotsController(robot_id)
    asyncio.run(controller.main(port))
