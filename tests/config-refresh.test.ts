import { describe, expect, it, vi } from 'vitest'
import { ConfigKey } from '~/core/config/common'

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
  },
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      update: () => Promise.resolve(),
    }),
  },
}))

describe('configuration refresh classification', () => {
  it('refreshes file scan/custom format changes without reloading the webview', async () => {
    const { Config } = await import('~/core/config/config')

    expect(Config.reloadConfigs).not.toContain(ConfigKey.file_scan)
    expect(Config.reloadConfigs).not.toContain(ConfigKey.file_customFormats)
    expect(Config.refreshConfigs).toContain(ConfigKey.file_scan)
    expect(Config.refreshConfigs).toContain(ConfigKey.file_customFormats)
  })

  it('refreshes the image tree only when the scan extension list changes', async () => {
    const { shouldRefreshImageTreeForConfigKeys } = await import('~/webview/image-manager/utils/config-refresh')

    expect(shouldRefreshImageTreeForConfigKeys([ConfigKey.file_scan])).toBe(true)
    expect(shouldRefreshImageTreeForConfigKeys([ConfigKey.file_customFormats])).toBe(false)
    expect(shouldRefreshImageTreeForConfigKeys([ConfigKey.file_scan, ConfigKey.file_customFormats])).toBe(true)
  })
})
