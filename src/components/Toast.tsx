import { useEffect } from 'react'
import { useStore } from '../lib/store'

export function Toast() {
  const toast = useStore((s) => s.toast)
  const dismiss = useStore((s) => s.dismissToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, toast.action ? 6000 : toast.tone === 'error' ? 5000 : 3000)
    return () => clearTimeout(t)
  }, [toast, dismiss])

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50">
      {toast && (
        <div
          key={toast.id}
          className="toast-in pointer-events-auto absolute left-1/2 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full bg-fg py-3 pl-5 pr-3 text-[0.95rem] font-medium text-desk shadow-[0_12px_32px_-8px_rgb(16_24_40/0.45)]"
        >
          {toast.tone === 'error' && <span className="size-2.5 shrink-0 rounded-full bg-hi" aria-hidden="true" />}
          <span className="min-w-0">{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              className="shrink-0 rounded-full bg-hi px-3.5 py-1 font-semibold text-[#1d2532] active:scale-95"
              onClick={() => {
                toast.action!.run()
                dismiss()
              }}
            >
              {toast.action.label}
            </button>
          ) : (
            <span className="w-2" />
          )}
        </div>
      )}
    </div>
  )
}
