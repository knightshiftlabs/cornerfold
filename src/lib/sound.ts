/** A soft tick when a page lands, for people who switch it on in Appearance. Made on the spot: no sound file, nothing fetched. */
let ctx: AudioContext | null = null

export function tick() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(1500, t)
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.04)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.07)
  } catch {
    /* no audio available: silence is fine */
  }
}
