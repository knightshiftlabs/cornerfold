// The questions Cornerfold asks about locked files: one at a time, and nothing kept afterwards.
import { describe, expect, it } from 'vitest'
import { askPassword, askRestricted, promptOpen, questionsFor, usePrompt } from '../src/lib/passwords'

const tick = () => new Promise((r) => setTimeout(r, 5))
const current = () => usePrompt.getState().prompt

describe('asking for a password', () => {
  it('shows the question, and clears it as soon as it is answered', async () => {
    const answer = askPassword('statement.pdf', false)
    await tick()
    expect(promptOpen()).toBe(true)
    expect(current()).toMatchObject({ kind: 'password', fileName: 'statement.pdf', wrong: false })
    current()!.answer('hunter2')
    expect(await answer).toBe('hunter2')
    expect(promptOpen()).toBe(false)
    expect(JSON.stringify(usePrompt.getState().prompt)).toBe('null') // nothing about the password lingers
  })

  it('remembers that the last try was wrong, so the dialog can say so', async () => {
    const answer = askPassword('statement.pdf', true)
    await tick()
    expect(current()!.wrong).toBe(true)
    current()!.answer(null)
    await answer
  })

  it('treats skipping as null', async () => {
    const answer = askPassword('statement.pdf', false)
    await tick()
    current()!.answer(null)
    expect(await answer).toBeNull()
  })

  it('asks about several locked files one at a time, in the order they came', async () => {
    const first = askPassword('a.pdf', false)
    const second = askPassword('b.pdf', false)
    const third = askRestricted('c.pdf')
    await tick()
    expect(current()!.fileName).toBe('a.pdf') // only one question is ever on screen
    current()!.answer('one')
    expect(await first).toBe('one')
    await tick()
    expect(current()!.fileName).toBe('b.pdf')
    current()!.answer(null)
    expect(await second).toBeNull()
    await tick()
    expect(current()).toMatchObject({ kind: 'restricted', fileName: 'c.pdf' })
    current()!.answer('yes')
    expect(await third).toBe(true)
    expect(promptOpen()).toBe(false)
  })
})

describe('asking permission to remove restrictions', () => {
  it('is true when the person agrees and false when they skip', async () => {
    const yes = askRestricted('bank.pdf')
    await tick()
    current()!.answer('yes')
    expect(await yes).toBe(true)
    const no = askRestricted('bank.pdf')
    await tick()
    current()!.answer(null)
    expect(await no).toBe(false)
  })
})

describe('keeping the dialog up while an answer is checked', () => {
  it('stays open, marked as checking, until the file is done, and then forgets everything', async () => {
    let finish!: () => void
    const done = questionsFor('statement.pdf', async (ask) => {
      expect(await ask.password(false)).toBe('hunter2')
      await new Promise<void>((r) => (finish = r)) // the password is being tried
    })
    await tick()
    current()!.answer('hunter2')
    await tick()
    expect(current()).toMatchObject({ fileName: 'statement.pdf', checking: true })
    current()!.answer(null) // a second answer while checking is ignored
    await tick()
    expect(current()!.checking).toBe(true)
    finish()
    await done
    expect(JSON.stringify(usePrompt.getState().prompt)).toBe('null')
  })

  it('a retry is a new question, so the dialog starts fresh, and it says the last try was wrong', async () => {
    let first = 0
    const done = questionsFor('statement.pdf', async (ask) => {
      await ask.password(false)
      first = current()!.id
      return ask.password(true)
    })
    await tick()
    current()!.answer('wrong')
    await tick()
    expect(current()).toMatchObject({ wrong: true, checking: false })
    expect(current()!.id).not.toBe(first)
    current()!.answer('right')
    expect(await done).toBe('right')
  })

  it('another file’s question waits until this file’s retries are over (regression)', async () => {
    const asked: string[] = []
    const a = questionsFor('a.pdf', async (ask) => {
      await ask.password(false)
      asked.push('a, first try')
      await ask.password(true)
      asked.push('a, second try')
    })
    const b = askPassword('b.pdf', false)
    for (const _ of [1, 2, 3]) {
      await tick()
      const now = current()!
      asked.push(`asking ${now.fileName}`)
      now.answer('x')
    }
    await Promise.all([a, b])
    expect(asked).toEqual(['asking a.pdf', 'a, first try', 'asking a.pdf', 'a, second try', 'asking b.pdf'])
  })
})
