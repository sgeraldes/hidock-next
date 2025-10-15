import React, { useState, useCallback } from 'react';
import { FirmwareService } from '../services/firmwareService';

interface FirmwareUpdateProps {
  device: any; // HiDock USB device instance
  currentVersion: number;
  model: string;
}

export const FirmwareUpdate: React.FC<FirmwareUpdateProps> = ({
  device,
  currentVersion,
  model
}) => {
  const [status, setStatus] = useState<'idle' | 'checking' | 'downloading' | 'uploading' | 'complete' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [updateInfo, setUpdateInfo] = useState<any>(null);

  const checkForUpdate = useCallback(async () => {
    setStatus('checking');
    setErrorMessage('');
    
    try {
      const metadata = await FirmwareService.checkFirmwareUpdate(currentVersion, model);
      
      if (metadata) {
        setUpdateInfo(metadata);
        setStatus('idle');
        return true;
      } else {
        setStatus('complete');
        setErrorMessage('Your device is already running the latest firmware');
        return false;
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage('Failed to check for updates');
      return false;
    }
  }, [currentVersion, model]);

  const performUpdate = useCallback(async () => {
    if (!updateInfo) {
      await checkForUpdate();
      return;
    }

    try {
      setStatus('downloading');
      setProgress(0);

      // Download firmware
      const firmwareData = await FirmwareService.downloadFirmware(
        updateInfo.fileName,
        (downloadProgress) => {
          setProgress(Math.round(downloadProgress * 50)); // 0-50% for download
        }
      );

      // Validate firmware
      const isValid = await FirmwareService.validateFirmware(
        firmwareData,
        updateInfo.signature
      );

      if (!isValid) {
        throw new Error('Firmware validation failed');
      }

      // Upload to device
      setStatus('uploading');
      const success = await FirmwareService.uploadFirmwareToDevice(
        device,
        firmwareData,
        updateInfo,
        (uploadProgress) => {
          setProgress(50 + Math.round(uploadProgress * 50)); // 50-100% for upload
        }
      );

      if (success) {
        setStatus('complete');
        setProgress(100);
      } else {
        throw new Error('Firmware upload failed');
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Update failed');
    }
  }, [device, updateInfo, checkForUpdate]);

  const getStatusMessage = () => {
    switch (status) {
      case 'checking':
        return 'Checking for updates...';
      case 'downloading':
        return `Downloading firmware... ${progress}%`;
      case 'uploading':
        return `Installing firmware... ${progress}%`;
      case 'complete':
        return updateInfo ? 'Firmware updated successfully!' : 'Your device is up to date';
      case 'error':
        return errorMessage;
      default:
        return updateInfo ? `Update available: v${updateInfo.versionCode}` : '';
    }
  };

  return (
    <div className="firmware-update-container p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-4">Firmware Update</h2>
      
      <div className="device-info mb-4">
        <p className="text-gray-600">Model: {model}</p>
        <p className="text-gray-600">Current Version: {currentVersion}</p>
      </div>

      {updateInfo && status === 'idle' && (
        <div className="update-info mb-4 p-4 bg-blue-50 rounded">
          <h3 className="font-semibold mb-2">New Version Available: {updateInfo.versionCode}</h3>
          <div className="changelog text-sm text-gray-700 whitespace-pre-line">
            {updateInfo.remark}
          </div>
        </div>
      )}

      <div className="status-message mb-4">
        <p className={`text-lg ${status === 'error' ? 'text-red-600' : 'text-gray-800'}`}>
          {getStatusMessage()}
        </p>
      </div>

      {(status === 'downloading' || status === 'uploading') && (
        <div className="progress-bar mb-4">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div 
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="actions flex gap-4">
        {status === 'idle' && !updateInfo && (
          <button
            onClick={checkForUpdate}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Check for Updates
          </button>
        )}

        {status === 'idle' && updateInfo && (
          <>
            <button
              onClick={performUpdate}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
            >
              Install Update
            </button>
            <button
              onClick={() => setUpdateInfo(null)}
              className="px-6 py-2 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
            >
              Cancel
            </button>
          </>
        )}

        {status === 'complete' && (
          <button
            onClick={() => {
              setStatus('idle');
              setUpdateInfo(null);
              setProgress(0);
            }}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            OK
          </button>
        )}
      </div>

      {status === 'uploading' && (
        <div className="warning mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-yellow-800 font-semibold">⚠️ Important:</p>
          <ul className="text-yellow-700 text-sm mt-2">
            <li>• Do not disconnect your HiDock during the update</li>
            <li>• Keep the device powered on</li>
            <li>• The update may take several minutes</li>
          </ul>
        </div>
      )}
    </div>
  );
};