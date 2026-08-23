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

const routine = { id: 'push', name: 'Push', emoji: null, prog: 'linear', ex: [{ id: 'lift', sets: 3, inc: 2.5 }] }

describe('APP E2E: start workout from Home', () => {
  let container
  beforeEach(() => {
    window.location.hash = '#/home'
    localStorage.clear()
    localStorage.setItem('gym_guest', '1')
    container = document.createElement('div')
    document.body.appendChild(container)
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState({
      user: null,
      ready: true,
      S: { unit: 'kg', bodyweight: [{ d: '2026-08-10', w: 74 }], routines: [routine], week: { [new Date().getDay()]: 'push' }, dayPlan: {}, workouts: [], active: null, theme: 'dark', accent: '#4f9dff', lang: 'en', programmes: null }
    })
  })

  it('login -> Home today-row -> check-in -> Save & start -> lands on #/workout with active set', async () => {
    let root
    await act(async () => {
      const { default: App } = await import('../App.jsx')
      root = createRoot(container)
      root.render(<App />)
    })

    const row = container.querySelector('.today-row')
    expect(row, 'today-row should exist on Home').toBeTruthy()

    const startBtn = container.querySelector('.home-start-action')
    expect(startBtn, 'Home Start action should exist').toBeTruthy()
    await act(async () => { startBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const saveBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent && b.textContent.includes('Save & start workout'))
    expect(saveBtn, 'check-in Save & start workout button should exist').toBeTruthy()

    await act(async () => { saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })

    const S = useStore.getState().S
    expect(S.active, 'active workout should be created').not.toBeNull()
    expect(window.location.hash, 'should land on #/workout (got ' + window.location.hash + ')').toContain('workout')
    expect(container.textContent).toContain('Push')

    await act(async () => { root.unmount() })
    container.remove()
  }, 30000)
})
