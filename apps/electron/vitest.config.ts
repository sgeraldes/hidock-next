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
          // Many main-db files run initializeDatabase() in beforeAll/beforeEach.
          // That's sub-second warm, but on cold or starved CI runners it blows
          // the default 10s hookTimeout (pixel-rag, timeline-analysis and
          // merge-journal have each red-lighted CI this way). A hung hook still
          // fails — it just gets a runner-realistic margin.
          hookTimeout: 60000
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
