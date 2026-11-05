import type { CustomFormatConfig } from '~/core/custom-format/types'
import { describe, expect, it } from 'vitest'
import {
  addExtensionToDraft,
  createFileFormatsDraft,
  removeExtensionFromDraft,
  updateExtensionPresetDraft,
} from '~/webview/image-manager/hooks/use-settings/settings/components/file-formats/model'

const baseConfig: CustomFormatConfig = {
  extensionPresets: {},
  folderPresets: {},
}

describe('file format settings draft model', () => {
  it('keeps preset edits in a local draft until the caller explicitly applies them', () => {
    const saved: CustomFormatConfig = {
      extensionPresets: {
        raw: {
          extensions: ['raw'],
          kind: 'raw',
          name: 'Old Raw',
          options: { height: 10, layout: 'HW', width: 10 },
        },
      },
      folderPresets: {},
    }
    const draft = createFileFormatsDraft(['png', 'raw'], saved)
    const next = updateExtensionPresetDraft(draft, 'raw', {
      ...draft.customFormats.extensionPresets.raw,
      name: 'New Raw',
      options: { height: 20, layout: 'HW', width: 20 },
    })

    expect(saved.extensionPresets.raw.name).toBe('Old Raw')
    expect(next.customFormats.extensionPresets.raw.name).toBe('New Raw')
  })

  it('adds custom extension presets with a user-facing name and target suffixes', () => {
    const draft = createFileFormatsDraft(['png'], baseConfig)
    const next = addExtensionToDraft(draft, {
      extensions: '.raw, dat',
      kind: 'raw',
      name: 'Microscope Raw',
    })

    expect(next.scan).toEqual(['png', 'raw', 'dat'])
    expect(next.customFormats.extensionPresets.raw).toMatchObject({
      extensions: ['raw', 'dat'],
      kind: 'raw',
      name: 'Microscope Raw',
    })
    expect(next.customFormats.extensionPresets.dat).toBe(next.customFormats.extensionPresets.raw)
  })

  it('removes a suffix from scan list without deleting shared presets still used by another suffix', () => {
    const draft = addExtensionToDraft(createFileFormatsDraft([], baseConfig), {
      extensions: 'raw, dat',
      kind: 'raw',
      name: 'Shared Raw',
    })
    const next = removeExtensionFromDraft(draft, 'dat')

    expect(next.scan).toEqual(['raw'])
    expect(next.customFormats.extensionPresets.raw?.name).toBe('Shared Raw')
    expect(next.customFormats.extensionPresets.dat).toBeUndefined()
  })
})
