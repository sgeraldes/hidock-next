# Requirements Specification: Quick Transcription Feature

## 1. Overview

This document specifies the requirements for implementing a quick transcription feature in the HiDock Desktop application that allows users to send audio recordings to Gemini 2.5 Pro for transcription and view/access the transcription results directly from the file list interface.

## 2. Stakeholders

- **Primary Users**: HiDock desktop application users who need to transcribe meeting recordings
- **Development Team**: Desktop application developers
- **AI Service**: Google Gemini 2.5 Pro API

## 3. Functional Requirements (EARS Format)

### 3.1 Transcription Column Display

**REQ-1**: WHEN the file list tree view is displayed, the system SHALL display a "Transcription" column showing the transcription status for each audio file.

**REQ-2**: WHERE a transcription exists for a file, the system SHALL display a clickable indicator (e.g., "📄 View") in the transcription column.

**REQ-3**: WHERE no transcription exists for a file, the system SHALL display an empty cell or a subtle indicator (e.g., "-") in the transcription column.

**REQ-4**: WHILE a transcription is being processed, the system SHALL display a loading indicator (e.g., "⏳ Processing...") in the transcription column.

### 3.2 Transcription Initiation

**REQ-5**: WHEN a user right-clicks on an audio file, the system SHALL display a context menu option "Quick Transcribe with Gemini".

**REQ-6**: WHEN the user selects "Quick Transcribe with Gemini", the system SHALL initiate an asynchronous transcription request to Gemini 2.5 Pro.

**REQ-7**: IF the file has not been downloaded from the device, the system SHALL automatically download it to a temporary location before initiating transcription.

**REQ-8**: IF a Gemini API key is not configured, the system SHALL prompt the user to configure the API key before proceeding.

### 3.3 Transcription Processing

**REQ-9**: WHEN transcribing an audio file, the system SHALL use the Gemini 2.5 Pro model (not Flash) for higher accuracy.

**REQ-10**: WHEN the transcription completes successfully, the system SHALL save the transcription text to a file named `{audio_filename}_transcription.txt` in the same directory as the downloaded audio file.

**REQ-11**: WHEN the transcription completes, the system SHALL update the file metadata to include the transcription file path.

**REQ-12**: WHEN a transcription fails, the system SHALL log the error and display an error status in the transcription column (e.g., "❌ Failed").

### 3.4 Transcription Viewing

**REQ-13**: WHEN a user clicks on a transcription indicator in the transcription column, the system SHALL open the transcription text file in Windows Notepad.

**REQ-14**: IF the transcription file cannot be found, the system SHALL display an error message to the user.

**REQ-15**: WHEN opening a transcription, the system SHALL use the default system text editor (notepad.exe on Windows).

### 3.5 Transcription Persistence

**REQ-16**: WHEN the application restarts, the system SHALL restore transcription status for files by checking for the existence of transcription text files.

**REQ-17**: WHERE a transcription file exists for a downloaded audio file, the system SHALL automatically display the transcription status in the file list.

### 3.6 User Feedback

**REQ-18**: WHEN a transcription starts, the system SHALL display a toast notification informing the user that transcription has begun.

**REQ-19**: WHEN a transcription completes successfully, the system SHALL display a success toast notification with the file name.

**REQ-20**: WHEN a transcription fails, the system SHALL display an error toast notification with a brief error description.

## 4. Non-Functional Requirements

### 4.1 Performance

**NFR-1**: The system SHALL update the transcription column status within 100ms of receiving a status change.

**NFR-2**: The system SHALL handle transcription requests asynchronously to prevent UI freezing.

**NFR-3**: The system SHALL support multiple concurrent transcription requests (up to 3 simultaneous).

### 4.2 Usability

**NFR-4**: The transcription column indicator SHALL be visually distinct and intuitive to users.

**NFR-5**: The context menu option SHALL be clearly labeled and positioned logically within the menu.

**NFR-6**: Error messages SHALL be clear and actionable, guiding users on how to resolve issues.

### 4.3 Reliability

**NFR-7**: The system SHALL gracefully handle API rate limiting by implementing exponential backoff.

**NFR-8**: The system SHALL retry failed transcription requests up to 2 times before marking as failed.

**NFR-9**: The system SHALL validate API responses before marking transcriptions as complete.

### 4.4 Maintainability

**NFR-10**: The transcription feature SHALL integrate cleanly with the existing FileActionsMixin architecture.

**NFR-11**: The transcription storage mechanism SHALL be compatible with existing file metadata structures.

**NFR-12**: Configuration settings SHALL follow the existing config_and_logger.py patterns.

### 4.5 Security

**NFR-13**: The system SHALL store Gemini API keys securely in the application configuration.

**NFR-14**: The system SHALL NOT log or expose API keys in error messages or logs.

**NFR-15**: The system SHALL transmit audio files to Gemini API over HTTPS only.

## 5. Constraints

**CON-1**: The feature SHALL only support audio files in formats compatible with Gemini 2.5 Pro (WAV, MP3, FLAC, etc.).

**CON-2**: The feature SHALL require an active internet connection for transcription.

**CON-3**: The feature SHALL be subject to Gemini API rate limits and quotas.

**CON-4**: The feature SHALL only work on Windows platforms (due to notepad.exe dependency).

## 6. Assumptions

**ASM-1**: Users have a valid Google Gemini API key configured.

**ASM-2**: Audio files are in a format supported by the existing transcription_module.py.

**ASM-3**: Users have sufficient disk space for storing transcription text files.

**ASM-4**: The application has read/write permissions to the download directory.

## 7. Dependencies

**DEP-1**: Google Gemini API (gemini-2.0-flash-exp model recommended for transcription)

**DEP-2**: Existing transcription_module.py and ai_service.py infrastructure

**DEP-3**: File metadata storage system

**DEP-4**: Toast notification system

**DEP-5**: Existing file download mechanisms

## 8. Future Enhancements (Out of Scope)

- Multi-language transcription selection
- In-app transcription viewer (instead of Notepad)
- Transcription editing capabilities
- Export to different formats (PDF, DOCX)
- Meeting insights extraction (already partially supported)
- Speaker diarization display
- Transcription search and filtering
