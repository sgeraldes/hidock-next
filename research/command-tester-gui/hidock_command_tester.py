# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
HiDock Command Tester GUI

Interactive GUI application for testing HiDock commands with custom parameters.
Allows testing any command with any parameters and seeing the results.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-08-31
"""

import sys
import os
import time
import struct
import json
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent / "command-10-discovery"))

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import threading
from safe_testing_framework import SafeCommandTester
from response_decoder import HiDockResponseDecoder

class HiDockCommandTester:
    def __init__(self, root):
        self.root = root
        self.root.title("HiDock Command Tester")
        self.root.geometry("900x700")
        
        # Device tester
        self.tester = None
        self.connected = False
        self.decoder = HiDockResponseDecoder()
        
        # Command definitions
        self.commands = {
            1: "GET_DEVICE_INFO",
            2: "GET_DEVICE_TIME", 
            3: "SET_DEVICE_TIME",
            4: "GET_FILE_LIST",
            5: "TRANSFER_FILE",
            6: "GET_FILE_COUNT",
            7: "DELETE_FILE",
            8: "REQUEST_FIRMWARE_UPGRADE",
            9: "FIRMWARE_UPLOAD",
            10: "DEMO_CONTROL",
            11: "GET_SETTINGS",
            12: "SET_SETTINGS",
            13: "GET_FILE_BLOCK",
            14: "UNKNOWN_14 (Empty Response)",
            15: "UNKNOWN_15 (Empty Response)",
            16: "GET_CARD_INFO",
            17: "FORMAT_CARD",
            18: "GET_RECORDING_FILE",
            19: "RESTORE_FACTORY_SETTINGS",
            20: "SEND_MEETING_SCHEDULE_INFO"
        }
        
        # Common parameter presets
        self.param_presets = {
            "Empty": "",
            "Single Null": "00",
            "Double Null": "0000",
            "Quad Null": "00000000",
            "Demo Start (Cmd 10)": "34121000",
            "Demo Stop (Cmd 10)": "00000000",
            "File ID 0": "00000000",
            "File ID 1": "01000000",
            "File ID 2": "02000000",
            "Index 0": "0000",
            "Index 1": "0100",
            "Timestamp Now": "",  # Will be calculated
            "Jensen Magic": "1234",
            "Test Pattern": "deadbeef",
            "All FF": "ffffffff",
            "Custom...": "custom"
        }
        
        self.setup_ui()
        
    def setup_ui(self):
        """Setup the GUI interface"""
        
        # Main container
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Connection Frame
        conn_frame = ttk.LabelFrame(main_frame, text="Device Connection", padding="10")
        conn_frame.grid(row=0, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        self.connect_btn = ttk.Button(conn_frame, text="Connect Device", command=self.toggle_connection)
        self.connect_btn.grid(row=0, column=0, padx=5)
        
        self.conn_status = ttk.Label(conn_frame, text="Disconnected", foreground="red")
        self.conn_status.grid(row=0, column=1, padx=5)
        
        self.device_info = ttk.Label(conn_frame, text="")
        self.device_info.grid(row=0, column=2, padx=20)
        
        # Command Selection Frame
        cmd_frame = ttk.LabelFrame(main_frame, text="Command Selection", padding="10")
        cmd_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        ttk.Label(cmd_frame, text="Command:").grid(row=0, column=0, padx=5, sticky=tk.W)
        
        self.cmd_var = tk.StringVar()
        self.cmd_combo = ttk.Combobox(cmd_frame, textvariable=self.cmd_var, width=40, state="readonly")
        self.cmd_combo['values'] = [f"{cmd_id}: {name}" for cmd_id, name in self.commands.items()]
        self.cmd_combo.grid(row=0, column=1, padx=5, sticky=(tk.W, tk.E))
        self.cmd_combo.current(0)
        self.cmd_combo.bind('<<ComboboxSelected>>', self.on_command_selected)
        
        # Parameter Frame
        param_frame = ttk.LabelFrame(main_frame, text="Parameters", padding="10")
        param_frame.grid(row=2, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        ttk.Label(param_frame, text="Preset:").grid(row=0, column=0, padx=5, sticky=tk.W)
        
        self.preset_var = tk.StringVar()
        self.preset_combo = ttk.Combobox(param_frame, textvariable=self.preset_var, width=30, state="readonly")
        self.preset_combo['values'] = list(self.param_presets.keys())
        self.preset_combo.grid(row=0, column=1, padx=5)
        self.preset_combo.current(0)
        self.preset_combo.bind('<<ComboboxSelected>>', self.on_preset_selected)
        
        ttk.Label(param_frame, text="Hex Data:").grid(row=1, column=0, padx=5, sticky=tk.W)
        
        self.param_entry = ttk.Entry(param_frame, width=50)
        self.param_entry.grid(row=1, column=1, padx=5, sticky=(tk.W, tk.E))
        
        ttk.Label(param_frame, text="(Enter hex bytes, e.g., '01020304' or '01 02 03 04')").grid(
            row=2, column=1, padx=5, sticky=tk.W)
        
        # Control Buttons Frame
        ctrl_frame = ttk.Frame(main_frame)
        ctrl_frame.grid(row=3, column=0, columnspan=2, pady=10)
        
        self.send_btn = ttk.Button(ctrl_frame, text="Send Command", command=self.send_command, state="disabled")
        self.send_btn.grid(row=0, column=0, padx=5)
        
        ttk.Button(ctrl_frame, text="Clear Log", command=self.clear_log).grid(row=0, column=1, padx=5)
        
        ttk.Button(ctrl_frame, text="Save Log", command=self.save_log).grid(row=0, column=2, padx=5)
        
        self.health_check_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(ctrl_frame, text="Health Check After Command", 
                       variable=self.health_check_var).grid(row=0, column=3, padx=20)
        
        # Output Frame
        output_frame = ttk.LabelFrame(main_frame, text="Command Log", padding="10")
        output_frame.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        
        self.log_text = scrolledtext.ScrolledText(output_frame, width=100, height=25, wrap=tk.WORD)
        self.log_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure tags for colored text
        self.log_text.tag_config("command", foreground="blue", font=("Consolas", 10, "bold"))
        self.log_text.tag_config("success", foreground="green")
        self.log_text.tag_config("error", foreground="red")
        self.log_text.tag_config("info", foreground="black")
        self.log_text.tag_config("response", foreground="purple", font=("Consolas", 10))
        
        # Configure grid weights
        main_frame.rowconfigure(4, weight=1)
        main_frame.columnconfigure(0, weight=1)
        output_frame.rowconfigure(0, weight=1)
        output_frame.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        self.root.columnconfigure(0, weight=1)
        
        # Initial log message
        self.log("HiDock Command Tester Started", "info")
        self.log("Click 'Connect Device' to begin", "info")
        
    def on_command_selected(self, event=None):
        """Handle command selection"""
        cmd_text = self.cmd_var.get()
        if not cmd_text:
            return
            
        cmd_id = int(cmd_text.split(":")[0])
        
        # Set suggested parameters based on command
        if cmd_id == 10:
            self.preset_combo.set("Demo Start (Cmd 10)")
            self.on_preset_selected()
        elif cmd_id in [1, 2, 6, 11, 16, 19]:
            self.preset_combo.set("Empty")
            self.on_preset_selected()
        elif cmd_id == 4:
            self.preset_combo.set("Index 0")
            self.on_preset_selected()
        elif cmd_id in [5, 7, 18]:
            self.preset_combo.set("File ID 0")
            self.on_preset_selected()
            
    def on_preset_selected(self, event=None):
        """Handle preset selection"""
        preset = self.preset_var.get()
        
        if preset == "Custom...":
            self.param_entry.delete(0, tk.END)
            self.param_entry.focus()
        elif preset == "Timestamp Now":
            timestamp = int(time.time())
            hex_data = struct.pack('<Q', timestamp).hex()
            self.param_entry.delete(0, tk.END)
            self.param_entry.insert(0, hex_data)
        elif preset in self.param_presets:
            hex_data = self.param_presets[preset]
            self.param_entry.delete(0, tk.END)
            self.param_entry.insert(0, hex_data)
            
    def toggle_connection(self):
        """Connect or disconnect from device"""
        if not self.connected:
            self.connect_device()
        else:
            self.disconnect_device()
            
    def connect_device(self):
        """Connect to HiDock device"""
        self.log("\n" + "="*60, "info")
        self.log("Connecting to device...", "info")
        
        try:
            self.tester = SafeCommandTester()
            
            if not self.tester.initialize_backend():
                self.log("Failed to initialize USB backend", "error")
                return
                
            if not self.tester.connect_device():
                self.log("Failed to connect to device", "error")
                return
                
            self.connected = True
            self.connect_btn.config(text="Disconnect Device")
            self.conn_status.config(text="Connected", foreground="green")
            self.send_btn.config(state="normal")
            
            self.log("Device connected successfully!", "success")
            
            # Try to get device info, but don't fail if it doesn't work
            self.log("Attempting to get device information...", "info")
            time.sleep(1)  # Give device time to stabilize
            try:
                self.get_device_info()
            except Exception as e:
                self.log(f"Note: Could not get device info: {e}", "warning")
                self.log("Device is connected and ready for commands", "info")
            
        except Exception as e:
            self.log(f"Connection error: {e}", "error")
            
    def disconnect_device(self):
        """Disconnect from device"""
        if self.tester:
            self.tester.cleanup()
            self.tester = None
            
        self.connected = False
        self.connect_btn.config(text="Connect Device")
        self.conn_status.config(text="Disconnected", foreground="red")
        self.device_info.config(text="")
        self.send_btn.config(state="disabled")
        
        self.log("Device disconnected", "info")
        
    def get_device_info(self):
        """Get and display device information"""
        try:
            # Send GET_DEVICE_INFO command without health check
            # Use the device directly to avoid health check loop
            response = self.tester.device._send_and_receive(1, b'', timeout_ms=3000)
            
            if response and isinstance(response, dict):
                body = response.get('body', b'')
                if body:
                    # Use decoder to parse the response
                    hex_data = body.hex()
                    decoded = self.decoder.decode_response(1, hex_data)
                    
                    if decoded:
                        # Extract first line for status bar
                        first_line = decoded.split('\n')[2] if '\n' in decoded else decoded
                        self.device_info.config(text=first_line[:50])
                        self.log("Device info retrieved", "success")
                    else:
                        self.device_info.config(text="Device connected")
                else:
                    self.device_info.config(text="Device connected")
            else:
                self.device_info.config(text="Device connected")
                    
        except Exception as e:
            # Don't fail, just note it
            self.device_info.config(text="Device connected")
            self.log(f"Note: Device info not available", "warning")
            
    def send_command(self):
        """Send the selected command with parameters"""
        if not self.connected:
            messagebox.showerror("Error", "Device not connected")
            return
            
        # Get command ID
        cmd_text = self.cmd_var.get()
        if not cmd_text:
            messagebox.showerror("Error", "Please select a command")
            return
            
        cmd_id = int(cmd_text.split(":")[0])
        cmd_name = self.commands[cmd_id]
        
        # Get parameters
        hex_str = self.param_entry.get().strip()
        hex_str = hex_str.replace(" ", "").replace(",", "")
        
        try:
            if hex_str:
                param_bytes = bytes.fromhex(hex_str)
            else:
                param_bytes = b''
        except ValueError:
            messagebox.showerror("Error", "Invalid hex data")
            return
            
        # Log command being sent
        self.log("\n" + "="*60, "info")
        self.log(f"SENDING COMMAND {cmd_id}: {cmd_name}", "command")
        self.log(f"Parameters: {param_bytes.hex() if param_bytes else '(empty)'} ({len(param_bytes)} bytes)", "info")
        
        # Send command in thread to avoid blocking GUI
        thread = threading.Thread(target=self.send_command_thread, args=(cmd_id, param_bytes, cmd_name))
        thread.daemon = True
        thread.start()
        
    def send_command_thread(self, cmd_id, param_bytes, cmd_name):
        """Send command in separate thread"""
        try:
            start_time = time.time()
            
            # Perform health check before if enabled
            if self.health_check_var.get():
                health_result = self.tester.test_device_health()
                if not health_result:
                    self.log("Pre-command health check failed!", "error")
                    return
                    
            # Send the actual command
            # Skip internal health check if GUI health check is enabled (we already did it)
            # or if user disabled health checks
            skip_internal_health = self.health_check_var.get() or True  # Always skip for now
            result = self.tester.safe_command_test(cmd_id, param_bytes, cmd_name, skip_health_check=skip_internal_health)
            
            elapsed = time.time() - start_time
            
            # Log results
            if result['status'] == 'success':
                response = result.get('response', {})
                body_hex = response.get('body_hex', '')
                
                self.log(f"Response received in {elapsed:.3f}s", "success")
                
                if body_hex:
                    self.log(f"Response data: {body_hex}", "response")
                    
                    # Try to decode response for known commands
                    self.decode_response(cmd_id, body_hex)
                else:
                    self.log("Response: (empty)", "response")
                    
            else:
                self.log(f"Command failed: {result.get('error', 'Unknown error')}", "error")
                
            # Perform health check after if enabled
            if self.health_check_var.get():
                health_result = self.tester.test_device_health()
                if health_result:
                    self.log("Post-command health check: PASSED", "success")
                else:
                    self.log("Post-command health check: FAILED", "error")
                    
        except Exception as e:
            self.log(f"Error sending command: {e}", "error")
            
    def decode_response(self, cmd_id, hex_data):
        """Try to decode response data for known commands"""
        try:
            # Use the comprehensive decoder
            decoded = self.decoder.decode_response(cmd_id, hex_data)
            
            if decoded:
                # Log the decoded data in a formatted way
                self.log("\n--- DECODED RESPONSE ---", "info")
                for line in decoded.split('\n'):
                    if line.strip():
                        self.log(line, "response")
                self.log("--- END DECODED ---\n", "info")
            else:
                # If decoder returns None, try basic decoding
                data = bytes.fromhex(hex_data)
                
                # Show ASCII representation if printable
                ascii_str = ''.join(chr(b) if 32 <= b <= 126 else '.' for b in data)
                if any(32 <= b <= 126 for b in data):
                    self.log(f"ASCII: {ascii_str}", "info")
                    
        except Exception as e:
            # If we can't decode, that's fine - just show hex
            self.log(f"Could not decode response: {e}", "warning")
            
    def log(self, message, tag="info"):
        """Add message to log with formatting"""
        self.log_text.insert(tk.END, message + "\n", tag)
        self.log_text.see(tk.END)
        self.root.update_idletasks()
        
    def clear_log(self):
        """Clear the log window"""
        self.log_text.delete(1.0, tk.END)
        self.log("Log cleared", "info")
        
    def save_log(self):
        """Save log to file"""
        from tkinter import filedialog
        
        filename = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
            initialfile=f"hidock_test_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        )
        
        if filename:
            try:
                with open(filename, 'w') as f:
                    f.write(self.log_text.get(1.0, tk.END))
                self.log(f"Log saved to: {filename}", "success")
            except Exception as e:
                self.log(f"Failed to save log: {e}", "error")

def main():
    root = tk.Tk()
    app = HiDockCommandTester(root)
    
    # Handle window close
    def on_closing():
        if app.connected:
            app.disconnect_device()
        root.destroy()
        
    root.protocol("WM_DELETE_WINDOW", on_closing)
    
    try:
        root.mainloop()
    except KeyboardInterrupt:
        if app.connected:
            app.disconnect_device()
        sys.exit(0)

if __name__ == "__main__":
    main()