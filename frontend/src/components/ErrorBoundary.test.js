import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ErrorBoundary.jsx', import.meta.url), 'utf8')

describe('ErrorBoundary timer barriers', () => {
  it('stops timers before both reload and discard side effects', () => {
    expect(source).toContain("import { useUI } from '../store/useUI.js'")

    const reload = source.indexOf('icon="reset"')
    const reloadStop = source.indexOf('useUI.getState().stopTimers()', reload)
    const reloadCall = source.indexOf('location.reload()', reload)
    expect(reload).toBeGreaterThanOrEqual(0)
    expect(reloadStop).toBeGreaterThan(reload)
    expect(reloadStop).toBeLessThan(reloadCall)

    const discard = source.indexOf('icon="trash"')
    const discardStop = source.indexOf('useUI.getState().stopTimers()', discard)
    const discardMutation = source.indexOf('useStore.getState().update', discard)
    expect(discardStop).toBeGreaterThan(discard)
    expect(discardStop).toBeLessThan(discardMutation)
  })
})