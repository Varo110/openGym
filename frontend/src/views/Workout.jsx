import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutines, lastEntryFor, bestWeightFor, activeWorkoutHistoryState, activeWorkoutHistoryPolicy, activeWorkoutLoadReference, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort, pairAdjacent, cleanupSg, weeklySessionStatus } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, dateLocale } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { setProgressHighWater, supersetFlowStep } from '../lib/supersetFlow.js'
import { cuesForExercise } from '../lib/annotations.js'
import Media from '../components/Media.jsx'
import { startFlow, startFreestyleFlow, startSessionSheet, resumeWeeklySession, exercisePicker, exConfigSheet, warmupConfigSheet, workConfigSheet, exerciseDetailSheet, topWeightSheet, autoConfirmTopWeight, finishWorkout, workoutCompleteSheet, confirmSheet, restSettingsSheet, discardWorkout, programmeExitSheet, activeGroupMetaSheet, swapActiveWorkoutExercise } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription, defaultIncrement, POLICY_NAME } from '../lib/progression.js'
import { formatProgressionGuidance } from '../lib/progression-copy.js'
import { prepSecondsFor, timerDurationForSet, canApplyTimedResult, removeActiveSet, navigateActiveExercise, prependWarmupSets, applyWarmupConfigToEntry, applyWorkConfigToEntry, mergeWorkConfigIntoTarget, warmupConfigForEntry, resolveTargetLoad, sessionConfigFor, sessionPlanFor, isAmrapEntry, effectiveAmrapPolicyForEntry, isAmrapProgressionAllowed, shouldConfirmWorkingWeight, hasSelectedWorkPhase, setTableColumnsForMode, tableModesRequirePerRowHeaders, addSetForEntry, appendSetForEntry, amrapRoleForSet, amrapTargetForSet, cycleAmrapRole, restSecondsFor } from '../lib/workout-runtime.js'
import { modeForSet, cachedWeightFor, isWarmupRow, isWorkRow, isAmrapRoleEligibleSet, normalizePhase, normalizeWeightPrescription } from '../lib/workout-model.js'
import { classifyWorkoutExit, isProgrammeSession, recordProgrammeSetRemoval } from '../lib/partial.js'
import { glyphOf } from '../lib/glyphs.js'
import { programmeStartSurface } from '../lib/programmes.js'
import { moveActiveGroupMember, reorderActiveWorkoutUnit, saveActiveAmrapTargetsToRoutine, saveActiveOrderToRoutine } from '../lib/active-workout-editing.js'
import { pickupCycleFor, savedPickupPolicy } from '../lib/programme-pickup.js'
import { resistedSwipeOffset, SWIPE_GAP, swipeDecision } from '../lib/swipe.js'
import ProgrammePickupSheet from '../components/ProgrammePickupSheet.jsx'
import LastPerformance from '../components/LastPerformance.jsx'

const SWIPE_ANIMATION_MS = 200
const SWIPE_DRAG_DEADZONE = 8
const SWIPE_TRANSITION_CLASS = 'workout-swipe-transition'
const emptySwipeGesture = () => ({ startX: null, startY: null, dx: 0, dy: 0, offset: 0, claimed: false, direction: null })

function clearSwipeCard(card) {
  if (!card) return
  card.classList.remove(SWIPE_TRANSITION_CLASS)
  card.style.removeProperty('transform')
}

function sideBySideSwipeTransform(direction, offset) {
  const origin = direction === 'next' ? '100%' : '-100%'
  const gap = direction === 'next' ? `+ ${SWIPE_GAP}px` : `- ${SWIPE_GAP}px`
  const dragOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0
  const translated = dragOffset < 0
    ? ` - ${Math.abs(dragOffset)}px`
    : dragOffset > 0 ? ` + ${dragOffset}px` : ''
  return `translate3d(calc(${origin} ${gap}${translated}), 0, 0)`
}

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const startSurface = programmeStartSurface(S, { now: Date.now() })
  const queueHead = startSurface.front
  const showQueuedSession = queueHead?.source === 'programme'
  const queueRoutine = queueHead?.routineSnapshot
    || queueHead?._session?.routineSnapshot
    || (queueHead?.source === 'classic' ? S.routines.find(r => String(r.id) === String(queueHead?.routineId)) : null)
    || {}
  const queueBlocked = !!queueHead && !startSurface.eligible.some(item => item.instanceId === queueHead.instanceId)
  const queueGuardUntil = queueHead?.guardUntil || startSurface.queue.blocked?.guardUntil || null
  const queueName = queueRoutine.name && String(queueHead?.routineId || '').indexOf(queueRoutine.name) < 0 ? queueRoutine.name : t('Unnamed routine')
  const queueSession = queueHead?.source === 'programme' ? {
    source: 'programme', routineId: queueHead.routineId, instanceId: queueHead.instanceId,
    calendarDate: queueHead.nominalDate, status: queueHead.status,
    recordId: queueHead.recordId, latestRecord: queueHead.latestRecord
  } : null
  const queueStatus = queueSession ? weeklySessionStatus(S, queueSession) : null
  const todayPlans = effectiveRoutines(S, todayISO())
  const todayOvr = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, todayISO())
  const plannedIds = new Set(todayPlans.map(r => r.id))
  const others = S.routines.filter(r => !r.draft && !plannedIds.has(r.id))
  const todayStatuses = new Map(todayPlans.map(plan => [plan.id, weeklySessionStatus(S, {
    source: 'classic', routineId: plan.id, calendarDate: todayISO()
  })]))
  const resumePlans = todayPlans.filter(plan => todayStatuses.get(plan.id) === 'resume')
  const todayLabel = todayPlans.length ? todayPlans.map(r => r.name).join(', ') : t('rest day, but no one’s stopping you')
  const versionedProgramme = S.programmes && !Array.isArray(S.programmes) && S.programmes.version === 1 ? S.programmes : null
  const repeatableCycle = pickupCycleFor(versionedProgramme)
  const repeatableProgrammeId = repeatableCycle?.programmeId || repeatableCycle?.definitionId || versionedProgramme?.id || null
  const repeatableProgramme = versionedProgramme && repeatableCycle && repeatableProgrammeId ? versionedProgramme : null
  const goQueue = () => queueStatus === 'resume'
    ? resumeWeeklySession(queueSession)
    : startFlow(
        queueHead.routineId,
        queueHead.source === 'programme' ? queueHead : null,
        { calendarDate: queueHead.nominalDate || todayISO() }
      )
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} \u2014 {todayPlans.length ? t('today is {0}', todayLabel) : todayLabel}</div></div></div>
    {showQueuedSession && <div className="card" style={{ borderColor: queueBlocked ? 'var(--orange)' : 'var(--acc)' }}>
      <h2 className={queueBlocked ? 'warn' : 'accent'}>{t('Queued session')}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{queueName}</div><div className="muted small">{exCount(queueRoutine.ex?.length || 0)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(queueRoutine.emoji)} /></span>
      </div>
      {queueBlocked
        ? <div className="muted small">{queueGuardUntil
          ? t('Available after {0}', new Date(queueGuardUntil).toLocaleString(dateLocale()))
          : t('Continue next time')}</div>
        : <Button variant="primary" icon="play" onClick={goQueue}>{queueStatus === 'resume' ? t('Resume') : t('Start {0}', queueName)}</Button>}
    </div>}
    {todayPlans.length === 1 && todayStatuses.get(todayPlans[0].id) === 'start' && (
      <div className="card" style={{ borderColor: 'var(--acc)' }}>
        <h2 className="accent">{t("Today's plan")}{todayOvr ? ' \u00b7 ' + t('rescheduled') : ''}</h2>
        <div className="row between" style={{ marginBottom: 12 }}>
          <div><div className="big">{todayPlans[0].name}</div><div className="muted small">{exCount(todayPlans[0].ex.length)}</div></div>
          <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayPlans[0].emoji)} /></span>
        </div>
        <Button variant="primary" icon="play" onClick={() => startFlow(todayPlans[0].id)}>{t('Start {0}', todayPlans[0].name)}</Button>
      </div>
    )}
    {resumePlans.length > 0 && <div className="card">
      <h2>{t('Resume')}</h2>
      <div className="muted small" style={{ marginBottom: 10 }}>{resumePlans.map(plan => plan.name).join(', ')}</div>
      {resumePlans.map(plan => <Button key={plan.id} variant="primary" icon="play" onClick={() => resumeWeeklySession({ source: 'classic', routineId: plan.id, calendarDate: todayISO() })}>{t('Resume')}</Button>)}
    </div>}
    {todayPlans.length > 1 && (
      <div className="card">
        <h2 className="accent">{t('Today’s sessions')}</h2>
        <div className="muted small" style={{ marginBottom: 10 }}>{todayLabel}</div>
        <Button variant="primary" icon="play" onClick={() => startSessionSheet()}>{t('Choose a session')}</Button>
      </div>
    )}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    {repeatableProgramme && <Button onClick={() => nav('/programme/pickup', { state: {
      programmeId: repeatableProgrammeId,
      cycleId: repeatableCycle.id,
      mode: 'repeat',
      savedPolicy: savedPickupPolicy({ programme: S.programmes, cycle: repeatableCycle }),
    } })}>{t('Start / Repeat')}</Button>}
    <>
      <Button icon="shuffle" onClick={startFreestyleFlow}>{t('Freestyle workout (pick as you go)')}</Button>
      {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
    </>
  </div>
}

// Named export for the programme route; the classic workout surface remains independent.
export { StartChooser, ProgrammePickupSheet }

export function emptyWorkoutMessage(routineId) {
  return routineId
    ? `${t('{0} workout', t('Planned'))} — ${t('Add exercise')}`
    : t('Freestyle workout — add your first exercise.')
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

function PhaseDivider({ phase, onSettings }) {
  const warmup = phase === 'warmup'
  const label = warmup ? t('Warm-up') : t('Work')
  return <div className={'phase-divider ' + phase}>
    <span className="phase-label">{label}</span>
    <span className="phase-line" />
    <button className="iconbtn phase-settings" aria-label={t(warmup ? 'Warm-up settings' : 'Work settings')} title={t(warmup ? 'Warm-up settings' : 'Work settings')}
      onClick={onSettings}><Icon name="gear" /></button>
  </div>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, onToggle, onField, onAddSet, onRemoveSet, onRemoveExercise, onAddWarmup, onRemoveWarmup, onWarmupSettings, onWorkSettings, onStartTimed, onCycleRole, onAdjustAmrapTarget, onPairPrev, onPairNext, setRowRef }) {
  const { work } = useUI()
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const preparing = useUI(s => s.prep)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const activeUnit = S.active.unit || S.active.sourceUnit || S.unit
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const historyState = activeWorkoutHistoryState(S, S.active)
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = mode === 'reps' ? Math.max(bestWeightFor({ ...historyState, unit: activeUnit }, entry.id), cachedWeightFor(historyState.exWeights?.[entry.id], activeUnit)) : 0
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  const amrap = isAmrapEntry(entry)
  const progressionAllowed = isAmrapProgressionAllowed(entry)
  const qualifyingSingleGreyskullDriver = progressionAllowed
    && entry.sets.filter((_set, index) => isAmrapRoleEligibleSet(entry, index)).length === 1
    && entry.sets.some((_set, index) => amrapRoleForSet(entry, index) === 'progression')
  // Bodyweight hides the load column until a belt/load is actually recorded; timed and cardio
  // rows still keep their native shape, and reps rows can opt into the effort scale.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const guidance = plan ? formatProgressionGuidance(plan, cfg, { unit: activeUnit, policyLabel: plan.policy ? t(POLICY_NAME[plan.policy]) : null }) : null
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const warmupCount = entry.sets.filter(isWarmupRow).length
  const canRemoveWarmup = warmupCount > 0 && entry.sets.length > 1
  const columnsForRow = rowMode => {
    const base = setTableColumnsForMode(rowMode, activeUnit)
    const hideLoad = bw && !added && rowMode !== 'cardio'
    const load = base.primary?.f === 'w' ? base.primary : base.secondary?.f === 'w' ? base.secondary : null
    const value = load === base.primary ? base.secondary : base.primary
    const primary = hideLoad ? null : load
      ? rowMode === 'reps' && bw ? { ...load, label: 'Added' } : load
      : value
    const secondary = hideLoad
      ? (value && rowMode === 'reps' ? { ...value, step: repStep(cfg) } : value)
      : load ? value : base.secondary
    const effort = rowMode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true } : null
    return { ...base, primary, secondary, effort }
  }
  const columns = columnsForRow(mode)
  const perRowHeaders = tableModesRequirePerRowHeaders(entry)
  // The visual grid is always load/weight first, then reps/duration. `columnsForRow`
  // leaves the first slot empty for bodyweight work instead of moving reps/seconds
  // into it, so ordinary and superset rows never change column meaning.
  const metricColumns = rowColumns => ({ first: rowColumns.primary, second: rowColumns.secondary })
  const heading = column => {
    const label = column.label || column.hd
    return label === 'Weight'
      ? t('Weight ({0})', column.unit)
      : label === 'Added'
        ? t('Added ({0})', column.unit)
        : t(label)
  }
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  // Effort is optional and only appears on repetition rows; a blank cell is not RIR 0.
  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )
  const renderSetHead = rowColumns => {
    const metrics = metricColumns(rowColumns)
    return <div className={'sethead' + (rowColumns.effort ? ' eff3' : '')}>
      <span className="n-sp" />
      <span className="w-sp metric-weight">{metrics.first ? heading(metrics.first) : ''}</span>
      <span className="r-sp metric-reps">{metrics.second ? heading(metrics.second) : ''}</span>
      {rowColumns.effort && <span className="eff-sp">{heading(rowColumns.effort)}</span>}
      {rowColumns.timed && <span className="ck-sp" />}<span className="ck-sp" />
    </div>
  }
  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{ex.n}</div>
      <div className="row" style={{ gap: 6 }}>
        <button className="iconbtn" aria-label={t('Remove exercise')} title={t('Remove exercise')} disabled={!!work} onClick={onRemoveExercise}><Icon name="trash" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex, { historyState })}><Icon name="info" /></button>
      </div>
    </div>
    {!compact && (onPairPrev || onPairNext) && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {onPairPrev && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with previous')} onClick={onPairPrev}>{t('Make superset with previous')}</Button>}
      {onPairNext && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with next')} onClick={onPairNext}>{t('Make superset with next')}</Button>}
    </div>}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {amrap && <span className="tag acc">{t('AMRAP')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !s.done)?.r ?? entry.sets[0]?.r)))}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {activeUnit}</span>}
    </div>

    {cuesForExercise(S, entry.id) && <div className="small ex-notes" style={{ marginBottom: 4 }}><Icon name="lightbulb" /> <b>{t('Personal cues')}:</b> {cuesForExercise(S, entry.id)}</div>}
    {cfg.notes && <div className="small dim ex-notes" style={{ marginBottom: 4 }}><Icon name="info" /> <b>{t('Routine note')}:</b> {cfg.notes}</div>}
    <LastPerformance state={historyState} exerciseId={entry.id} mode={mode} occurrenceId={entry.occurrenceId} />
    {guidance && <button type="button" className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}
      aria-label={t('Open progression settings')} onClick={event => { event.stopPropagation(); onWorkSettings?.() }}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...guidance)}</span>
    </button>}
    {qualifyingSingleGreyskullDriver && <div className="small dim" role="note" style={{ marginBottom: 4 }}>
      {t('Greyskull uses the final work set as AMRAP.')}
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {!perRowHeaders && renderSetHead(columns)}
      {entry.sets.map((s, i) => {
        const setMode = modeForSet(s, entry.target || entry) || mode
        const rowColumns = columnsForRow(setMode)
        const phase = isWarmupRow(s) ? 'warmup' : 'work'
        const prevPhase = i > 0 ? (isWarmupRow(entry.sets[i - 1]) ? 'warmup' : 'work') : null
        const rowClass = 'setrow ' + phase + (s.done ? ' done' : '') + (rowColumns.effort ? ' eff3' : '')
        const phaseStart = prevPhase !== phase
        const noWarmups = !entry.sets.some(isWarmupRow)
        const phaseIndex = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === (phase === 'warmup')).length
        const roleEligible = isAmrapRoleEligibleSet(entry, i)
        const resolvedRole = roleEligible ? (amrapRoleForSet(entry, i) || 'none') : null
        const role = resolvedRole === 'progression' && !progressionAllowed ? 'amrap' : resolvedRole
        const roleLabel = role === 'progression' ? `★ ${t('AMRAP')} · ${t('Progression')}` : role === 'amrap' ? t('AMRAP') : `+ ${t('AMRAP')}`
        const ariaRoleLabel = role === 'progression' ? `★ ${t('AMRAP')} · ${t('Progression')}` : role === 'amrap' ? t('AMRAP') : t('No AMRAP role')
        const nextAriaRoleLabel = role === 'none' ? t('AMRAP')
          : role === 'amrap' && progressionAllowed ? `★ ${t('AMRAP')} · ${t('Progression')}` : t('No AMRAP role')
        const rowTarget = role === 'none' ? null : amrapTargetForSet(entry, i)
        const targetUnit = setMode === 'time' ? t('seconds') : t('reps')
        return <div key={i} className={'setgroup' + (perRowHeaders ? ' per-row-head' : '')}>
          {phaseStart && phase === 'warmup' && <PhaseDivider phase={phase} onSettings={onWarmupSettings} />}
          {phaseStart && phase === 'work' && <>
            {noWarmups && <PhaseDivider phase="warmup" onSettings={onWarmupSettings} />}
            <div className="row setbtns" style={{ marginBottom: 6 }}>
              <Button className="warmbtn" size="sm" icon="plus" onClick={onAddWarmup}>{t('Add warm-up set')}</Button>
              <Button className="warmbtn" size="sm" icon="minus" disabled={!canRemoveWarmup} onClick={onRemoveWarmup}>{t('Remove warm-up set')}</Button>
            </div>
            <PhaseDivider phase={phase} onSettings={onWorkSettings} />
          </>}
          {perRowHeaders && renderSetHead(rowColumns)}
          <div ref={el => setRowRef?.(s, el)} className={rowClass}>
            <span className="n">{phaseIndex}</span>
            {(() => {
              const metrics = metricColumns(rowColumns)
              return <>
                {metrics.first ? cell(s, i, metrics.first, 'w') : <span className="stp w metric-weight-empty" aria-hidden="true" />}
                {metrics.second ? cell(s, i, metrics.second, 'r') : <span className="stp r metric-reps-empty" aria-hidden="true" />}
              </>
            })()}
            {rowColumns.effort && cell(s, i, rowColumns.effort, 'eff')}
            {/* A timed set is started, not typed: the timer counts the hold down and checks the
                set off itself. The checkbox stays for anyone who timed it on their own watch. */}
            {rowColumns.timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working || !!preparing}
              onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
            <Check checked={s.done} ariaLabel={t('Set {0} complete', i + 1)} onChange={() => onToggle(i)} />
          </div>
          {roleEligible && <div className="amrap-role-row">
            <button type="button" className={'amrap-role-control role-' + role}
              aria-label={`${t('Set {0}', phaseIndex)}: ${ariaRoleLabel}. ${t('Next')}: ${nextAriaRoleLabel}`}
              onClick={() => onCycleRole?.(i)}>{roleLabel}</button>
            {rowTarget != null && <div className="amrap-target-inline" aria-label={`${t('AMRAP')} · ${t('Target')}: ${rowTarget} ${targetUnit}`}>
              <button type="button" aria-label={t('Decrease AMRAP target')} onClick={() => onAdjustAmrapTarget?.(i, -1)}><Icon name="minus" /></button>
              <span className="amrap-target-value">{rowTarget} {targetUnit}</span>
              <button type="button" aria-label={t('Increase AMRAP target')} onClick={() => onAdjustAmrapTarget?.(i, 1)}><Icon name="plus" /></button>
            </div>}
          </div>}
        </div>
      })}
      <div style={{ height: 8 }} />
      <div className="row setbtns">
        <Button size="sm" icon="minus" onClick={onRemoveSet}>{t(entry.sets.length <= 1 ? 'Remove exercise' : 'Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>
  </>
}

/* ---------- active workout ---------- */
// Clear the work callback before indexes can shift. This also protects a confirmation
// sheet that was opened first and confirmed after a timed hold started.
export function removeActiveExercise(idx) {
  useUI.getState().stopWork()
  useStore.getState().update(s => {
    if (!s.active || !Array.isArray(s.active.entries)) return
    if (idx < 0 || idx >= s.active.entries.length) return
    s.active.entries[idx].sets?.forEach((_set, setIdx) => recordProgrammeSetRemoval(s.active, idx, setIdx))
    s.active.entries.splice(idx, 1)
    cleanupSg(s.active.entries)
    if (idx < s.active.cur) s.active.cur--
    if (s.active.cur >= s.active.entries.length) s.active.cur = Math.max(0, s.active.entries.length - 1)
  }, true)
}

// New exercises sit after the current navigation unit, not merely after the current member. This
// keeps a contiguous superset together while preserving the existing standalone-entry shape.
export function insertAfterCurrentUnit(entries, currentIndex) {
  if (!Array.isArray(entries) || entries.length === 0) return 0
  const rawIndex = Number(currentIndex)
  const index = Number.isFinite(rawIndex)
    ? Math.min(Math.max(rawIndex, 0), entries.length - 1)
    : 0
  const unit = unitOf(supersetUnits(entries), index)
  return (unit[unit.length - 1] ?? index) + 1
}

function theoreticalWarmupTarget(config = {}) {
  const rows = Array.isArray(config.warmup) ? config.warmup : []
  return rows.find(row => normalizeWeightPrescription(row, row?.weight)?.kind === 'percentage') || null
}

function ActiveWorkout() {
  // Keep this hook even though its cleanup is intentionally empty: the workout timers are
  // app-global and route changes must not tear them down.
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const workoutUI = useUI()
  const { startRest, stopRest, work } = workoutUI
  if (typeof window !== 'undefined' && window.__wkDebug) console.log('WK render work=', !!work)
  const A = S.active
  const activeUnit = A.unit || A.sourceUnit || S.unit
  useEffect(() => () => {
    // Timers are app-global: leaving the workout screen must never kill the rest,
    // prep or work countdowns - their popups stay visible everywhere (owner req).
  }, [])
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const prevDisabled = unitIdx <= 0
  const nextDisabled = unitIdx < 0 || unitIdx >= units.length - 1
  const isSuperset = unit.length > 1
  // Superset flow (owner req): keep the active exercise in view - completing a set
  // scrolls to the next exercise in the group, then back up to the first of the round.
  const exRefs = useRef(new Map())
  const setRowRefs = useRef(new Map())
  const swipeAreaRef = useRef(null)
  const swipeCardRef = useRef(null)
  const swipePeekRef = useRef(null)
  const swipeGesture = useRef(emptySwipeGesture())
  const swipeNavigation = useRef(null)
  const swipeAnimation = useRef({ active: false, cancelWait: null })
  const [swipeAnimating, setSwipeAnimating] = useState(false)
  const [swipePeekUnitIdx, setSwipePeekUnitIdx] = useState(null)
  const progressHighWater = useRef(A.entries.map(e => e.sets.filter(s => s.done).length))
  useEffect(() => {
    if (!isSuperset) return
    const entry = A.entries[cur]
    const targetSet = entry?.sets.find(set => !set.done) || entry?.sets[entry.sets.length - 1]
    const el = setRowRefs.current.get(targetSet) || exRefs.current.get(entry)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }
  }, [cur, isSuperset, A.entries.length])
  const pairAt = (first, second) => update(s => {
    s.active.entries = pairAdjacent(s.active.entries, first, second)
  })
  const onPairPrev = !isSuperset && cur > 0 ? () => pairAt(cur - 1, cur) : null
  const onPairNext = !isSuperset && cur < A.entries.length - 1 ? () => pairAt(cur, cur + 1) : null
  const moveCurrentExercise = direction => {
    workoutUI.stopTimers()
    update(s => {
      const active = s.active
      const index = active?.cur
      const entry = active?.entries?.[index]
      if (!entry) return
      if (entry.sg) return moveActiveGroupMember(active, index, direction)
      const activeUnits = supersetUnits(active.entries)
      const slot = activeUnits.findIndex(candidate => candidate.includes(index))
      if (slot >= 0) reorderActiveWorkoutUnit(active, index, slot + direction)
    }, true)
  }

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)
  const hasActiveAmrapTargets = A.entries.some(entry => (entry.sets || []).some((set, index) => {
    const role = isAmrapRoleEligibleSet(entry, index) ? amrapRoleForSet(entry, index) : null
    return (role === 'amrap' || role === 'progression') && Number(set.amrapTarget) > 0
  }))
  const canSaveAmrapTargets = hasActiveAmrapTargets && !isProgrammeSession(A)
    && !!A.routineId && Array.isArray(A.routineEntryMap)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Changing a weight cascades to the following sets of the same phase, so a
    // heavier bar carries through the set instead of retyping every row. It only
    // cascades on fixed-weight rows: percentage prescriptions are driven by the
    // plan and must stay untouched, and completed sets are never rewritten.
    if (field === 'w') {
      const cfg = e.target || e
      const warm = isWarmupRow(e.sets[i])
      const warmupIndex = warm
        ? e.sets.slice(0, i + 1).filter(isWarmupRow).length - 1
        : -1
      const prescription = warm ? e.target?.warmup?.[warmupIndex]?.weightPrescription : cfg.weightPrescription
      if (['percentage', 'workset_percent'].includes(prescription?.kind)) return
      for (let j = i + 1; j < e.sets.length; j++) {
        if (isWarmupRow(e.sets[j]) === warm && !e.sets[j].done) {
          if (v == null) delete e.sets[j][field]; else e.sets[j][field] = v
        }
      }
    }
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => { e.sets = appendSetForEntry(e).sets })
  const cycleSetRole = (idx, setIndex) => mutEntry(idx, e => { e.sets = cycleAmrapRole(e, setIndex).sets })
  const adjustAmrapTarget = (idx, setIndex, direction) => {
    useUI.getState().stopTimers()
    update(s => {
      const entry = s.active?.entries?.[idx]
      const set = entry?.sets?.[setIndex]
      if (!entry || !set || !isAmrapRoleEligibleSet(entry, setIndex)) return
      const role = amrapRoleForSet(entry, setIndex)
      if (role !== 'amrap' && role !== 'progression') return
      const mode = modeForSet(set, entry.target || entry)
      const current = amrapTargetForSet(entry, setIndex)
      const step = mode === 'time' ? 5 : 1
      set.amrapTarget = Math.max(1, Math.round(Number(current) || 1) + direction * step)
    }, true)
  }
  const saveAmrapTargetsToRoutine = () => {
    let saved = false
    update(s => {
      if (isProgrammeSession(s.active) || !s.active?.routineId) return
      const routine = s.routines.find(candidate => candidate.id === s.active.routineId)
      if (routine) saved = saveActiveAmrapTargetsToRoutine(s.active, routine)
    }, true)
    if (!saved) useUI.getState().toast(t('Could not save this edit to the routine.'))
  }
  const removeSet = idx => {
    update(s => {
      const entry = s.active?.entries?.[idx]
      const setIdx = entry && entry.sets.length ? entry.sets.length - 1 : -1
      recordProgrammeSetRemoval(s.active, idx, setIdx)
      removeActiveSet(s.active, idx, setIdx, () => {})
    }, true)
  }
  // Remove flow (owner req): always a confirmation screen; in a superset the confirmation
  // first asks WHICH exercise of the group to remove.
  const confirmRemoveExercise = idx => {
    const e = A.entries[idx]
    if (!e) return
    const hasDone = (e.sets || []).some(s => s.done)
    const doIt = () => {
      removeActiveExercise(idx)
      useUI.getState().stopWorkAndPrep()
    }
    confirmSheet({
      title: t('Remove {0}?', exOr(e.id).n),
      message: hasDone
        ? t('The sets you logged for this exercise in this session will be lost.')
        : t('This removes the exercise from your current session.'),
      confirmText: t('Remove'), danger: true, onConfirm: doIt
    })
  }
  const removeExerciseSheet = () => {
    if (unit.length > 1) {
      useUI.getState().openSheet(close => (
        <div>
          <h3>{t('Remove exercise')}</h3>
          <div className="muted small" style={{ marginBottom: 12 }}>{t('Which exercise in this superset do you want to remove?')}</div>
          <div className="list">
            {unit.map(idx => <div key={idx} className="item" onClick={() => { close(); confirmRemoveExercise(idx) }}>
              <div className="grow"><div className="tt">{exOr(A.entries[idx]?.id).n}</div></div>
              <Icon name="chevronRight" />
            </div>)}
          </div>
        </div>
      ))
    } else confirmRemoveExercise(cur)
  }
  const navigateExercise = nextCur => {
    if (!swipeAnimation.current.active) {
      swipeGesture.current = emptySwipeGesture()
      clearSwipeCard(swipeCardRef.current)
      clearSwipeCard(swipePeekRef.current)
      setSwipePeekUnitIdx(null)
    }
    update(s => {
      navigateActiveExercise(s.active, nextCur, () => {})
    })
  }
  swipeNavigation.current = { units, unitIdx, prevDisabled, nextDisabled, navigateExercise }
  // Direct DOM transforms avoid a React render for every touchmove. The one local render that
  // mounts a peek keeps the drag alive; any store/UI render abandons it so stale pixels and an
  // adjacent unit cannot survive a set update, rest start, or other workout state change.
  useEffect(() => {
    if (swipeAnimation.current.active) return
    swipeGesture.current = emptySwipeGesture()
    clearSwipeCard(swipeCardRef.current)
    clearSwipeCard(swipePeekRef.current)
    setSwipePeekUnitIdx(null)
  }, [S, workoutUI])
  useEffect(() => {
    const el = swipeAreaRef.current
    if (!el) return
    const resetGesture = () => { swipeGesture.current = emptySwipeGesture() }
    const resetPeek = () => {
      clearSwipeCard(swipePeekRef.current)
      setSwipePeekUnitIdx(null)
    }
    const resetCard = () => clearSwipeCard(swipeCardRef.current)
    const resetDrag = () => {
      resetCard()
      resetPeek()
      resetGesture()
    }
    const overlayOpen = () => (useUI.getState().sheets || []).length > 0
    const cancelScheduledWork = () => {
      swipeAnimation.current.cancelWait?.()
      swipeAnimation.current.cancelWait = null
    }
    const beginAnimation = () => {
      if (swipeAnimation.current.active) return false
      swipeAnimation.current.active = true
      setSwipeAnimating(true)
      return true
    }
    const finishAnimation = () => {
      cancelScheduledWork()
      resetCard()
      resetPeek()
      resetGesture()
      swipeAnimation.current.active = false
      setSwipeAnimating(false)
    }
    const waitForTransform = (card, done) => {
      let settled = false
      let timerId = null
      const cleanup = () => {
        card.removeEventListener('transitionend', onTransitionEnd)
        if (timerId != null) window.clearTimeout(timerId)
      }
      const cancel = () => {
        if (settled) return
        settled = true
        cleanup()
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        if (swipeAnimation.current.cancelWait === cancel) swipeAnimation.current.cancelWait = null
        done()
      }
      const onTransitionEnd = event => {
        if (event.target === card && (!event.propertyName || event.propertyName === 'transform')) finish()
      }
      swipeAnimation.current.cancelWait = cancel
      card.addEventListener('transitionend', onTransitionEnd)
      timerId = window.setTimeout(finish, SWIPE_ANIMATION_MS)
    }
    const springBack = direction => {
      const card = swipeCardRef.current
      const peek = swipePeekRef.current
      if (!card?.style.transform || !beginAnimation()) { resetCard(); resetPeek(); return }
      card.classList.add(SWIPE_TRANSITION_CLASS)
      card.style.transform = 'translate3d(0, 0, 0)'
      if (peek && direction) {
        peek.classList.add(SWIPE_TRANSITION_CLASS)
        peek.style.transform = sideBySideSwipeTransform(direction, 0)
      }
      waitForTransform(card, finishAnimation)
    }
    const slideToExercise = (decision, navigate) => {
      const card = swipeCardRef.current
      const peek = swipePeekRef.current
      if (!card || !peek || !beginAnimation()) { resetCard(); resetPeek(); return }
      const outgoing = decision === 'next' ? '-100%' : '100%'
      card.classList.add(SWIPE_TRANSITION_CLASS)
      peek.classList.add(SWIPE_TRANSITION_CLASS)
      card.style.transform = `translate3d(${outgoing}, 0, 0)`
      peek.style.transform = 'translate3d(0, 0, 0)'
      waitForTransform(card, () => {
        navigate()
        finishAnimation()
      })
    }
    const onTouchStart = event => {
      if (swipeAnimation.current.active) return
      if (overlayOpen() || event.touches.length !== 1) { resetDrag(); return }
      resetDrag()
      const touch = event.touches[0]
      swipeGesture.current = { startX: touch.clientX, startY: touch.clientY, dx: 0, dy: 0, offset: 0, claimed: false, direction: null }
    }
    const onTouchMove = event => {
      if (swipeAnimation.current.active) return
      const gesture = swipeGesture.current
      if (gesture.startX == null) return
      if (event.touches.length !== 1) { resetDrag(); return }
      if (overlayOpen()) { resetDrag(); return }
      const touch = event.touches[0]
      const dx = touch.clientX - gesture.startX
      const dy = touch.clientY - gesture.startY
      gesture.dx = dx
      gesture.dy = dy
      const navigation = swipeNavigation.current
      let peekCandidate = null
      let claimedNow = false
      if (!gesture.claimed) {
        const direction = swipeDecision(dx, dy, { threshold: SWIPE_DRAG_DEADZONE })
        if (!direction) return
        gesture.claimed = true
        gesture.direction = direction
        claimedNow = true
        const candidate = navigation
          ? navigation.unitIdx + (direction === 'next' ? 1 : -1)
          : -1
        peekCandidate = candidate >= 0 && candidate < (navigation?.units.length || 0) ? candidate : null
      }
      // Once horizontal intent wins, keep the gesture claimed so vertical scrolling cannot
      // restart halfway through the drag. Navigation is still decided only on release.
      event.preventDefault()
      const offset = resistedSwipeOffset(dx, {
        atStart: !navigation || navigation.prevDisabled,
        atEnd: !navigation || navigation.nextDisabled,
      })
      gesture.offset = offset
      // The adjacent layer must exist before this first move is painted (and before an
      // immediate touchend can start the synchronized transition).
      if (claimedNow) flushSync(() => setSwipePeekUnitIdx(peekCandidate))
      const card = swipeCardRef.current
      if (!card) return
      card.classList.remove(SWIPE_TRANSITION_CLASS)
      card.style.transform = `translate3d(${offset}px, 0, 0)`
      const peek = swipePeekRef.current
      if (peek && gesture.direction) {
        peek.classList.remove(SWIPE_TRANSITION_CLASS)
        peek.style.transform = sideBySideSwipeTransform(gesture.direction, offset)
      }
    }
    const release = allowNavigation => {
      if (swipeAnimation.current.active) return
      const gesture = swipeGesture.current
      const navigation = swipeNavigation.current
      const releaseDecision = allowNavigation && gesture.claimed ? swipeDecision(gesture.dx, gesture.dy) : null
      // The incoming layer is locked on the first horizontal claim. A full reversal settles
      // instead of navigating beneath a different card than the one the user can see.
      const decision = releaseDecision === gesture.direction ? releaseDecision : null
      const direction = gesture.direction
      resetGesture()
      let target = null
      if (decision === 'prev' && navigation && !navigation.prevDisabled) {
        target = navigation.units[navigation.unitIdx - 1]?.[0]
      } else if (decision === 'next' && navigation && !navigation.nextDisabled) {
        target = navigation.units[navigation.unitIdx + 1]?.[0]
      }
      if (target != null) {
        slideToExercise(decision, () => navigation.navigateExercise(target))
      } else {
        springBack(direction)
      }
    }
    const onTouchEnd = () => release(!overlayOpen())
    const onTouchCancel = () => release(false)
    const listenerOptions = { passive: false }
    el.addEventListener('touchstart', onTouchStart, listenerOptions)
    el.addEventListener('touchmove', onTouchMove, listenerOptions)
    el.addEventListener('touchend', onTouchEnd, listenerOptions)
    el.addEventListener('touchcancel', onTouchCancel, listenerOptions)
    return () => {
      el.removeEventListener('touchstart', onTouchStart, listenerOptions)
      el.removeEventListener('touchmove', onTouchMove, listenerOptions)
      el.removeEventListener('touchend', onTouchEnd, listenerOptions)
      el.removeEventListener('touchcancel', onTouchCancel, listenerOptions)
      cancelScheduledWork()
      resetCard()
      clearSwipeCard(swipePeekRef.current)
      swipeAnimation.current.active = false
    }
  }, [])
  const restForCompletedSet = (state, entryIdx, setIdx) => {
    const active = state
    const entry = active?.entries?.[entryIdx]
    const set = entry?.sets?.[setIdx]
    const root = useStore.getState().S
    if (!entry || !set) return Number(root.restSec) || 0
    const routine = active.routineContext || (root.routines || []).find(item => String(item.id) === String(active.routineId)) || {}
    return restSecondsFor(set, entry.target || entry, routine, root.restSec)
  }
  const addWarmup = idx => mutEntry(idx, e => {
    const firstWork = e.sets.findIndex(isWorkRow)
    const at = firstWork === -1 ? e.sets.length : firstWork
    const workSets = e.sets.filter(isWorkRow)
    const configured = Array.isArray(e.target?.warmup) ? e.target.warmup : []
    const existingWarmup = [...e.sets].reverse().find(isWarmupRow)
    const template = configured[configured.length - 1] || (existingWarmup
      ? {
          phase: 'warmup',
          mode: modeForSet(existingWarmup, e.target || e),
          ...(existingWarmup.sec != null ? { sec: existingWarmup.sec } : { reps: existingWarmup.r }),
          weightPrescription: { kind: 'fixed', weight: existingWarmup.w || 0 },
          ...(existingWarmup.restSec != null ? { restSec: existingWarmup.restSec } : {})
        }
      : (() => {
          const fallback = addSetForEntry(e)
          return {
            phase: 'warmup', mode: modeForSet(fallback, e.target || e),
            ...(fallback.sec != null ? { sec: fallback.sec } : { reps: fallback.r }),
            weightPrescription: { kind: 'fixed', weight: fallback.w || 0 }
          }
        })())
    const historyState = activeWorkoutHistoryState(S, S.active)
    const previous = activeWorkoutLoadReference(S, S.active, template, e.id, modeOf({ ...template, id: e.id }))
      || lastEntryFor(historyState, e.id, modeOf({ ...template, id: e.id }))
    const generated = prependWarmupSets({
      ...e.target,
      phases: ['warmup'],
      warmup: [{ ...template, phase: 'warmup' }]
    }, workSets, previous || [], e.target?.inc || defaultIncrement(e.id, activeUnit), {
      state: S, exerciseId: e.id, now: S.active?.start || Date.now(), unit: activeUnit
    })
      .find(isWarmupRow)
    const warm = generated || { ...template, phase: 'warmup', done: false }
    e.sets.splice(at, 0, warm)
    e.target = { ...(e.target || {}), warmup: warmupConfigForEntry(e).warmup }
  })
  const removeWarmup = idx => {
    const entry = A.entries[idx]
    const setIdx = entry?.sets?.findLastIndex(isWarmupRow) ?? -1
    if (setIdx < 0 || entry.sets.length <= 1) return
    useUI.getState().stopTimers()
    mutEntry(idx, e => {
      if (e.sets.length > 1) {
        e.sets.splice(setIdx, 1)
        e.target = { ...(e.target || {}), warmup: warmupConfigForEntry(e).warmup }
      }
    })
  }
  const openWorkSettings = idx => {
    const entry = useStore.getState().S.active?.entries?.[idx]
    if (!entry) return
    const exercise = exOr(entry.id)
    const effectivePolicy = effectiveAmrapPolicyForEntry(entry)
    const resolutionState = useStore.getState().S
    workConfigSheet(exercise, entry.target || entry, config => {
      useUI.getState().stopTimers()
      update(s => {
        const activeEntry = s.active?.entries?.[idx]
        if (!activeEntry) return
        const targetForLoad = mergeWorkConfigIntoTarget(activeEntry.target || {}, config)
        const previous = activeWorkoutLoadReference(s, s.active, targetForLoad, activeEntry.id,
          modeOf({ ...targetForLoad, id: activeEntry.id }))
        const increment = activeEntry.target?.inc > 0
          ? activeEntry.target.inc
          : defaultIncrement(activeEntry.id, activeUnit)
        const updated = applyWorkConfigToEntry(activeEntry, config, previous || [], increment, {
          state: activeWorkoutHistoryState(s, s.active), percentageState: s,
          exerciseId: activeEntry.id, now: s.active?.start || Date.now(), unit: activeUnit
        })
        activeEntry.target = updated.target
        activeEntry.plan = updated.plan
        activeEntry.sets = updated.sets
      }, true)
    }, effectivePolicy ? { prog: effectivePolicy, amrapMissPolicy: entry.target?.amrapMissPolicy } : undefined,
    { historyState: activeWorkoutHistoryState(resolutionState, resolutionState.active), percentageState: resolutionState,
      now: resolutionState.active?.start || Date.now() })
  }
  const openWarmupSettings = idx => {
    const entry = useStore.getState().S.active?.entries?.[idx]
    if (!entry) return
    const exercise = exOr(entry.id)
    const routine = A.routineContext || S.routines.find(r => r.id === A.routineId) || {}
    warmupConfigSheet(exercise, warmupConfigForEntry(entry), config => {
      useUI.getState().stopTimers()
      update(s => {
        const activeEntry = s.active?.entries?.[idx]
        if (!activeEntry) return
        const historyState = activeWorkoutHistoryState(s, s.active)
        const warmupTarget = theoreticalWarmupTarget(config)
        const previous = warmupTarget
          ? activeWorkoutLoadReference(s, s.active, warmupTarget, activeEntry.id, modeOf({ ...warmupTarget, id: activeEntry.id }))
          : lastEntryFor(historyState, activeEntry.id, modeOf({ ...(activeEntry.target || {}), id: activeEntry.id }))
        const increment = activeEntry.target?.inc > 0
          ? activeEntry.target.inc
          : defaultIncrement(activeEntry.id, activeUnit)
        const updated = applyWarmupConfigToEntry(activeEntry, config, previous || [], increment, {
          state: activeWorkoutHistoryState(s, s.active), percentageState: s,
          exerciseId: activeEntry.id, now: s.active?.start || Date.now(), unit: activeUnit
        })
        activeEntry.target = updated.target
        activeEntry.sets = updated.sets
      }, true)
    }, routine)
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    const workoutId = A.id
    const duration = timerDurationForSet(e, i)
    const routine = A.routineContext || S.routines.find(r => r.id === A.routineId) || {}
    const configured = routine?.ex?.find(x => x.id === e.id) || {}
    const prep = prepSecondsFor(e.sets[i], { ...configured, ...(e.target || {}) }, routine || {}, S.prepSec)
    useUI.getState().startWork(duration, exOr(e.id).n, elapsed => {
      const active = useStore.getState().S.active
      if (!canApplyTimedResult(active, workoutId, idx, i)) return
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      const current = useStore.getState().S.active
      if (canApplyTimedResult(current, workoutId, idx, i)) toggle(idx, i)
    }, prep)
  }

  const toggle = (idx, i) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    const isLastUnit = unitIdx >= units.length - 1
    // Any set toggle is a lifecycle boundary: a finished timed hold is a completed planned set,
    // so record it before invalidating timer callbacks. Its callback re-enters this function;
    // if it completed the exact unchecked row that was clicked, it has already handled the
    // transition and the outer invocation must not flip that row back off.
    const wasDone = A.entries[idx]?.sets?.[i]?.done
    if (useUI.getState().work?.done) {
      useUI.getState().logWorkPlanned()
      if (!wasDone && useStore.getState().S.active?.entries?.[idx]?.sets?.[i]?.done) return
    } else {
      useUI.getState().stopTimers()
    }
    let askTop = false, exJustDone = false, workoutDone = false, checked = false, isNewProgress = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      checked = e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (unitDone && isLastUnit) workoutDone = true      // last exercise's last set → done
        // Only reps training has a "working weight" worth confirming — a bodyweight plank
        // has nothing to put in that slider.
        if (e.sets.every(x => x.done)) { exJustDone = true; if (shouldConfirmWorkingWeight(e, m) && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    const fresh = useStore.getState().S.active
    if (fresh && checked && fresh.entries[idx]) {
      const progress = setProgressHighWater(fresh.entries[idx], progressHighWater.current[idx] || 0)
      progressHighWater.current[idx] = progress.highWater
      isNewProgress = progress.isNew
    }

    // Reps: topWeight first (it chains into the finish/continue prompt on the last unit).
    // Cardio/timed or already-confirmed: go straight to the prompt. These completion side effects
    // intentionally do not depend on the index-keyed navigation watermark.
    if (askTop) {
      if (S.endSummary === false) autoConfirmTopWeight(idx)
      else topWeightSheet(idx)
    } else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))

    // High-water progress suppresses duplicate navigation/progression, but rest is a repeatable
    // consequence of a checked transition. This lets uncheck/re-check restart the same countdown.
    if (fresh && checked && fresh.entries[idx]) {

      const freshUnits = supersetUnits(fresh.entries)
      const freshUnit = freshUnits.find(u => u.includes(idx))
      const freshUnitIdx = freshUnits.indexOf(freshUnit)
      const freshLastUnit = freshUnitIdx >= freshUnits.length - 1
      const freshUnitDone = freshUnit?.every(ui => fresh.entries[ui].sets.every(x => x.done))

      // A normal exercise deliberately stops any existing rest when it is finished, but it must
      // never enter the superset navigation/rest-start block (supersetUnits returns singletons).
      if (freshUnitDone) stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (!freshUnitDone) {
          startRest(restForCompletedSet(fresh, idx, i))
          return
        }
        if (!freshLastUnit) {
          const nextUnit = freshUnits[freshUnitIdx + 1] || []
          const nextHasUnfinishedWarmup = nextUnit.some(nextIdx =>
            fresh.entries[nextIdx]?.sets?.some(nextSet => isWarmupRow(nextSet) && !nextSet.done)
          )
          if (!nextHasUnfinishedWarmup) startRest(restForCompletedSet(fresh, idx, i))
        }
        return
      }

      const completedPhase = normalizePhase(fresh.entries[idx]?.sets?.[i]?.phase)
      const step = supersetFlowStep(fresh.entries, freshUnit, idx, i, completedPhase)
      if (!step) return
      if (step.unitDone) {
        if (!freshLastUnit) {
          const nextUnit = freshUnits[freshUnitIdx + 1]
          // The top-weight sheet's explicit "Just close" path owns the choice not to advance.
          if (isNewProgress && !askTop && nextUnit?.length) update(s => { if (s.active) s.active.cur = nextUnit[0] })
          startRest(restForCompletedSet(fresh, idx, i))
        }
      } else {
        if (isNewProgress && step.nextIdx != null) update(s => { if (s.active) s.active.cur = step.nextIdx })
        if (step.roundDone) startRest(restForCompletedSet(fresh, idx, i))
      }
    }
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  const interactiveExerciseProps = idx => ({
    onToggle: i => toggle(idx, i),
    onField: (i, f, v) => setField(idx, i, f, v),
    onAddSet: () => addSet(idx),
    onRemoveSet: () => removeSet(idx),
    onRemoveExercise: () => confirmRemoveExercise(idx),
    onAddWarmup: () => addWarmup(idx),
    onRemoveWarmup: () => removeWarmup(idx),
    onWarmupSettings: () => openWarmupSettings(idx),
    onWorkSettings: () => openWorkSettings(idx),
    onStartTimed: i => startTimed(idx, i),
    onCycleRole: i => cycleSetRole(idx, i),
    onAdjustAmrapTarget: (setIndex, direction) => adjustAmrapTarget(idx, setIndex, direction),
    setRowRef: (set, el) => {
      if (el) setRowRefs.current.set(set, el)
      else setRowRefs.current.delete(set)
    },
  })
  const renderUnit = (renderUnitIdx, interactive = false) => {
    const renderedUnit = units[renderUnitIdx] || []
    if (!renderedUnit.length) return null
    if (renderedUnit.length > 1) {
      const groupId = A.entries[renderedUnit[0]]?.sg
      const group = A.groupMeta?.[groupId]
      const onSaveToRoutine = !isProgrammeSession(A) && A.routineId && Array.isArray(A.routineEntryMap)
        ? () => {
          let saved = false
          update(s => {
            if (isProgrammeSession(s.active) || !s.active?.routineId) return
            const routine = s.routines.find(candidate => candidate.id === s.active.routineId)
            if (routine) saved = saveActiveOrderToRoutine(s.active, routine)
          })
          if (!saved) useUI.getState().toast(t('Could not save this edit to the routine.'))
          return saved
        }
        : undefined
      const openGroupSettings = () => activeGroupMetaSheet(groupId, { onSaveToRoutine })
      return <div className="ss-card">
        <div className="ss-hd ss-heading">
          <button type="button" className="ss-heading-button" onClick={openGroupSettings}><Icon name="link" />{group?.label || t(group?.kind === 'complex' ? 'Complex' : 'Superset')}</button>
          {interactive && <button type="button" className="iconbtn ss-heading-cog" aria-label={t('Edit group')} title={t('Edit group')} onClick={openGroupSettings}><Icon name="gear" /></button>}
        </div>
        {group?.cues && <div className="small dim" style={{ margin: '0 0 8px' }}><b>{t('Group cues')}:</b> {group.cues}</div>}
        {!group?.label && !group?.cues && <div className="small dim" style={{ margin: '0 0 8px' }}>{t('Superset · do these back-to-back, rest when done')}</div>}
        {renderedUnit.map((idx, k) => <div key={idx}
          ref={interactive ? el => {
            const entry = A.entries[idx]
            if (el) exRefs.current.set(entry, el)
            else exRefs.current.delete(entry)
          } : undefined}
          className="ss-ex" data-exidx={idx}>
          {k > 0 && <div className="ss-amp">+</div>}
          <ExerciseBlock entryIdx={idx} compact {...(interactive ? interactiveExerciseProps(idx) : {})} />
        </div>)}
      </div>
    }
    const entryIdx = renderedUnit[0]
    return <ExerciseBlock entryIdx={entryIdx} {...(interactive ? {
      ...interactiveExerciseProps(entryIdx),
      onPairPrev,
      onPairNext,
    } : {})} />
  }

  return <div className="narrow" ref={swipeAreaRef} data-testid="workout-swipe-area">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => {
        const programme = isProgrammeSession(A)
        const incomplete = programme && classifyWorkoutExit(A, 'default').outcome !== 'complete'
        if (incomplete) programmeExitSheet()
        else confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: discardWorkout })
      }}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub"><Elapsed start={A.start} /> · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" aria-label={t('Rest settings')} title={t('Rest settings')} onClick={restSettingsSheet}><Icon name="timer" /></button>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      <div className="workout-swipe-stack">
        {swipePeekUnitIdx != null && <div key={swipePeekUnitIdx}
          ref={swipePeekRef} className="workout-swipe-peek" data-testid="workout-exercise-peek"
          aria-hidden="true" inert style={{ pointerEvents: 'none' }}>
          {renderUnit(swipePeekUnitIdx)}
        </div>}
        <div key="current" ref={swipeCardRef} className="workout-swipe-card" data-testid="workout-exercise-slide">
          {renderUnit(unitIdx, true)}
        </div>
      </div>
      {canSaveAmrapTargets && <div className="row workout-amrap-save" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <Button size="xs" icon="copy" aria-label={t('Save routine')} onClick={saveAmrapTargetsToRoutine}>{t('Save routine')}</Button>
      </div>}
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{emptyWorkoutMessage(A.routineId)}
      {isProgrammeSession(A) && <div style={{ marginTop: 10 }}>
        <Button variant="danger" size="sm" onClick={() => { programmeExitSheet() }}>{t('Leave this session')}</Button>
      </div>}
    </div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <Button icon="chevronLeft" disabled={swipeAnimating || prevDisabled} onClick={() => navigateExercise(units[unitIdx - 1][0])}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={swipeAnimating || nextDisabled} onClick={() => navigateExercise(units[unitIdx + 1][0])}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    <Button onClick={() => exercisePicker(ex => {
      const routine = A.routineContext || S.routines.find(r => r.id === A.routineId) || {}
      const historyPolicy = activeWorkoutHistoryPolicy(A)
      const freestyle = historyPolicy !== 'global'
      // Active Repeat keeps its selected-source replay for existing rows, but explicit Add/configure
      // uses exact-compatible account history for setup, progression, LastPerformance, and e1RM.
      exConfigSheet(ex, null, cfg => update(s => {
        const full = { ...cfg, id: ex.id }
        const phaseConfig = { ...full, ...(routine?.phases ? { phases: routine.phases } : {}) }
        const hasWork = hasSelectedWorkPhase(phaseConfig)
        const currentHistory = activeWorkoutHistoryState(s, s.active)
        const mode = modeOf({ ...full, id: ex.id })
        const scopedPrevious = lastEntryFor(currentHistory, ex.id, mode)
        const previous = activeWorkoutLoadReference(s, s.active, full, ex.id, mode)
        const increment = full.inc > 0 ? full.inc : defaultIncrement(ex.id, activeUnit)
        const resolvedWeight = hasWork
          ? resolveTargetLoad(full, previous || [], increment,
            { state: currentHistory, percentageState: s, exerciseId: ex.id, now: s.active?.start || Date.now(), unit: activeUnit })
          : 0
        const percentage = hasWork && normalizeWeightPrescription(full, full.weight)?.kind === 'percentage'
        const resolved = percentage ? { ...full, weight: resolvedWeight, resolvedWeight } : { ...full }
        const plan = !freestyle && hasWork ? nextPrescription(s, resolved, routine) : { policy: 'off', kind: 'off' }
        const sessionCfg = sessionConfigFor({ ...resolved, ...(routine?.phases ? { phases: routine.phases } : {}) }, plan)
        const workSets = hasWork
          ? (freestyle ? buildSets(currentHistory, sessionCfg) : applyPrescription(buildSets(s, sessionCfg), sessionPlanFor(resolved, plan)))
          : []
        const insertAt = insertAfterCurrentUnit(s.active.entries, s.active.cur)
        const warmupTarget = theoreticalWarmupTarget(sessionCfg)
        const warmupPrevious = warmupTarget
          ? activeWorkoutLoadReference(s, s.active, warmupTarget, ex.id, modeOf({ ...warmupTarget, id: ex.id }))
          : scopedPrevious
        s.active.entries.splice(insertAt, 0, { id: ex.id, target: { ...sessionCfg }, plan, sets: prependWarmupSets(
          sessionCfg,
          workSets,
          warmupPrevious || [],
          increment,
          { state: currentHistory, percentageState: s, exerciseId: ex.id, now: s.active?.start || Date.now(), unit: activeUnit }
        ) })
        s.active.cur = insertAt
      }), null, routine, undefined, { useLastSetup: true, historyState: S, percentageState: S, now: A.start || Date.now() })
    })} icon="plus">{t('Add exercise')}</Button>
    {A.entries.length > 0 && <>
      <div style={{ height: 6 }} />
      <div className="row workout-direct-actions">
        <Button size="sm" icon="chevronUp" aria-label={t('Move up')} disabled={!!work || (A.entries[cur]?.sg ? cur === unit[0] : prevDisabled)} onClick={() => moveCurrentExercise(-1)}>{t('Move up')}</Button>
        <Button size="sm" trailingIcon="chevronDown" aria-label={t('Move down')} disabled={!!work || (A.entries[cur]?.sg ? cur === unit[unit.length - 1] : nextDisabled)} onClick={() => moveCurrentExercise(1)}>{t('Move down')}</Button>
        <Button size="sm" icon="pencil" aria-label={t('Swap exercise')} disabled={!!work} onClick={() => swapActiveWorkoutExercise(cur)}>{t('Swap exercise')}</Button>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Button size="sm" icon="minus" style={{ color: 'var(--red)' }} disabled={!!work} onClick={removeExerciseSheet}>{t('Remove exercise')}</Button>
      </div>
    </>}
    <div style={{ height: 10 }} />
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
