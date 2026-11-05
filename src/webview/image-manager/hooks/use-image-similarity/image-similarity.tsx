import type { ReactNode } from 'react'
import type { Props as ImageOperatorProps } from '../../components/image-operator'
import type { SimilarityAlgorithm } from '~/core/analysis/similarity-common'
import type { ImperativeModalProps } from '~/webview/image-manager/hooks/use-imperative-antd-modal'
import { Alert, Button, Card, Divider, InputNumber, Popover, Progress, Select, Space, Spin, Typography } from 'antd'
import { remove } from 'es-toolkit'
import { produce } from 'immer'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { VscQuestion } from 'react-icons/vsc'
import { getSimilarityAlgorithmOptions, getSimilarityAlgorithmProfile } from '~/core/analysis/similarity-common'
import { useControlledState } from '~/webview/image-manager/hooks/use-controlled-state'
import useScrollRef from '~/webview/image-manager/hooks/use-scroll-ref'
import EmptyImage from '../../components/empty'
import ImageGroup from '../../components/image-group'
import useImageManagerEvent, { IMEvent } from '../use-image-manager-event'
import { getSimilarityAutoPlaceholder, getSimilarityResultContextMenuEnable } from './similarity-ui'

type SimilarityScope = 'same-level' | 'all'
type SimilaritySliceStrategy = 'first' | 'all'

type SimilarityDialogOptions = {
  algorithm: SimilarityAlgorithm
  maxResults: number
  scope?: SimilarityScope
  sliceStrategy?: SimilaritySliceStrategy
  threshold?: number
}

type SimilarImage = {
  algorithm?: SimilarityAlgorithm
  image: ImageType
  distance: number
}

type Props = Omit<ImageOperatorProps, 'images'> & {
  /**
   * 被比较的图片
   */
  image: ImageType
  /**
   * 相似图片
   */
  loading?: boolean
  onCancel?: () => void
  progress?: { completed: number, total: number }
  options?: SimilarityDialogOptions
  status?: {
    kind: 'cancelled' | 'empty' | 'error' | 'loading' | 'no-candidates'
    message?: ReactNode
  }
  onSearch?: (options: SimilarityDialogOptions) => void
  searchPoolImages?: ImageType[]
  similarImages: SimilarImage[]
  stats?: {
    totalMatches?: number
    scanned: number
    skipped: number
  }
}

function ImageSimilarity(props: Props & ImperativeModalProps) {
  const { image, loading, onCancel, onSearch, options, progress, searchPoolImages, similarImages: similarImagesProp, stats, status } = props
  const { t } = useTranslation()
  const [draftOptions, setDraftOptions] = useState({
    algorithm: options?.algorithm || 'hybrid',
    maxResults: options?.maxResults ?? 50,
    scope: options?.scope || 'all',
    threshold: options?.threshold,
  })

  const [similarImages, setSimilarImages] = useControlledState({
    value: similarImagesProp,
  })

  useEffect(() => () => onCancel?.(), [onCancel])

  useEffect(() => {
    setDraftOptions({
      algorithm: options?.algorithm || 'hybrid',
      maxResults: options?.maxResults ?? 50,
      scope: options?.scope || 'all',
      threshold: options?.threshold,
    })
  }, [options?.algorithm, options?.maxResults, options?.scope, options?.threshold])

  useImageManagerEvent({
    on: {
      [IMEvent.rename]: (previosImage, newImage) => {
        // 图片重命名后，更新相似图片中的图片信息
        setSimilarImages(
          produce((draft) => {
            const index = draft.findIndex(t => t.image.path === previosImage.path)
            if (index !== -1) {
              draft[index].image = newImage
            }
          }),
        )
      },
      [IMEvent.delete]: (images) => {
        setSimilarImages(
          produce((draft) => {
            const removedIndex: number[] = []
            images.forEach((image) => {
              const index = draft.findIndex(t => t.image.path === image.path)
              if (index !== -1) {
                removedIndex.push(index)
              }
            })
            remove(draft, (_, index) => removedIndex.includes(index))
          }),
        )
      },
    },
  })

  const { images } = useMemo(() => {
    const images = [...similarImages]
      .sort((a, b) => a.distance - b.distance || a.image.path.localeCompare(b.image.path))
      .map(({ image }) => ({
        ...image,
      }))

    return {
      images,
    }
  }, [similarImages])

  const algorithmOptions = useMemo(() => getSimilarityAlgorithmOptions(), [])
  const algorithmProfile = useMemo(() => getSimilarityAlgorithmProfile(draftOptions.algorithm), [draftOptions.algorithm])
  const thresholdPlaceholder = getSimilarityAutoPlaceholder(draftOptions.algorithm)
  const thresholdRecommended = `${algorithmProfile.threshold.recommended[0]}-${algorithmProfile.threshold.recommended[1]}`
  const resultCount = stats?.totalMatches ?? similarImages.length

  const { scrollRef } = useScrollRef()

  return (
    <>
      <Card>
        <div className='flex justify-center'>
          <ImageGroup
            images={[image]}
            lazyImageProps={{
              imageNameProps: {
                tooltipDisplayFullPath: true,
              },
              lazy: false,
            }}
          >
          </ImageGroup>
        </div>
      </Card>
      <Divider plain dashed className='!my-4' />
      <Card
        title={t('im.similar_images')}
        extra={(
          <Space size='small'>
            <Popover
              placement='bottomRight'
              title={`${algorithmProfile.label} ${t('im.similarity_help')}`}
              content={(
                <div className='max-w-[360px] text-xs leading-5'>
                  <Typography.Paragraph className='!mb-2'>
                    {t(`im.similarity_algorithm_${draftOptions.algorithm}_desc`)}
                  </Typography.Paragraph>
                  <div>
                    <Typography.Text strong>{t('im.similarity_threshold')}</Typography.Text>
                    :
                    {' '}
                    {t('im.similarity_threshold_help', {
                      defaultThreshold: algorithmProfile.threshold.defaultValue,
                      max: algorithmProfile.threshold.max,
                      min: algorithmProfile.threshold.min,
                      recommended: thresholdRecommended,
                      unit: t(`im.similarity_unit_${draftOptions.algorithm}`),
                    })}
                  </div>
                  <div className='mt-1'>{t('im.similarity_threshold_direction')}</div>
                  <div className='mt-1'>{t(`im.similarity_algorithm_${draftOptions.algorithm}_use_case`)}</div>
                </div>
              )}
              trigger={['click']}
            >
              <Button
                aria-label={t('im.similarity_help')}
                icon={<VscQuestion />}
                size='small'
                type='text'
              />
            </Popover>
            <Button
              size='small'
              type='primary'
              onClick={() => onSearch?.(draftOptions)}
            >
              {t('im.search')}
            </Button>
            {loading && <Button size='small' onClick={onCancel}>{t('im.cancel')}</Button>}
          </Space>
        )}
      >
        <div data-similarity-panel className='mb-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(140px,1fr)_minmax(170px,1.2fr)_minmax(110px,.8fr)_minmax(130px,.9fr)]'>
          <label className='min-w-0 text-xs text-ant-color-text-secondary'>
            <span className='mb-1 block font-medium text-ant-color-text'>{t('im.similarity_algorithm')}</span>
            <Select
              aria-label={t('im.similarity_algorithm')}
              size='small'
              value={draftOptions.algorithm}
              onChange={(algorithm: SimilarityAlgorithm) => setDraftOptions(prev => ({
                ...prev,
                algorithm,
                threshold: undefined,
              }))}
              options={algorithmOptions}
              style={{ width: '100%' }}
            />
            <span className='mt-1 block'>{t(`im.similarity_algorithm_${draftOptions.algorithm}_short`)}</span>
          </label>
          <label className='min-w-0 text-xs text-ant-color-text-secondary'>
            <span className='mb-1 block font-medium text-ant-color-text'>
              {t('im.similarity_threshold')}
              {' '}
              (
              {t(`im.similarity_unit_${draftOptions.algorithm}`)}
              )
            </span>
            <InputNumber
              aria-label={t('im.similarity_threshold')}
              size='small'
              value={draftOptions.threshold}
              min={algorithmProfile.threshold.min}
              max={algorithmProfile.threshold.max}
              step={algorithmProfile.threshold.step}
              controls={false}
              placeholder={t('im.similarity_threshold_auto', { value: thresholdPlaceholder })}
              style={{ width: '100%' }}
              onChange={value => setDraftOptions(prev => ({ ...prev, threshold: value == null ? undefined : Number(value) }))}
            />
            <span className='mt-1 block'>
              {t('im.similarity_threshold_range', {
                max: algorithmProfile.threshold.max,
                min: algorithmProfile.threshold.min,
                recommended: thresholdRecommended,
              })}
            </span>
          </label>
          <label className='min-w-0 text-xs text-ant-color-text-secondary'>
            <span className='mb-1 block font-medium text-ant-color-text'>{t('im.similarity_max_results')}</span>
            <InputNumber
              aria-label={t('im.similarity_max_results')}
              size='small'
              value={draftOptions.maxResults}
              min={1}
              max={500}
              controls={false}
              style={{ width: '100%' }}
              onChange={value => setDraftOptions(prev => ({ ...prev, maxResults: Number(value ?? prev.maxResults) }))}
            />
            <span className='mt-1 block'>{t('im.similarity_max_results_hint')}</span>
          </label>
          <label className='min-w-0 text-xs text-ant-color-text-secondary'>
            <span className='mb-1 block font-medium text-ant-color-text'>{t('im.similarity_scope')}</span>
            <Select
              aria-label={t('im.similarity_scope')}
              size='small'
              value={draftOptions.scope}
              onChange={scope => setDraftOptions(prev => ({ ...prev, scope }))}
              options={[
                { label: t('im.current_directory'), value: 'same-level' },
                { label: t('im.all_directories'), value: 'all' },
              ]}
              style={{ width: '100%' }}
            />
            <span className='mt-1 block'>{t('im.similarity_scope_hint')}</span>
          </label>
        </div>
        <div className='mb-3 flex items-center justify-between text-xs text-ant-color-text-secondary'>
          <Typography.Text type='secondary'>
            {t('im.similarity_results_total')}
            :
            {' '}
            {resultCount}
            {' / '}
            {t('im.scanned')}
            :
            {' '}
            {stats?.scanned || 0}
            {' / '}
            {t('im.skipped')}
            :
            {' '}
            {stats?.skipped || 0}
          </Typography.Text>
        </div>
        {!loading && status?.kind === 'error' && (
          <Alert
            className='mb-3'
            type='error'
            showIcon
            message={t('im.find_similar_images')}
            description={status.message}
          />
        )}
        {!loading && (status?.kind === 'empty' || status?.kind === 'no-candidates' || status?.kind === 'cancelled') && (
          <Alert
            className='mb-3'
            type='info'
            showIcon
            message={status.kind === 'cancelled' ? t('im.cancelled') : status.kind === 'no-candidates' ? t('im.no_similarity_candidates_title') : t('im.no_similar_images_title')}
            description={status.message}
          />
        )}
        {loading
          ? (
              <div className='flex min-h-32 flex-col items-center justify-center gap-3' data-similarity-progress>
                <Spin />
                <Progress className='max-w-80' percent={progress?.total ? Math.floor(progress.completed / progress.total * 100) : 0} />
                <span>
                  {progress?.completed ?? 0}
                  {' '}
                  /
                  {' '}
                  {progress?.total ?? 0}
                </span>
              </div>
            )
          : images.length
            ? (
                <div className='max-h-[500px] overflow-auto' ref={scrollRef}>
                  <ImageGroup
                    images={images}
                    workspaceImages={searchPoolImages}
                    enableContextMenu={getSimilarityResultContextMenuEnable()}
                    lazyImageProps={{
                      imageNameProps: {
                        tooltipDisplayFullPath: true,
                      },
                      lazy: {
                        root: scrollRef.current!,
                      },
                    }}
                  >
                  </ImageGroup>
                </div>
              )
            : (
                <EmptyImage />
              )}
      </Card>
    </>
  )
}

export default memo(ImageSimilarity)
