// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const routine = { id: 'push', name: 'Push', emoji: null, prog: 'linear', ex: [{ id: '0235', sets: 2, inc: 2.5 }] }

describe('rest timer across navigation (debug)', () => {
  let container
  beforeEach(() => {
    window.location.hash = '#/workout'
    container = document.createElement('div')
    document.body.appendChild(container)
    useUI.setState({ sheets: [], toastMsg: '', timer: null, prep: null, work: null })
  })

  it('finds the tab bar and switches tabs', async () => {
    const active = {
      id: 'w1', d: '2026-08-11', start: Date.now() - 60000, routineId: 'push',
      name: 'Push', bw: 74, cur: 0, unit: 'kg', sourceUnit: 'kg',
      entries: [{ id: '0235', name: 'Ext rotation', ex: '0235', sets: [{ w: 5, r: 8 }] }]
    }
    useStore.setState({
      S: { unit: 'kg', bodyweight: [], routines: [routine], week: {}, dayPlan: {}, workouts: [], active, programmes: null, sound: true, restSec: 90 }
    })
    let root
    await act(async () => {
      const { default: App } = await import('../App.jsx')
      root = createRoot(container)
      root.render(<App />)
    })
    await act(async () => { await new Promise(r => setTimeout(r, 150)) })

    // guest if login shows
    const guestBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent && b.textContent.includes('Continue without account'))
    if (guestBtn) {
      await act(async () => { guestBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      await act(async () => { await new Promise(r => setTimeout(r, 150)) })
    }
    console.log('HASH:', window.location.hash)
    console.log('BUTTONS:', [...container.querySelectorAll('button')].map(b => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean).slice(0, 12))

    act(() => { useUI.getState().startRest(90) })
    expect(useUI.getState().timer).not.toBeNull()

    const tabs = [...container.querySelectorAll('button')].filter(b => {
      const txt = (b.textContent || '').toLowerCase()
      return ['home', 'workout', 'plan', 'stats', 'history', 'settings'].some(k => txt.includes(k))
    })
    console.log('TAB CANDIDATES:', tabs.map(b => (b.textContent || '').trim().slice(0, 20)))
    const homeTab = tabs.find(b => (b.textContent || '').toLowerCase().includes('home'))
    console.log('HOMETAB FOUND:', !!homeTab)
    if (homeTab) {
      await act(async () => { homeTab.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      await act(async () => { await new Promise(r => setTimeout(r, 150)) })
      console.log('AFTER HOME: hash=', window.location.hash, 'timer=', !!useUI.getState().timer, 'popup=', !!container.querySelector('#timer'))
    }

    await act(async () => { root.unmount() })
    container.remove()
  }, 30000)
})
