import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EXDB } from '../lib/exercises.js'
import LastPerformance from './LastPerformance.jsx'

const LIFT = EXDB.find(ex => ex.bp !== 'cardio' && ex.eq !== 'body weight').id

const workout = (date, weight, reps) => ({
  d: date, unit: 'kg', entries: [{ id: LIFT, target: { mode: 'reps' }, notes: 'private note', sets: [{ phase: 'work', mode: 'reps', unit: 'kg', w: weight, r: reps, done: true }] }]
})

describe('LastPerformance', () => {
  it('renders the latest exact compatible performance and keeps private fields out of markup', () => {
    const html = renderToStaticMarkup(<LastPerformance state={{ unit: 'kg', workouts: [workout('2026-01-01', 60, 5), workout('2026-01-02', 62.5, 5)] }} exerciseId={LIFT} mode="reps" />)
    expect(html).toContain('Last performance')
    expect(html).toContain('62.5×5')
    expect(html).toContain('Show last 3')
    expect(html).not.toContain('private note')
  })
})
