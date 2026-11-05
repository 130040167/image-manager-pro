import type { CmdToWebview } from './cmd'
import type { SimilarityProgress } from '~/core/analysis/similarity'
import type { ConfigType, VscodeConfigType } from '~/core/config/common'
import type { UpdateType } from '~/webview/image-manager/utils/tree/const'
import type { UpdatePayload } from '~/webview/image-manager/utils/tree/tree-manager'

export type FullUpdate = {
  updateType: UpdateType.full
  payloads: UpdatePayload[]
  id: string
  traceId?: string
  workspaceFolder: string
  absWorkspaceFolder: string
}
export type PatchUpdate = {
  updateType: UpdateType.patch
  payloads: UpdatePayload[]
  id: string
  traceId?: string
  workspaceFolder?: string
  absWorkspaceFolder?: string
}

export type CmdToWebviewMessage = {
  [CmdToWebview.update_images]: FullUpdate | PatchUpdate
  [CmdToWebview.reveal_image_in_viewer]: { imagePath: string }
  [CmdToWebview.program_reload_webview]: undefined
  [CmdToWebview.update_config]: { keys?: Flatten<ConfigType>[] } | undefined
  [CmdToWebview.update_workspaceState]: undefined
  [CmdToWebview.webview_callback]: undefined
  [CmdToWebview.update_vscode_settings]: VscodeConfigType
  [CmdToWebview.similarity_progress]: SimilarityProgress
}
