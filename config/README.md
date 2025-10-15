# Configuration Files

This directory contains configuration templates and default settings for HiDock Next applications.

## 📁 Contents

### Configuration Templates
- Default settings for applications
- USB device configurations
- API provider configurations

## 🔧 Usage

Configuration files are typically copied during setup to user-specific locations:
- Desktop app: `%APPDATA%/HiDock/` (Windows) or `~/.hidock/` (Unix)
- Web app: Environment variables and `.env` files

## ⚠️ Important

- Do not store sensitive information (API keys, passwords) in this directory
- Use environment variables or secure storage for credentials
- Configuration templates should contain placeholder values only