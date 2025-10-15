"""
Extended Features Integration Module

This module provides integration between the Extended Jensen Protocol and the existing
HiDock desktop application. It adds advanced hardware access capabilities to the GUI
and demonstrates how to use the extended protocol commands.

Usage:
    from extended_features_integration import ExtendedFeaturesManager
    
    # Initialize with existing USB backend
    ext_manager = ExtendedFeaturesManager(usb_backend)
    
    # Enable extended features
    if ext_manager.initialize():
        # Use extended features
        hardware_info = ext_manager.get_hardware_info()
        performance = ext_manager.get_performance_metrics()

Author: HiDock Hardware Analysis Project  
Version: 1.0.0
Date: 2025-08-31
"""

import time
import threading
from typing import Dict, List, Optional, Callable
from dataclasses import asdict

from config_and_logger import logger
from jensen_protocol_extensions import (
    ExtendedJensenProtocol, 
    HardwareInfo, 
    PerformanceMetrics,
    AudioRegisterState
)


class ExtendedFeaturesManager:
    """
    Manager class for extended HiDock features integration
    
    This class provides a high-level interface for using extended Jensen protocol
    features within the existing desktop application.
    """
    
    def __init__(self, usb_backend_instance_ref):
        """Initialize extended features manager"""
        self.extended_protocol = ExtendedJensenProtocol(usb_backend_instance_ref)
        self.is_initialized = False
        self.monitoring_active = False
        self.monitoring_thread = None
        self.monitoring_callbacks = []
        self.hardware_info = None
        self.last_performance_metrics = None
        
        # Performance monitoring configuration
        self.monitoring_interval = 2.0  # seconds
        self.performance_alert_thresholds = {
            'cpu_usage': 90.0,      # %
            'dsp_usage': 95.0,      # %  
            'memory_usage': 90.0,   # %
            'temperature': 75.0     # °C
        }
        
        logger.info("ExtendedFeatures", "__init__", "Extended features manager created")
    
    def initialize(self) -> bool:
        """
        Initialize extended features
        
        Returns:
            bool: True if initialization successful
        """
        try:
            # First ensure basic device connection
            if not self.extended_protocol.is_connected():
                logger.error("ExtendedFeatures", "initialize", 
                           "Device not connected, cannot enable extended features")
                return False
            
            # Enable extended protocol
            if not self.extended_protocol.enable_extended_protocol():
                logger.error("ExtendedFeatures", "initialize",
                           "Failed to enable extended protocol")
                return False
            
            # Get hardware information
            self.hardware_info = self.extended_protocol.get_hardware_info()
            if not self.hardware_info:
                logger.warning("ExtendedFeatures", "initialize",
                              "Could not retrieve hardware info, continuing anyway")
            
            self.is_initialized = True
            logger.info("ExtendedFeatures", "initialize", 
                       "Extended features initialized successfully")
            
            return True
            
        except Exception as e:
            logger.error("ExtendedFeatures", "initialize", 
                        f"Initialization failed: {e}")
            return False
    
    def get_hardware_info(self) -> Optional[Dict]:
        """
        Get hardware information as dictionary
        
        Returns:
            Dict: Hardware information or None if not available
        """
        if not self.is_initialized:
            logger.error("ExtendedFeatures", "get_hardware_info",
                        "Extended features not initialized")
            return None
        
        if not self.hardware_info:
            self.hardware_info = self.extended_protocol.get_hardware_info()
        
        if self.hardware_info:
            return asdict(self.hardware_info)
        return None
    
    def get_performance_metrics(self) -> Optional[Dict]:
        """
        Get current performance metrics as dictionary
        
        Returns:
            Dict: Performance metrics or None if not available
        """
        if not self.is_initialized:
            logger.error("ExtendedFeatures", "get_performance_metrics",
                        "Extended features not initialized")
            return None
        
        metrics = self.extended_protocol.get_performance_metrics()
        if metrics:
            self.last_performance_metrics = metrics
            return asdict(metrics)
        return None
    
    def read_memory(self, address: int, size: int) -> Optional[bytes]:
        """
        Read memory with safety checks
        
        Args:
            address (int): Memory address
            size (int): Number of bytes to read
            
        Returns:
            bytes: Memory data or None if failed
        """
        if not self.is_initialized:
            logger.error("ExtendedFeatures", "read_memory",
                        "Extended features not initialized")
            return None
        
        # Safety check for reasonable memory ranges
        if address < 0x20000000 or address > 0xA0000000:
            logger.warning("ExtendedFeatures", "read_memory",
                          f"Reading from potentially unsafe address: 0x{address:08X}")
        
        return self.extended_protocol.direct_memory_read(address, size)
    
    def read_storage_blocks(self, block_address: int, block_count: int) -> Optional[bytes]:
        """
        Read raw storage blocks
        
        Args:
            block_address (int): Starting block address
            block_count (int): Number of blocks to read
            
        Returns:
            bytes: Block data or None if failed
        """
        if not self.is_initialized:
            logger.error("ExtendedFeatures", "read_storage_blocks",
                        "Extended features not initialized")
            return None
        
        return self.extended_protocol.storage_raw_read(block_address, block_count)
    
    def start_performance_monitoring(self, callback: Optional[Callable] = None):
        """
        Start continuous performance monitoring
        
        Args:
            callback: Optional callback function for performance updates
        """
        if not self.is_initialized:
            logger.error("ExtendedFeatures", "start_performance_monitoring",
                        "Extended features not initialized")
            return
        
        if self.monitoring_active:
            logger.warning("ExtendedFeatures", "start_performance_monitoring",
                          "Performance monitoring already active")
            return
        
        if callback:
            self.monitoring_callbacks.append(callback)
        
        self.monitoring_active = True
        self.monitoring_thread = threading.Thread(
            target=self._performance_monitoring_loop,
            daemon=True
        )
        self.monitoring_thread.start()
        
        logger.info("ExtendedFeatures", "start_performance_monitoring",
                   "Performance monitoring started")
    
    def stop_performance_monitoring(self):
        """Stop continuous performance monitoring"""
        if not self.monitoring_active:
            return
        
        self.monitoring_active = False
        
        if self.monitoring_thread and self.monitoring_thread.is_alive():
            self.monitoring_thread.join(timeout=5.0)
        
        logger.info("ExtendedFeatures", "stop_performance_monitoring",
                   "Performance monitoring stopped")
    
    def add_monitoring_callback(self, callback: Callable):
        """Add callback for performance monitoring updates"""
        if callback not in self.monitoring_callbacks:
            self.monitoring_callbacks.append(callback)
    
    def remove_monitoring_callback(self, callback: Callable):
        """Remove callback for performance monitoring updates"""
        if callback in self.monitoring_callbacks:
            self.monitoring_callbacks.remove(callback)
    
    def _performance_monitoring_loop(self):
        """Performance monitoring thread loop"""
        logger.info("ExtendedFeatures", "_performance_monitoring_loop",
                   "Performance monitoring thread started")
        
        while self.monitoring_active:
            try:
                # Get performance metrics
                metrics = self.extended_protocol.get_performance_metrics()
                if metrics:
                    self.last_performance_metrics = metrics
                    
                    # Check for alerts
                    self._check_performance_alerts(metrics)
                    
                    # Notify callbacks
                    metrics_dict = asdict(metrics)
                    for callback in self.monitoring_callbacks:
                        try:
                            callback(metrics_dict)
                        except Exception as e:
                            logger.error("ExtendedFeatures", "_performance_monitoring_loop",
                                        f"Callback error: {e}")
                
                # Wait for next monitoring cycle
                time.sleep(self.monitoring_interval)
                
            except Exception as e:
                logger.error("ExtendedFeatures", "_performance_monitoring_loop",
                           f"Monitoring error: {e}")
                time.sleep(self.monitoring_interval)  # Continue monitoring despite errors
        
        logger.info("ExtendedFeatures", "_performance_monitoring_loop",
                   "Performance monitoring thread stopped")
    
    def _check_performance_alerts(self, metrics: PerformanceMetrics):
        """Check performance metrics against alert thresholds"""
        alerts = []
        
        if metrics.cpu_usage > self.performance_alert_thresholds['cpu_usage']:
            alerts.append(f"High CPU usage: {metrics.cpu_usage:.1f}%")
        
        if metrics.dsp_usage > self.performance_alert_thresholds['dsp_usage']:
            alerts.append(f"High DSP usage: {metrics.dsp_usage:.1f}%")
        
        if metrics.memory_usage > self.performance_alert_thresholds['memory_usage']:
            alerts.append(f"High memory usage: {metrics.memory_usage:.1f}%")
        
        if metrics.system_temperature > self.performance_alert_thresholds['temperature']:
            alerts.append(f"High temperature: {metrics.system_temperature:.1f}°C")
        
        if alerts:
            logger.warning("ExtendedFeatures", "_check_performance_alerts",
                          f"Performance alerts: {', '.join(alerts)}")
    
    def get_device_capabilities_summary(self) -> Dict:
        """
        Get a comprehensive summary of device capabilities
        
        Returns:
            Dict: Device capabilities summary
        """
        if not self.is_initialized:
            return {"error": "Extended features not initialized"}
        
        summary = {
            "extended_protocol_enabled": True,
            "hardware_info_available": self.hardware_info is not None,
            "performance_monitoring_active": self.monitoring_active,
            "capabilities": {
                "direct_memory_access": True,
                "raw_storage_access": True,
                "audio_register_access": True,
                "performance_monitoring": True,
                "hardware_diagnostics": True
            }
        }
        
        if self.hardware_info:
            summary["hardware_specs"] = {
                "cpu_frequency": self.hardware_info.cpu_frequency,
                "dsp_frequency": self.hardware_info.dsp_frequency,
                "sram_size": self.hardware_info.sram_size,
                "storage_size": self.hardware_info.external_storage_size,
                "dios_version": self.hardware_info.dios_version,
                "rome_version": self.hardware_info.rome_version
            }
        
        if self.last_performance_metrics:
            summary["current_performance"] = {
                "cpu_usage": self.last_performance_metrics.cpu_usage,
                "dsp_usage": self.last_performance_metrics.dsp_usage,
                "memory_usage": self.last_performance_metrics.memory_usage,
                "temperature": self.last_performance_metrics.system_temperature
            }
        
        return summary
    
    def shutdown(self):
        """Shutdown extended features manager"""
        logger.info("ExtendedFeatures", "shutdown", "Shutting down extended features")
        
        # Stop monitoring if active
        if self.monitoring_active:
            self.stop_performance_monitoring()
        
        # Clear callbacks
        self.monitoring_callbacks.clear()
        
        # Reset state
        self.is_initialized = False
        self.hardware_info = None
        self.last_performance_metrics = None
        
        logger.info("ExtendedFeatures", "shutdown", "Extended features shutdown complete")


class ExtendedFeaturesGUIIntegration:
    """
    GUI integration helpers for extended features
    
    This class provides methods to integrate extended features into the existing
    customtkinter GUI application.
    """
    
    @staticmethod
    def create_hardware_info_display(parent, hardware_info: HardwareInfo) -> dict:
        """
        Create hardware info display widgets
        
        Args:
            parent: Parent tkinter widget
            hardware_info: Hardware information object
            
        Returns:
            dict: Dictionary of created widgets
        """
        import customtkinter as ctk
        
        widgets = {}
        
        # Hardware info frame
        info_frame = ctk.CTkFrame(parent)
        info_frame.pack(fill="x", padx=10, pady=5)
        
        widgets['frame'] = info_frame
        
        # Title
        title_label = ctk.CTkLabel(info_frame, text="Hardware Information", 
                                  font=ctk.CTkFont(size=16, weight="bold"))
        title_label.pack(pady=(10, 5))
        widgets['title'] = title_label
        
        # Hardware specs
        specs_text = f"""CPU: {hardware_info.cpu_frequency} MHz
DSP: {hardware_info.dsp_frequency} MHz  
SRAM: {hardware_info.sram_size // 1024} KB
Flash: {hardware_info.flash_size // (1024*1024)} MB
Storage: {hardware_info.external_storage_size // (1024*1024*1024)} GB
DIOS: {hardware_info.dios_version}
ROME: {hardware_info.rome_version}
Zephyr: {hardware_info.zephyr_version}"""
        
        specs_label = ctk.CTkLabel(info_frame, text=specs_text, 
                                  justify="left", font=ctk.CTkFont(family="monospace"))
        specs_label.pack(pady=5, padx=10)
        widgets['specs'] = specs_label
        
        return widgets
    
    @staticmethod
    def create_performance_monitor_display(parent) -> dict:
        """
        Create performance monitoring display widgets
        
        Args:
            parent: Parent tkinter widget
            
        Returns:
            dict: Dictionary of created widgets including update method
        """
        import customtkinter as ctk
        
        widgets = {}
        
        # Performance frame
        perf_frame = ctk.CTkFrame(parent)
        perf_frame.pack(fill="x", padx=10, pady=5)
        widgets['frame'] = perf_frame
        
        # Title
        title_label = ctk.CTkLabel(perf_frame, text="Performance Monitor",
                                  font=ctk.CTkFont(size=16, weight="bold"))
        title_label.pack(pady=(10, 5))
        widgets['title'] = title_label
        
        # Performance metrics labels
        cpu_label = ctk.CTkLabel(perf_frame, text="CPU: ---%")
        cpu_label.pack(pady=2)
        widgets['cpu'] = cpu_label
        
        dsp_label = ctk.CTkLabel(perf_frame, text="DSP: ---%")
        dsp_label.pack(pady=2)
        widgets['dsp'] = dsp_label
        
        memory_label = ctk.CTkLabel(perf_frame, text="Memory: ---%")
        memory_label.pack(pady=2)
        widgets['memory'] = memory_label
        
        temp_label = ctk.CTkLabel(perf_frame, text="Temperature: ---°C")
        temp_label.pack(pady=2)
        widgets['temperature'] = temp_label
        
        def update_performance_display(metrics_dict: Dict):
            """Update performance display with new metrics"""
            try:
                cpu_label.configure(text=f"CPU: {metrics_dict['cpu_usage']:.1f}%")
                dsp_label.configure(text=f"DSP: {metrics_dict['dsp_usage']:.1f}%")
                memory_label.configure(text=f"Memory: {metrics_dict['memory_usage']:.1f}%")
                temp_label.configure(text=f"Temperature: {metrics_dict['system_temperature']:.1f}°C")
            except Exception as e:
                logger.error("GUI", "update_performance_display", f"Update error: {e}")
        
        widgets['update_method'] = update_performance_display
        
        return widgets


# Example usage and testing functions
def test_extended_features(usb_backend):
    """
    Test function for extended features
    
    Args:
        usb_backend: USB backend instance
    """
    logger.info("ExtendedFeatures", "test_extended_features", "Starting extended features test")
    
    # Create and initialize extended features manager
    ext_manager = ExtendedFeaturesManager(usb_backend)
    
    if not ext_manager.initialize():
        logger.error("ExtendedFeatures", "test_extended_features", 
                    "Failed to initialize extended features")
        return False
    
    # Test hardware info
    hardware_info = ext_manager.get_hardware_info()
    if hardware_info:
        logger.info("ExtendedFeatures", "test_extended_features",
                   f"Hardware Info: CPU={hardware_info['cpu_frequency']}MHz, "
                   f"DSP={hardware_info['dsp_frequency']}MHz")
    
    # Test performance metrics
    performance = ext_manager.get_performance_metrics()
    if performance:
        logger.info("ExtendedFeatures", "test_extended_features",
                   f"Performance: CPU={performance['cpu_usage']:.1f}%, "
                   f"Temp={performance['system_temperature']:.1f}°C")
    
    # Test memory read (safe region)
    memory_data = ext_manager.read_memory(0x20000000, 256)  # Read from SRAM
    if memory_data:
        logger.info("ExtendedFeatures", "test_extended_features",
                   f"Memory read successful: {len(memory_data)} bytes")
    
    # Test storage read
    storage_data = ext_manager.read_storage_blocks(0, 1)  # Read first block
    if storage_data:
        logger.info("ExtendedFeatures", "test_extended_features",
                   f"Storage read successful: {len(storage_data)} bytes")
    
    # Get capabilities summary
    capabilities = ext_manager.get_device_capabilities_summary()
    logger.info("ExtendedFeatures", "test_extended_features",
               f"Device capabilities: {capabilities}")
    
    # Clean up
    ext_manager.shutdown()
    
    logger.info("ExtendedFeatures", "test_extended_features", "Extended features test completed")
    return True