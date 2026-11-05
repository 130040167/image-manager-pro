export type ImageDetailDimensionInfo = {
  imageSizeText?: string
  shapeText?: string
}

export function resolveImageDetailDimensionInfo(metadata: Metadata | undefined): ImageDetailDimensionInfo {
  const width = metadata?.width
  const height = metadata?.height
  const channels = metadata?.channels
  const shape = metadata?.shape

  return {
    imageSizeText: width && height
      ? `${width} x ${height}${channels ? ` x ${channels}` : ''}`
      : undefined,
    shapeText: shape?.length
      ? shape.join(' x ')
      : undefined,
  }
}
