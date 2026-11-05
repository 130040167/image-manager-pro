import type { Buffer } from 'node:buffer'
import type { SharpNS } from '~/@types/global'
import { Global } from '~/core/global'

const SIZE = 8

export async function ahash(image: string | Buffer, options?: SharpNS.SharpOptions) {
  const data = await Global.sharp(image, options)
    .greyscale()
    .resize(SIZE, SIZE, { fit: 'fill' })
    .rotate()
    .raw()
    .toBuffer()

  let total = 0
  for (const value of data)
    total += value
  const average = total / data.length

  let fingerprint = ''
  for (const value of data)
    fingerprint += value >= average ? '1' : '0'
  return fingerprint
}
