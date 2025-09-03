import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { deviceService } from '@/services/deviceService';

export const useDeviceConnection = () => {
  const {
    device,
    isDeviceConnected,
    settings,
    setDevice,
    setError,
    setLoading,
    setLoadingProgress,
    recordings,
    setRecordings,
    addRecordings
  } = useAppStore();

  // Create stable refs for the store functions
  const connectDeviceRef = useRef<(() => Promise<void>) | null>(null);
  const hasTriedAutoReconnect = useRef(false);

  const connectDevice = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const connectedDevice = await deviceService.requestDevice();
      
      // Handle user cancellation
      if (!connectedDevice) {
        return; // User cancelled, no error needed
      }
      
      setDevice(connectedDevice);

      // Clear existing recordings for fresh streaming
      console.log(`🗑️ HOOK: Clearing recordings for fresh streaming at ${new Date().toLocaleTimeString()}`);
      setRecordings([]);

      // Set up progress listener for file loading
      deviceService.onProgress('get_recordings', (progress) => {
        console.log(`📊 HOOK: Progress update - ${progress.progress}/${progress.total} - ${progress.message} at ${new Date().toLocaleTimeString()}`);
        setLoadingProgress({
          operation: 'Loading file list',
          current: progress.progress,
          total: progress.total || 100,
          message: progress.message || `Loading recordings...`
        });
      });

      // Set up streaming listener for incremental file updates
      deviceService.onProgress('streaming_files', (progress) => {
        if (progress.newFiles && progress.newFiles.length > 0) {
          console.log(`📨 HOOK: Received ${progress.newFiles.length} new files from streaming at ${new Date().toLocaleTimeString()}. Adding to UI...`);
          addRecordings(progress.newFiles);
        }
      });

      // Load recordings with streaming
      console.log('🔄 HOOK: Starting getRecordings...');
      const deviceRecordings = await deviceService.getRecordings();
      console.log(`✅ HOOK: getRecordings completed with ${deviceRecordings.length} total files`);
      // Note: files should already be added via streaming, but set final result to be safe
      setRecordings(deviceRecordings);

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to connect device');
    } finally {
      setLoading(false);
      setLoadingProgress(null);
      deviceService.removeProgressListener('get_recordings');
      deviceService.removeProgressListener('streaming_files');
    }
  }, [setDevice, setError, setLoading, setLoadingProgress, setRecordings, addRecordings]);

  // Update the ref whenever connectDevice changes
  connectDeviceRef.current = connectDevice;

  const disconnectDevice = useCallback(async () => {
    try {
      await deviceService.disconnect();
      setDevice(null);
      setRecordings([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to disconnect device');
    }
  }, [setDevice, setError, setRecordings]);

  // Auto-reconnect on app startup to previously paired devices
  const tryAutoReconnect = useCallback(async () => {
    if (hasTriedAutoReconnect.current || isDeviceConnected) {
      return;
    }
    
    hasTriedAutoReconnect.current = true;
    console.log('🔄 Attempting auto-reconnection...');
    
    try {
      const connectedDevice = await deviceService.tryAutoReconnect();
      if (connectedDevice) {
        // Set the full device info with storage
        setDevice(connectedDevice);
        
        // Load recordings with streaming
        console.log(`📋 Loading recordings after auto-reconnect...`);
        setRecordings([]);
        
        deviceService.onProgress('get_recordings', (progress) => {
          setLoadingProgress({
            operation: 'Loading file list',
            current: progress.progress,
            total: progress.total || 100,
            message: progress.message || 'Loading recordings...'
          });
        });

        deviceService.onProgress('streaming_files', (progress) => {
          if (progress.newFiles && progress.newFiles.length > 0) {
            addRecordings(progress.newFiles);
          }
        });

        const deviceRecordings = await deviceService.getRecordings();
        setRecordings(deviceRecordings);
        setLoadingProgress(null);
        
        console.log('✅ Auto-reconnection successful');
      }
    } catch (error) {
      console.warn('⚠️ Auto-reconnection failed:', error);
      // Don't show error to user for auto-reconnection failures
    } finally {
      deviceService.removeProgressListener('get_recordings');
      deviceService.removeProgressListener('streaming_files');
    }
  }, [isDeviceConnected, setDevice, setRecordings, addRecordings, setLoadingProgress]);

  const refreshRecordings = useCallback(async () => {
    if (!isDeviceConnected) return;

    setLoading(true);
    
    // Clear existing recordings for fresh streaming
    setRecordings([]);
    
    try {
      // Set up progress listener for file loading
      deviceService.onProgress('get_recordings', (progress) => {
        setLoadingProgress({
          operation: 'Refreshing file list',
          current: progress.progress,
          total: progress.total || 100,
          message: progress.message || `Loading recordings...`
        });
      });

      // Set up streaming listener for incremental file updates
      deviceService.onProgress('streaming_files', (progress) => {
        if (progress.newFiles && progress.newFiles.length > 0) {
          addRecordings(progress.newFiles);
        }
      });

      const deviceRecordings = await deviceService.getRecordings(true); // Force refresh since user explicitly requested it
      // Note: files should already be added via streaming, but set final result to be safe
      setRecordings(deviceRecordings);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to refresh recordings');
    } finally {
      setLoading(false);
      setLoadingProgress(null);
      deviceService.removeProgressListener('get_recordings');
      deviceService.removeProgressListener('streaming_files');
    }
  }, [isDeviceConnected, setRecordings, addRecordings, setError, setLoading, setLoadingProgress]);

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

  // Auto-reconnect on page load if device was previously connected and setting is enabled
  useEffect(() => {
    // Only auto-connect if the setting is enabled
    if (!settings.autoConnect) {
      console.debug('Auto-connect is disabled in settings');
      return;
    }

    // Try auto-reconnection using the proper method
    tryAutoReconnect();
  }, [settings.autoConnect, tryAutoReconnect]);

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
