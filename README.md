# **HiDock Next**

HiDock Next gives you direct, local control over your HiDock recordings. Manage, backup, and access your audio files without relying on the cloud or proprietary software.  
This open-source application provides an alternative to the standard HiNotes software, focusing on robust local file management for your HiDock device. Our goal is to empower users with greater control over their data and offer a foundation for future enhancements driven by community needs.

## **Why HiDock Next?**

The HiDock hardware is innovative, but users often face challenges with the official HiNotes software, including:

* **Connectivity & Reliability:** Issues with stable connections and browser-specific limitations.  
* **Workflow Hurdles:** Confusing steps to access and manage recordings.  
* **Data Control Concerns:** Dependence on a cloud service for basic operations.  
* **Vendor Lock-in:** Limited options for how and where your recordings are processed.

**HiDock Next aims to address these by providing:**

* **Direct Local Access:** Manage your HiDock recordings directly on your computer using Python and libusb.  
* **Offline Capability:** Core features work without needing an internet connection or the HiNotes web interface.  
* **Full Data Ownership:** Keep your audio files securely stored on your local machine.  
* **Open Foundation:** A community-driven project with the potential for powerful future features, including flexible transcription options.

## **Key Features**

* **Local Recording Management (Core \- Available Now):**  
  * Access, list, and play recordings stored on your HiDock device.  
  * Download recordings to your computer for backup and local storage.  
  * Delete recordings from the device.  
  * Format the HiDock's internal storage.  
  * *(Works offline, without needing HiNotes or an internet connection for these operations)*  
* **Flexible Transcription Support (Future Goal):**  
  * Planned support for various transcription engines.  
  * Emphasis on a "Bring Your Own Key" (BYOK) model, allowing you to use your preferred services.  
  * Future exploration of locally-run transcription options for maximum privacy and control.  
* **Auto-Download (Planned):**  
  * Automatically detect and download new recordings from your HiDock when connected.  
* **Community-Driven Enhancements (Future):**  
  * The long-term vision includes advanced features shaped by user feedback and contributions.

## **Current Status**

**Functional Application - Development Ongoing.**
HiDock Next is a functional desktop application providing local management for HiDock devices. Key aspects of the current version include:

* **Modern User Interface:** Built with **CustomTkinter**, featuring **Font Awesome icons** for an intuitive experience.
* **Modular Codebase:** Organized into distinct Python modules (e.g., `main.py`, `gui_main_window.py`, `settings_window.py`, `hidock_device.py`, `config_and_logger.py`, `constants.py`) for clarity and maintainability.
* **Core Local Management:** Robust Python/libusb backend for accessing, listing, playing, downloading, deleting recordings, and formatting device storage.
* **Comprehensive GUI Features:**
  * Advanced file list management (drag-selection, status indicators, context menus, header controls with live storage/file counts, sorting).
  * Theming support (light/dark modes, Azure theme).
  * Detailed settings configuration (download directory, logging levels & colors, UI preferences, device-specific settings) via a dedicated `SettingsDialog`.
  * Enhanced logging system (colored console, configurable GUI log pane with live color previews and suppression options).
  * Standard application controls (Menubar, Toolbar, Status Bar) with synchronized states and icons.
  * Persistent settings saved to `hidock_tool_config.json`.
Development is ongoing to add further enhancements and refine existing functionality.

## **Development Focus: Implemented Features & Future Plans**

This section outlines the features already implemented in HiDock Next and the planned enhancements.

### **Implemented Features**

**Core Local Device Management:**

* Direct USB communication with HiDock devices (via Python & libusb).
* List audio recordings stored on the device.
* Download recordings to the local computer.
* Play audio recordings directly from the device (after a temporary download if not already local).
* Delete recordings from the device.
* Format the device's storage.
* View device information (model, SN, firmware version).
* View storage card information (capacity, used space).
* Synchronize device time with the computer.

**Graphical User Interface (GUI) & User Experience (UX):**

* Modern interface built with CustomTkinter.
* Theming support (Light/Dark modes, configurable color themes e.g., 'blue', 'dark-blue', 'green').
* Integrated Font Awesome icons for toolbar, menus, and buttons.
* **File List:**
  * Detailed Treeview display of files with columns for name, size, duration, date, time, and status.
  * Sortable columns.
  * Real-time status indicators (e.g., "Recording", "Downloaded", "Mismatch", "Playing", "Queued", "Cancelled").
  * Click-and-drag selection/deselection of multiple files.
  * "Select All" & "Clear Selection" controls.
  * Right-click context menu for file-specific actions.
  * Double-click actions (download or play based on status).
* **Main Controls:**
  * Menubar for access to all application functions.
  * Toolbar for quick access to common actions.
  * Status bar displaying connection status, device info, storage usage, file counts, and operation progress.
* **Header Panel:**
  * Live display of storage usage and file counts (total/selected).
  * Button to open current download directory (left-click) or select a new one (right-click).
* **Playback Controls:**
  * Dedicated playback control bar with play/pause, progress slider, current/total time display, volume control, and loop option.
* **Logging Pane:**
  * In-GUI display of application logs.
  * Configurable log level filtering for the GUI pane.
  * Option to clear or save GUI logs to a file.

**Configuration & Logging:**

* Persistent application settings saved to `hidock_tool_config.json`.
* **Settings Dialog:**
  * Organized into tabs (General, Connection, Operation, Device Specific, Logging).
  * Configuration for:
    * Appearance (theme, mode).
    * Download directory.
    * USB device selection (VID/PID), target interface.
    * Autoconnect on startup.
    * Operation timeouts, auto-refresh intervals.
    * Device-specific behavior (auto-record, auto-play, tones - if supported by device).
    * Logging levels (processing level, console/GUI suppression).
    * Customizable GUI log colors for each level (with live previews).
* **Logging System:**
  * Modern theming and styling (light/dark modes, styled Treeview and scrollbars, Font Awesome icons).
  * Robust logging system (colored console output, configurable GUI log pane with custom colors, suppression options).

**Application Structure & Dependencies:**

* Modular codebase organized into logical Python files (`main.py`, `gui_main_window.py`, `settings_window.py`, `hidock_device.py`, `config_and_logger.py`, `constants.py`, etc.).
* Dependencies managed via `requirements.txt`.

### **Planned Enhancements (Developer To-Do List)**

The following features are planned for future development:

* **Auto-Download Functionality:**
  * Implement logic to automatically detect and download new recordings when the HiDock device is connected.
* **Transcription Capabilities:**
  * Develop support for various transcription engines.
  * Design for a "Bring Your Own Key" (BYOK) model for cloud-based services.
  * Research and implement options for local, on-device transcription engines.
* **GUI & UX Refinements:**
  * Continuously improve the user interface based on personal use and identified areas for enhancement.
  * Explore additional theming options or UI customizations.
* **Advanced File Management:**
  * Consider adding batch renaming capabilities.
  * Investigate metadata editing (if feasible with device protocol).
* **Error Handling & Robustness:**
  * Ongoing enhancements to error reporting and recovery mechanisms.
* **Developer Documentation:**
  * Create `CONTRIBUTING.md` for developer guidelines.
* **Code Polish & Optimization:**
  * Regularly review and refactor code for clarity, efficiency, and adherence to best practices.

## **Getting Started**

### **Prerequisites**

* **Python:** Version 3.8 or higher recommended.  
* **libusb:** You'll need libusb (or its equivalent like libusb-1.0) installed on your system.  
  * **Linux:** sudo apt-get install libusb-1.0-0-dev (Debian/Ubuntu) or equivalent.  
  * **macOS:** brew install libusb  
  * **Windows:** Decompress libusb-1.0.dll from the libusb x64 distribution. Alternative: requires careful setup (e.g., using [Zadig](https://zadig.akeo.ie/) to install WinUSB driver for the HiDock device). **Be cautious with Zadig.**  
* **HiDock Device:** A HiDock H1, H1E, or compatible variant.

### **Installation**

1. **Clone the repository:**  
   git clone <https://github.com/sgeraldes/hidock-next.git>  
   cd hidock-next

2. **Create a virtual environment (recommended):**  
   python \-m venv venv  
   source venv/bin/activate  \# On Windows: venv\\Scripts\\activate

3. **Install dependencies:**  
   pip install \-r requirements.txt

## **Usage**

Once dependencies are installed, you can run the HiDock Next GUI application using the main entry point (`main.py`) from the project's root directory:

```bash
python hidock_tool_gui.py
```

**Brief GUI Overview:**

* **Menubar:** Access all application functions including File (Connect, Settings, Exit), View (Toggle Panes), Actions (Refresh, Download, Play, Delete), and Device (Sync Time, Format).
* **Toolbar:** Quick access buttons for common actions like Connect/Disconnect, Refresh, Download, Play, Delete, and Settings.
* **File List:** Displays recordings from your HiDock. Supports selection, sorting, context-menu actions, and shows file status.
* **Status Bar:** Shows connection status, device info, storage usage, file counts, download progress, and current download directory.
* **Settings Window:** Configure application behavior, appearance, logging, download directory, and device-specific options.

More detailed user guides and feature explanations will be added to the project Wiki

## **Transcription Setup (Future Feature)**

When transcription features are implemented, HiDock Next will aim to use a "Bring Your Own Key" (BYOK) model for any cloud-based services and explore support for local transcription engines.

* You will be responsible for API keys and any associated costs for cloud services.  
* The application will prioritize secure handling of any user-provided credentials.  
* **Never** share your API keys publicly or commit **them to version control.**

## **Contributing**

We welcome contributions! If you're interested in helping, please check out our GitHub Issues to see where you can help or to report new bugs/suggest features.

For more detailed guidelines on contributing, please see the `CONTRIBUTING.md` file (coming soon).

You can also help by:

* Reporting bugs or suggesting features for the current local management capabilities on our [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues).
* Indicating interest in future features like transcription support.

## **Support the Project**

If you find HiDock Next useful, please consider supporting its continued development via Patreon\!

Your support helps cover development time and resources.

## **License**

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

## **Acknowledgements**

* The developers of libusb for direct USB communication.  
* The open-source community for their invaluable tools and libraries.

## **Disclaimer**

HiDock Next is an independent, third-party project and is not affiliated with, endorsed by, or sponsored by HiDock or its parent company. Use this software at your own risk. The developers are not responsible for any damage to your device or loss of data. Always back up important recordings.
