const tracking = require('./vendor/tracking-runtime')

const DEFAULT_MAX_WIDTH = 160
const DEFAULT_MAX_HEIGHT = 160

function getTrackingRuntime() {
  if (tracking && tracking.ViolaJones) {
    return tracking
  }


  throw new Error('tracking runtime unavailable')
}

function toUint8ClampedArray(data) {
  if (!data) {
    return new Uint8ClampedArray(0)
  }

  if (data instanceof Uint8ClampedArray) {
    return data
  }

  if (data.buffer) {
    return new Uint8ClampedArray(data.buffer, data.byteOffset || 0, data.byteLength)
  }

  return new Uint8ClampedArray(data)
}

function computeScale(width, height, maxWidth = DEFAULT_MAX_WIDTH, maxHeight = DEFAULT_MAX_HEIGHT) {
  const widthScale = width > maxWidth ? maxWidth / width : 1
  const heightScale = height > maxHeight ? maxHeight / height : 1
  return Math.min(widthScale, heightScale, 1)
}

function resizeRgbaNearest(src, srcWidth, srcHeight, destWidth, destHeight) {
  if (srcWidth === destWidth && srcHeight === destHeight) {
    return src
  }

  const dest = new Uint8ClampedArray(destWidth * destHeight * 4)

  for (let y = 0; y < destHeight; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.floor(y * srcHeight / destHeight))

    for (let x = 0; x < destWidth; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x * srcWidth / destWidth))
      const srcIndex = (srcY * srcWidth + srcX) * 4
      const destIndex = (y * destWidth + x) * 4

      dest[destIndex] = src[srcIndex]
      dest[destIndex + 1] = src[srcIndex + 1]
      dest[destIndex + 2] = src[srcIndex + 2]
      dest[destIndex + 3] = src[srcIndex + 3]
    }
  }

  return dest
}

function pickBestRect(rects, width, height) {
  if (!rects || !rects.length) {
    return null
  }

  const frameCenterX = width / 2
  const frameCenterY = height * 0.43

  return rects
    .map((rect) => {
      const area = rect.width * rect.height
      const centerX = rect.x + rect.width / 2
      const centerY = rect.y + rect.height / 2
      const offsetX = Math.abs(centerX - frameCenterX) / width
      const offsetY = Math.abs(centerY - frameCenterY) / height
      const centerPenalty = offsetX + offsetY
      const score = area * (1 - Math.min(centerPenalty, 0.95))

      return {
        ...rect,
        score
      }
    })
    .sort((a, b) => b.score - a.score)[0]
}

function normalizeRect(rect, width, height) {
  return {
    x: rect.x / width,
    y: rect.y / height,
    width: rect.width / width,
    height: rect.height / height
  }
}

function detectFace(frame, options = {}) {
  if (!frame || !frame.width || !frame.height || !frame.data) {
    return {
      found: false,
      box: null,
      raw: null,
      debug: {
        reason: 'invalid-frame'
      }
    }
  }

  const runtime = getTrackingRuntime()
  const sourcePixels = toUint8ClampedArray(frame.data)
  const scale = computeScale(frame.width, frame.height, options.maxWidth, options.maxHeight)
  const sampleWidth = Math.max(20, Math.round(frame.width * scale))
  const sampleHeight = Math.max(20, Math.round(frame.height * scale))
  const pixels = resizeRgbaNearest(sourcePixels, frame.width, frame.height, sampleWidth, sampleHeight)

  const rects = runtime.ViolaJones.detect(
    pixels,
    sampleWidth,
    sampleHeight,
    options.initialScale || 1,
    options.scaleFactor || 1.2,
    options.stepSize || 1.5,
    options.edgesDensity === undefined ? 0.08 : options.edgesDensity,
    runtime.ViolaJones.classifiers.face
  )

  const bestRect = pickBestRect(rects, sampleWidth, sampleHeight)

  if (!bestRect) {
    return {
      found: false,
      box: null,
      raw: {
        rects,
        sampleWidth,
        sampleHeight,
        scale
      }
    }
  }

  return {
    found: true,
    box: normalizeRect(bestRect, sampleWidth, sampleHeight),
    raw: {
      rects,
      bestRect,
      sampleWidth,
      sampleHeight,
      scale
    }
  }
}

module.exports = {
  detectFace
}
