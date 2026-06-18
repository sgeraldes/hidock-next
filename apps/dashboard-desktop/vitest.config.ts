import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/main/services/**/*.test.ts'],
    restoreMocks: true
  }
})
