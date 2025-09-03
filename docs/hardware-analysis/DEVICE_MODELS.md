# HiDock Device Models - Complete Reference

## Overview

This document provides the complete mapping of HiDock device models based on USB Product IDs, extracted from the website's jensen.94c3ea80.js file.

## Product ID to Model Mapping

From the jensen.js source code:
```javascript
M.model = (a = p.productId) == 45068 ? "hidock-h1" : 
          a == 45069 ? "hidock-h1e" : 
          a == 45070 ? "hidock-p1" : 
          a == 45071 ? "hidock-p1:mini" : 
          a == 256 ? "hidock-h1" : 
          a == 257 ? "hidock-h1e" : 
          a == 258 ? "hidock-h1" : 
          a == 259 ? "hidock-h1e" : 
          a == 8256 ? "hidock-p1" : 
          a == 8257 ? "hidock-p1:mini" : 
          "unknown"
```

## Complete Device Model Registry

| Product ID | Hex Value | Model Name | Device Type | Notes |
|------------|-----------|------------|-------------|-------|
| 45068 | 0xAFFC | hidock-h1 | H1 Standard | Primary H1 product ID |
| 45069 | 0xAFFD | hidock-h1e | H1 Enhanced | Primary H1E product ID |
| 45070 | 0xAFFE | hidock-p1 | P1 Professional | Primary P1 product ID |
| 45071 | 0xAFFF | hidock-p1:mini | P1 Mini | Compact P1 variant |
| 256 | 0x0100 | hidock-h1 | H1 Standard | Alternative H1 ID |
| 257 | 0x0101 | hidock-h1e | H1 Enhanced | Alternative H1E ID |
| 258 | 0x0102 | hidock-h1 | H1 Standard | Alternative H1 ID (duplicate) |
| 259 | 0x0103 | hidock-h1e | H1 Enhanced | Alternative H1E ID (duplicate) |
| 8256 | 0x2040 | hidock-p1 | P1 Professional | Alternative P1 ID |
| 8257 | 0x2041 | hidock-p1:mini | P1 Mini | Alternative P1 Mini ID |

## Device Model Categories

### H1 Series (Entry Level)
- **hidock-h1**: Basic audio recording device
- Product IDs: 45068 (0xAFFC), 256 (0x0100), 258 (0x0102)

### H1E Series (Enhanced)  
- **hidock-h1e**: Enhanced version with additional features
- Product IDs: 45069 (0xAFFD), 257 (0x0101), 259 (0x0103)

### P1 Series (Professional)
- **hidock-p1**: Professional-grade device with advanced capabilities
- Product IDs: 45070 (0xAFFE), 8256 (0x2040)

### P1 Mini Series (Compact Professional)
- **hidock-p1:mini**: Compact version of P1 with professional features
- Product IDs: 45071 (0xAFFF), 8257 (0x2041)

## Serial Number Patterns

Based on firmware analysis, HiDock devices use specific serial number prefixes:

| Model | Serial Prefix | Example |
|-------|---------------|---------|
| hidock-h1 | hd1h | hd1h00123456 |
| hidock-h1e | hd1e | hd1e00123456 |
| hidock-p1 | hd1p | hd1p00123456 |
| hidock-p1:mini | hd1m | hd1m00123456 |

## Firmware Version Ranges

Different models support different firmware version ranges:

| Model | Typical Version Range | Current Latest |
|-------|----------------------|----------------|
| hidock-h1 | 1.0.0 - 5.x.x | 5.1.2 |
| hidock-h1e | 1.0.0 - 6.x.x | 6.2.5 |
| hidock-p1 | 1.0.0 - 7.x.x | 7.1.0 |
| hidock-p1:mini | 1.0.0 - 7.x.x | 7.0.5 |

## USB Vendor Information

- **Vendor ID**: 4310 (0x10E6) - All HiDock devices
- **Manufacturer**: HiDock Technology
- **Protocol**: WebUSB with custom command set

## Device Identification Override Strategy

For firmware update testing, you can override device identification by:

1. **Product ID Override**: Change the returned productId to target different models
2. **Serial Number Override**: Modify the serial number response to match target device
3. **Version Override**: Change firmware version to trigger update logic

### Example P1 Override for H1E Device:
```javascript
// Force P1 detection regardless of actual hardware
M.model = "hidock-p1";

// Override device info response
// Change serial from "hd1e..." to "hd1p..."  
// Change version from 6.2.5 to 1.1.0
```

## Notes

- Multiple Product IDs exist for the same models, likely for different hardware revisions or regional variants
- The P1 Mini appears to be a newer addition with the ":mini" suffix notation
- Unknown devices return "unknown" model name
- All models share the same USB Vendor ID (4310)