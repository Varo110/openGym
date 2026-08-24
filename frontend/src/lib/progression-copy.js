const policyName = {
  linear: 'Linear progression',
  greyskull: 'Greyskull LP',
  double: 'Double progression',
  time: 'Add time',
}

const firstWhy = plan => String(plan?.why?.[0] || '')
const unitFor = (plan, cfg, context) => context?.unit || cfg?.unit || plan?.unit || 'kg'

/**
 * Presentation-only mapping for the existing nextPrescription result. The progression engine
 * remains the source of truth for numbers and kind; this helper only replaces ambiguous prose
 * with a policy-labelled translation key and the same result arguments.
 */
export function formatProgressionGuidance(plan, cfg = {}, context = {}) {
  const source = plan || {}
  const policy = source.policy || 'off'
  const mode = cfg.mode || (source.sec != null ? 'time' : 'reps')
  const unit = unitFor(source, cfg, context)
  const why = firstWhy(source)
  const sets = Number(source.sets ?? cfg.sets)
  const prescribedReps = Number(cfg.reps ?? source.goal)
  const step = Number(source.step ?? cfg.inc)
  if (source.kind === 'off' || policy === 'off') return ['No automatic progression · targets stay where you set them.']
  if (source.kind === 'first') return ['{0} · no compatible completed session yet — this target sets the baseline.', context.policyLabel || policyName[policy] || 'Progression']

  if (source.kind === 'up' && mode === 'reps' && Number(source.weight) === 0) {
    if (source.sets > 0) return ['Bodyweight · every set was clean → add a set and go back to {0} reps.', source.reps]
    return ['Bodyweight · every set was clean → aim for {0} reps.', source.reps]
  }
  if (mode === 'reps' && Number(source.weight) === 0 && source.kind === 'hold') {
    if (why.includes('time to add weight')) return source.why
    return ['Bodyweight — same target again until every set is clean.']
  }
  if (source.kind === 'hold' && source.programmeHoldDisposition === 'deload') return ['Programme deload · progression paused — resume the pre-deload target before adding load.']
  if (policy === 'time') {
    if (source.kind === 'up') return ['Add time · every set held for the full duration → {0}s (+{1}s).', source.sec, Number.isFinite(step) ? step : 5]
    if (source.kind === 'deload') return ['Add time · repeated short sessions → back off to {0}s and build up again.', source.sec]
    if (source.kind === 'hold') return ['Add time · last session came up short → repeat the same target.']
  }
  if (source.kind === 'up' && policy === 'greyskull') {
    if (source.doubleJump === true || why.includes('double jump')) return ['Greyskull LP · AMRAP reached twice the target → {0} {1} (+{2} {1}).', source.weight, unit, Number.isFinite(step) ? step : 0]
    return ['Greyskull LP · AMRAP minimum met last session → {0} {1} (+{2} {1}).', source.weight, unit, Number.isFinite(step) ? step : 0]
  }
  if (source.kind === 'up' && policy === 'double' && Number.isFinite(sets) && Number.isFinite(prescribedReps)
    && Number.isFinite(Number(source.weight)) && Number.isFinite(Number(source.reps)) && Number.isFinite(step)) {
    return ['Double · {0}×{1} complete → {2} {3} (+{4} {3}); reset to {5} reps.', sets, prescribedReps, source.weight, unit, step, source.reps]
  }
  if (source.kind === 'up' && policy === 'linear' && Number.isFinite(sets) && Number.isFinite(prescribedReps)
    && Number.isFinite(Number(source.weight)) && Number.isFinite(step)) {
    return ['Linear · {0}×{1} complete → {2} {3} (+{4} {3}).', sets, prescribedReps, source.weight, unit, step]
  }
  if (source.kind === 'up' && policy === 'linear') return ['Linear · increase the load for the next session.']

  if (source.kind === 'deload') return ['{0} · missed reps trigger a reset → {1} {2}.', context.policyLabel || policyName[policy] || 'Progression', source.weight, unit]
  if (source.kind === 'hold' && policy === 'double' && source.weight == null) return ['Double · keep the current weight; aim for {0} reps on every set.', source.reps ?? prescribedReps]
  if (source.kind === 'hold' && policy === 'double') return ['Double · keep {0} {1}; aim for {2} reps on every set.', source.weight, unit, source.reps ?? prescribedReps]
  if (source.kind === 'hold' && policy === 'greyskull' && why.includes('AMRAP')) return ['Greyskull LP · AMRAP minimum missed → maintain the current weight.']
  if (source.kind === 'hold' && why.includes('partial')) return ['Progression paused · complete the prescribed work before progressing.']
  if (source.kind === 'hold' && why.includes('No progression-driver')) return ['No progression-driver set · hold the current target.']
  if (source.kind === 'hold') return ['{0} · missed reps → repeat the current target.', context.policyLabel || policyName[policy] || 'Progression']
  return null
}
