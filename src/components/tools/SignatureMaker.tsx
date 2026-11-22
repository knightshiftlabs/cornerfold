import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { MarkImage } from '../../lib/marks'
import { SIGNATURE_NOTE, inkToImage, loadSignatureFont, photoSignature, typedSignature } from '../../lib/signature'
import { unsupportedCharacters } from '../../lib/stampText'
import { Button, Sheet } from '../ui'
import { Choices } from './parts'

type Way = 'draw' | 'type' | 'photo'

/** Making a signature: drawn with a finger, mouse or pen, typed, or from a photo of one on paper. */
export function SignatureMaker({ onClose, onMade }: { onClose: () => void; onMade: (img: MarkImage) => void }) {
  const [way, setWay] = useState<Way>('draw')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState<MarkImage | null>(null)
  const [drawn, setDrawn] = useState(false)
  // One address per photo, made once and given back when the photo changes or the sheet closes.
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(new Blob([photo.png], { type: 'image/png' })) : ''), [photo])
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl])
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (way === 'type') void loadSignatureFont()
    setProblem(null)
  }, [way])

  // Drawing: smooth strokes that follow the pointer, sized for the screen's pixel density.
  useEffect(() => {
    const c = canvas.current
    if (way !== 'draw' || !c) return
    const ratio = Math.min(devicePixelRatio || 1, 3)
    c.width = c.clientWidth * ratio
    c.height = c.clientHeight * ratio
    const ctx = c.getContext('2d')!
    ctx.lineWidth = 2.6 * ratio
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0d1a40'
    let last: [number, number] | null = null
    const point = (e: PointerEvent): [number, number] => {
      const r = c.getBoundingClientRect()
      return [(e.clientX - r.left) * ratio, (e.clientY - r.top) * ratio]
    }
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId)
      last = point(e)
      ctx.beginPath()
      ctx.arc(last[0], last[1], ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fillStyle = ctx.strokeStyle
      ctx.fill()
      setDrawn(true)
    }
    const move = (e: PointerEvent) => {
      if (!last) return
      const p = point(e)
      const mid: [number, number] = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2]
      ctx.beginPath()
      ctx.moveTo(last[0], last[1])
      ctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1])
      ctx.lineTo(p[0], p[1])
      ctx.stroke()
      last = p
    }
    const up = () => (last = null)
    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    return () => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
    }
  }, [way])

  const clear = () => {
    const c = canvas.current
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setDrawn(false)
  }

  const use = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const img = way === 'draw' ? await inkToImage(canvas.current!) : way === 'type' ? await typedSignature(name.trim()) : photo
      if (!img) return setProblem(way === 'photo' ? 'No signature found in that photo. Try one with dark ink on plain paper.' : 'Nothing to use yet.')
      onMade(img)
    } catch {
      setProblem('That didn’t work. Please try again, or another way.')
    } finally {
      setBusy(false)
    }
  }

  const badName = unsupportedCharacters(name)
  const ready = !busy && (way === 'draw' ? drawn : way === 'type' ? !!name.trim() && !badName.length : !!photo)

  return (
    <Sheet
      title="Your signature"
      intro="Kept only in this tab, and forgotten when you close it."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={use}>
            {busy && <LoaderCircle className="spin" aria-hidden="true" />}
            Use this signature
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Choices<Way> label="How to make it" value={way} onChange={setWay} options={[{ value: 'draw', label: 'Draw' }, { value: 'type', label: 'Type' }, { value: 'photo', label: 'Photo' }]} />
        {way === 'draw' && (
          <div>
            <canvas ref={canvas} aria-label="Draw your signature here" className="h-44 w-full touch-none rounded-2xl border border-line bg-white" />
            <div className="mt-2 flex items-center justify-between text-sm text-muted">
              <span>Draw with your finger, a mouse or a pen. To use the keyboard, choose Type.</span>
              <Button onClick={clear} disabled={!drawn}>
                Clear
              </Button>
            </div>
          </div>
        )}
        {way === 'type' && (
          <div>
            <label htmlFor="sign-name" className="text-sm font-semibold">
              Your name
            </label>
            <input id="sign-name" data-autofocus value={name} onInput={(e) => setName(e.currentTarget.value)} autoComplete="name" className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-paper px-4 text-base outline-none focus:border-ink" />
            {badName.length > 0 ? (
              <p role="alert" className="mt-2 text-sm font-medium">
                A typed signature can use Latin letters for now. To sign in another script, choose Draw or Photo.
              </p>
            ) : (
              <p aria-hidden="true" className="mt-3 min-h-16 rounded-2xl bg-white px-4 text-5xl leading-[4rem] text-[#0d1a40]" style={{ fontFamily: '"Cornerfold Signature", cursive' }}>
                {name}
              </p>
            )}
          </div>
        )}
        {way === 'photo' && (
          <div>
            <label className="block text-sm font-semibold">
              A photo of your signature on paper
              <input
                type="file"
                accept="image/*"
                className="mt-2 block w-full text-sm"
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0]
                  if (!file) return
                  setBusy(true)
                  setPhoto(await photoSignature(file).catch(() => null))
                  setBusy(false)
                }}
              />
            </label>
            {photo && <img alt="Your signature, with the paper removed" className="mt-3 max-h-32 rounded-2xl border border-line bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2" src={photoUrl} />}
            <p className="mt-2 text-sm text-muted">The paper is made see-through, so only the ink goes on the page. The photo itself isn’t kept.</p>
          </div>
        )}
        {problem && (
          <p role="alert" className="text-sm font-medium">
            {problem}
          </p>
        )}
        <p className="text-xs text-muted">{SIGNATURE_NOTE}</p>
      </div>
    </Sheet>
  )
}
