import { defineConfig, configDefaults } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    },
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@pages': resolve(__dirname, 'src/pages'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@lib': resolve(__dirname, 'src/lib'),
      '@store': resolve(__dirname, 'src/store'),
      '@types': resolve(__dirname, 'src/types')
    },
    // D3 follow-up (review): the better-sqlite3 dual-ABI shim is SCOPED, not
    // global. Only the `main-db` project (main-process, DB-backed tests) loads
    // src/test/setup-db.ts. Renderer tests never see the mock, and the
    // `native-binding` project runs UNMOCKED so it can detect a missing or
    // broken production binding (better-sqlite3-binding.smoke.test.ts).
    projects: [
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'main-db',
          include: ['electron/**/__tests__/**/*.test.ts', 'electron/**/__tests__/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, '**/*.smoke.test.ts'],
          setupFiles: ['./src/test/setup.ts', './src/test/setup-db.ts'],
          // DB-backed suites run initializeDatabase() (40+ migrations, often on
          // the sql.js/WASM engine) inside beforeAll/beforeEach hooks. That is
          // fast locally but blew the 10s default hookTimeout on a loaded
          // shared CI runner (run 29342252597: pixel-rag beforeAll,
          // timeline-analysis beforeEach). 30s absorbs runner-speed variance
          // while still failing fast on a genuine hang.
          hookTimeout: 30_000
        }
      },
      {
        extends: true,
        test: {
          name: 'native-binding',
          include: ['electron/**/__tests__/**/*.smoke.test.ts'],
          setupFiles: ['./src/test/setup.ts']
        }
      }
    ]
  }
})
