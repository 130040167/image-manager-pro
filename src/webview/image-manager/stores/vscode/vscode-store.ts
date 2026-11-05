import type { ConfigType, VscodeConfigType } from '~/core/config/common'
import type { WorkspaceStateType } from '~/core/persist/workspace/common'
import { atom } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { DEFAULT_WORKSPACE_STATE } from '~/core/persist/workspace/common'
import { FALLBACK_LANGUAGE, ReduceMotion, Theme } from '~/meta'

const DEFAULT_VSCODE_CONFIG: VscodeConfigType = {
  language: FALLBACK_LANGUAGE,
  reduceMotion: ReduceMotion.auto,
  theme: Theme.dark,
}

export const VscodeAtoms = {
  extConfigAtom: atom<ConfigType>(DEFAULT_CONFIG),
  vscodeConfigAtom: atom<VscodeConfigType>(DEFAULT_VSCODE_CONFIG),
  workspaceStateAtom: atom<WorkspaceStateType>(DEFAULT_WORKSPACE_STATE),
}

export function VscodeAtomsHydrator({
  extConfig,
  vscodeConfig,
  workspaceState,
  children,
}: {
  extConfig: ConfigType
  vscodeConfig: VscodeConfigType
  workspaceState: WorkspaceStateType
  children: React.ReactNode
}) {
  useHydrateAtoms(
    [
      [VscodeAtoms.extConfigAtom, extConfig],
      [VscodeAtoms.vscodeConfigAtom, vscodeConfig],
      [VscodeAtoms.workspaceStateAtom, workspaceState],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}
