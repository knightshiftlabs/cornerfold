import { create } from 'zustand'

/**
 * How Cornerfold looks and feels, chosen by the person and kept on this device.
 *
 * Only choices that differ from the defaults are saved, and the saved copy is removed once everything is back to
 * default, so someone who never opens Appearance has nothing stored. public/theme.js reads the same saved copy before
 * the first paint, so the page never flashes the wrong theme; tests/prefs.test.ts keeps the two in step.
 */
export const CHOICES = {
  theme: ['auto', 'light', 'dark', 'midnight', 'paper'],
  accent: ['indigo', 'blue', 'violet', 'pink', 'orange', 'green', 'graphite'],
  desk: ['graphite', 'slate', 'linen', 'felt'],
  paper: ['bright', 'soft', 'warm'],
  shadow: ['flat', 'soft', 'lifted'],
  select: ['fold', 'check', 'ring'],
  corners: ['sharp', 'soft', 'round'],
  density: ['compact', 'calm', 'airy'],
  motion: ['full', 'calm', 'off'],
  text: ['default', 'large', 'largest'],
} as const

type Choices = typeof CHOICES
export type Look = { [K in keyof Choices]: Choices[K][number] } & {
  /** 0 to 100: how blurred and see-through the frosted panels are. */
  glass: number
  /** 0 to 100: how big the page thumbnails are. */
  size: number
  contrast: boolean
  hints: boolean
  sound: boolean
}

export const DEFAULTS: Look = {
  theme: 'auto',
  accent: 'indigo',
  desk: 'graphite',
  paper: 'soft',
  shadow: 'soft',
  select: 'fold',
  corners: 'soft',
  density: 'calm',
  motion: 'full',
  text: 'default',
  glass: 70,
  size: 37,
  contrast: false,
  hints: true,
  sound: false,
}

export const KEY = 'cornerfold.look'

const isChoice = <K extends keyof Choices>(k: K, v: unknown): v is Choices[K][number] => (CHOICES[k] as readonly unknown[]).includes(v)
const clamp = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fallback)

/** Anything unexpected (an old version, a hand edit, a wrong type) falls back to the default for that one setting. */
export function sanitize(raw: unknown): Look {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, unknown> = { ...DEFAULTS }
  for (const k of Object.keys(CHOICES) as (keyof Choices)[]) if (isChoice(k, src[k])) out[k] = src[k]
  out.glass = clamp(src.glass, DEFAULTS.glass)
  out.size = clamp(src.size, DEFAULTS.size)
  for (const k of ['contrast', 'hints', 'sound'] as const) out[k] = typeof src[k] === 'boolean' ? src[k] : DEFAULTS[k]
  return out as unknown as Look
}

export function load(): Look {
  try {
    const text = localStorage.getItem(KEY)
    return sanitize(text ? JSON.parse(text) : null)
  } catch {
    return { ...DEFAULTS }
  }
}

/** Saves only what differs from the default. Storage can be unavailable or full; the look still applies for this visit. */
export function save(look: Look) {
  try {
    const changed = Object.fromEntries(Object.entries(look).filter(([k, v]) => v !== DEFAULTS[k as keyof Look]))
    if (Object.keys(changed).length) localStorage.setItem(KEY, JSON.stringify(changed))
    else localStorage.removeItem(KEY)
  } catch {
    /* private window, blocked storage, or full: carry on without saving */
  }
}

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches

/** The theme actually drawn: "auto" follows the device. */
export const effectiveTheme = (look: Look): 'light' | 'dark' | 'midnight' | 'paper' => (look.theme === 'auto' ? (prefersDark() ? 'dark' : 'light') : look.theme)

const DESK_COLOR = { light: '#e7e8ee', dark: '#0c0d11', midnight: '#000000', paper: '#efe9dc' }

/** Puts the look on the page as attributes the stylesheet reads. */
export function apply(look: Look, root: HTMLElement = document.documentElement) {
  const theme = effectiveTheme(look)
  root.dataset.theme = theme
  root.dataset.accent = look.accent
  root.dataset.desk = look.desk
  root.dataset.paper = look.paper
  root.dataset.shadow = look.shadow
  root.dataset.sel = look.select
  root.dataset.corners = look.corners
  root.dataset.density = look.density
  root.dataset.motion = look.motion
  root.dataset.text = look.text
  if (look.contrast) root.dataset.contrast = 'high'
  else delete root.dataset.contrast
  root.style.setProperty('--glass', String(look.glass))
  root.style.setProperty('--size', String(look.size))
  // The browser's own chrome (the address bar on phones) follows the desk.
  root.ownerDocument.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute('media')
    m.content = DESK_COLOR[theme]
  })
}

/** 1 for full motion, less for "calm", nearly none for "off" or when the device asks for reduced motion. */
export function motionScale(look: Look = usePrefs.getState().look): number {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || look.motion === 'off') return 0
  return look.motion === 'calm' ? 0.5 : 1
}

interface PrefsState {
  look: Look
  open: boolean
  set: <K extends keyof Look>(key: K, value: Look[K]) => void
  reset: () => void
  setOpen: (open: boolean) => void
}

export const usePrefs = create<PrefsState>((set, get) => ({
  look: load(),
  open: false,
  set: (key, value) => {
    const look = { ...get().look, [key]: value }
    save(look)
    apply(look)
    set({ look })
  },
  reset: () => {
    save(DEFAULTS)
    apply(DEFAULTS)
    set({ look: { ...DEFAULTS } })
  },
  setOpen: (open) => set({ open }),
}))

/** Called once at start-up: applies the saved look and keeps it right when the device or another tab changes. */
export function startPrefs() {
  apply(usePrefs.getState().look)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(usePrefs.getState().look))
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return
    const look = load()
    apply(look)
    usePrefs.setState({ look })
  })
}
