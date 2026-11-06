import { useLayoutEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { usePrompt, type Prompt } from '../lib/passwords'
import { Button, IconButton } from './ui'

/** Asks for a PDF's password, or for agreement to make a copy without its editing restrictions. */
export function PasswordDialog() {
  const prompt = usePrompt((s) => s.prompt)
  return prompt ? <Panel prompt={prompt} /> : null
}

function Panel({ prompt }: { prompt: Prompt }) {
  const [value, setValue] = useState('')
  const [shown, setShown] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const needsPassword = prompt.kind === 'password'
  const skip = () => prompt.answer(null)
  const submit = () => (needsPassword ? value && prompt.answer(value) : prompt.answer('yes'))

  // Layout effects run as soon as the dialog is on screen, so focus and the Escape and Tab handling are in place at once.
  useLayoutEffect(() => {
    ;(needsPassword ? input.current : panel.current?.querySelector<HTMLElement>('[data-primary]'))?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return e.preventDefault(), skip()
      if (e.key !== 'Tab') return
      // Keep Tab inside the dialog while it is open.
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? [])]
      if (!items.length) return
      const [first, last] = [items[0], items[items.length - 1]]
      if (e.shiftKey && document.activeElement === first) e.preventDefault(), last.focus()
      else if (!e.shiftKey && document.activeElement === last) e.preventDefault(), first.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgb(16_24_40/0.45)] backdrop-blur-[2px] sm:items-center sm:p-6">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-title"
        aria-describedby="lock-body"
        className="toast-in-up w-full max-w-md rounded-t-3xl border border-line bg-desk p-5 shadow-[0_24px_60px_-12px_rgb(16_24_40/0.5)] outline-none sm:rounded-3xl sm:p-7"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-desk-2 text-ink">
            <Lock className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="lock-title" className="text-2xl font-semibold tracking-tight">
              {needsPassword ? 'Password needed' : 'Make an editable copy?'}
            </h2>
            <p id="lock-body" className="mt-1 break-words text-sm text-muted">
              <span className="font-semibold text-fg">{prompt.fileName}</span>{' '}
              {needsPassword
                ? 'is protected. Enter its password to open it.'
                : 'opens without a password, but whoever made it restricted editing or printing. To work on it, Cornerfold will make a copy without those restrictions.'}
            </p>
          </div>
        </div>

        {needsPassword && (
          <div className="mt-5">
            <label htmlFor="lock-password" className="text-sm font-semibold">
              Password
            </label>
            <div className="mt-1.5 flex items-center gap-1 rounded-2xl border border-line bg-paper pl-4 pr-1 focus-within:border-ink">
              <input
                id="lock-password"
                ref={input}
                type={shown ? 'text' : 'password'}
                value={value}
                onInput={(e) => setValue(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={prompt.wrong}
                aria-describedby={prompt.wrong ? 'lock-error' : undefined}
                className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              <IconButton label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown(!shown)}>
                {shown ? <EyeOff /> : <Eye />}
              </IconButton>
            </div>
            {prompt.wrong && (
              <p id="lock-error" role="alert" className="mt-2 flex items-center gap-2 text-sm font-medium">
                <span className="size-2.5 shrink-0 rounded-full bg-hi" aria-hidden="true" />
                That password didn’t work. Check it and try again.
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-muted">
          {needsPassword
            ? 'The password is used only on this device, to open this file. It is never stored or sent. Cornerfold works on a copy with no password and none of the file’s editing or printing restrictions. '
            : ''}
          Only do this for documents you’re allowed to change.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={skip}>Skip this file</Button>
          <Button variant="primary" data-primary onClick={submit} disabled={needsPassword && !value}>
            {needsPassword ? 'Unlock' : 'Make editable copy'}
          </Button>
        </div>
      </div>
    </div>
  )
}
