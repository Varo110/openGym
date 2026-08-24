// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const bench = { id: 'bench', name: 'Bench', emoji: null, prog: 'linear', ex: [{ id: '0235', sets: 2, inc: 2.5 }, { id: '3313', sets: 2, inc: 2.5 }] }

describe('superset screen-switch debug', () => {
  let container
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    useUI.setState({ sheets: [], toastMsg: '', timer: null, prep: null, work: null })
  })

  it('shows the exercise name on screen after advancing', async () => {
    const active = {
      id: 'w1', d: '2026-08-11', start: Date.now() - 60000, routineId: 'bench',
      name: 'Bench', bw: 74, cur: 0, unit: 'kg', sourceUnit: 'kg',
      entries: [
        { id: '0235', name: 'Bench press', ex: '0235', sg: 'g1', sets: [{ w: 50, r: 8 }, { w: 50, r: 8 }] },
        { id: '3313', name: 'Weighted dip', ex: '3313', sg: 'g1', sets: [{ w: 10, r: 8 }, { w: 10, r: 8 }] }
      ]
    }
    useStore.setState({
      S: { unit: 'kg', bodyweight: [], routines: [bench], week: {}, dayPlan: {}, workouts: [], active, programmes: null, sound: true, restSec: 90 }
    })
    let root
    await act(async () => {
      const { default: Workout } = await import('../views/Workout.jsx')
      root = createRoot(container)
      root.render(<MemoryRouter><Workout /></MemoryRouter>)
    })
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
    const dumpScreen = label => {
      const txt = (container.textContent || '').replace(/\s+/g, ' ').slice(0, 160)
      console.log(label, '=>', txt)
    }
    dumpScreen('INITIAL')

    const check = container.querySelector('[aria-label="Set 1 complete"]')
    await act(async () => { check.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise(r => setTimeout(r, 200)) })
    dumpScreen('AFTER A1')

    console.log('CUR STATE:', useStore.getState().S.active.cur)

    await act(async () => { root.unmount() })
    container.remove()
  }, 20000)
})
