# HiDock Firmware Update System Analysis

## Overview

This document provides a complete technical analysis of the HiDock firmware update mechanism, including firmware delivery, binary structure, and partition layout.

## Firmware Update Flow

### 1. Version Check
- **Endpoint**: `POST /v2/device/firmware/latest`
- **Authentication**: API token via `accesstoken` header
- **Request**: Form data with current `version` and device `model`
- **Response**: Firmware metadata including download information

### 2. Binary Delivery
- **Method**: Direct HTTP request for firmware binary
- **Format**: Base64-encoded `application/octet-stream`
- **Delivery**: Standard HTTP response (not WebSocket, WebRTC, or embedded in JavaScript)
- **Size**: Variable per firmware version

### 3. Device Upload
- **Protocol**: WebUSB via jensen.js library
- **Commands**: 
  - Command 8: `requestFirmwareUpgrade(fileSize, versionNumber, timeout)`
  - Command 9: `uploadFirmware(binaryData, timeout, progressCallback)`
- **Transfer**: Direct USB communication bypassing HTTP

## Firmware Binary Analysis

### HiDock H1E Version 6.2.5

#### Metadata
- **File Name**: `20ec7c710a9945428a5d3f0d904876c2`
- **Version Code**: `6.2.5`
- **Version Number**: `393733` (0x60205)
- **File Size**: `3,451,904 bytes`
- **MD5 Signature**: `d38b66b51b222a89ca49d2d769d7f42e`
- **Build Timestamp**: `2503241721` (25/03/24 17:21)
- **Board Target**: `ats2835p_evb`
- **Download Status**: `404 - endpoint not found`

#### Binary Structure
- **Container Format**: Custom ACTTEST0 format
- **Header**: 512 bytes
- **Metadata**: XML descriptor starting at offset 512
- **Partitions**: 6 discrete firmware components
- **OTA Version Check**: Disabled

#### Partition Layout
| ID | Type | Name | File | Size | Checksum |
|----|------|------|------|------|----------|
| 1 | BOOT | fw0_boot | mbrec.bin | 4,096 bytes | 0x8f514d09 |
| 3 | SYSTEM | fw0_sys | zephyr.bin | 1,260,064 bytes | 0x1f3a7570 |
| 224 | SUGR | fw_dsp_bk | RomeApp.bin | 430,020 bytes | 0x4da37140 |
| 9 | SUGR | fw0_uac | UAC.bin | 1,024 bytes | 0xd18d87df |
| 11 | SUGR | fw_ig_d | IG1202dl.bin | 704,000 bytes | 0xc6d2f351 |
| 225 | SUGR | fw_sdfs_bk | sdfs.bin | 1,048,192 bytes | 0x2b4d60f7 |

**Total Partition Size**: 3,447,396 bytes
**Container Overhead**: 4,508 bytes

## Validation Results

### Binary Integrity
- **MD5 Hash**: `d38b66b51b222a89ca49d2d769d7f42e` ✓ **VERIFIED**
- **File Size**: `3,451,904 bytes` ✓ **VERIFIED**
- **Format**: Valid ACTTEST0 container ✓ **VERIFIED**

### Metadata Consistency
- **Version Number Match**: API metadata matches firmware XML ✓ **VERIFIED**
- **File Size Match**: API metadata matches actual binary ✓ **VERIFIED**
- **Signature Match**: Expected hash matches calculated hash ✓ **VERIFIED**

## Firmware Components

### Core System Components
- **mbrec.bin**: Master Boot Record and bootloader
- **zephyr.bin**: Main Zephyr RTOS system image (largest component)
- **sdfs.bin**: System data filesystem

### Audio Processing Components  
- **RomeApp.bin**: DSP application for audio processing
- **UAC.bin**: USB Audio Class implementation
- **IG1202dl.bin**: Audio codec/DSP component

## Security Considerations

### Firmware Validation
- MD5 hash verification ensures integrity during download
- Device-side validation occurs during flash process
- OTA version checking can be enabled/disabled per firmware

### Update Process Safety
- Device enters bootloader mode before firmware write
- Partition checksums validate individual components
- Failed updates can potentially brick device if interruption occurs during critical partitions

## Authentication System

### OAuth Flow
- **Provider**: Google OAuth 2.0 via `accounts.google.com/gsi/client`
- **Token Storage**: Client-side (localStorage/sessionStorage)
- **Token Format**: 64-character alphanumeric string
- **Header**: `accesstoken: M4XoUFm5OOygd5snWe10lMxtSqadM2KOp2wWObw554iUyTaEZbVXdu11TZ3zD4SD`

### API Authentication Requirements
- **ALL API calls require authentication** via `accesstoken` header
- **Firmware download endpoint** `/v2/device/firmware/get?id={id}` **REQUIRES** valid token
- **Token validation** occurs server-side for each request
- **No anonymous access** to firmware binaries

### Firmware Version Logic
- **API Response**: Only returns firmware data when current version is **lower** than latest available
- **No Update Available**: Returns empty `<data/>` section when current version equals or exceeds latest
- **Version Comparison**: Uses numeric version numbers (e.g., 328196, 393733) for comparison
- **Multi-Device Support**: Different firmware versions and sizes per device model (H1: ~4.1MB, H1E: ~3.5MB)

### Token Lifecycle
- Token appears in first API call (request 28: `/v1/user/info`)
- Same token used throughout entire session (28 consecutive API calls)
- Token likely obtained during initial Google OAuth login flow
- No token refresh observed during captured session

## Technical Implementation Notes

### Container Format
The ACTTEST0 format appears to be a custom OTA packaging system:
- Fixed 512-byte header containing partition table
- XML metadata describing partition layout and checksums  
- Sequential partition data blocks
- No apparent compression or encryption

### Device Communication
- WebUSB vendor ID: 4310 (HiDock)
- USB commands use custom protocol via jensen.js library
- Direct binary transfer bypasses browser security restrictions
- Progress callbacks available during upload process

### API Endpoints
- Firmware check: `/v2/device/firmware/latest` (POST) **[AUTH REQUIRED]**
- Binary download: `/v2/device/firmware/get?id={firmware_id}` (GET) **[AUTH REQUIRED]**
- Alternative endpoints return 404 (not publicly accessible)

## Conclusion

The HiDock firmware update system uses a hybrid approach combining HTTP API for metadata and binary delivery with WebUSB for device communication. The firmware binary structure is well-organized with clear partition separation and validation mechanisms. The system bypasses typical web security restrictions through WebUSB while maintaining integrity verification throughout the process.