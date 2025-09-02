# Research & Analysis Tools

This directory contains research tools and reverse engineering utilities for HiDock devices.

## 📁 Directory Structure

### [firmware-analysis/](firmware-analysis/) - Firmware Analysis
- `decode_firmware.py` - Decode and extract firmware files
- `firmware_analysis.py` - Analyze firmware structure
- `firmware_downloader.py` - Download firmware from devices
- `disasm_analysis.py` - Disassemble and analyze firmware code

### [protocol-analysis/](protocol-analysis/) - Protocol Reverse Engineering
- `analyze_auth.py` - Authentication flow analysis
- `jensen_protocol_reverse.py` - Jensen protocol reverse engineering

### [command-discovery/](command-discovery/) - Command Testing
- `command_parameter_test.py` - Test command parameters
- `command_table_analysis.py` - Analyze command tables
- `deep_command_analysis.py` - Deep dive into command structures

### [command-10-discovery/](command-10-discovery/) - Command 10 Research
Specialized research for command 10 functionality.

### [command-14-15-discovery/](command-14-15-discovery/) - Commands 14-15 Research
Research into commands 14 and 15 operations.

### [command-tester-gui/](command-tester-gui/) - GUI Command Tester
Graphical interface for testing device commands.

## ⚠️ Warning

These tools are for research and development purposes only. Use with caution as they directly interact with device firmware and protocols.

## 📝 Usage

Most scripts can be run directly:
```bash
python firmware-analysis/decode_firmware.py [firmware_file]
```

See individual script headers for specific usage instructions.