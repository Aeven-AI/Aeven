/**
 * The cursor sprite painted on a canvas, for a page whose Content-Security-Policy
 * refuses `data:` images: the PNG is decoded here and its pixels written with
 * `putImageData`, which no page policy governs.
 * @module
 */

/** Bytes per RGBA pixel. */
const PIXEL_BYTES = 4

/**
 * Decode an 8-bit, non-interlaced RGBA PNG.
 * @param bytes - the PNG file.
 * @returns its width, height, and pixels.
 * @throws {Error} when the PNG uses another format.
 */
async function decode(bytes: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) throw new Error('the sprite is not an 8-bit RGBA PNG')
  const parts: Uint8Array[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'IDAT') parts.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  const stream = new Blob(parts as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'))
  const raw = new Uint8Array(await new Response(stream).arrayBuffer())
  const stride = width * PIXEL_BYTES
  const pixels = new Uint8ClampedArray(new ArrayBuffer(stride * height))
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)] ?? 0
    const source = row * (stride + 1) + 1
    const target = row * stride
    for (let index = 0; index < stride; index++) {
      const value = raw[source + index] ?? 0
      const left = index >= PIXEL_BYTES ? pixels[target + index - PIXEL_BYTES] ?? 0 : 0
      const up = row > 0 ? pixels[target + index - stride] ?? 0 : 0
      const upLeft = row > 0 && index >= PIXEL_BYTES ? pixels[target + index - stride - PIXEL_BYTES] ?? 0 : 0
      let predicted = 0
      switch (filter) {
        case 1: predicted = left; break
        case 2: predicted = up; break
        case 3: predicted = (left + up) >> 1; break
        case 4: {
          const estimate = left + up - upLeft
          const toLeft = Math.abs(estimate - left)
          const toUp = Math.abs(estimate - up)
          const toUpLeft = Math.abs(estimate - upLeft)
          predicted = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
          break
        }
      }
      pixels[target + index] = (value + predicted) & 0xff
    }
  }
  return { width, height, pixels }
}

/**
 * Paint a PNG data URI onto a canvas the same size it is drawn at.
 * @param dataUrl - `data:image/png;base64,...`.
 * @returns the canvas, its backing store at the PNG's own resolution.
 */
export async function spriteCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  const { width, height, pixels } = await decode(bytes)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')?.putImageData(new ImageData(pixels, width, height), 0, 0)
  return canvas
}
