import type { HandlerParams, ItemParams, PredicateParams } from 'react-contexify'
import type { ImageContextMenuType } from './hooks/use-image-context-menu'
import { useLockFn, useMemoizedFn } from 'ahooks'
import { App } from 'antd'
import { defaults } from 'es-toolkit/compat'
import { useAtomValue } from 'jotai'
import { memo } from 'react'
import {

  Item,

  RightSlot,
  Separator,
  Submenu,
} from 'react-contexify'
import { useTranslation } from 'react-i18next'
import logger from '~/utils/logger'
import useImageDetails from '~/webview/image-manager/hooks/use-image-details/use-image-details'
import useImageOperation from '~/webview/image-manager/hooks/use-image-operation'
import { getSimilaritySearchLaunch } from '~/webview/image-manager/hooks/use-image-similarity/similarity-ui'
import { Keybinding } from '~/webview/image-manager/keybinding'
import { GlobalAtoms } from '~/webview/image-manager/stores/global/global-store'
import { OS } from '~/webview/image-manager/utils/device'
import { vscodeApi } from '~/webview/vscode-api'
import MaskMenu from '../../../mask-menu'
import Arrow from '../arrow'

export const IMAGE_CONTEXT_MENU_ID = 'IMAGE_CONTEXT_MENU_ID'

enum IMAGE_CONTEXT_MENU {
  open_in_os_explorer = 'open_in_os_explorer',
  open_in_vscode_explorer = 'open_in_vscode_explorer',
  reveal_in_viewer = 'reveal_in_viewer',
  copy = 'copy',
  cut = 'cut',
  compress = 'compress',
  format_conversion = 'format_conversion',
  crop = 'crop',
  edit = 'edit',
  find_similar_in_same_level = 'find_similar_in_same_level',
  find_similar_in_all = 'find_similar_in_all',
  pretty_svg = 'pretty_svg',
  rename = 'rename',
  delete = 'delete',
  preview = 'preview',
  transform = 'transform',
  view_detail = 'view_detail',
  more_tools = 'more_tools',
}

const defaultImageContextMenu = {
  /**
   * 在系统资源管理器中打开
   * @default true
   */
  [IMAGE_CONTEXT_MENU.open_in_os_explorer]: true,
  /**
   * 在vscode资源管理器中打开
   * @default true
   */
  [IMAGE_CONTEXT_MENU.open_in_vscode_explorer]: true,
  /**
   * 在Viewer中显示
   * @default true
   */
  [IMAGE_CONTEXT_MENU.reveal_in_viewer]: true,
  /**
   * 复制
   * @default false
   */
  [IMAGE_CONTEXT_MENU.copy]: false,
  /**
   * 剪切
   * @default false
   */
  [IMAGE_CONTEXT_MENU.cut]: false,
  /**
   * 压缩
   * @default false
   */
  [IMAGE_CONTEXT_MENU.compress]: false,
  /**
   * 转化格式
   * @default false
   */
  [IMAGE_CONTEXT_MENU.format_conversion]: false,
  /**
   * 裁剪
   * @default false
   */
  [IMAGE_CONTEXT_MENU.crop]: false,
  [IMAGE_CONTEXT_MENU.edit]: false,
  /**
   * 查找相似(同目录)
   * @default false
   */
  [IMAGE_CONTEXT_MENU.find_similar_in_same_level]: false,
  /**
   * 查找相似(所有)
   * @default false
   */
  [IMAGE_CONTEXT_MENU.find_similar_in_all]: false,
  /**
   * 格式化svg
   * @default false
   */
  [IMAGE_CONTEXT_MENU.pretty_svg]: false,
  /**
   * 重命名
   * @default false
   */
  [IMAGE_CONTEXT_MENU.rename]: false,
  /**
   * 删除
   * @default false
   */
  [IMAGE_CONTEXT_MENU.delete]: false,

  /**
   * 预览
   * @default true
   */
  [IMAGE_CONTEXT_MENU.preview]: false,
  [IMAGE_CONTEXT_MENU.transform]: false,
  /**
   * 查看详情
   * @default true
   */
  [IMAGE_CONTEXT_MENU.view_detail]: true,
  [IMAGE_CONTEXT_MENU.more_tools]: true,
}

export type EnableImageContextMenuType = Partial<typeof defaultImageContextMenu>

type ItemParamsContextMenu = ItemParams<Required<ImageContextMenuType>>

const sharpRelated = [
  IMAGE_CONTEXT_MENU.compress,
  IMAGE_CONTEXT_MENU.format_conversion,
  IMAGE_CONTEXT_MENU.find_similar_in_same_level,
  IMAGE_CONTEXT_MENU.find_similar_in_all,
]

const moreToolRelated = [
  IMAGE_CONTEXT_MENU.compress,
  IMAGE_CONTEXT_MENU.format_conversion,
  IMAGE_CONTEXT_MENU.find_similar_in_same_level,
  IMAGE_CONTEXT_MENU.find_similar_in_all,
  IMAGE_CONTEXT_MENU.transform,
]

function ImageContextMenu() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const sharpInstalled = useAtomValue(GlobalAtoms.sharpInstalledAtom)

  const {
    openInOsExplorer,
    openInVscodeExplorer,
    handleCopyString,
    copyImageAsBase64,
    beginCompressProcess,
    editImage,
    beginFormatConversionProcess,
    prettySvg,
    beginFindSimilarProcess,
    beginDeleteImageProcess,
    beginRenameImageProcess,
    beginRevealInViewer,
    beginCopyProcess,
    beginCutProcess,
  } = useImageOperation()

  // 在os中打开图片
  const handleOpenInOsExplorer = useMemoizedFn((e: ItemParamsContextMenu) => {
    openInOsExplorer(e.props!.image.path)
  })

  // 在vscode中打开图片
  const handleOpenInVscodeExplorer = useMemoizedFn((e: ItemParamsContextMenu) => {
    openInVscodeExplorer(e.props!.image.path)
  })

  const isItemHidden = useMemoizedFn((e: PredicateParams<ImageContextMenuType>) => {
    const { data, props } = e

    const enabled = defaults(props?.enableContextMenu || {}, defaultImageContextMenu)

    if (sharpInstalled === false) {
      sharpRelated.forEach((item) => {
        enabled[item] = false
      })
    }

    if (Array.isArray(data)) {
      return data.every(d => enabled?.[d] === false)
    }
    return enabled?.[data] === false
  })

  // 压缩图片
  const handleCompressImage = useMemoizedFn((e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'compress',
      count: e.props?.images?.length || 0,
      path: e.props?.image?.path,
    })
    beginCompressProcess(e.props!.images)
  })

  const handleCopyBase64 = useMemoizedFn((e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'copy-base64',
      path: e.props?.image?.path,
    })
    handleCopyString(e.props!.image, { proto: 'path', callback: copyImageAsBase64 })
  })

  // 打开图像编辑器
  const handleEditImage = useLockFn(async (e: ItemParamsContextMenu, defaultTool: 'crop' | 'select' = 'select') => {
    vscodeApi.log('debug', 'image context menu action', {
      action: defaultTool === 'crop' ? 'crop' : 'edit',
      path: e.props?.image?.path,
    })
    if (!e.props?.image) {
      return message.error(t('im.no_image'))
    }
    e.props.z_commands?.edit?.beforeOpen?.()
    editImage(e.props.image, defaultTool)
  })

  // 转化格式
  const handleConvertFormat = useLockFn(async (e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'convert',
      count: e.props?.images?.length || 0,
      path: e.props?.image?.path,
    })
    beginFormatConversionProcess(e.props!.images)
  })

  // 格式化svg
  const handlePrettySvg = useLockFn(async (e: ItemParamsContextMenu) => {
    try {
      const image = e.props!.image
      await prettySvg(image!.path)
      message.success(t('im.pretty_success'))
    }
    catch (e) {
      logger.error(e)
    }
  })

  const handleFindSimilarInSameLevel = useLockFn(async (e: ItemParamsContextMenu) => {
    const { image, sameLevelImages, sameWorkspaceImages } = e.props || {}
    const launch = getSimilaritySearchLaunch('same-level', {
      sameLevelImages,
      sameWorkspaceImages,
    })
    vscodeApi.log('debug', 'image context menu action', {
      action: 'find-similar',
      count: launch.scopeImages.length,
      mode: 'same-level',
      path: image?.path,
    })
    await beginFindSimilarProcess(image!, launch.scopeImages, launch.options)
  })

  const handleFindSimilarInAll = useLockFn(async (e: ItemParamsContextMenu) => {
    const { image, sameLevelImages, sameWorkspaceImages } = e.props || {}
    const launch = getSimilaritySearchLaunch('all', {
      sameLevelImages,
      sameWorkspaceImages,
    })
    vscodeApi.log('debug', 'image context menu action', {
      action: 'find-similar',
      count: launch.scopeImages.length,
      mode: 'all',
      path: image?.path,
    })
    await beginFindSimilarProcess(image!, launch.scopeImages, launch.options)
  })

  const handleDelete = useMemoizedFn(async (e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'delete',
      count: e.props?.images?.length || 0,
      path: e.props?.image?.path,
    })
    beginDeleteImageProcess(e.props!.images)
  })

  const handleRename = useMemoizedFn((e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'rename',
      count: e.props?.images?.length || 0,
      path: e.props?.image?.path,
    })
    beginRenameImageProcess(e.props!.image, e.props!.images)
  })

  const handleRevealInViewer = useLockFn(async (e: ItemParamsContextMenu) => {
    beginRevealInViewer(e.props!.image.path)
  })

  const hasPreviewTransform = useMemoizedFn((e: PredicateParams<ImageContextMenuType>) => {
    return !e.props?.z_commands?.transform
  })

  const isTransformHidden = useMemoizedFn((e: PredicateParams<ImageContextMenuType>) => {
    return hasPreviewTransform(e) || isItemHidden({ ...e, data: IMAGE_CONTEXT_MENU.transform })
  })

  const handleFlipX = useMemoizedFn((e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'flip-x',
      path: e.props?.image?.path,
    })
    e.props?.z_commands?.transform?.onFlipX?.()
  })

  const handleFlipY = useMemoizedFn((e: ItemParamsContextMenu) => {
    vscodeApi.log('debug', 'image context menu action', {
      action: 'flip-y',
      path: e.props?.image?.path,
    })
    e.props?.z_commands?.transform?.onFlipY?.()
  })

  const isSvg = useMemoizedFn((e: HandlerParams<Required<ImageContextMenuType>>) => {
    return e.props!.images.every(image => image.extname === 'svg') || false
  })

  const { showImageDetails } = useImageDetails()

  return (
    <>
      <MaskMenu id={IMAGE_CONTEXT_MENU_ID}>
        <Item onClick={handleOpenInOsExplorer}>
          {OS.isMac ? t('im.reveal_in_os_mac') : t('im.reveal_in_os_windows')}
        </Item>
        <Item onClick={handleOpenInVscodeExplorer}>{t('im.reveal_in_explorer')}</Item>
        <Item onClick={handleRevealInViewer} hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.reveal_in_viewer}>
          {t('im.reveal_in_viewer')}
        </Item>

        {/* 按照vscode的交互，复制/剪切是单独分组的 */}
        <Separator hidden={isItemHidden} data={[IMAGE_CONTEXT_MENU.copy, IMAGE_CONTEXT_MENU.cut]} />
        <Item hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.copy} onClick={e => beginCopyProcess(e.props!.images)}>
          {(e: ItemParamsContextMenu) => (
            <>
              {t('im.copy')}
              <RightSlot hidden={!e.props!.shortcutsVisible}>{Keybinding.Copy()}</RightSlot>
            </>
          )}
        </Item>
        <Item hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.cut} onClick={e => beginCutProcess(e.props!.images)}>
          {(e: ItemParamsContextMenu) => (
            <>
              {t('im.cut')}
              <RightSlot hidden={!e.props!.shortcutsVisible}>{Keybinding.Cut()}</RightSlot>
            </>
          )}
        </Item>

        <Separator />
        <Item onClick={e => handleCopyString(e.props!.image, { proto: 'basename' })}>{t('im.copy_image_name')}</Item>
        <Item onClick={e => handleCopyString(e.props!.image, { proto: 'path' })}>
          {t('im.copy_image_path')}
        </Item>
        <Item onClick={e => handleCopyString(e.props!.image, { proto: 'relativePath' })}>
          {t('im.copy_image_relative_path')}
        </Item>

        <Separator hidden={e => isItemHidden({ ...e, data: [...moreToolRelated, IMAGE_CONTEXT_MENU.copy] })} />
        <Item onClick={e => handleEditImage(e, 'select')} hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.edit}>
          {t('im.edit_image')}
        </Item>
        <Submenu
          label={t('im.more_tools')}
          arrow={<Arrow />}
          hidden={e => isItemHidden({ ...e, data: [...moreToolRelated, IMAGE_CONTEXT_MENU.copy] })}
        >
          <Item onClick={handleCopyBase64}>
            {t('im.copy_image_base64')}
          </Item>
          <Item hidden={isItemHidden} onClick={handleCompressImage} data={IMAGE_CONTEXT_MENU.compress}>
            {t('im.compress')}
          </Item>
          <Item onClick={handleConvertFormat} hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.format_conversion}>
            {t('im.convert_format')}
          </Item>
          <Item onClick={handleFindSimilarInSameLevel} hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.find_similar_in_same_level}>
            {`${t('im.find_similar_images')} - ${t('im.current_directory')}`}
          </Item>
          <Item
            onClick={handleFindSimilarInAll}
            hidden={e => isItemHidden({ ...e, data: IMAGE_CONTEXT_MENU.find_similar_in_all }) || isSvg(e)}
            data={IMAGE_CONTEXT_MENU.find_similar_in_all}
          >
            {`${t('im.find_similar_images')} - ${t('im.all_directories')}`}
          </Item>
          <Item hidden={isTransformHidden} onClick={handleFlipX}>
            {t('im.scale_x')}
          </Item>
          <Item hidden={isTransformHidden} onClick={handleFlipY}>
            {t('im.scale_y')}
          </Item>
        </Submenu>

        <Item
          onClick={handlePrettySvg}
          hidden={e => isItemHidden({ ...e, data: [IMAGE_CONTEXT_MENU.pretty_svg] }) || !isSvg(e)}
        >
          {t('im.pretty')}
          {' '}
          svg
        </Item>

        {/* file operation menu */}
        <Separator hidden={isItemHidden} data={[IMAGE_CONTEXT_MENU.rename, IMAGE_CONTEXT_MENU.delete]} />
        <Item onClick={handleRename} hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.rename}>
          {(e: ItemParamsContextMenu) => (
            <>
              {t('im.rename')}
              {' '}
              <RightSlot hidden={!e.props!.shortcutsVisible}>{Keybinding.Rename()}</RightSlot>
            </>
          )}
        </Item>
        <Item onClick={handleDelete} hidden={isItemHidden} data={IMAGE_CONTEXT_MENU.delete}>
          {(e: ItemParamsContextMenu) => (
            <>
              {t('im.delete')}
              {' '}
              <RightSlot hidden={!e.props!.shortcutsVisible}>{Keybinding.Delete()}</RightSlot>
            </>
          )}
        </Item>

        <Separator />
        <Item
          onClick={(e: ItemParamsContextMenu) => {
            vscodeApi.log('debug', 'image context menu action', {
              action: 'detail',
              path: e.props?.image?.path,
            })
            showImageDetails({
              image: e.props!.image,
              onPreview: e.props?.z_commands?.preview?.onClick,
            })
          }}
        >
          {t('im.detail')}
        </Item>
      </MaskMenu>
    </>
  )
}

export default memo(ImageContextMenu)
