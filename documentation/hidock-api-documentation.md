
# HiDock H1E Communication Protocols

## Device Architecture
- **Audio Controller**: DSEA A/S SC70 CTRL (1395:005c)
  - USB Audio Class 1.0 compliant
  - 48kHz, 16-bit, Stereo playback
  - 48kHz, 16-bit, Mono capture
  - HID interface for controls
  
- **Main Controller**: Actions Semiconductor HiDock_H1E (10d6:b00d)
  - Vendor-specific interface (Class FF)
  - Device coordination and firmware
  
- **USB Hubs**: Realtek USB3.2 hubs (0bda:0411)
  - Standard hub functionality
  - Multiple instances for port expansion

## Control Interfaces

### Audio Controls (ALSA)
- PCM Playback Volume: 0-1008 (0 to -63dB)
- PCM Playback Switch: On/Off
- Mic Capture Volume: 0-496 (0 to +31dB)
- Mic Capture Switch: On/Off

### HID Interface (Consumer Controls)
- Device: /dev/hidraw11 (may vary)
- Vendor: DSEA A/S
- Functions: Volume, mute, media controls

### Potential Custom Commands
- Main controller uses vendor-specific interface
- May support custom configuration commands
- Requires reverse engineering of protocol

## Power Management
- All devices support USB power management
- Custom udev rules required for stability
- r8152 ethernet driver must be blacklisted

## Firmware Information
- Audio: Version 1.00 (DSEA A/S)
- Main: Version 1.00 (Actions)
- Ethernet: Version 31.00 (Realtek)
- Hubs: Version 1.01 (Generic)
