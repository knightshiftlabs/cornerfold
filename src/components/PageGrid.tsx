import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { useStore, type Page } from '../lib/store'
import { getThumb, peekThumb } from '../lib/pdf'
import { entering } from '../lib/motion'
import { deletePages } from '../lib/actions'

export function PageGrid() {
  const pages = useStore((s) => s.pages)
  const reorder = useStore((s) => s.reorder)
  const deselect = useStore((s) => s.deselect)
  const [activeId, setActiveId] = useState<string | null>(null)
  const ids = useMemo(() => pages.map((p) => p.id), [pages])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeIndex = activeId ? ids.indexOf(activeId) : -1
  const clearOnBackground = (e: MouseEvent) => e.target === e.currentTarget && deselect()

  return (
    <div className="min-h-[calc(100dvh-4rem)] px-3 pb-28 pt-5 sm:px-8" onClick={clearOnBackground}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={(e) => {
          setActiveId(null)
          if (e.over) reorder(String(e.active.id), String(e.over.id))
        }}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <ol
            className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] sm:gap-x-5"
            onClick={clearOnBackground}
          >
            {pages.map((p, i) => (
              <SortablePage key={p.id} page={p} number={i + 1} />
            ))}
          </ol>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }}>
          {activeIndex >= 0 ? <CardFace page={pages[activeIndex]} number={activeIndex + 1} lifted /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

const SortablePage = memo(function SortablePage({ page, number }: { page: Page; number: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const selected = useStore((s) => s.selected.has(page.id))
  const select = useStore((s) => s.select)
  const rotate = useStore((s) => s.rotate)
  const [enter] = useState(() => {
    const e = entering.get(page.id)
    entering.delete(page.id)
    return e
  })

  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }
  const enterStyle = enter ? ({ '--d': `${enter.delay}ms`, '--tilt': `${enter.tilt}deg` } as CSSProperties) : undefined
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={`Page ${number}`}
      aria-pressed={selected}
      onClick={(e) => select(page.id, e.shiftKey ? 'range' : 'toggle')}
      className="group relative cursor-grab touch-manipulation rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div className={enter ? 'sheet-enter' : undefined} style={enterStyle}>
        <CardFace page={page} number={number} selected={selected} />
      </div>
      <div
        className={`absolute right-3.5 top-3.5 flex gap-1 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 ${selected ? 'opacity-100' : 'opacity-0'}`}
      >
        <CardAction label="Rotate left" onClick={stop(() => rotate(new Set([page.id]), -90))}>
          <RotateCcw />
        </CardAction>
        <CardAction label="Rotate right" onClick={stop(() => rotate(new Set([page.id]), 90))}>
          <RotateCw />
        </CardAction>
        <CardAction label="Delete page" onClick={stop(() => deletePages(new Set([page.id])))}>
          <Trash2 />
        </CardAction>
      </div>
    </li>
  )
})

function CardAction({ label, onClick, children }: { label: string; onClick: (e: MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="grid size-8 place-items-center rounded-full bg-white/95 text-[#1d2532] shadow-[0_1px_3px_rgb(16_24_40/0.25)] hover:bg-white active:scale-90 transition-transform [&_svg]:size-4"
    >
      {children}
    </button>
  )
}

function CardFace({ page, number, selected, lifted }: { page: Page; number: number; selected?: boolean; lifted?: boolean }) {
  const source = useStore((s) => s.sources[page.sourceId])
  return (
    <div className={`card ${selected ? 'is-selected' : ''} ${lifted ? 'is-lifted' : ''}`}>
      <div className="sheet-box">
        <Thumb page={page} />
      </div>
      <div className="mt-2.5 flex min-w-0 items-baseline gap-2 px-0.5">
        <span className="font-semibold tabular-nums">{number}</span>
        <span className="card-src truncate text-xs text-muted">
          {source.name}
          {source.pageCount > 1 ? `, p. ${page.index + 1}` : ''}
        </span>
      </div>
    </div>
  )
}

function Thumb({ page }: { page: Page }) {
  const source = useStore((s) => s.sources[page.sourceId])
  const [url, setUrl] = useState<string | null>(() => peekThumb(page.sourceId, page.index))
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (url || !ref.current) return
    let alive = true
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        getThumb(source, page.index).then(
          (u) => alive && setUrl(u),
          () => alive && setFailed(true),
        )
      },
      { rootMargin: '600px' },
    )
    io.observe(ref.current)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [url, source, page.index])

  const turn = { transform: `rotate(${page.rotation}deg)` }
  if (url) return <img src={url} alt="" draggable={false} className="sheet" style={turn} />
  return (
    <div ref={ref} className="sheet is-blank grid place-items-center text-xs text-[#6b7686]" style={turn}>
      {failed ? 'Preview unavailable' : null}
    </div>
  )
}
