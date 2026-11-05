import { ConfigKey } from '~/core/config/common'

export function shouldRefreshImageTreeForConfigKeys(keys: readonly string[] | undefined) {
  return !!keys?.includes(ConfigKey.file_scan)
}
