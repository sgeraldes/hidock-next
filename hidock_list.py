""" This script manages USB device storage with a specific Vendor ID and Product ID. """
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
# import sys
import usb.core
import usb.util
import usb.backend.libusb1 # Explicitly import the backend

# --- Constants ---
# VENDOR_ID = 0x1395   # HiDock Vendor ID
# PRODUCT_ID = 0x005C  # HiDock H1E Product ID (from your info)
VENDOR_ID = 0x10D6   # Actions Semiconductor
PRODUCT_ID = 0xB00D  # The PID you found for the main HiDock H1E entry

EP_OUT_ADDR_REQUEST = 0x01
EP_IN_ADDR_REQUEST = 0x82

def list_usb_device_details(vid, pid):
    """
    Lists all configurations, interfaces, and endpoints for a USB device
    identified by its Vendor ID and Product ID.
    """
    device = None
    backend = None
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        possible_dll_names = ["libusb-1.0.dll"]
        dll_path = None
        for name in possible_dll_names:
            path_candidate = os.path.join(script_dir, name)
            if os.path.exists(path_candidate):
                dll_path = path_candidate
                break
            path_candidate_ms64 = os.path.join(script_dir, "MS64", "dll", name)
            if os.path.exists(path_candidate_ms64):
                dll_path = path_candidate_ms64
                break
            path_candidate_ms32 = os.path.join(script_dir, "MS32", "dll", name)
            if os.path.exists(path_candidate_ms32):
                dll_path = path_candidate_ms32
                break

        if not dll_path:
            print("ERROR: libusb-1.0.dll not found in script directory or common subdirectories (MS64/dll, MS32/dll).")
            backend = usb.backend.libusb1.get_backend()
            if not backend:
                print("ERROR: libusb-1.0 backend could not be initialized even from system paths.")
                return
            print("Warning: Using system-found libusb backend as local DLL was not found.")
        else:
            print(f"Attempting to load backend using DLL: {dll_path}")
            backend = usb.backend.libusb1.get_backend(find_library=lambda x: dll_path)
            if not backend:
                print(f"ERROR: Failed to get libusb-1.0 backend with DLL at {dll_path}")
                return
        print(f"Using backend: {backend}")
    except OSError as e:
        print(f"Error initializing libusb backend: {e}")
        return

    try:
        device = usb.core.find(idVendor=vid, idProduct=pid, backend=backend)

        if device is None:
            print(f"Device with VID={hex(vid)}, PID={hex(pid)} not found using the specified backend.")
            # ... (rest of the not found message)
            return

        print(f"\nFound Device: {device.product or 'Unknown Product'} (by {device.manufacturer or 'Unknown Manufacturer'})")
        print(f"  VID: {hex(device.idVendor)}, PID: {hex(device.idProduct)}")
        try:
            sn_str = usb.util.get_string(device, device.iSerialNumber) if device.iSerialNumber else 'N/A'
        except usb.core.USBError:
            sn_str = 'N/A (Error accessing)'
        print(f"  Serial Number: {sn_str}")
        print(f"  Bus: {device.bus}, Address: {device.address}")
        print("-" * 40)

        for cfg_idx, cfg in enumerate(device):
            print(f"  Configuration {cfg.bConfigurationValue} (Index {cfg_idx}):")
            try:
                cfg_desc_str = usb.util.get_string(device, cfg.iConfiguration) if cfg.iConfiguration else 'N/A'
            except usb.core.USBError:
                cfg_desc_str = 'N/A (Error accessing)'
            print(f"    Configuration Descriptor: {cfg_desc_str}")
            print(f"    Number of Interfaces: {cfg.bNumInterfaces}")

            for intf_idx, intf in enumerate(cfg):
                print(f"    Interface {intf.bInterfaceNumber}, Alternate Setting {intf.bAlternateSetting} (Index {intf_idx}):")
                print(f"      Interface Class: {intf.bInterfaceClass} (0x{intf.bInterfaceClass:02X})")
                print(f"      Interface SubClass: {intf.bInterfaceSubClass} (0x{intf.bInterfaceSubClass:02X})")
                print(f"      Interface Protocol: {intf.bInterfaceProtocol} (0x{intf.bInterfaceProtocol:02X})")
                try:
                    intf_desc_str = usb.util.get_string(device, intf.iInterface) if intf.iInterface else 'N/A'
                except usb.core.USBError:
                    intf_desc_str = 'N/A (Error accessing)'
                print(f"      Interface Descriptor: {intf_desc_str}")

                for ep_idx, ep in enumerate(intf):
                    ep_dir_val = usb.util.endpoint_direction(ep.bEndpointAddress)
                    ep_dir_str = "OUT" if ep_dir_val == usb.util.ENDPOINT_OUT else "IN"
                    ep_type_val = usb.util.endpoint_type(ep.bmAttributes)
                    # ***** MODIFICATION HERE *****
                    ep_type_str = {
                        0: "Control",    # usb.util.ENDPOINT_TYPE_CONTROL
                        1: "Isochronous",# usb.util.ENDPOINT_TYPE_ISO
                        2: "Bulk",       # usb.util.ENDPOINT_TYPE_BULK
                        3: "Interrupt"   # usb.util.ENDPOINT_TYPE_INTERRUPT
                    }.get(ep_type_val, f"Unknown ({ep_type_val})")
                    # ***** END MODIFICATION *****
                    print(f"        Endpoint Address: {hex(ep.bEndpointAddress)} ({ep_dir_str}) (Index {ep_idx})")
                    print(f"          Type: {ep_type_str}")
                    print(f"          MaxPacketSize: {ep.wMaxPacketSize}")
                    print(f"          Attributes: {hex(ep.bmAttributes)}")
                print("-" * 20)
            print("=" * 30)

    except usb.core.USBError as e:
        print(f"USBError during detailed listing: {e}")
        if e.errno == 13: # LIBUSB_ERROR_ACCESS
            print("This is likely a permissions issue or another application/driver has exclusive access.")
            print("On Windows, Zadig might be needed to assign WinUSB to the specific interface you intend to use with PyUSB if default drivers are blocking access.")
        elif e.errno == 5: # LIBUSB_ERROR_NOT_FOUND / EIO
            print("This can happen on Windows if a generic driver (like WinUSB via Zadig) is not installed for the interface PyUSB needs to access, or if the OS driver has exclusive control.")
        else:
            print(f"USBError details: errno={e.errno}, strerror='{e.strerror}'")
    except RuntimeError as e:
        import traceback
        print(f"RuntimeError occurred: {e}")
        print(traceback.format_exc())
    except ValueError as e:
        import traceback
        print(f"ValueError occurred: {e}")
        print(traceback.format_exc())
    finally:
        if device:
            usb.util.dispose_resources(device)
            print("Device resources disposed.")

if __name__ == "__main__":
    print("Attempting to list details for HiDock device...")
    list_usb_device_details(VENDOR_ID, PRODUCT_ID)
    print("\nListing complete.")
    print("Look for an INTERFACE (note its 'Interface X' number from the output, e.g., Interface 0, Interface 3) that has two BULK endpoints:")
    print(f"  - One with address like 0x{EP_OUT_ADDR_REQUEST:02X} (OUT)")
    print(f"  - One with address like 0x{EP_IN_ADDR_REQUEST:02X} (IN)")
    print("The `bInterfaceNumber` of that interface is what you need for TARGET_INTERFACE_FOR_JENSEN_PROTOCOL in the main script.")
    print("If you see 'Access denied' or 'Input/output error' (errno 5 or 13), especially for specific interfaces, you will likely need Zadig on Windows to assign WinUSB to that specific interface.")
