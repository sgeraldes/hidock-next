
import React, { useState, useRef, useCallback } from 'react';
import type { AudioData } from '../types';
import { MAX_FILE_SIZE_BYTES, SUPPORTED_AUDIO_TYPES, MAX_FILE_SIZE_MB } from '../constants';
import { UploadCloudIcon, MicIcon, StopCircleIcon, AlertCircleIcon } from './IconComponents';


interface AudioInputProps {
  onAudioReady: (audioData: AudioData) => void;
  disabled?: boolean;
}

export const AudioInput: React.FC<AudioInputProps> = ({ onAudioReady, disabled }) => {
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processAudioFile = (file: File) => {
    setError(null);
    setFileName(null);

    if (!SUPPORTED_AUDIO_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type}. Supported types: ${SUPPORTED_AUDIO_TYPES.join(', ')}`);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(2)} MB). Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64Full = e.target?.result as string;
      // Data URL format: "data:[<mediatype>][;base64],<data>"
      const base64Data = base64Full.split(',')[1];
      if (base64Data) {
        onAudioReady({
          fileName: file.name,
          base64: base64Data,
          mimeType: file.type,
        });
        setFileName(file.name);
      } else {
        setError("Could not read file data.");
      }
    };
    reader.onerror = () => {
      setError("Error reading file.");
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processAudioFile(file);
    }
    // Reset file input to allow uploading the same file again after an error or reset
    if(fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      processAudioFile(file);
    }
  };

  const startRecording = async () => {
    setError(null);
    setFileName(null);
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        audioChunksRef.current = [];

        mediaRecorderRef.current.ondataavailable = (event) => {
          audioChunksRef.current.push(event.data);
        };

        mediaRecorderRef.current.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: audioChunksRef.current[0]?.type || 'audio/webm' });
          const recordedFileName = `recording-${new Date().toISOString()}.webm`;
          const reader = new FileReader();
          reader.onload = (e) => {
            const base64Full = e.target?.result as string;
            const base64Data = base64Full.split(',')[1];
            if (base64Data) {
              onAudioReady({
                fileName: recordedFileName,
                base64: base64Data,
                mimeType: audioBlob.type,
              });
              setFileName(recordedFileName);
            } else {
              setError("Could not process recorded audio.");
            }
          };
          reader.onerror = () => {
            setError("Error processing recorded audio.");
          };
          reader.readAsDataURL(audioBlob);

          // Stop microphone tracks
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Error accessing microphone:", err);
        setError("Could not access microphone. Please ensure permission is granted and no other app is using it.");
      }
    } else {
      setError("Audio recording is not supported by your browser.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className="space-y-6">
      <div
        className={`p-6 border-2 border-dashed border-slate-600 rounded-lg text-center cursor-pointer hover:border-sky-500 transition-colors duration-300 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={!disabled ? triggerFileInput : undefined}
        onDragOver={!disabled ? handleDragOver : undefined}
        onDrop={!disabled ? handleDrop : undefined}
      >
        <input
          type="file"
          accept={SUPPORTED_AUDIO_TYPES.join(',')}
          onChange={handleFileChange}
          ref={fileInputRef}
          className="hidden"
          disabled={disabled}
        />
        <UploadCloudIcon className="w-12 h-12 mx-auto text-slate-500 mb-3" />
        <p className="text-slate-400">
          <span className="font-semibold text-sky-400">Click to upload</span> or drag and drop an audio file.
        </p>
        <p className="text-xs text-slate-500 mt-1">Max file size: {MAX_FILE_SIZE_MB}MB. Supported: MP3, WAV, OGG, AAC, FLAC, WEBM</p>
      </div>

      {!isRecording && (
        <button
          onClick={startRecording}
          disabled={disabled || isRecording}
          className="w-full flex items-center justify-center bg-teal-500 hover:bg-teal-600 text-white font-medium py-3 px-4 rounded-lg shadow-sm hover:shadow-md transition duration-300 ease-in-out disabled:opacity-50"
        >
          <MicIcon className="w-5 h-5 mr-2" />
          Record Audio
        </button>
      )}
      {isRecording && (
        <button
          onClick={stopRecording}
          className="w-full flex items-center justify-center bg-red-500 hover:bg-red-600 text-white font-medium py-3 px-4 rounded-lg shadow-sm hover:shadow-md transition duration-300 ease-in-out"
        >
          <StopCircleIcon className="w-5 h-5 mr-2" />
          Stop Recording
        </button>
      )}
      {fileName && <p className="text-sm text-green-400 text-center mt-2">Selected: {fileName}</p>}
      {error && (
        <div className="mt-3 p-3 bg-red-900/50 text-red-300 border border-red-700 rounded-md text-sm flex items-center">
          <AlertCircleIcon className="w-5 h-5 mr-2 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
