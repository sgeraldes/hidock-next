# -*- coding: utf-8-sig -*-
#!/usr/bin/env python3
"""
Simple HiDock Command Tester GUI

A simplified GUI that connects directly to the device without complex health checks.

Author: HiDock Research Project
Version: 1.0.0
Date: 2025-09-01
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import sys
import os
import time
import struct
from datetime import datetime
import threading

# Add to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'hidock-desktop-app'))

from jensen import HiDockJensen
from response_decoder import HiDockResponseDecoder
import usb.backend.libusb1

class SimpleHiDockTester:
    def __init__(self, root):
        self.root = root
        self.root.title("HiDock Simple Command Tester")
        self.root.geometry("800x600")
        
        self.device = None
        self.connected = False
        self.decoder = HiDockResponseDecoder()
        
        # Commands
        self.commands = {
            1: "GET_DEVICE_INFO",
            2: "GET_DEVICE_TIME",
            3: "SET_DEVICE_TIME", 
            4: "GET_FILE_LIST",
            5: "TRANSFER_FILE",
            6: "GET_FILE_COUNT",
            7: "DELETE_FILE",
            10: "DEMO_CONTROL",
            11: "GET_SETTINGS",
            12: "SET_SETTINGS",
            13: "GET_FILE_BLOCK",
            14: "UNKNOWN_14",
            15: "UNKNOWN_15",
            16: "GET_CARD_INFO",
            17: "FORMAT_CARD",
            18: "GET_RECORDING_FILE",
            19: "RESTORE_FACTORY",
            20: "SEND_MEETING_SCHEDULE"
        }
        
        self.setup_ui()
        
    def setup_ui(self):
        """Setup the GUI"""
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Connection
        conn_frame = ttk.LabelFrame(main_frame, text="Connection", padding="5")
        conn_frame.grid(row=0, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        self.connect_btn = ttk.Button(conn_frame, text="Connect", command=self.toggle_connection)
        self.connect_btn.grid(row=0, column=0, padx=5)
        
        self.status_label = ttk.Label(conn_frame, text="Disconnected", foreground="red")
        self.status_label.grid(row=0, column=1, padx=5)
        
        # Command selection
        cmd_frame = ttk.LabelFrame(main_frame, text="Command", padding="5")
        cmd_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        ttk.Label(cmd_frame, text="Command:").grid(row=0, column=0, padx=5)
        
        self.cmd_var = tk.StringVar()
        self.cmd_combo = ttk.Combobox(cmd_frame, textvariable=self.cmd_var, width=40)
        self.cmd_combo['values'] = [f"{k}: {v}" for k, v in self.commands.items()]
        self.cmd_combo.grid(row=0, column=1, padx=5)
        self.cmd_combo.current(0)
        
        ttk.Label(cmd_frame, text="Parameters (hex):").grid(row=1, column=0, padx=5)
        
        self.param_entry = ttk.Entry(cmd_frame, width=40)
        self.param_entry.grid(row=1, column=1, padx=5, pady=5)
        
        # Quick fills
        quick_frame = ttk.Frame(cmd_frame)
        quick_frame.grid(row=2, column=0, columnspan=2, pady=5)
        
        ttk.Button(quick_frame, text="Empty", command=lambda: self.param_entry.delete(0, tk.END)).pack(side=tk.LEFT, padx=2)
        ttk.Button(quick_frame, text="Demo Start", command=lambda: self.set_param("00121034")).pack(side=tk.LEFT, padx=2)
        ttk.Button(quick_frame, text="Demo Stop", command=lambda: self.set_param("00000000")).pack(side=tk.LEFT, padx=2)
        ttk.Button(quick_frame, text="Index 0", command=lambda: self.set_param("0000")).pack(side=tk.LEFT, padx=2)
        
        self.send_btn = ttk.Button(cmd_frame, text="Send Command", command=self.send_command, state="disabled")
        self.send_btn.grid(row=3, column=0, columnspan=2, pady=10)
        
        # Output
        output_frame = ttk.LabelFrame(main_frame, text="Output", padding="5")
        output_frame.grid(row=2, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        
        self.output_text = scrolledtext.ScrolledText(output_frame, height=20, width=80)
        self.output_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure tags
        self.output_text.tag_config("info", foreground="black")
        self.output_text.tag_config("success", foreground="green")
        self.output_text.tag_config("error", foreground="red")
        self.output_text.tag_config("command", foreground="blue", font=("Courier", 10, "bold"))
        self.output_text.tag_config("response", foreground="purple")
        
        # Clear button
        ttk.Button(output_frame, text="Clear", command=self.clear_output).grid(row=1, column=0, pady=5)
        
        # Grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(0, weight=1)
        main_frame.rowconfigure(2, weight=1)
        output_frame.columnconfigure(0, weight=1)
        output_frame.rowconfigure(0, weight=1)
        
    def set_param(self, hex_str):
        """Set parameter field"""
        self.param_entry.delete(0, tk.END)
        self.param_entry.insert(0, hex_str)
        
    def log(self, msg, tag="info"):
        """Add message to output"""
        self.output_text.insert(tk.END, msg + "\n", tag)
        self.output_text.see(tk.END)
        self.root.update_idletasks()
        
    def clear_output(self):
        """Clear output"""
        self.output_text.delete(1.0, tk.END)
        
    def toggle_connection(self):
        """Connect or disconnect"""
        if self.connected:
            self.disconnect()
        else:
            self.connect()
            
    def connect(self):
        """Connect to device"""
        self.log("Connecting to device...", "info")
        
        try:
            # Initialize backend
            app_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'hidock-desktop-app')
            lib_path = os.path.join(app_dir, 'libusb-1.0.dll')
            
            if os.path.exists(lib_path):
                backend = usb.backend.libusb1.get_backend(find_library=lambda x: lib_path)
            else:
                backend = usb.backend.libusb1.get_backend()
                
            # Connect device
            self.device = HiDockJensen(backend)
            
            if self.device.connect():
                self.connected = True
                self.connect_btn.config(text="Disconnect")
                self.status_label.config(text="Connected", foreground="green")
                self.send_btn.config(state="normal")
                self.log("Device connected successfully!", "success")
                
                # Try to get device info
                self.get_info()
            else:
                self.log("Failed to connect to device", "error")
                
        except Exception as e:
            self.log(f"Connection error: {e}", "error")
            
    def disconnect(self):
        """Disconnect from device"""
        if self.device:
            try:
                self.device.disconnect()
            except:
                pass
            self.device = None
            
        self.connected = False
        self.connect_btn.config(text="Connect")
        self.status_label.config(text="Disconnected", foreground="red")
        self.send_btn.config(state="disabled")
        self.log("Device disconnected", "info")
        
    def get_info(self):
        """Try to get device info"""
        try:
            response = self.device._send_and_receive(1, b'', timeout_ms=2000)
            if response and response.get('body'):
                hex_data = response['body'].hex()
                decoded = self.decoder.decode_response(1, hex_data)
                if decoded:
                    self.log("\nDevice Info:", "info")
                    self.log(decoded, "response")
        except:
            pass  # Ignore errors
            
    def send_command(self):
        """Send selected command"""
        if not self.connected:
            messagebox.showerror("Error", "Not connected")
            return
            
        # Get command
        cmd_text = self.cmd_var.get()
        if not cmd_text:
            messagebox.showerror("Error", "Select a command")
            return
            
        cmd_id = int(cmd_text.split(":")[0])
        cmd_name = self.commands[cmd_id]
        
        # Get parameters
        hex_str = self.param_entry.get().strip()
        hex_str = hex_str.replace(" ", "").replace(",", "")
        
        try:
            param_bytes = bytes.fromhex(hex_str) if hex_str else b''
        except ValueError:
            messagebox.showerror("Error", "Invalid hex data")
            return
            
        # Log
        self.log("\n" + "="*60, "info")
        self.log(f"SENDING: Command {cmd_id} ({cmd_name})", "command")
        self.log(f"Parameters: {param_bytes.hex() if param_bytes else '(empty)'}", "info")
        
        # Send in thread
        thread = threading.Thread(target=self.send_thread, args=(cmd_id, param_bytes))
        thread.daemon = True
        thread.start()
        
    def send_thread(self, cmd_id, param_bytes):
        """Send command in thread"""
        try:
            start = time.time()
            response = self.device._send_and_receive(cmd_id, param_bytes, timeout_ms=5000)
            elapsed = time.time() - start
            
            if response:
                self.log(f"Response in {elapsed:.2f}s", "success")
                
                if response.get('body'):
                    hex_data = response['body'].hex()
                    self.log(f"Raw: {hex_data[:100]}..." if len(hex_data) > 100 else f"Raw: {hex_data}", "info")
                    
                    # Decode
                    decoded = self.decoder.decode_response(cmd_id, hex_data)
                    if decoded:
                        self.log("\nDECODED:", "info")
                        self.log(decoded, "response")
                else:
                    self.log("Empty response", "info")
            else:
                self.log(f"No response after {elapsed:.2f}s", "error")
                
        except Exception as e:
            self.log(f"Error: {e}", "error")

def main():
    root = tk.Tk()
    app = SimpleHiDockTester(root)
    
    def on_closing():
        if app.connected:
            app.disconnect()
        root.destroy()
        
    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()

if __name__ == "__main__":
    main()