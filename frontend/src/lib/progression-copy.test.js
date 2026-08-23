import { describe, expect, it } from 'vitest'
import { formatProgressionGuidance } from './progression-copy.js'

describe('policy-labelled progression copy', () => {
  it('labels linear completion with the configured increment and unit', () => {
    expect(formatProgressionGuidance({ policy: 'linear', kind: 'up', weight: 70, step: 2.5, why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'] }, { mode: 'reps', sets: 3, reps: 5 }, { unit: 'kg' }))
      .toEqual(['Linear · {0}×{1} complete → {2} {3} (+{4} {3}).', 3, 5, 70, 'kg', 2.5])
  })

  it('distinguishes Greyskull AMRAP minimum and double-jump outcomes', () => {
    expect(formatProgressionGuidance({ policy: 'greyskull', kind: 'up', weight: 65, step: 2.5, why: ['Every rep last time — {0} {1} more.', 2.5, 'kg'] }, { mode: 'reps' }, { unit: 'kg' }))
      .toEqual(['Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).', 65, 'kg', 2.5])
    expect(formatProgressionGuidance({ policy: 'greyskull', kind: 'up', weight: 70, step: 5, doubleJump: true, why: ['Last set hit {0} reps — twice the target, so take a double jump of {1} {2}.', 10, 5, 'kg'] }, { mode: 'reps' }, { unit: 'kg' }))
      .toEqual(['Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).', 70, 'kg', 5])
  })

  it('preserves double, time, bodyweight, deload, miss, and off semantics', () => {
    expect(formatProgressionGuidance({ policy: 'double', kind: 'up', weight: 62.5, reps: 6, step: 2.5 }, { mode: 'reps', sets: 3, reps: 8 }, { unit: 'kg' }))
      .toEqual(['Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.', 3, 8, 62.5, 'kg', 2.5, 6])
    expect(formatProgressionGuidance({ policy: 'double', kind: 'hold', weight: 60, reps: 7 }, { mode: 'reps' }, { unit: 'kg' }))
      .toEqual(['Double · keep {0} {1}; aim for {2} reps on every set.', 60, 'kg', 7])
    expect(formatProgressionGuidance({ policy: 'time', kind: 'up', sec: 50, step: 5 }, { mode: 'time' }))
      .toEqual(['Add time · every set held for the full duration → {0}s (+{1}s).', 50, 5])
    expect(formatProgressionGuidance({ policy: 'linear', kind: 'up', reps: 12, weight: 0 }, { mode: 'reps' }))
      .toEqual(['Bodyweight · every set was clean → aim for {0} reps.', 12])
    expect(formatProgressionGuidance({ policy: 'linear', kind: 'hold', weight: 0, why: ['Bodyweight — same target again until every set is clean.'] }, { mode: 'reps' }))
      .toEqual(['Bodyweight — same target again until every set is clean.'])
    expect(formatProgressionGuidance({ policy: 'linear', kind: 'deload', weight: 45 }, { mode: 'reps', inc: 2.5 }))
      .toEqual(['{0} · missed reps trigger a reset → {1} {2}.', 'Linear progression', 45, 'kg'])
    expect(formatProgressionGuidance({ policy: 'linear', kind: 'hold', programmeHoldDisposition: 'deload', weight: 60 }, { mode: 'reps' }))
      .toEqual(['Programme deload · progression paused — resume the pre-deload target before adding load.'])
    expect(formatProgressionGuidance({ policy: 'time', kind: 'hold', programmeHoldDisposition: 'deload', sec: 45 }, { mode: 'time' }))
      .toEqual(['Programme deload · progression paused — resume the pre-deload target before adding load.'])
    expect(formatProgressionGuidance({ policy: 'linear', kind: 'hold', weight: 60 }, { mode: 'reps' }))
      .toEqual(['{0} · missed reps → repeat the current target.', 'Linear progression'])
    expect(formatProgressionGuidance({ policy: 'off', kind: 'off' }, { mode: 'reps' }))
      .toEqual(['No automatic progression · targets stay where you set them.'])
  })
})
