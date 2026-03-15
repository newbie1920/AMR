#!/usr/bin/env python3

import os
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, ExecuteProcess
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution, Command
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from launch_ros.substitutions import FindPackageShare
from launch_ros.parameter_descriptions import ParameterValue


def generate_launch_description():
    # Package paths
    pkg_amr_description = FindPackageShare('amr_description')
    pkg_amr_bringup = FindPackageShare('amr_bringup')
    pkg_gazebo_ros = FindPackageShare('gazebo_ros')
    
    # Launch arguments
    use_rviz = LaunchConfiguration('use_rviz')
    world_file = LaunchConfiguration('world')
    
    declare_use_rviz = DeclareLaunchArgument(
        'use_rviz',
        default_value='true',
        description='Launch RViz'
    )
    
    declare_world = DeclareLaunchArgument(
        'world',
        default_value=PathJoinSubstitution([pkg_amr_bringup, 'worlds', 'workshop.world']),
        description='Gazebo world file'
    )
    
    # URDF file path
    urdf_file = PathJoinSubstitution([pkg_amr_description, 'urdf', 'amr.urdf.xacro'])
    
    # Robot description
    robot_description = ParameterValue(
        Command(['xacro ', urdf_file]),
        value_type=str
    )
    
    # Robot State Publisher
    robot_state_publisher = Node(
        package='robot_state_publisher',
        executable='robot_state_publisher',
        name='robot_state_publisher',
        output='screen',
        parameters=[{
            'robot_description': robot_description,
            'use_sim_time': True
        }]
    )
    
    # Gazebo
    gazebo = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([
            PathJoinSubstitution([pkg_gazebo_ros, 'launch', 'gazebo.launch.py'])
        ]),
        launch_arguments={
            'world': world_file,
            'verbose': 'true'
        }.items()
    )
    
    # Spawn robot in Gazebo
    spawn_robot = Node(
        package='gazebo_ros',
        executable='spawn_entity.py',
        name='spawn_entity',
        arguments=[
            '-topic', 'robot_description',
            '-entity', 'amr_robot',
            '-x', '0.0',
            '-y', '0.0',
            '-z', '0.1'
        ],
        output='screen'
    )
    
    # RViz
    rviz_config = PathJoinSubstitution([pkg_amr_description, 'rviz', 'amr.rviz'])
    rviz_node = Node(
        package='rviz2',
        executable='rviz2',
        name='rviz2',
        arguments=['-d', rviz_config],
        parameters=[{'use_sim_time': True}],
        condition=IfCondition(use_rviz),
        output='screen'
    )
    
    return LaunchDescription([
        declare_use_rviz,
        declare_world,
        robot_state_publisher,
        gazebo,
        spawn_robot,
        rviz_node
    ])
