import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 当 debug.enabled = true 时，把 Channel.* 输出多写一份到 ~/.vscode-image-manager-debug.log。
 *
 * VSCode 的 OutputChannel 在用户关掉窗口或下拉切别的 channel 后就看不到了，
 * 排查 SSHFS 上 globby/watcher 行为时常常需要的是滚动几分钟的连续日志，
 * 文件比 Output 面板更适合。
 *
 * 文件单调追加；通过 maxBytes 在写入时简单截断，避免长时间运行时把磁盘塞满。
 */

let logFilePath: string | null = null
let writeStream: fs.WriteStream | null = null
// eslint-disable-next-line prefer-const -- 保留 let 以便未来通过配置覆盖
let maxBytes = 50 * 1024 * 1024 // 50MB
let writtenBytes = 0
let truncatedThisSession = false

function defaultLogPath(): string {
  return path.join(os.homedir(), '.vscode-image-manager-debug.log')
}

function ensureStream(): fs.WriteStream | null {
  if (writeStream)
    return writeStream
  if (!logFilePath)
    logFilePath = defaultLogPath()

  try {
    // 启动时如果文件已经超过上限，先 truncate，避免越写越大
    try {
      const stat = fs.statSync(logFilePath)
      if (stat.size > maxBytes && !truncatedThisSession) {
        fs.truncateSync(logFilePath, 0)
        truncatedThisSession = true
      }
      writtenBytes = stat.size > maxBytes ? 0 : stat.size
    }
    catch {
      writtenBytes = 0
    }
    writeStream = fs.createWriteStream(logFilePath, { flags: 'a' })
    writeStream.on('error', () => {
      // 写日志失败不应影响主流程
      writeStream = null
    })
    return writeStream
  }
  catch {
    return null
  }
}

export function setDebugLogFilePath(p: string | null): void {
  if (writeStream) {
    writeStream.end()
    writeStream = null
  }
  logFilePath = p
  writtenBytes = 0
  truncatedThisSession = false
}

export function getDebugLogFilePath(): string {
  return logFilePath || defaultLogPath()
}

export function writeDebugLine(line: string): void {
  const stream = ensureStream()
  if (!stream)
    return
  const ts = new Date().toISOString()
  const out = `[${ts}] ${line}\n`
  // 简单的环形上限：超过就 truncate 重新开
  if (writtenBytes + Buffer.byteLength(out, 'utf8') > maxBytes) {
    try {
      writeStream?.end()
    }
    catch {}
    try {
      fs.truncateSync(logFilePath || defaultLogPath(), 0)
    }
    catch {}
    writeStream = null
    writtenBytes = 0
    const reopened = ensureStream()
    if (!reopened)
      return
    reopened.write(`[${ts}] [debug-log rotated]\n`)
  }
  try {
    stream.write(out)
    writtenBytes += Buffer.byteLength(out, 'utf8')
  }
  catch {
    // 失败就静默
  }
}

export function closeDebugLog(): void {
  if (writeStream) {
    try {
      writeStream.end()
    }
    catch {}
    writeStream = null
  }
}
