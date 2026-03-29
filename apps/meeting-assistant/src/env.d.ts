interface ElectronAPI {
  app: {
    info: () => Promise<{ name: string; version: string; path: string }>;
  };

  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
