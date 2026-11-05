import { vscodeApi } from '~/webview/vscode-api'

const DIRECTORY_WARMUP_PAUSE_AFTER_MS = 5_000
const DIRECTORY_WARMUP_PAUSE_MS = 30_000

const directoryWarmupPausedUntil = new Map<string, number>()

export function getDirectoryWarmupPauseMs(workspaceId: string) {
  const until = directoryWarmupPausedUntil.get(workspaceId) || 0
  const remaining = until - Date.now()
  if (remaining <= 0) {
    directoryWarmupPausedUntil.delete(workspaceId)
    return 0
  }
  return remaining
}

export function recordDirectoryWarmupLoadTiming(options: {
  dirPath: string
  isImageOnlyRequest: boolean
  runMs: number
  traceId: string
  workspaceId: string
}) {
  const { dirPath, isImageOnlyRequest, runMs, traceId, workspaceId } = options
  if (isImageOnlyRequest || runMs <= DIRECTORY_WARMUP_PAUSE_AFTER_MS)
    return

  directoryWarmupPausedUntil.set(workspaceId, Date.now() + DIRECTORY_WARMUP_PAUSE_MS)
  vscodeApi.log('debug', 'directory warmup paused after slow foreground load', {
    dirPath,
    pauseMs: DIRECTORY_WARMUP_PAUSE_MS,
    runMs,
    thresholdMs: DIRECTORY_WARMUP_PAUSE_AFTER_MS,
    traceId,
    workspaceId,
  })
}

export function logDirectoryWarmupSkipped(options: {
  dirPath: string
  pauseMs: number
  reason: string
  workspaceId: string
}) {
  vscodeApi.log('debug', 'directory warmup skipped', options)
}
