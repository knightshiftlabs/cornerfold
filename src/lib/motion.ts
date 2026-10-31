/** Entrance choreography for newly added pages: a short stagger and a random tilt that settles flat. */
export const entering = new Map<string, { delay: number; tilt: number }>()

export function stage(pageIds: string[]) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  pageIds.forEach((id, i) => {
    entering.set(id, { delay: reduce ? 0 : Math.min(i, 24) * 28, tilt: reduce ? 0 : Math.random() * 12 - 6 })
  })
}
