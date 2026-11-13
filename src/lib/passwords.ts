// Asking the person for a password, or for permission to remove a file's restrictions. One question at
// a time, even when several locked files are added together. Nothing here is stored: the answer goes
// straight back to the code that asked, and the question is cleared.
import { create } from 'zustand'

export interface Prompt {
  /** Each question has its own id, so the dialog starts fresh for a retry. */
  id: number
  kind: 'password' | 'restricted'
  fileName: string
  /** True when the password just tried was wrong. */
  wrong: boolean
  /** True while the answer is being checked: the dialog stays open and waits, rather than vanishing. */
  checking: boolean
  /** Called with the password (or true to confirm), or null if the person skips the file. */
  answer: (value: string | null) => void
}

export const usePrompt = create<{ prompt: Prompt | null }>(() => ({ prompt: null }))
export const promptOpen = () => usePrompt.getState().prompt !== null

let line: Promise<unknown> = Promise.resolve()
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const result = line.then(task, task)
  line = result.catch(() => undefined)
  return result
}

let ids = 0
function show(kind: Prompt['kind'], fileName: string, wrong: boolean) {
  return new Promise<string | null>((resolve) => {
    usePrompt.setState({
      prompt: {
        id: ++ids,
        kind,
        fileName,
        wrong,
        checking: false,
        answer: (value) => {
          const now = usePrompt.getState().prompt
          if (!now || now.checking) return // one answer per question
          usePrompt.setState({ prompt: value === null ? null : { ...now, checking: true } })
          resolve(value)
        },
      },
    })
  })
}

export interface Questions {
  /** Resolves to the password, or null if the person skips this file. */
  password: (wrong: boolean) => Promise<string | null>
  /** Resolves to true if the person agrees to a copy without the file's editing restrictions. */
  restricted: () => Promise<boolean>
}

/**
 * Asks all of one file's questions as one turn: a retry after a wrong password follows straight on, with no
 * other file's question in between, and the dialog stays open while each answer is checked. It closes, and
 * forgets everything, when the file is done.
 */
export function questionsFor<T>(fileName: string, task: (ask: Questions) => Promise<T>): Promise<T> {
  return inTurn(async () => {
    try {
      return await task({
        password: (wrong) => show('password', fileName, wrong),
        restricted: async () => (await show('restricted', fileName, false)) !== null,
      })
    } finally {
      usePrompt.setState({ prompt: null })
    }
  })
}

/** One question on its own. */
export const askPassword = (fileName: string, wrong: boolean) => questionsFor(fileName, (ask) => ask.password(wrong))
export const askRestricted = (fileName: string) => questionsFor(fileName, (ask) => ask.restricted())
