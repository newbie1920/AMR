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
    pkg_amr_description = FindPackageShare('amr_description')
    pkg_amr_bringup = FindPackageShare('amr_bringup')
    pkg_amr_navigation = FindPackageShare('amr_navigation')
    
    # Launch arguments
    use_sim_time = LaunchConfiguration('use_sim_time')
    use_rviz = LaunchConfiguration('use_rviz')
    use_navigation = LaunchConfiguration('use_navigation')
    
    declare_use_sim_time = DeclareLaunchArgument(
        'use_sim_time',
        default_value='false',
        description='Use simulation clock'
    )
    
    declare_use_rviz = DeclareLaunchArgument(
        'use_rviz',
        default_value='true',
        description='Launch RViz'
    )
    
    declare_use_navigation = DeclareLaunchArgument(
        'use_navigation',
        default_value='true',
        description='Launch navigation stack'
    )
    
    # Robot description launch
    robot_description = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([
            PathJoinSubstitution([pkg_amr_description, 'launch', 'description.launch.py'])
        ]),
        launch_arguments={'use_sim_time': use_sim_time}.items()
    )
    
    # RViz
    rviz_config = PathJoinSubstitution([pkg_amr_description, 'rviz', 'amr.rviz'])
    rviz_node = Node(
        package='rviz2',
        executable='rviz2',
        name='rviz2',
        arguments=['-d', rviz_config],
        parameters=[{'use_sim_time': use_sim_time}],
        condition=IfCondition(use_rviz),
        output='screen'
    )
    
    # Navigation launch (conditionally)
    navigation_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([
            PathJoinSubstitution([pkg_amr_navigation, 'launch', 'navigation.launch.py'])
        ]),
        launch_arguments={'use_sim_time': use_sim_time}.items(),
        condition=IfCondition(use_navigation)
    )
    
    # Rosbridge for desktop app connection
    rosbridge_node = Node(
        package='rosbridge_server',
        executable='rosbridge_websocket',
        name='rosbridge_websocket',
        parameters=[{
            'port': 9090,
            'address': '',
            'use_sim_time': use_sim_time
        }],
        output='screen'
    )
    
    return LaunchDescription([
        declare_use_sim_time,
        declare_use_rviz,
        declare_use_navigation,
        robot_description,
        rviz_node,
        navigation_launch,
        rosbridge_node
    ])
