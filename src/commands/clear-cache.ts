import type { ExtensionModule } from '~/module'
import { commands, window } from 'vscode'
import { Similarity } from '~/core/analysis/similarity'
import { Global } from '~/core/global'
import { i18n } from '~/i18n'
import { Channel } from '~/utils/node/channel'
import { Commands } from './commands'

export default <ExtensionModule> function () {
  async function clearCache() {
    try {
      await Global.installer?.clearCaches()
      Similarity.clearCache()
      const RESTART = i18n.t('prompt.reload_now')
      const r = await window.showInformationMessage(i18n.t('prompt.clear_cache_success'), RESTART)
      if (r === RESTART) {
        commands.executeCommand('workbench.action.reloadWindow')
      }
    }
    catch (e) {
      Channel.error(e)
    }
  }

  return [commands.registerCommand(Commands.clear_cache, clearCache)]
}
