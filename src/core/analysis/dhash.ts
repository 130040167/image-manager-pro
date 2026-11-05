import type { Buffer } from 'node:buffer'
import type { SharpNS } from '~/@types/global'
import { Global } from '~/core/global'

const WIDTH = 9
const HEIGHT = 8

export async function dhash(image: string | Buffer, options?: SharpNS.SharpOptions) {
  const data = await Global.sharp(image, options)
    .greyscale()
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .rotate()
    .raw()
    .toBuffer()

  let fingerprint = ''
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH - 1; x++) {
      const left = data[y * WIDTH + x]
      const right = data[y * WIDTH + x + 1]
      fingerprint += left > right ? '1' : '0'
    }
  }
  return fingerprint
}
