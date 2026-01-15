import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          splash: resolve(__dirname, 'electron/preload/splash.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html')
        },
        output: {
          // Manual chunks for better caching and bundle organization
          manualChunks: {
            // Core React runtime - rarely changes
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            // UI component library - changes occasionally
            'vendor-radix': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-popover',
              '@radix-ui/react-select',
              '@radix-ui/react-tooltip',
              '@radix-ui/react-tabs',
              '@radix-ui/react-toast',
              '@radix-ui/react-scroll-area',
              '@radix-ui/react-slider'
            ],
            // State management
            'vendor-state': ['zustand']
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@components': resolve(__dirname, 'src/components'),
        '@pages': resolve(__dirname, 'src/pages'),
        '@hooks': resolve(__dirname, 'src/hooks'),
        '@lib': resolve(__dirname, 'src/lib'),
        '@store': resolve(__dirname, 'src/store'),
        '@types': resolve(__dirname, 'src/types')
      }
    },
    plugins: [react()]
  }
})
