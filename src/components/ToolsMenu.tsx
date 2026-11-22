import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { splitPages } from '../lib/actions'
import { ArrowDownUp, Palette, CopyPlus, Droplets, FilePlus2, FileText, FlipVertical2, Hash, Images, ListChecks, Ruler, ScanSearch, Scissors, Shrink, Signature, SquareSplitHorizontal, Wrench } from 'lucide-react'
import { describePaper } from '../lib/paper'
import { duplicateSelected, insertBlankPage, reverseOrder, selectBlankPages } from '../lib/pageTools'
import { useStore } from '../lib/store'
import { usePrefs } from '../lib/prefs'
import { Button } from './ui'

interface Item {
  icon: ComponentType<{ className?: string }>
  label: string
  hint?: string
  disabled?: boolean
  /** Shown only on phones, where the toolbar has no room for it. */
  phoneOnly?: boolean
  run: () => void
}

/** Everything that doesn't earn a button of its own in the toolbar. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false)
  const selected = useStore((s) => s.selected.size)
  const busy = useStore((s) => !!s.busy)
  const openTool = useStore((s) => s.openTool)
  const invert = useStore((s) => s.invertSelection)
  const paper = useStore((s) => s.paper)
  const pagesCount = useStore((s) => s.pages.length)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Where the button is, so the desktop dropdown can sit under it.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)

  const groups: { name: string; phoneOnly?: boolean; items: Item[] }[] = [
    {
      name: 'Make smaller',
      phoneOnly: true,
      items: [{ icon: Shrink, label: 'Compress…', disabled: busy, phoneOnly: true, run: () => useStore.getState().setCompressOpen(true) }],
    },
    {
      name: 'Appearance',
      phoneOnly: true,
      items: [{ icon: Palette, label: 'Appearance…', hint: 'Theme, accent and more', phoneOnly: true, run: () => usePrefs.getState().setOpen(true) }],
    },
    {
      name: 'Sign',
      items: [
        {
          icon: Signature,
          label: 'Fill and sign…',
          hint: 'Forms, signatures, text and ticks',
          run: () => {
            const st = useStore.getState()
            useStore.setState({ tool: 'sign', previewPage: st.pages.find((p) => st.selected.has(p.id))?.id ?? st.pages[0]?.id ?? null })
          },
        },
      ],
    },
    {
      name: 'Select',
      items: [
        {
          icon: ListChecks,
          label: 'Select pages…',
          hint: 'By number, odd, even or every Nth',
          run: () => openTool('select'),
        },
        { icon: FlipVertical2, label: 'Invert selection', run: invert },
      ],
    },
    {
      name: 'Pages',
      items: [
        {
          icon: CopyPlus,
          label: 'Duplicate',
          hint: selected ? undefined : 'Select pages first',
          disabled: !selected,
          run: duplicateSelected,
        },
        {
          icon: ArrowDownUp,
          label: selected >= 2 ? 'Reverse selected pages' : 'Reverse page order',
          run: reverseOrder,
        },
        {
          icon: FilePlus2,
          label: 'Insert blank page',
          hint: selected ? 'After the selection' : 'At the end',
          disabled: busy,
          run: insertBlankPage,
        },
        {
          icon: ScanSearch,
          label: 'Find blank pages',
          hint: 'Selects them for you to review',
          disabled: busy,
          run: selectBlankPages,
        },
      ],
    },
    {
      name: 'Photos',
      items: [
        {
          icon: Ruler,
          label: 'Page size for photos…',
          hint: describePaper(paper).replace(/^./, (c) => c.toUpperCase()),
          run: () => openTool('paper'),
        },
      ],
    },
    {
      name: 'Split',
      items: [
        { icon: SquareSplitHorizontal, label: 'Split by ranges or size…', run: () => openTool('split') },
        { icon: Scissors, label: 'Split into single pages', disabled: busy || pagesCount < 2, phoneOnly: true, run: splitPages },
      ],
    },
    {
      name: 'Save as',
      items: [
        {
          icon: Images,
          label: 'Images…',
          hint: 'JPG or PNG',
          run: () => openTool('images'),
        },
        {
          icon: FileText,
          label: 'Text…',
          hint: 'Copy or save the words',
          run: () => openTool('text'),
        },
      ],
    },
    {
      name: 'Stamp',
      items: [
        { icon: Hash, label: 'Page numbers…', run: () => openTool('numbers') },
        {
          icon: Droplets,
          label: 'Watermark…',
          run: () => openTool('watermark'),
        },
      ],
    },
  ]

  const TILE: Record<string, string> = { 'Make smaller': '#2fa98a', Appearance: '#8e5cf0', Sign: '#5b6cff', Select: '#7b8296', Pages: '#d98a0b', Photos: '#e0587a', Split: '#7a6ae0', 'Save as': '#23a36f', Stamp: '#d9701f' }

  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = root.current?.getBoundingClientRect()
      if (r) setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
      // On wider screens the phone-only items are hidden, so the arrow keys skip them.
      .filter((el) => !(el.hasAttribute('data-phone-only') && window.matchMedia('(min-width: 640px)').matches))
    items()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return (e.preventDefault(), e.stopPropagation(), close())
      if (e.key === 'Tab') return close(false)
      const list = items()
      const at = list.indexOf(document.activeElement as HTMLElement)
      const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null
      if (to === null) return
      e.preventDefault()
      list[(to + list.length) % list.length]?.focus()
    }
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node) && close(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <Button onClick={() => setOpen(!open)} className="max-sm:px-2.5" aria-label="Tools" aria-haspopup="menu" aria-expanded={open}>
        <Wrench />
        <span className="hidden sm:inline">Tools</span>
      </Button>
      {open &&
        // Drawn at the top of the page, not inside the toolbar: the toolbar's frosted-glass blur would
        // otherwise become the frame that "fixed" is measured from, and on phones the menu would open off screen.
        createPortal(
          <>
            <div className="fixed inset-0 z-50 bg-scrim sm:hidden" aria-hidden="true" />
            <div
              ref={panel}
              role="menu"
              aria-label="Tools"
              style={anchor && window.matchMedia('(min-width: 640px)').matches ? { top: anchor.top, right: anchor.right } : undefined}
              className="pop-in fixed inset-x-2 bottom-2 z-50 max-h-[80dvh] overflow-y-auto glass rounded-[var(--r-panel)] p-2 sm:inset-x-auto sm:bottom-auto sm:max-h-[calc(100dvh-6rem)] sm:w-80"
            >
              {groups.map((group) => (
                <div key={group.name} role="group" aria-label={group.name} className={`py-1 ${group.phoneOnly ? 'sm:hidden' : ''}`}>
                  <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.name}</div>
                  {group.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => {
                        close(false)
                        item.run()
                      }}
                      className={`group flex w-full items-center gap-3 rounded-[var(--r-ctl)] px-2.5 py-2 text-left outline-none hover:bg-ink hover:text-white focus-visible:bg-ink focus-visible:text-white disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-inherit ${item.phoneOnly ? 'sm:hidden' : ''}`}
                  data-phone-only={item.phoneOnly || undefined}
                    >
                      <span className="tile" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${TILE[group.name]} 80%, #fff), ${TILE[group.name]})` }} aria-hidden="true">
                        <item.icon className="size-[15px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{item.label}</span>
                        {item.hint && <span className="block text-xs text-muted group-hover:text-white group-focus-visible:text-white">{item.hint}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
