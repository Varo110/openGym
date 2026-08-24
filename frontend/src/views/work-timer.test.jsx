// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { useUI } from '../store/useUI.js'
import RestTimer from '../components/RestTimer.jsx'
import { useStore } from '../store/useStore.js'

describe('work timer overtime flow', () => {
  let container
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    useUI.setState({ sheets: [], toastMsg: '', timer: null, prep: null, work: null })
    useStore.setState({ S: { ...(useStore.getState().S || {}), sound: true } })
  })

  it('at zero: keeps counting overtime, nothing logged until the user chooses', async () => {
    let logged = null
    let root
    await act(async () => { root = createRoot(container); root.render(<RestTimer />) })

    act(() => { useUI.getState().startWork(2, 'Plank', elapsed => { logged = elapsed }) })
    // let it cross zero and keep counting
    await act(async () => { await new Promise(r => setTimeout(r, 3400)) })
    const wk = useUI.getState().work
    console.log('AFTER 3.4s: work=', JSON.stringify(wk), 'logged=', logged)
    expect(wk, 'work timer exists').not.toBeNull()
    expect(wk.done, 'time is up').toBe(true)
    expect(logged, 'nothing auto-logged at zero').toBeNull()
    expect(wk.left, 'overtime counting (negative)').toBeLessThan(0)
    const txt = (container.textContent || '').replace(/\s+/g, ' ')
    expect(txt).toContain("Time's up!")

    // wait one more second -> overtime grows
    await act(async () => { await new Promise(r => setTimeout(r, 1200)) })
    const over = -useUI.getState().work.left
    console.log('OVERTIME now:', over)

    // choose "log with extra" -> planned + overtime, through the same callback
    const addBtn = [...container.querySelectorAll('button')].find(b => (b.textContent || '').includes('Log +'))
    expect(addBtn, 'log-with-extra button').toBeTruthy()
    await act(async () => { addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    console.log('LOGGED with extra:', logged)
    expect(logged, 'planned + overtime logged').toBe(2 + over)
    expect(useUI.getState().work, 'popup closed after choosing').toBeNull()

    await act(async () => { root.unmount() })
    container.remove()
  }, 30000)

  it('choose keep: logs only the planned time', async () => {
    let logged = null
    let root
    await act(async () => { root = createRoot(container); root.render(<RestTimer />) })
    act(() => { useUI.getState().startWork(2, 'Plank', elapsed => { logged = elapsed }) })
    await act(async () => { await new Promise(r => setTimeout(r, 3400)) })
    expect(useUI.getState().work.done).toBe(true)
    expect(logged).toBeNull()
    const keepBtn = [...container.querySelectorAll('button')].find(b => (b.textContent || '').includes('Keep'))
    expect(keepBtn, 'keep-planned button').toBeTruthy()
    await act(async () => { keepBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    console.log('LOGGED keep:', logged)
    expect(logged, 'only the planned time logged').toBe(2)
    await act(async () => { root.unmount() })
    container.remove()
  }, 30000)
})
