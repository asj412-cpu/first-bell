/** Local paths only. Tesseract must not fall back to a CDN. */
export const OCR_PATHS = {
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr/tesseract-core-simd.wasm.js',
  langPath: '/ocr',
  gzip: true,
  workerBlobURL: false,
  legacyCore: true,
}

function assertLocal(paths) {
  for (const value of Object.values(paths)) {
    if (typeof value === 'string' && /^https?:/i.test(value)) {
      throw new Error('OCR refused a remote address')
    }
  }
}

export async function recognizeLocal(image, paths = OCR_PATHS) {
  assertLocal(paths)
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, paths)
  try {
    const result = await worker.recognize(image)
    return result?.data?.text || ''
  } finally {
    await worker.terminate()
  }
}
