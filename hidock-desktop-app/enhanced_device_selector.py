# -*- coding: utf-8 -*-
"""
Enhanced Device Selector Widget for HiDock Desktop Application

This module provides an enhanced device selection interface with status indicators,
device information display, and improved user experience for device management.

Requirements: 6.1, 6.2, 6.3
"""

import os
import threading
import tkinter
from typing import List, Dict, Optional, Callable

import customtkinter as ctk
from config_and_logger import logger
from PIL import Image

class DeviceInfo:
    """Container for device information."""
    
    def __init__(self, name: str, vendor_id: int, product_id: int, status: str = "available",
                 is_hidock: bool = False, version: str = "", capabilities: List[str] = None):
        self.name = name
        self.vendor_id = vendor_id
        self.product_id = product_id
        self.status = status  # available, connected, error
        self.is_hidock = is_hidock
        self.version = version
        self.capabilities = capabilities or []
        
    def get_display_name(self) -> str:
        """Get formatted display name for the device."""
        status_icon = {
            "connected": "🟢",
            "available": "🔵",
            "error": "🔴"
        }.get(self.status, "⚪")
        
        hidock_indicator = "🎵" if self.is_hidock else "📱"
        
        name_parts = [status_icon, hidock_indicator, self.name]
        if self.version:
            name_parts.append(f"v{self.version}")
            
        return " ".join(name_parts)
    
    def get_detail_text(self) -> str:
        """Get detailed device information text."""
        details = [
            f"VID: {hex(self.vendor_id)} | PID: {hex(self.product_id)}",
            f"Status: {self.status.title()}"
        ]
        
        if self.is_hidock and self.capabilities:
            details.append(f"Features: {', '.join(self.capabilities)}")
            
        return "\n".join(details)


class EnhancedDeviceSelector(ctk.CTkFrame):
    """Enhanced device selector with status indicators and detailed information."""
    
    def __init__(self, parent, command: Optional[Callable] = None, scan_callback: Optional[Callable] = None, **kwargs):
        super().__init__(parent, **kwargs)
        
        self.command = command
        self.scan_callback = scan_callback
        self.devices: List[DeviceInfo] = []
        self.selected_device: Optional[DeviceInfo] = None
        self.is_scanning = False
        
        # Load icons
        self._load_icons()
        
        # Create UI
        self._create_widgets()
        
    def _load_icons(self):
        """Load device-related icons."""
        self.icons = {}
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            icons_dir = os.path.join(script_dir, "icons", "black", "16")
            
            icon_files = {
                "refresh": "refresh.png",
                "usb": "usb.png",
                "check": "check-circle.png",
                "alert": "alert-circle.png",
                "info": "info-circle.png"
            }
            
            for name, filename in icon_files.items():
                icon_path = os.path.join(icons_dir, filename)
                if os.path.exists(icon_path):
                    image = Image.open(icon_path)
                    self.icons[name] = ctk.CTkImage(
                        light_image=image, dark_image=image, size=(16, 16)
                    )
                    
        except Exception as e:
            logger.warning("EnhancedDeviceSelector", "_load_icons", f"Error loading icons: {e}")
    
    def _create_widgets(self):
        """Create the device selector interface."""
        # Header with scan button
        header_frame = ctk.CTkFrame(self)
        header_frame.pack(fill="x", padx=5, pady=5)
        
        ctk.CTkLabel(
            header_frame,
            text="🔌 USB Device Selection",
            font=ctk.CTkFont(size=14, weight="bold")
        ).pack(side="left", padx=10, pady=5)
        
        self.scan_button = ctk.CTkButton(
            header_frame,
            text="Scan Devices",
            image=self.icons.get("refresh"),
            compound="left",
            width=120,
            height=28,
            command=self._scan_devices
        )
        self.scan_button.pack(side="right", padx=10, pady=5)
        
        # Device list frame
        self.device_list_frame = ctk.CTkScrollableFrame(self, height=200)
        self.device_list_frame.pack(fill="both", expand=True, padx=5, pady=(0, 5))
        
        # Status bar
        self.status_frame = ctk.CTkFrame(self)
        self.status_frame.pack(fill="x", padx=5, pady=(0, 5))
        
        self.status_label = ctk.CTkLabel(
            self.status_frame,
            text="Click 'Scan Devices' to detect available devices",
            anchor="w"
        )
        self.status_label.pack(fill="x", padx=10, pady=5)
        
        # Progress bar (initially hidden)
        self.progress_bar = ctk.CTkProgressBar(self.status_frame)
        self.progress_bar.pack_forget()
        
    def _scan_devices(self):
        """Start device scanning process."""
        if self.is_scanning:
            return
            
        self.is_scanning = True
        self.scan_button.configure(state="disabled", text="Scanning...")
        
        # Show progress bar
        self.progress_bar.pack(fill="x", padx=10, pady=(0, 5))
        self.progress_bar.configure(mode="indeterminate")
        self.progress_bar.start()
        
        self.status_label.configure(text="🔍 Scanning for USB devices...")
        
        # Clear existing devices
        self._clear_device_list()
        
        # Start scanning in background thread
        threading.Thread(target=self._scan_devices_thread, daemon=True).start()
    
    def _scan_devices_thread(self):
        """Background thread for device scanning."""
        try:
            # Simulate device scanning (replace with actual USB enumeration)
            devices = self._enumerate_usb_devices()
            
            # Update UI on main thread
            self.after(0, self._on_scan_complete, devices)
            
        except Exception as e:
            logger.error("EnhancedDeviceSelector", "_scan_devices_thread", f"Error scanning devices: {e}")
            self.after(0, self._on_scan_error, str(e))
    
    def _enumerate_usb_devices(self) -> List[DeviceInfo]:
        """Enumerate USB devices and identify HiDock devices."""
        devices = []
        
        try:
            import usb.core
            
            # Find all USB devices
            usb_devices = usb.core.find(find_all=True)
            
            for device in usb_devices:
                try:
                    # Try to get device name
                    try:
                        name = usb.util.get_string(device, device.iProduct) or f"USB Device {hex(device.idProduct)}"
                    except:
                        name = f"USB Device {hex(device.idProduct)}"
                    
                    # Check if it's a HiDock device
                    is_hidock = self._is_hidock_device(device.idVendor, device.idProduct)
                    
                    # Determine status
                    status = "available"
                    capabilities = []
                    version = ""
                    
                    if is_hidock:
                        capabilities = ["Audio Recording", "File Transfer", "Real-time Sync"]
                        # Try to get version info if possible
                        try:
                            version = f"{device.bcdDevice >> 8}.{device.bcdDevice & 0xFF}"
                        except:
                            pass
                    
                    device_info = DeviceInfo(
                        name=name,
                        vendor_id=device.idVendor,
                        product_id=device.idProduct,
                        status=status,
                        is_hidock=is_hidock,
                        version=version,
                        capabilities=capabilities
                    )
                    
                    devices.append(device_info)
                    
                except Exception as e:
                    logger.warning("EnhancedDeviceSelector", "_enumerate_usb_devices", f"Error processing device: {e}")
                    continue
                    
        except Exception as e:
            logger.error("EnhancedDeviceSelector", "_enumerate_usb_devices", f"Error enumerating USB devices: {e}")
        
        # Sort devices: HiDock devices first, then by name
        devices.sort(key=lambda d: (not d.is_hidock, d.name))
        return devices
    
    def _is_hidock_device(self, vendor_id: int, product_id: int) -> bool:
        """Check if device is a HiDock device based on VID/PID."""
        # Common HiDock VID/PID combinations
        hidock_devices = [
            (0x0483, 0x5740),  # Example HiDock VID/PID
            (0x0483, 0x5741),  # Another example
            # Add actual HiDock VID/PID combinations here
        ]
        
        return (vendor_id, product_id) in hidock_devices
    
    def _on_scan_complete(self, devices: List[DeviceInfo]):
        """Handle successful device scan completion."""
        self.is_scanning = False
        self.devices = devices
        
        # Update UI
        self.scan_button.configure(state="normal", text="Scan Devices")
        self.progress_bar.stop()
        self.progress_bar.pack_forget()
        
        # Update device list
        self._populate_device_list()
        
        # Update status
        hidock_count = sum(1 for d in devices if d.is_hidock)
        total_count = len(devices)
        self.status_label.configure(
            text=f"✅ Found {total_count} devices ({hidock_count} HiDock devices)"
        )
        
        # Call scan callback if provided
        if self.scan_callback:
            self.scan_callback(devices)
    
    def _on_scan_error(self, error_message: str):
        """Handle device scan error."""
        self.is_scanning = False
        
        # Update UI
        self.scan_button.configure(state="normal", text="Scan Devices")
        self.progress_bar.stop()
        self.progress_bar.pack_forget()
        
        self.status_label.configure(
            text=f"❌ Scan failed: {error_message}"
        )
    
    def _clear_device_list(self):
        """Clear the device list display."""
        for widget in self.device_list_frame.winfo_children():
            widget.destroy()
    
    def _populate_device_list(self):
        """Populate the device list with found devices."""
        self._clear_device_list()
        
        if not self.devices:
            no_devices_label = ctk.CTkLabel(
                self.device_list_frame,
                text="No devices found",
                text_color="gray"
            )
            no_devices_label.pack(pady=20)
            return
        
        for device in self.devices:
            self._create_device_item(device)
    
    def _create_device_item(self, device: DeviceInfo):
        """Create a device item widget."""
        # Device item frame
        item_frame = ctk.CTkFrame(self.device_list_frame)
        item_frame.pack(fill="x", padx=5, pady=2)
        
        # Selection state tracking
        is_selected = device == self.selected_device
        
        # Main device button
        device_button = ctk.CTkButton(
            item_frame,
            text=device.get_display_name(),
            anchor="w",
            height=40,
            command=lambda d=device: self._select_device(d),
            fg_color="green" if is_selected else None,
            hover_color="darkgreen" if is_selected else None
        )
        device_button.pack(fill="x", padx=5, pady=5)
        
        # Device details (shown for HiDock devices or selected devices)
        if device.is_hidock or is_selected:
            details_label = ctk.CTkLabel(
                item_frame,
                text=device.get_detail_text(),
                font=ctk.CTkFont(size=10),
                anchor="w",
                text_color="gray70"
            )
            details_label.pack(fill="x", padx=15, pady=(0, 5))
        
        # Store references for selection updates
        device_button._device = device
        item_frame._device_button = device_button
    
    def _select_device(self, device: DeviceInfo):
        """Select a device."""
        self.selected_device = device
        
        # Update button appearances
        for item_frame in self.device_list_frame.winfo_children():
            if hasattr(item_frame, '_device_button'):
                button = item_frame._device_button
                if button._device == device:
                    button.configure(fg_color="green", hover_color="darkgreen")
                else:
                    button.configure(fg_color=None, hover_color=None)
        
        # Update status
        self.status_label.configure(
            text=f"📱 Selected: {device.name} ({device.status})"
        )
        
        # Call command callback if provided
        if self.command:
            self.command(device)
        
        logger.info("EnhancedDeviceSelector", "_select_device", f"Selected device: {device.name}")
    
    def get_selected_device(self) -> Optional[DeviceInfo]:
        """Get the currently selected device."""
        return self.selected_device
    
    def set_devices(self, devices: List[DeviceInfo]):
        """Set devices externally (for testing or manual population)."""
        self.devices = devices
        self._populate_device_list()
    
    def refresh_devices(self):
        """Refresh the device list."""
        self._scan_devices()


def create_enhanced_device_selector(parent, command=None, scan_callback=None, **kwargs) -> EnhancedDeviceSelector:
    """Factory function to create an enhanced device selector."""
    return EnhancedDeviceSelector(parent, command=command, scan_callback=scan_callback, **kwargs)


if __name__ == "__main__":
    # Test the enhanced device selector
    def on_device_selected(device):
        print(f"Selected device: {device.name} (HiDock: {device.is_hidock})")
    
    def on_scan_complete(devices):
        print(f"Scan complete: {len(devices)} devices found")
    
    root = ctk.CTk()
    root.title("Enhanced Device Selector Test")
    root.geometry("600x400")
    
    selector = EnhancedDeviceSelector(
        root,
        command=on_device_selected,
        scan_callback=on_scan_complete
    )
    selector.pack(fill="both", expand=True, padx=10, pady=10)
    
    root.mainloop()