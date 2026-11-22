// A limit on how much a ZIP of exported pages may hold. Building one keeps every file in memory, and then the ZIP
// itself as well, so a long scan saved at high detail can bring down a phone's tab. The size is worked out as the
// pages are made, and the job stops as soon as it is clear it will not fit, instead of after all the work is done.

/** The most the files of one ZIP may add up to. The ZIP itself needs about the same again while it is built. */
export const MAX_ZIP_BYTES = 300 * 1024 * 1024

export class ExportTooBigError extends Error {}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

/**
 * Called after each part is made. `made` is how many parts exist so far, `bytes` their total size, `total` how many
 * will be made. Throws once the total is over the limit, or is clearly heading there (judged from the average so far,
 * after at least two parts, so one unusually large page doesn't decide).
 */
export function checkZipBudget(made: number, total: number, bytes: number, advice: string, limit = MAX_ZIP_BYTES) {
  const projected = made >= 2 ? (bytes / made) * total : bytes
  if (bytes > limit || projected > limit) {
    throw new ExportTooBigError(`These would come to about ${mb(Math.max(bytes, projected))}, more than this browser can safely build in one go (${mb(limit)}). ${advice}`)
  }
}
