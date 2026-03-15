#!/usr/bin/env python3

import os
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare


def generate_launch_description():
    # Package paths
    pkg_amr_navigation = FindPackageShare('amr_navigation')
    pkg_nav2_bringup = FindPackageShare('nav2_bringup')
    
    # Launch arguments
    use_sim_time = LaunchConfiguration('use_sim_time')
    slam = LaunchConfiguration('slam')
    map_file = LaunchConfiguration('map')
    nav2_params_file = LaunchConfiguration('params_file')
    
    declare_use_sim_time = DeclareLaunchArgument(
        'use_sim_time',
        default_value='false',
        description='Use simulation clock'
    )
    
    declare_slam = DeclareLaunchArgument(
        'slam',
        default_value='True',
        description='Run SLAM to build map'
    )
    
    declare_map = DeclareLaunchArgument(
        'map',
        default_value='',
        description='Path to map yaml file (required if slam:=False)'
    )
    
    declare_params_file = DeclareLaunchArgument(
        'params_file',
        default_value=PathJoinSubstitution([pkg_amr_navigation, 'config', 'nav2_params.yaml']),
        description='Full path to Nav2 parameters file'
    )
    
    # SLAM Toolbox
    slam_params_file = PathJoinSubstitution([pkg_amr_navigation, 'config', 'slam_params.yaml'])
    
    slam_toolbox = Node(
        package='slam_toolbox',
        executable='async_slam_toolbox_node',
        name='slam_toolbox',
        output='screen',
        parameters=[
            slam_params_file,
            {'use_sim_time': use_sim_time}
        ],
        condition=IfCondition(slam)
    )
    
    # Nav2 bringup
    nav2_bringup = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([
            PathJoinSubstitution([pkg_nav2_bringup, 'launch', 'navigation_launch.py'])
        ]),
        launch_arguments={
            'use_sim_time': use_sim_time,
            'params_file': nav2_params_file
        }.items()
    )
    
    return LaunchDescription([
        declare_use_sim_time,
        declare_slam,
        declare_map,
        declare_params_file,
        slam_toolbox,
        nav2_bringup
    ])
