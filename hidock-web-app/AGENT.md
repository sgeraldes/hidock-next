# AI Assistant Operational Rules: HiDock Web Application

This document contains the mandatory, non-negotiable rules and procedures for all React TypeScript development on the HiDock Web Application. As an AI assistant, you must adhere to these rules without exception. All project configurations are defined in `package.json`, `tsconfig.json`, and `vite.config.ts`.

---

## 1. Core Directives

- **React 18 + Zustand State Management:** You must use React 18 with Zustand for global state. Never use Redux, Context API for global state, or prop drilling.

- **TypeScript Strict Mode:** All code must pass strict TypeScript checking with zero errors. No `any` types allowed except for third-party library interfaces.

- **WebUSB API Mandatory:** All device communication must use the WebUSB API. Never attempt alternative device communication methods.

- **Multi-Provider AI Integration:** Support exactly 11 AI providers as defined in the configuration. Never hard-code provider logic.

- **Vite Build System Only:** Never use Create React App, Webpack, or other build tools. All development must use Vite.

## 2. Technology Stack Requirements

### Required Dependencies

You must use these exact core dependencies:

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.4.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "typescript": "^5.0.0",
    "vite": "^4.4.0"
  }
}
```

### WebUSB Requirements

All device communication must use this exact pattern:

```typescript
interface HiDockDevice {
  vendorId: number;
  productId: number;
  device?: USBDevice;
}

class WebUSBManager {
  private device: USBDevice | null = null;

  async requestDevice(): Promise<boolean> {
    try {
      this.device = await navigator.usb.requestDevice({
        filters: [
          { vendorId: 0x1234, productId: 0x5678 } // HiDock vendor/product IDs
        ]
      });
      return true;
    } catch (error) {
      console.error('Device selection failed:', error);
      return false;
    }
  }

  async connect(): Promise<boolean> {
    if (!this.device) return false;

    try {
      await this.device.open();
      await this.device.selectConfiguration(1);
      await this.device.claimInterface(0);
      return true;
    } catch (error) {
      console.error('Device connection failed:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await this.device.releaseInterface(0);
        await this.device.close();
      } catch (error) {
        console.error('Disconnect error:', error);
      } finally {
        this.device = null;
      }
    }
  }
}
```

## 3. Zustand State Management Requirements

### Global State Structure

You must implement this exact Zustand store structure:

```typescript
interface AppState {
  // Device state
  device: {
    connected: boolean;
    info: DeviceInfo | null;
    files: DeviceFile[];
    status: 'idle' | 'connecting' | 'syncing' | 'error';
  };

  // AI provider state
  ai: {
    selectedProvider: AIProvider;
    apiKeys: Record<string, string>;
    transcriptions: Record<string, TranscriptionResult>;
    processing: Set<string>;
  };

  // UI state
  ui: {
    theme: 'light' | 'dark';
    sidebarOpen: boolean;
    activeTab: string;
  };
}

interface AppActions {
  // Device actions
  connectDevice: () => Promise<boolean>;
  disconnectDevice: () => Promise<void>;
  syncFiles: () => Promise<void>;

  // AI actions
  setAIProvider: (provider: AIProvider) => void;
  transcribeFile: (fileId: string) => Promise<void>;

  // UI actions
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  // Initial state
  device: {
    connected: false,
    info: null,
    files: [],
    status: 'idle'
  },
  ai: {
    selectedProvider: 'openai',
    apiKeys: {},
    transcriptions: {},
    processing: new Set()
  },
  ui: {
    theme: 'light',
    sidebarOpen: false,
    activeTab: 'files'
  },

  // Actions implementation
  connectDevice: async () => {
    set(state => ({
      device: { ...state.device, status: 'connecting' }
    }));

    const webUSB = new WebUSBManager();
    const success = await webUSB.requestDevice() && await webUSB.connect();

    set(state => ({
      device: {
        ...state.device,
        connected: success,
        status: success ? 'idle' : 'error'
      }
    }));

    return success;
  }

  // ... other actions
}));
```

## 4. Multi-Provider AI Integration

### Required AI Provider Support

You must implement these exact 11 AI providers:

```typescript
type AIProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure'
  | 'aws'
  | 'huggingface'
  | 'cohere'
  | 'replicate'
  | 'together'
  | 'perplexity'
  | 'deepseek';

interface AIProviderConfig {
  name: string;
  apiKeyRequired: boolean;
  models: string[];
  endpoint: string;
  headers: (apiKey: string) => Record<string, string>;
}

const AI_PROVIDERS: Record<AIProvider, AIProviderConfig> = {
  openai: {
    name: 'OpenAI',
    apiKeyRequired: true,
    models: ['whisper-1', 'gpt-4-turbo'],
    endpoint: 'https://api.openai.com/v1',
    headers: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    })
  },
  // ... define all 11 providers
};
```

### Transcription Service Pattern

All AI provider integrations must follow this pattern:

```typescript
interface TranscriptionService {
  transcribe(audioFile: File, provider: AIProvider, apiKey: string): Promise<TranscriptionResult>;
}

class AITranscriptionService implements TranscriptionService {
  async transcribe(audioFile: File, provider: AIProvider, apiKey: string): Promise<TranscriptionResult> {
    const config = AI_PROVIDERS[provider];

    if (!config) {
      throw new Error(`Unsupported AI provider: ${provider}`);
    }

    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', config.models[0]);

    try {
      const response = await fetch(`${config.endpoint}/audio/transcriptions`, {
        method: 'POST',
        headers: config.headers(apiKey),
        body: formData
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const result = await response.json();

      return {
        text: result.text,
        provider,
        timestamp: new Date().toISOString(),
        confidence: result.confidence || 0.95
      };
    } catch (error) {
      throw new Error(`Transcription failed: ${error.message}`);
    }
  }
}
```

## 5. Mandatory Component Patterns

### React Component Structure

All React components must follow this exact pattern:

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';

interface ComponentProps {
  className?: string;
  children?: React.ReactNode;
  // All other props must be explicitly typed
}

export const ComponentName: React.FC<ComponentProps> = ({
  className,
  children,
  ...props
}) => {
  // Local state
  const [localState, setLocalState] = useState<string>('');

  // Zustand store access
  const { device, connectDevice } = useAppStore();

  // Event handlers with useCallback
  const handleAction = useCallback(async () => {
    try {
      await connectDevice();
    } catch (error) {
      console.error('Action failed:', error);
    }
  }, [connectDevice]);

  // Effects with cleanup
  useEffect(() => {
    // Effect logic

    return () => {
      // Cleanup
    };
  }, []);

  return (
    <div className={`component-name ${className || ''}`} {...props}>
      {children}
    </div>
  );
};
```

### WebUSB Device Components

All device-related components must include these error handling patterns:

```typescript
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';

export const DeviceConnection: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const { device, connectDevice, disconnectDevice } = useAppStore();

  useEffect(() => {
    const handleUSBDisconnect = (event: USBConnectionEvent) => {
      if (event.device === device.info?.device) {
        disconnectDevice();
        setError('Device disconnected unexpectedly');
      }
    };

    navigator.usb.addEventListener('disconnect', handleUSBDisconnect);

    return () => {
      navigator.usb.removeEventListener('disconnect', handleUSBDisconnect);
    };
  }, [device.info?.device, disconnectDevice]);

  const handleConnect = async () => {
    setError(null);
    try {
      await connectDevice();
    } catch (error) {
      setError(`Connection failed: ${error.message}`);
    }
  };

  return (
    <div className="device-connection">
      {error && <div className="error">{error}</div>}
      {device.connected ? (
        <button onClick={disconnectDevice}>Disconnect</button>
      ) : (
        <button onClick={handleConnect}>Connect Device</button>
      )}
    </div>
  );
};
```

## 6. Testing Requirements

### Component Testing Pattern

All components must be tested using this pattern:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentName } from './ComponentName';

// Mock Zustand store
vi.mock('../store/appStore', () => ({
  useAppStore: vi.fn(() => ({
    device: { connected: false },
    connectDevice: vi.fn()
  }))
}));

describe('ComponentName', () => {
  it('should render without errors', () => {
    render(<ComponentName />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should handle device connection', async () => {
    const mockConnect = vi.fn().mockResolvedValue(true);
    const { useAppStore } = await import('../store/appStore');
    (useAppStore as any).mockReturnValue({
      device: { connected: false },
      connectDevice: mockConnect
    });

    render(<ComponentName />);

    fireEvent.click(screen.getByText(/connect/i));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalled();
    });
  });
});
```

### WebUSB API Testing

All WebUSB functionality must be tested with proper mocking:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { WebUSBManager } from './WebUSBManager';

// Mock WebUSB API
const mockUSBDevice = {
  open: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  selectConfiguration: vi.fn().mockResolvedValue(undefined),
  claimInterface: vi.fn().mockResolvedValue(undefined),
  releaseInterface: vi.fn().mockResolvedValue(undefined)
};

Object.defineProperty(navigator, 'usb', {
  value: {
    requestDevice: vi.fn().mockResolvedValue(mockUSBDevice),
    getDevices: vi.fn().mockResolvedValue([])
  },
  writable: true
});

describe('WebUSBManager', () => {
  it('should request device successfully', async () => {
    const manager = new WebUSBManager();
    const result = await manager.requestDevice();

    expect(result).toBe(true);
    expect(navigator.usb.requestDevice).toHaveBeenCalled();
  });
});
```

## 7. Quality Gates for Web Application

### Build Requirements

1. **Zero TypeScript Errors:** `tsc --noEmit` must pass
2. **ESLint Compliance:** `eslint src --ext .ts,.tsx` must pass
3. **Vitest Tests:** All tests must pass with >90% coverage
4. **Bundle Size:** Main bundle must be under 1MB
5. **Vite Build:** `vite build` must complete without warnings

### Runtime Requirements

1. **WebUSB Support:** Application must detect WebUSB availability
2. **Responsive Design:** Must work on desktop and tablet (768px+)
3. **Error Recovery:** Must handle device disconnections gracefully
4. **Performance:** Initial load within 2 seconds, interactions within 100ms

## 8. Local Validation Commands

Before committing any web application code, run these commands:

```bash
# Type checking
npx tsc --noEmit

# Linting
npx eslint src --ext .ts,.tsx --fix

# Testing
npm run test

# Build verification
npm run build

# Development server
npm run dev
```

## 9. Mandatory Project Structure

All code must follow this exact structure:

```text
hidock-web-app/
├── src/
│   ├── main.tsx             # React 18 app entry point
│   ├── App.tsx              # Main application component
│   ├── components/
│   │   ├── DeviceConnection.tsx # WebUSB device management
│   │   ├── FileManager.tsx      # Device file operations
│   │   ├── Transcription.tsx    # AI transcription interface
│   │   └── Settings.tsx         # App configuration
│   ├── store/
│   │   └── appStore.ts      # Zustand global state
│   ├── services/
│   │   ├── webusb.ts        # WebUSB device communication
│   │   ├── ai.ts            # Multi-provider AI services
│   │   └── storage.ts       # Local storage management
│   ├── types/
│   │   └── index.ts         # TypeScript type definitions
│   ├── hooks/
│   │   ├── useDevice.ts     # Device management hook
│   │   └── useAI.ts         # AI provider management hook
│   └── styles/
│       └── global.css       # Global styles
├── public/
│   └── index.html           # Main HTML template
├── package.json             # Dependencies and scripts
├── vite.config.ts           # Vite configuration
├── tsconfig.json            # TypeScript configuration
└── vitest.config.ts         # Testing configuration
```

## 10. Security Requirements

### API Key Management

All API keys must be stored securely:

```typescript
class SecureStorage {
  private static readonly KEY_PREFIX = 'hidock_ai_';

  static setAPIKey(provider: AIProvider, key: string): void {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('Invalid API key');
    }

    localStorage.setItem(`${this.KEY_PREFIX}${provider}`, key);
  }

  static getAPIKey(provider: AIProvider): string | null {
    return localStorage.getItem(`${this.KEY_PREFIX}${provider}`);
  }

  static removeAPIKey(provider: AIProvider): void {
    localStorage.removeItem(`${this.KEY_PREFIX}${provider}`);
  }

  static clearAllKeys(): void {
    Object.keys(localStorage)
      .filter(key => key.startsWith(this.KEY_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  }
}
```

### Content Security Policy

The application must implement these CSP headers:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               connect-src 'self' https://api.openai.com https://api.anthropic.com;
               script-src 'self' 'unsafe-inline';
               style-src 'self' 'unsafe-inline';">
```

## 11. Performance Requirements

- **Bundle Size:** Main JavaScript bundle under 1MB
- **Initial Load:** First Contentful Paint within 1.5 seconds
- **Device Operations:** WebUSB operations must complete within 3 seconds
- **Memory Usage:** Application must not exceed 150MB RAM

These requirements are non-negotiable and must be maintained across all changes.
