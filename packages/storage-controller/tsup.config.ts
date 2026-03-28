import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node18',
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true
  },
  {
    entry: {
      cli: 'src/cli.ts',
      mcp: 'src/mcp.ts'
    },
    format: ['esm'],
    target: 'node18',
    dts: false,
    splitting: false,
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node'
    }
  }
])
