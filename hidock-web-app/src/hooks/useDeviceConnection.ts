import { useCallback, useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { deviceService } from '@/services/deviceService';

export const useDeviceConnection = () => {
  const { 
    device, 
    isDeviceConnected, 
    setDevice, 
    setError, 
    setLoading,
    recordings,
    setRecordings
  } = useAppStore();

  const connectDevice = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const connectedDevice = await deviceService.requestDevice();
      setDevice(connectedDevice);
      
      // Load recordings after successful connection
      const deviceRecordings = await deviceService.getRecordings();
      setRecordings(deviceRecordings);
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to connect device');
    } finally {
      setLoading(false);
    }
  }, [setDevice, setError, setLoading, setRecordings]);

  const disconnectDevice = useCallback(async () => {
    try {
      await deviceService.disconnect();
      setDevice(null);
      setRecordings([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to disconnect device');
    }
  }, [setDevice, setError, setRecordings]);

  const refreshRecordings = useCallback(async () => {
    if (!isDeviceConnected) return;
    
    setLoading(true);
    try {
      const deviceRecordings = await deviceService.getRecordings();
      setRecordings(deviceRecordings);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to refresh recordings');
    } finally {
      setLoading(false);
    }
  }, [isDeviceConnected, setRecordings, setError, setLoading]);

  const downloadRecording = useCallback(async (recordingId: string) => {
    if (!isDeviceConnected) return;
    
    try {
      const audioData = await deviceService.downloadRecording(recordingId);
      // Handle the downloaded audio data
      console.log('Downloaded recording:', recordingId, audioData);
      
      // Update recording status
      const updatedRecordings = recordings.map(rec => 
        rec.id === recordingId 
          ? { ...rec, status: 'downloaded' as const }
          : rec
      );
      setRecordings(updatedRecordings);
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to download recording');
    }
  }, [isDeviceConnected, recordings, setRecordings, setError]);

  const deleteRecording = useCallback(async (recordingId: string) => {
    if (!isDeviceConnected) return;
    
    try {
      await deviceService.deleteRecording(recordingId);
      
      // Remove recording from state
      const updatedRecordings = recordings.filter(rec => rec.id !== recordingId);
      setRecordings(updatedRecordings);
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete recording');
    }
  }, [isDeviceConnected, recordings, setRecordings, setError]);

  const formatDevice = useCallback(async () => {
    if (!isDeviceConnected) return;
    
    setLoading(true);
    try {
      await deviceService.formatDevice();
      setRecordings([]);
      
      // Refresh device info
      if (device) {
        const updatedDevice = { ...device };
        updatedDevice.storageInfo.usedSpace = 0;
        updatedDevice.storageInfo.fileCount = 0;
        setDevice(updatedDevice);
      }
      
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to format device');
    } finally {
      setLoading(false);
    }
  }, [isDeviceConnected, device, setDevice, setRecordings, setError, setLoading]);

  const syncTime = useCallback(async () => {
    if (!isDeviceConnected) return;
    
    try {
      await deviceService.syncTime();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to sync device time');
    }
  }, [isDeviceConnected, setError]);

  // Auto-connect on page load if device was previously connected
  useEffect(() => {
    const checkForDevice = async () => {
      if (navigator.usb) {
        try {
          const devices = await navigator.usb.getDevices();
          if (devices.length > 0) {
            // Try to reconnect to the first available device
            const connectedDevice = await deviceService.connectToDevice(devices[0]);
            setDevice(connectedDevice);
            
            const deviceRecordings = await deviceService.getRecordings();
            setRecordings(deviceRecordings);
          }
        } catch (error) {
          // Silently fail - user can manually connect
          console.log('Auto-connect failed:', error);
        }
      }
    };

    checkForDevice();
  }, [setDevice, setRecordings]);

  return {
    device,
    isDeviceConnected,
    connectDevice,
    disconnectDevice,
    refreshRecordings,
    downloadRecording,
    deleteRecording,
    formatDevice,
    syncTime,
  };
};