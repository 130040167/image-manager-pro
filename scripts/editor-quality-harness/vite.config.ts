import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import json5 from 'vite-plugin-json5'

export default defineConfig({
  root: __dirname,
  plugins: [react(), json5()],
  resolve: { alias: { '~': path.resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
})
