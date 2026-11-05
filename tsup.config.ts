import type { Options } from 'tsup'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { defineConfig } from 'tsup'
import { loadEnv } from 'vite'
import logger from '~/utils/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function buildExternals(option: Options): Options[] {
  return [
    {
      entry: {
        'lib/sharp/index': 'lib/sharp/index.ts',
      },
      format: ['cjs'],
      target: 'node18',
      minify: !option.watch,
      dts: false,
      clean: false,
    },
    {
      // 目录 I/O Worker 必须独立打包成 cjs 文件，extension 通过 new Worker(filePath)
      // 加载它（不能跟主 bundle 共用，否则 require('vscode') 等会爆）。
      entry: {
        'directory-io-worker': 'src/message/directory-io-worker.ts',
        'thumbnail-worker': 'src/message/thumbnail-worker.ts',
      },
      format: ['cjs'],
      target: 'node18',
      minify: !option.watch,
      dts: false,
      clean: false,
      external: ['vscode'],
    },
  ]
}

export default defineConfig(option => [
  {
    entry: {
      'extension': 'src/extension.ts',
    },
    format: 'cjs',
    external: ['vscode', 'sharp'],
    noExternal: ['sharp/package.json', /sharp\/lib\/libvips/],
    dts: false,
    target: 'node18',
    minify: !option.watch,
    env: {
      NODE_ENV: option.watch ? 'development' : process.env.NODE_ENV || 'production',
      ...loadEnv('', __dirname, 'IM_'),
    },
    define: {
      'import.meta.env': JSON.stringify({}),
    },
    onSuccess() {
      execa('npm', ['run', 'build:i18n'])
      logger.success('i18n build success')
      return Promise.resolve()
    },
    clean: false,
  },
  ...buildExternals(option),
])
