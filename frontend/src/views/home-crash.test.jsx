// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/api.js', () => ({
  api: vi.fn(path => path === '/api/config'
    ? Promise.resolve({ allow_guest: true })
    : Promise.reject(Object.assign(new Error('Unauthenticated'), { status: 401 }))),
  webauthnOK: () => false,
  passkeyLogin: vi.fn(),
  passkeyRegister: vi.fn(),
  BIO: 'your fingerprint, face or PIN'
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const routine = { id: 'push', name: 'Push', emoji: null, prog: 'linear', ex: [{ id: '0235', sets: 2, inc: 2.5 }] }

describe('home-crash probe', () => {
  let container
  beforeEach(() => {
    window.location.hash = '#/workout'
    localStorage.clear()
    localStorage.setItem('gym_guest', '1')
    container = document.createElement('div')
    document.body.appendChild(container)
    useUI.setState({ sheets: [], toastMsg: '', timer: null, prep: null, work: null })
  })

  it('keeps Home and the rest timer available after a tab switch with an active workout', async () => {
    const active = {
      id: 'w1', d: '2026-08-11', start: Date.now() - 60000, routineId: 'push',
      name: 'Push', bw: 74, cur: 0, unit: 'kg', sourceUnit: 'kg',
      entries: [{ id: '0235', name: 'Ext rotation', ex: '0235', sets: [{ w: 5, r: 8 }] }]
    }
    useStore.setState({
      user: null,
      ready: true,
      S: { unit: 'kg', bodyweight: [], routines: [routine], week: {}, dayPlan: {}, workouts: [], active, programmes: null, sound: true, restSec: 90 }
    })
    let root
    await act(async () => {
      const { default: App } = await import('../App.jsx')
      root = createRoot(container)
      root.render(<App />)
    })
    act(() => { useUI.getState().startRest(90) })

    const homeTab = [...container.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Home')
    expect(homeTab, 'Home tab should be available after boot').toBeTruthy()
    await act(async () => { homeTab.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(window.location.hash).toContain('/home')
    expect(container.querySelector('.today-row')).toBeTruthy()
    expect(useUI.getState().timer).not.toBeNull()
    expect(container.querySelector('#timer')).toBeTruthy()

    await act(async () => { root.unmount() })
    container.remove()
  }, 30000)
})
