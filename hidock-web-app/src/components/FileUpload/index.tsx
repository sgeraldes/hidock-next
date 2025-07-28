import React, { useCallback, useState } from 'react';
import { Upload, File, X, AlertCircle } from 'lucide-react';
import { AUDIO_CONFIG, ERROR_MESSAGES } from '@/constants';
import { formatBytes } from '@/utils/formatters';
import type { AudioData } from '@/types';

interface FileUploadProps {
  onFileSelect: (audioData: AudioData) => void;
  onError: (error: string) => void;
  disabled?: boolean;
  className?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  onError,
  disabled = false,
  className = ''
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > AUDIO_CONFIG.MAX_FILE_SIZE) {
      return ERROR_MESSAGES.FILE_TOO_LARGE;
    }

    // Check file type
    if (!AUDIO_CONFIG.SUPPORTED_FORMATS.includes(file.type)) {
      return ERROR_MESSAGES.UNSUPPORTED_FORMAT;
    }

    return null;
  };

  const processFile = useCallback(async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      onError(validationError);
      return;
    }

    setIsProcessing(true);

    try {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (!result) {
          onError('Failed to read file');
          setIsProcessing(false);
          return;
        }

        const base64Data = result.split(',')[1]; // Remove data URL prefix
        
        const audioData: AudioData = {
          fileName: file.name,
          base64: base64Data,
          mimeType: file.type,
          size: file.size,
        };

        onFileSelect(audioData);
        setIsProcessing(false);
      };

      reader.onerror = () => {
        onError('Failed to read file');
        setIsProcessing(false);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      onError('Failed to process file');
      setIsProcessing(false);
    }
  }, [onFileSelect, onError]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    const audioFile = files.find(file => 
      AUDIO_CONFIG.SUPPORTED_FORMATS.includes(file.type)
    );

    if (audioFile) {
      processFile(audioFile);
    } else if (files.length > 0) {
      onError(ERROR_MESSAGES.UNSUPPORTED_FORMAT);
    }
  };

  return (
    <div className={className}>
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200
          ${isDragOver && !disabled
            ? 'border-primary-400 bg-primary-400/10' 
            : 'border-slate-600 hover:border-slate-500'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isProcessing ? 'pointer-events-none' : ''}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={AUDIO_CONFIG.SUPPORTED_FORMATS.join(',')}
          onChange={handleFileInput}
          disabled={disabled || isProcessing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          id="file-upload"
        />

        {isProcessing ? (
          <div className="space-y-4">
            <div className="w-12 h-12 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <div>
              <h3 className="text-lg font-medium text-slate-100 mb-2">Processing File...</h3>
              <p className="text-slate-400">Please wait while we prepare your audio file</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="w-12 h-12 text-slate-500 mx-auto" />
            <div>
              <h3 className="text-lg font-medium text-slate-100 mb-2">Upload Audio File</h3>
              <p className="text-slate-400 mb-4">
                Drag and drop an audio file here, or click to browse
              </p>
              <div className="text-sm text-slate-500">
                <p>Supported formats: MP3, WAV, M4A, OGG</p>
                <p>Maximum size: {formatBytes(AUDIO_CONFIG.MAX_FILE_SIZE)}</p>
              </div>
            </div>
            <label 
              htmlFor="file-upload" 
              className="btn-primary inline-flex items-center space-x-2 cursor-pointer"
            >
              <File className="w-4 h-4" />
              <span>Choose File</span>
            </label>
          </div>
        )}
      </div>

      {/* File Format Info */}
      <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
        <div className="flex items-start space-x-2">
          <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-slate-400">
            <p className="font-medium mb-1">Tips for best results:</p>
            <ul className="space-y-1 text-xs">
              <li>• Use clear, high-quality audio recordings</li>
              <li>• Minimize background noise when possible</li>
              <li>• Ensure speakers are clearly audible</li>
              <li>• Files under 10MB typically process faster</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};