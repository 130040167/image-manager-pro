import type { ImperativeModalProps } from '~/webview/image-manager/hooks/use-imperative-antd-modal'
import { useMemoizedFn, useSize } from 'ahooks'
import { Button, Image, Tooltip } from 'antd'
import { memo, useEffect, useMemo, useState } from 'react'
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider'
import { useTranslation } from 'react-i18next'
import { TbPhotoQuestion, TbZoomIn, TbZoomOut, TbZoomReset } from 'react-icons/tb'
import { VscChromeClose } from 'react-icons/vsc'
import useWheelScaleEvent from '~/webview/image-manager/hooks/use-wheel-scale-event'
import { classNames } from '~/webview/image-manager/utils/tw-clsx'
import { getAppRoot } from '~/webview/utils'
import { clampCompareWidth, createCompareZoomState, formatCompareZoomPercent } from './compare-image-state'
import styles from './index.module.css'

type Props = {
  oldImage: string
  newImage: string
  imageWidth: number
}

function CompareImage(props: ImperativeModalProps & Props) {
  const { oldImage, newImage, imageWidth, closeModal } = props

  const { t } = useTranslation()

  const { width: windowWidth = 0 } = useSize(getAppRoot()) || {}
  const zoomState = useMemo(
    () => createCompareZoomState({
      imageWidth,
      viewportWidth: windowWidth,
    }),
    [imageWidth, windowWidth],
  )
  const [visible, setVisible] = useState(true)
  const [width, setWidth] = useState(() => zoomState.width)

  useEffect(() => {
    setWidth(prev => clampCompareWidth(prev || zoomState.width, zoomState.minWidth, zoomState.maxWidth))
  }, [zoomState.maxWidth, zoomState.minWidth, zoomState.width])

  const [ref] = useWheelScaleEvent({
    setImageWidth: setWidth,
    min: zoomState.minWidth,
    max: zoomState.maxWidth,
    keyborad: false,
    scaleStep: 0.45,
  })

  const zoomPercent = formatCompareZoomPercent(width, zoomState.baseWidth)
  const zoomStep = Math.max(80, Math.round(zoomState.baseWidth * 0.12))

  const handleClose = useMemoizedFn(() => {
    setVisible(false)
    closeModal()
  })

  const imageRender = useMemoizedFn(() => {
    return (
      <div className={styles.viewerShell}>
        <div className={styles.controls}>
          <div className={styles.controlsGroup}>
            <Tooltip title={t('im.zoom_out')}>
              <Button
                type='text'
                className={styles.iconButton}
                icon={<TbZoomOut className='text-xl' />}
                onClick={() => setWidth(prev => clampCompareWidth(prev - zoomStep, zoomState.minWidth, zoomState.maxWidth))}
              />
            </Tooltip>
            <div className={styles.zoomBadge}>{zoomPercent}</div>
            <Tooltip title={t('im.zoom_in')}>
              <Button
                type='text'
                className={styles.iconButton}
                icon={<TbZoomIn className='text-xl' />}
                onClick={() => setWidth(prev => clampCompareWidth(prev + zoomStep, zoomState.minWidth, zoomState.maxWidth))}
              />
            </Tooltip>
            <Tooltip title={t('im.zoom_reset')}>
              <Button
                type='text'
                className={styles.iconButton}
                icon={<TbZoomReset className='text-xl' />}
                onClick={() => setWidth(zoomState.baseWidth)}
              />
            </Tooltip>
          </div>
          <div className={styles.controlsGroup}>
            <Tooltip title={t('im.diff_tip')}>
              <Button type='text' className={styles.iconButton} icon={<TbPhotoQuestion className='text-xl' />} />
            </Tooltip>
            <Button
              type='text'
              className={styles.iconButton}
              icon={<VscChromeClose className='text-lg' />}
              onClick={handleClose}
            />
          </div>
        </div>
        <div className={styles.compareViewport} ref={ref}>
          <ReactCompareSlider
            itemOne={<ReactCompareSliderImage src={oldImage} />}
            itemTwo={<ReactCompareSliderImage src={newImage} />}
            className={classNames(
              styles.slider,
              'cursor-grab transition-[width] duration-ant-motion-duration-slow ease-ant-motion-ease-out',
            )}
            onlyHandleDraggable={true}
            style={{
              width,
            }}
          />
        </div>
      </div>
    )
  })

  return (
    <Image
      preview={{
        visible,
        onVisibleChange: (value) => {
          setVisible(value)
          if (!value) {
            closeModal()
          }
        },
        keyboard: true,
        maskClosable: false,
        mask: false,
        width: '100%',
        movable: false,
        imageRender,
        toolbarRender: () => null,
      }}
      hidden={true}
    />
  )
}

export default memo(CompareImage)
