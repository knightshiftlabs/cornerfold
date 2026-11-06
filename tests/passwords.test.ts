// The questions Cornerfold asks about locked files: one at a time, and nothing kept afterwards.
import { describe, expect, it } from 'vitest'
import { askPassword, askRestricted, promptOpen, usePrompt } from '../src/lib/passwords'

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
