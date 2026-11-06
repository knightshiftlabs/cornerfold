// Asking the person for a password, or for permission to remove a file's restrictions. One question at
// a time, even when several locked files are added together. Nothing here is stored: the answer goes
// straight back to the code that asked, and the question is cleared.
import { create } from 'zustand'

export interface Prompt {
  kind: 'password' | 'restricted'
  fileName: string
  /** True when the password just tried was wrong. */
  wrong: boolean
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

function ask(kind: Prompt['kind'], fileName: string, wrong: boolean) {
  return inTurn(
    () =>
      new Promise<string | null>((resolve) => {
        usePrompt.setState({
          prompt: {
            kind,
            fileName,
            wrong,
            answer: (value) => {
              usePrompt.setState({ prompt: null })
              resolve(value)
            },
          },
        })
      }),
  )
}

/** Resolves to the password, or null if the person skips this file. */
export const askPassword = (fileName: string, wrong: boolean) => ask('password', fileName, wrong)

/** Resolves to true if the person agrees to a copy without the file's editing restrictions. */
export const askRestricted = async (fileName: string) => (await ask('restricted', fileName, false)) !== null
