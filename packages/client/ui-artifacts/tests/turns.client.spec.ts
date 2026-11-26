/** Turns for card pictures: a few at once, handed out in order, and a waiting place given up leaves the line. */
import { describe, expect, it } from 'vitest'
import { TurnQueue } from '../src/client/slots.ts'

describe('picture turns', () => {
  it('grants at most the limit and hands a freed turn to the next in line', () => {
    const queue = new TurnQueue(2)
    const started: string[] = []
    const endA = queue.request(() => started.push('a'))
    queue.request(() => started.push('b'))
    const withdrawC = queue.request(() => started.push('c'))
    queue.request(() => started.push('d'))
    expect(started).toEqual(['a', 'b'])

    withdrawC()
    endA()
    expect(started).toEqual(['a', 'b', 'd'])
    endA()
    expect(started).toEqual(['a', 'b', 'd'])
  })
})
