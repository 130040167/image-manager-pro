import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { '~': path.resolve(__dirname, '../../src') } },
  server: { host: '127.0.0.1', port: 5201, strictPort: true },
})
