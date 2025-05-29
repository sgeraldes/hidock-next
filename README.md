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

Alpha/Beta Stage.  
The core local recording management features (access, download, play, delete, format) using Python and libusb are functional in a prototype. GUI development and preparation for initial release are underway.

## **Roadmap Highlights**

* **Phase 1 (Ongoing): Robust Local Management**  
  * Solidify and enhance the Python/libusb prototype for reliable local recording management.  
  * Develop a user-friendly Graphical User Interface (GUI) for all core local management tasks.  
  * Prepare for an initial public release focusing on these local capabilities.  
* **Phase 2: Enhanced Local Tools & Community Feedback**  
  * Implement auto-download functionality.  
  * Refine the GUI based on user feedback.  
  * Actively engage with the community to identify priorities for future development.  
* **Phase 3: Introducing Transcription Capabilities (Community Driven)**  
  * Based on community interest and contributions, begin implementing support for transcription engines.  
  * Focus on a flexible architecture supporting BYOK and exploring local transcription solutions.  
* **Phase 4: Continued Development & Advanced Features**  
  * Ongoing maintenance, improvements, and development of further advanced features as prioritized by the community.

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
   git clone [https://github.com/sgeraldes/hidock-next.git](https://github.com/sgeraldes/hidock-next.git)
   cd Hidock-Next

2. **Create a virtual environment (recommended):**  
   python \-m venv venv  
   source venv/bin/activate  \# On Windows: venv\\Scripts\\activate

3. **Install dependencies:**  
   pip install \-r requirements.txt

   *(Note: requirements.txt will be provided once initial dependencies are finalized.)*

## **Usage**

*(Detailed usage instructions for the command-line interface or GUI will be provided here as the application matures.)*

**Conceptual Example (for core local management):**

\# List recordings  
python hidock\_next.py \--list

\# Download a recording  
python hidock\_next.py \--download REC001.wav

## **Transcription Setup (Future Feature)**

When transcription features are implemented, HiDock Next will aim to use a "Bring Your Own Key" (BYOK) model for any cloud-based services and explore support for local transcription engines.

* You will be responsible for API keys and any associated costs for cloud services.  
* The application will prioritize secure handling of any user-provided credentials.  
* **Never** share your API keys publicly or commit **them to version control.**

## **Contributing**

We welcome contributions\! Please read our CONTRIBUTING.md file (to be created) for details on our code of conduct and the process for submitting pull requests.

You can also help by:

* Reporting bugs or suggesting features for the current local management capabilities on our [GitHub Issues](https://github.com/YOUR_USERNAME/Hidock-Next/issues). \* Sharing your experience with other HiDock users.  
* Indicating interest in future features like transcription support.

## **Support the Project**

If you find HiDock Next useful, please consider supporting its continued development via Patreon\!

Your support helps cover development time and resources.

## **License**

This project is licensed under the **MIT License**. See the [LICENSE](http://docs.google.com/LICENSE) file for details.

## **Acknowledgements**

* The developers of libusb for direct USB communication.  
* The open-source community for their invaluable tools and libraries.

## **Disclaimer**

HiDock Next is an independent, third-party project and is not affiliated with, endorsed by, or sponsored by HiDock or its parent company. Use this software at your own risk. The developers are not responsible for any damage to your device or loss of data. Always back up important recordings.
