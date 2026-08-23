import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX, BODYPARTS, isCardio, isBodyweightEq, allExercises, equipmentOf, matchesExerciseSearch, searchScore, exOr } from './lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, uid, exCount, DAYN, MONTHS_LONG } from './lib/format.js'
import { lastEntryFor, lastSetupFor, bestWeightFor, buildSets, activeWorkoutHistoryState, effectiveRoutineId, effectiveRoutineIds, effectiveRoutines, completedRoutineIdsForDate, reconcileStartSessionChoice, resumableWeeklyWorkout, weeklySessionStatus, workoutVolume, volumeByPhase, setsByPhase, setsDone, setsDoneActive, lastBW, supersetUnits, unitOf, setLabel, fmtSec, defaultConfig, cleanupSg, modeOf, effortOf, isBw, isPerSide, sideReps } from './lib/history.js'
import { beep } from './lib/sound.js'
import { t, instrFor, getLang, INSTR_LANGS, dateLocale } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { starterRoutines } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import LastPerformance from './components/LastPerformance.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, Row, MultiSelectRow } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import BodyMap from './components/BodyMap.jsx'
import { loadOfWorkouts, MUSCLES, MUSCLE_NAME, matchesMuscleGroups, normalizeMuscleGroups, hasExplicitMuscleMetadata, exerciseMuscleSnapshot } from './lib/muscles.js'
import { parseImport, mergeImport } from './lib/import-csv.js'
import { mergeCustomExercises as applyCustomExerciseMerges, suggestMatches } from './lib/merge-customs.js'
import { parsePlan, buildPlanBundle, mergePlan, printPlan, preparePlanForDestination, planErrorMessage } from './lib/plan-share.js'
import { estimate1RM, best1RM, is1RMRecord, e1rmSeries, normalizePercentageSource, percentage1RMDetailsForExercise } from './lib/onerm.js'
import LineChart from './components/LineChart.jsx'
import { strengthExerciseRows } from './lib/strength-exercises.js'
import { nextPrescription, applyPrescription, policyFor, defaultIncrement, deloadTo, DEFAULT_SEC_INCREMENT, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS } from './lib/progression.js'
import { MOBILE, shareExport } from './lib/mobile.js'
import { prependWarmupSets, applyPersistedAmrapTargets, resolveTargetLoad, restSecondsFor, sessionConfigFor, sessionPlanFor, amrapResultFor, warmupDraftForEditor, hasSelectedWorkPhase, shouldConfirmWorkingWeight, workRowsForMode, bestFullSetWeight } from './lib/workout-runtime.js'
import { normalizePhase, normalizeWeightUnit, stampCompletedWorkout, historyUnitCompatible, historyUnitFor, historyUnitAmbiguous, cachedWeightFor, weightCacheEntry, isWarmupRow, isWorkRow } from './lib/workout-model.js'
import { classifyWorkoutExit, entriesForProgrammeExit, isProgrammeSession, occurrenceIdForEntry, partialExitBaseline } from './lib/partial.js'
import { buildProgrammeSkipDisposition, programmeInstanceMarker, programmeStartSurface, projectStateQueue, scheduleWriteContext } from './lib/programmes.js'
import { cuesForExercise } from './lib/annotations.js'
import { moveActiveGroupMember, reorderActiveWorkoutUnit, replaceOrInsertActiveExercise } from './lib/active-workout-editing.js'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cancelText || t('Cancel')}</Button>
  </div>
}
// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center' })
}

/* ============================ starter plan ============================ */
export function loadStarterPlan() {
  const [push, pull, legs] = starterRoutines()
  update(st => {
    st.routines.push(push, pull, legs)
    st.week[1] = push.id; st.week[3] = pull.id; st.week[5] = legs.id
  })
  toast(t('Starter plan loaded — Mon Push · Wed Pull · Fri Legs'))
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label="minus 0.1"><Icon name="minus" /></button>
      <div className="bw-read">{fmtNum(value)}<span className="u"> {unit}</span></div>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label="plus 0.1"><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, onChooseDifferent, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  const save = () => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    <h3>{required ? t('Quick check-in') : t('Log body weight')}</h3>
    <div className="muted small">{required ? t('Slide or tap to set your weight — tracked before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="reset" onClick={() => { close(); (onChooseDifferent || startSessionSheet)() }}>{t('Choose a different workout')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(b.d)} aria-label="delete"><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: opts.locked ?? !!opts.required })
  return h
}

/* ============================ repeat freestyle workout ============================ */
function RepeatFreestyleSheet({ workout, onStart, close }) {
  const count = (workout?.entries || []).length
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{t('Repeat workout')}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {(workout?.name || t('Freestyle')) + ' \u00b7 ' + t('{0} exercises', count)}
    </div>
    <button className="btn primary" onClick={() => { close(); onStart('progression') }}>{t('Progression (automatic)')}</button>
    <div style={{ height: 8 }} />
    <button className="btn" onClick={() => { close(); onStart('deload') }}>{t('Deload')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

export function repeatFreestyleSheet(S, w, onStart) {
  const count = (w?.entries || []).length
  if (!count) { toast(t('This session has no exercises — nothing to repeat')); return }
  if (historyUnitAmbiguous(w)) { toast(t('This workout has mixed or unknown weight units — nothing to repeat')); return }
  const recordedUnit = historyUnitFor(w)
  const sourceUnit = normalizeWeightUnit(w?.unit) || (recordedUnit === 'kg' || recordedUnit === 'lb' ? recordedUnit : null)
  const targetUnit = normalizeWeightUnit(S?.unit) || 'kg'
  if (!sourceUnit && !historyUnitCompatible(w, targetUnit)) {
    toast(t('This workout has mixed or unknown weight units — nothing to repeat'))
    return
  }
  if (sourceUnit && targetUnit && sourceUnit !== targetUnit) {
    toast(t('This workout is in {0}; repeating it in {1} is blocked to protect the logged weights.', sourceUnit, targetUnit))
    return
  }
  const invalid = w.entries.find(entry => !entry?.id || !EXIDX[entry.id])
  if (invalid) { toast(t('This session contains an exercise that is no longer available — nothing to repeat')); return }
  ui().openSheet(close => <RepeatFreestyleSheet workout={w} onStart={mode => {
    const source = {
      name: w?.name || t('Freestyle'),
      deload: mode === 'deload',
      unit: sourceUnit || targetUnit || 'kg',
      selectedWorkout: w,
      ex: (w.entries || []).map((e, index) => {
        const workRows = (e.sets || []).filter(isWorkRow)
        const first = workRows[0] || e.sets?.[0] || {}
        const target = { ...(e.target || {}) }
        const mode = target.mode || (first.mode === 'time' || first.sec != null
          ? 'time'
          : first.mode === 'cardio' || first.min != null || first.speed != null ? 'cardio' : modeOf({ id: e.id }))
        target.mode ??= mode
        target.sets ??= Math.max(1, workRows.length || e.sets?.length || 1)
        if (mode === 'time') target.sec ??= Number(first.sec) || 45
        if (mode === 'cardio') {
          target.min ??= Number(first.min) || 20
          target.speed ??= Number(first.speed) || 8
        }
        if (mode === 'reps') {
          target.reps ??= Number(first.r) || 10
          target.weight ??= Number(first.w) || 0
        } else if (mode === 'time') target.weight ??= Number(first.w) || 0
        return {
          ...target,
          id: e.id,
          occurrenceId: e.occurrenceId || `${e.id}#${index + 1}`,
          unit: sourceUnit || targetUnit || 'kg',
          selectedEntry: e
        }
      })
    }
    bwSheet({ required: true, locked: false, onDone: bw => onStart(source, bw) })
  }} close={close} />, { locked: false })
}

/* ============================ import from another app ============================ */
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
const UNKNOWN_WEIGHT_ROWS_MESSAGE = '{0} weighted rows omitted because their unit is unknown.'
const unknownWeightWarning = parsed => {
  const count = Number(parsed?.unknownWeightRows) || 0
  return count > 0 ? t(UNKNOWN_WEIGHT_ROWS_MESSAGE, count) : null
}

function ImportSummary({ parsed, close, raw }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(parsed)
  const [unit, setUnit] = useState(st.unit)
  // The file's own unit is rarely written anywhere - let the user state it, then
  // re-parse with that assumption so lb files convert correctly on import.
  const changeUnit = v => {
    setUnit(v)
    if (!raw) return
    try {
      const p = parseImport(raw, { unit: v })
      if (!p.error) setCur(p)
    } catch (e) { /* keep the current parse */ }
  }
  const isBW = cur.kind === 'bodyweight'
  const have = isBW
    ? cur.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
    : cur.workouts.filter(w => st.workouts.some(x => x.d === w.d)).length
  const fresh = (isBW ? cur.bodyweight.length : cur.workouts.length) - have

  const doImport = () => {
    let res
    update(s => { res = mergeImport(s, cur) })
    close()
    toast(isBW
      ? t('{0} weigh-ins imported', res.added)
      : t('{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
      <span className="small dim">{t('Weights in this file are in')}</span>
      <Segmented className="seg-inline" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
        value={unit} onChange={changeUnit} />
    </div>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {cur.from === cur.to ? fmtDate(cur.from, true) : fmtDate(cur.from, true) + ' – ' + fmtDate(cur.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'left' }}>
      {isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{cur.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{cur.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {parsed.mixedUnits ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit || 'kg/lb', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {unknownWeightWarning(parsed) && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {unknownWeightWarning(parsed)}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {!isBW && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {!isBW && cur.unmatchedNames.length > 0 && <>
      <h4 className="sec">{t('Not in the library — added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {cur.unmatchedNames.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {cur.unmatchedNames.length > 12 && <span className="mchip">+{cur.unmatchedNames.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file, onDone) {
  const rd = new FileReader()
  rd.onload = () => {
    let parsed
    try { parsed = parseImport(String(rd.result), { unit: S().unit }) }
    catch (e) { toast(t('Could not read that file')); return }
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }
    if (parsed.kind === 'bodyweight' ? !parsed.bodyweight.length : !parsed.workouts.length) {
      if (parsed.unknownWeightRows > 0) toast(unknownWeightWarning(parsed))
      else toast(t('Nothing to import from that file'))
      return
    }
    ui().openSheet(close => <ImportSummary parsed={parsed} raw={String(rd.result)} close={close} />)
    onDone && onDone()
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const series = e1rmSeries(st, ex.id)
  const latest = series.length ? series[series.length - 1] : null
  // Intensity-aware strength row for this exercise: retained % and expected current 1RM.
  const srow = (best ? strengthExerciseRows(st, Date.now()) : []).find(r => r.id === ex.id)
  const [w, setW] = useState(best ? best.w : (cachedWeightFor(st.exWeights?.[ex.id], st.unit) || 20))
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 4 }}>
      {t('Best historical:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    {latest && latest !== best && <div className="small" style={{ marginBottom: 4 }}>
      {t('Latest:')} <b>{fmtNum(latest.y)} {st.unit}</b>
      <span className="dim"> · {fmtDate(latest.d, true)}</span>
    </div>}
    {srow && <div className="small" style={{ marginBottom: 4 }}>
      {t('Adaptive')}: <b>{Math.round(srow.decay * 100)}%</b>
      <span className="dim"> · {t('current')} <b className="accent">{fmtNum(srow.current)} {st.unit}</b></span>
    </div>}
    {series.length >= 2 && <div className="chart" style={{ margin: '8px 0 10px' }}>
      <LineChart points={series.map(p => ({ t: p.t, y: p.y, d: p.d }))} h={110} unit={st.unit} color="var(--blue)" />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a positive weight and reps for a valid estimate.')
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

function PersonalCuesForm({ ex, close }) {
  const st = useStore(s => s.S)
  const [cues, setCues] = useState(() => cuesForExercise(st, ex.id))
  const save = () => {
    update(state => {
      state.exerciseAnnotations = state.exerciseAnnotations || {}
      state.exerciseAnnotations[ex.id] = { cues: cues.slice(0, 2000) }
    })
    close()
    toast(t('Saved'))
  }
  return <>
    <h3>{t('Personal cues')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Private reminders for this exercise. They stay with your account unless you explicitly include them when sharing a plan.')}</div>
    <textarea className="input" rows={5} maxLength={2000} aria-label={t('Personal cues')}
      placeholder={t('Personal cues (optional) — reminders that are specific to you')} value={cues} onChange={event => setCues(event.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

export const personalCuesSheet = ex => ui().openSheet(close => <PersonalCuesForm ex={ex} close={close} />)

function GroupMetaForm({ routineId, groupId, close }) {
  const st = useStore(s => s.S)
  const routine = st.routines.find(candidate => candidate.id === routineId)
  const meta = routine?.groupMeta?.[groupId] || {}
  const [kind, setKind] = useState(meta.kind === 'complex' ? 'complex' : 'superset')
  const [label, setLabel] = useState(meta.label || '')
  const [cues, setCues] = useState(meta.cues || '')
  if (!routine) return null
  return <>
    <h3>{t('Group cues')}</h3>
    <label className="small" htmlFor="group-kind">{t('Group kind')}</label>
    <select id="group-kind" className="input" value={kind} onChange={event => setKind(event.target.value)}>
      <option value="superset">{t('Superset')}</option><option value="complex">{t('Complex')}</option>
    </select>
    <input className="input" aria-label={t('Group label')} placeholder={t('Group label (optional)')} value={label} onChange={event => setLabel(event.target.value)} style={{ marginTop: 10 }} />
    <textarea className="input" rows={4} maxLength={2000} aria-label={t('Group cues')} placeholder={t('Group cues (optional) — instructions for this linked group')} value={cues} onChange={event => setCues(event.target.value)} style={{ marginTop: 10 }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => {
      update(state => {
        const target = state.routines.find(candidate => candidate.id === routineId)
        if (!target) return
        target.groupMeta = target.groupMeta || {}
        target.groupMeta[groupId] = { kind, ...(label.trim() ? { label: label.trim() } : {}), ...(cues ? { cues: cues.slice(0, 2000) } : {}) }
      })
      close()
    }}>{t('Save')}</Button>
  </>
}

export const groupMetaSheet = (routineId, groupId) => ui().openSheet(close => <GroupMetaForm routineId={routineId} groupId={groupId} close={close} />)

function ActiveGroupMetaForm({ groupId, onSaveToRoutine, close }) {
  const st = useStore(s => s.S)
  const active = st.active
  const meta = active?.groupMeta?.[groupId] || {}
  const [kind, setKind] = useState(meta.kind === 'complex' ? 'complex' : 'superset')
  const [label, setLabel] = useState(meta.label || '')
  const [cues, setCues] = useState(meta.cues || '')
  if (!active || !(active.entries || []).some(entry => entry?.sg === groupId)) return null
  const members = active.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry?.sg === groupId)
  const save = () => {
    update(state => {
      const target = state.active
      if (!target || !(target.entries || []).some(entry => entry?.sg === groupId)) return
      target.groupMeta = target.groupMeta || {}
      target.groupMeta[groupId] = { kind, ...(label.trim() ? { label: label.trim() } : {}), ...(cues ? { cues: cues.slice(0, 2000) } : {}) }
    })
  }
  return <>
    <h3>{t('Group cues')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Changes apply to this workout. Save to routine is explicit.')}</div>
    <label className="small" htmlFor="active-group-kind">{t('Group kind')}</label>
    <select id="active-group-kind" className="input" value={kind} onChange={event => setKind(event.target.value)}>
      <option value="superset">{t('Superset')}</option><option value="complex">{t('Complex')}</option>
    </select>
    <input className="input" aria-label={t('Group label')} placeholder={t('Group label (optional)')} value={label} onChange={event => setLabel(event.target.value)} style={{ marginTop: 10 }} />
    <textarea className="input" rows={4} maxLength={2000} aria-label={t('Group cues')} placeholder={t('Group cues (optional) — instructions for this linked group')} value={cues} onChange={event => setCues(event.target.value)} style={{ marginTop: 10 }} />
    <div className="list" style={{ marginTop: 10 }}>
      {members.map(({ entry, index }, memberIndex) => <div className="item" key={entry.occurrenceId || index}>
        <div className="grow"><div className="tt capitalize">{exOr(entry.id).n}</div></div>
        <button type="button" className="iconbtn" aria-label="Move group member up" disabled={memberIndex === 0} onClick={() => { ui().stopTimers(); update(state => moveActiveGroupMember(state.active, index, -1)) }}><Icon name="chevronUp" /></button>
        <button type="button" className="iconbtn" aria-label="Move group member down" disabled={memberIndex === members.length - 1} onClick={() => { ui().stopTimers(); update(state => moveActiveGroupMember(state.active, index, 1)) }}><Icon name="chevronDown" /></button>
      </div>)}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {onSaveToRoutine && <><div style={{ height: 8 }} /><Button variant="ghost" icon="copy" onClick={() => { save(); if (onSaveToRoutine()) close() }}>{t('Save routine')}</Button></>}
  </>
}

/** Active-only group editing; callers may opt into a separately guarded routine write. */
export const activeGroupMetaSheet = (groupId, { onSaveToRoutine } = {}) => ui().openSheet(close => <ActiveGroupMetaForm groupId={groupId} onSaveToRoutine={onSaveToRoutine} close={close} />)

function ActiveWorkoutEditor({ close }) {
  const st = useStore(s => s.S)
  const active = st.active
  if (!active?.entries?.length) return null
  const units = supersetUnits(active.entries)
  const moveUnit = (memberIndex, direction) => {
    ui().stopTimers()
    update(state => {
      const currentUnits = supersetUnits(state.active?.entries || [])
      const source = currentUnits.findIndex(unit => unit.includes(memberIndex))
      if (source >= 0) reorderActiveWorkoutUnit(state.active, memberIndex, source + direction)
    })
  }
  const moveMember = (index, direction) => {
    ui().stopTimers()
    update(state => { moveActiveGroupMember(state.active, index, direction) })
  }
  const swap = index => exercisePicker(ex => exConfigSheet(ex, null, cfg => {
    const fullConfig = { id: ex.id, ...cfg }
    const replacement = {
      id: ex.id,
      target: fullConfig,
      plan: { policy: 'off', kind: 'off' },
      sets: prependWarmupSets(fullConfig, buildSets({ ...S(), workouts: [] }, fullConfig), [], 0)
    }
    const current = S().active?.entries?.[index]
    const apply = inheritGroup => {
      ui().stopTimers()
      update(state => { replaceOrInsertActiveExercise(state.active, index, replacement, { inheritGroup }) })
    }
    if ((current?.sets || []).some(set => set.done === true)) {
      if (current.sg) {
        ui().openSheet(close => <>
          <h3>Swap exercise?</h3>
          <div className="muted small" style={{ marginBottom: 12 }}>Logged sets stay with the original exercise. Choose where the replacement belongs.</div>
          <Button variant="primary" onClick={() => { close(); apply(true) }}>Keep replacement in this group</Button>
          <div style={{ height: 8 }} /><Button variant="ghost" onClick={() => { close(); apply(false) }}>Insert after this group</Button>
        </>)
      } else confirmSheet({
        title: 'Swap exercise?',
        message: 'Logged sets stay with the original exercise. The replacement will be inserted afterward.',
        confirmText: t('Continue'),
        onConfirm: () => apply(false)
      })
    } else apply(false)
  }, null, active, undefined, { useLastSetup: true, historyState: activeWorkoutHistoryState(S(), active) }))
  return <>
    <h3>{t('Edit workout')}</h3>
    <div className="muted small" style={{ marginBottom: 4 }}>{t('Changes apply to this workout. Timers stop before the order changes.')}</div>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Edit workout lets you swap exercises and reorder groups.')}</div>
    <div className="list">
      {units.map((unit, unitIndex) => <div className="card" key={unit.map(index => active.entries[index]?.occurrenceId || index).join(':')} style={{ margin: 0, padding: 10 }}>
        {unit.map((index, memberIndex) => {
          const entry = active.entries[index]
          return <div key={entry.occurrenceId || index} className="row active-workout-editor-member" style={{ gap: 6, padding: memberIndex ? '8px 0 0' : 0, marginTop: memberIndex ? 8 : 0, borderTop: memberIndex ? '1px solid var(--sep)' : 0 }}>
            <div className="grow"><div className="tt capitalize">{exOr(entry.id).n}</div><div className="ss">{unit.length > 1 ? t('Grouped') : t('Exercise')}</div></div>
            {unit.length > 1 && <span className="active-workout-editor-actions">
              <Button size="xs" icon="chevronUp" aria-label={t('Move group member up')} disabled={memberIndex === 0} onClick={() => moveMember(index, -1)}>{t('Move up')}</Button>
              <Button size="xs" trailingIcon="chevronDown" aria-label={t('Move group member down')} disabled={memberIndex === unit.length - 1} onClick={() => moveMember(index, 1)}>{t('Move down')}</Button>
            </span>}
            <Button size="xs" icon="pencil" aria-label={t('Swap exercise')} onClick={() => swap(index)}>{t('Swap')}</Button>
          </div>
        })}
        <div className="row" style={{ marginTop: 8 }}>
          <Button size="sm" icon="chevronUp" disabled={unitIndex === 0} onClick={() => moveUnit(unit[0], -1)}>{t('Move up')}</Button>
          <Button size="sm" trailingIcon="chevronDown" disabled={unitIndex === units.length - 1} onClick={() => moveUnit(unit[0], 1)}>{t('Move down')}</Button>
        </div>
      </div>)}
    </div>
    <div style={{ height: 12 }} /><Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}

export const activeWorkoutEditSheet = () => ui().openSheet(close => <ActiveWorkoutEditor close={close} />)

/** Start the safe swap flow for one currently displayed active-workout exercise. */
export function swapActiveWorkoutExercise(index) {
  const active = S().active
  if (!active?.entries?.[index]) return
  exercisePicker(ex => exConfigSheet(ex, null, cfg => {
    const fullConfig = { id: ex.id, ...cfg }
    const replacement = {
      id: ex.id,
      target: fullConfig,
      plan: { policy: 'off', kind: 'off' },
      sets: prependWarmupSets(fullConfig, buildSets({ ...S(), workouts: [] }, fullConfig), [], 0)
    }
    const current = S().active?.entries?.[index]
    const apply = inheritGroup => {
      ui().stopTimers()
      update(state => { replaceOrInsertActiveExercise(state.active, index, replacement, { inheritGroup }) })
    }
    if ((current?.sets || []).some(set => set.done === true)) {
      if (current.sg) {
        ui().openSheet(close => <>
          <h3>{t('Swap exercise?')}</h3>
          <div className="muted small" style={{ marginBottom: 12 }}>{t('Logged sets stay with the original exercise. Choose where the replacement belongs.')}</div>
          <Button variant="primary" onClick={() => { close(); apply(true) }}>{t('Keep replacement in this group')}</Button>
          <div style={{ height: 8 }} /><Button variant="ghost" onClick={() => { close(); apply(false) }}>{t('Insert after this group')}</Button>
        </>)
      } else confirmSheet({
        title: t('Swap exercise?'),
        message: t('Logged sets stay with the original exercise. The replacement will be inserted afterward.'),
        confirmText: t('Continue'),
        onConfirm: () => apply(false)
      })
    } else apply(false)
  }, null, active, undefined, { useLastSetup: true, historyState: activeWorkoutHistoryState(S(), active) }))
}

export function ExerciseDetail({ ex, close, historyState = null }) {
  const st = useStore(s => s.S)
  const history = historyState || st
  const last = lastEntryFor(history, ex.id)
  const best = bestWeightFor(history, ex.id)
  return <>
    <h3 className="capitalize">{ex.n}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{t(ex.bp)}</span>
      {(ex.primaries?.length ? ex.primaries : (ex.tg ? [ex.tg] : [])).map((s, i) => <span key={i} className="tag"><Icon name="target" />{t(s)}</span>)}
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
      {(ex.secondaries?.length ? ex.secondaries : (ex.sm || [])).slice(0, 3).map((s, i) => <span key={i} className="tag">{t(s)}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {cuesForExercise(st, ex.id) && <div className="exnote"><b>{t('Personal cues')}</b><br />{cuesForExercise(st, ex.id)}</div>}
    <LastPerformance state={history} exerciseId={ex.id} mode={modeOf({ id: ex.id })} />
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    <Button variant="ghost" icon="pencil" style={{ marginTop: 8 }} onClick={() => { close(); personalCuesSheet(ex) }}>{t('Edit personal cues')}</Button>
    {ex.custom && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {!isCardio(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = (ex, options = {}) => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} historyState={options.historyState || null} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', ex.n, r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className="capitalize">{t('Add “{0}”', ex.n)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.filter(r => !r.draft).map(r => <div key={r.id} className="item" onClick={() => pick(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" onClick={() => pick('_new')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats), just without an animation.
function CustomExForm({ existing, prefill, onDone, close }) {
  const [n, setN] = useState(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState(existing ? existing.bp : '')
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const [cues, setCues] = useState(existing ? cuesForExercise(S(), existing.id) : '')
  const [primaries, setPrimaries] = useState(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...existing.primaries]
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.length ? [norm[0]] : []
  })
  const [secondaries, setSecondaries] = useState(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...(existing.secondaries || [])]
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.slice(1)
  })
  const togglePrimary = value => setPrimaries(current => current.includes(value) ? current.filter(m => m !== value) : [...current, value])
  const toggleSecondary = value => setSecondaries(current => current.includes(value) ? current.filter(m => m !== value) : [...current, value])
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    const dup = allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    const personalCues = cues.slice(0, 2000)
    const prim = [...primaries]
    const sm = secondaries.filter(m => !prim.includes(m))
    const groups = [...prim, ...sm]
    let id = existing && existing.id
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) {
      c.n = name; c.bp = bp; c.desc = d; c.tg = prim[0] || ''; c.sm = sm; c.muscleGroups = groups; c.primaries = prim; c.secondaries = sm
      s.exerciseAnnotations = s.exerciseAnnotations || {}; s.exerciseAnnotations[id] = { cues: personalCues }
    } })
    else {
      id = 'c' + uid()
      update(s => {
        (s.customEx = s.customEx || []).push({ id, n: name, bp, desc: d, tg: prim[0] || '', sm, muscleGroups: groups, primaries: prim, secondaries: sm, eq: 'custom', custom: true })
        s.exerciseAnnotations = s.exerciseAnnotations || {}; s.exerciseAnnotations[id] = { cues: personalCues }
      })
    }
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part — it behaves like any other exercise, just without an animation.')}</div>
    <input className="input" placeholder={t('Exercise name')} value={n} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    {bp && bp !== 'cardio' && <>
      <MultiSelectRow title={t('Primary muscle groups')} sheetTitle={t('Primary muscle groups')}
        values={primaries}
        options={MUSCLES.map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))}
        onToggle={togglePrimary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
      <MultiSelectRow title={t('Additional muscle groups')} sheetTitle={t('Additional muscle groups')}
        values={secondaries}
        options={MUSCLES.filter(m => !primaries.includes(m)).map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))}
        onToggle={toggleSecondary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
    </>}
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} aria-label={t('Description')}
      placeholder={t('Description (optional) — exercise setup and general technique')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <div style={{ height: 10 }} />
    <textarea className="input" rows={4} maxLength={2000} aria-label={t('Personal cues')}
      placeholder={t('Personal cues (optional) — reminders that are specific to you')}
      value={cues} onChange={e => setCues(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing, onDone, prefill) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

/* ======================== merge imported customs ======================== */
const KEEP_CUSTOM = '__keep_custom__'

function customEntryCounts(st) {
  const counts = {}
  ;(st.workouts || []).forEach(workout => (workout.entries || []).forEach(entry => {
    if (entry?.id) counts[entry.id] = (counts[entry.id] || 0) + 1
  }))
  return counts
}

function MergeChoice({ checked, label, subtitle, onChange }) {
  return <button type="button" className="lrow tap" role="radio" aria-checked={checked} onClick={onChange}>
    <span className={'chk' + (checked ? ' on' : '')} aria-hidden="true"><Icon name="check" /></span>
    <span className="lrow-m"><span className="lrow-t">{label}</span>{subtitle && <span className="lrow-s">{subtitle}</span>}</span>
  </button>
}

function CustomExerciseMergeSheet({ close }) {
  const st = useStore(s => s.S)
  const { replaceState } = useStore()
  const counts = customEntryCounts(st)
  const customs = [...(st.customEx || [])]
    .filter(Boolean)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || String(a.n || '').localeCompare(String(b.n || '')) || String(a.id).localeCompare(String(b.id)))
  const [choices, setChoices] = useState(() => Object.fromEntries(customs.map(ex => [ex.id, KEEP_CUSTOM])))
  const picked = customs.filter(ex => choices[ex.id] && choices[ex.id] !== KEEP_CUSTOM)

  const merge = () => {
    const mapping = Object.fromEntries(picked.map(ex => [ex.id, choices[ex.id]]))
    if (!Object.keys(mapping).length) return
    replaceState(applyCustomExerciseMerges(st, mapping), true)
    close()
    toast(t('{0} custom exercises merged', Object.keys(mapping).length))
  }

  return <>
    <h3>{t('Review custom exercises')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Choose a catalogue match for each imported exercise, or keep it as custom. Suggestions are ranked and never change dates.')}</div>
    {customs.length === 0
      ? <div className="empty">{t('No custom exercises to review')}</div>
      : <div style={{ display: 'grid', gap: 10 }}>
        {customs.map(ex => {
          const suggestions = suggestMatches(ex.n).slice(0, 3)
          const entryCount = counts[ex.id] || 0
          return <div className="card" key={ex.id} style={{ margin: 0, padding: 12 }}>
            <div className="row between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="tt capitalize">{ex.n}</div>
                <div className="ss">{entryCount ? t('{0} logged entries', entryCount) : t('No logged entries — kept here for review')}</div>
              </div>
              <span className="tag">{entryCount ? t('Used') : t('Unused')}</span>
            </div>
            <div role="radiogroup" aria-label={t('Catalogue choices for {0}', ex.n)}>
              {suggestions.map(id => {
                const catalogue = EXIDX[id]
                return <MergeChoice key={id} checked={choices[ex.id] === id} onChange={() => setChoices(current => ({ ...current, [ex.id]: id }))}
                  label={catalogue?.n || id} subtitle={catalogue ? t(catalogue.bp) + ' · ' + t(catalogue.eq) : null} />
              })}
              <MergeChoice checked={choices[ex.id] === KEEP_CUSTOM} onChange={() => setChoices(current => ({ ...current, [ex.id]: KEEP_CUSTOM }))}
                label={t('Keep as custom')} subtitle={suggestions.length ? t('Leave this exercise unchanged') : t('No close catalogue match')} />
            </div>
          </div>
        })}
      </div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={!picked.length} onClick={merge}>{t('Merge selected')}{picked.length ? ' · ' + picked.length : ''}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const mergeCustomExercisesSheet = () => ui().openSheet(close => <CustomExerciseMergeSheet close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        const snapshot = exerciseMuscleSnapshot(ex)
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        // Keep the historical name and weighted catalogue metadata before unregistering the
        // custom exercise. The stats layer then remains correct even after the catalogue entry
        // is gone.
        s.workouts.forEach(w => w.entries.forEach(e => {
          if (e.id !== ex.id) return
          Object.assign(e, snapshot)
        }))
        delete s.exWeights[ex.id]
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
function ExercisePicker({ onPick }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, else a body part
  const [muscle, setMuscle] = useState('')  // optional any-match muscle filter
  const [eq, setEq] = useState('')          // '' = any equipment
  const [shown, setShown] = useState(50)
  const all = allExercises(st)
  let base = all.filter(e =>
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    matchesMuscleGroups(e, muscle ? [muscle] : []) &&
    matchesExerciseSearch(e, q))
  if (q.trim()) base = [...base].sort((a, b) => searchScore(b, q) - searchScore(a, q) || (a.n < b.n ? -1 : 1))
  else if (bp === '★') base = [...base].sort((a, b) => (usage[b.id] - usage[a.id]) || (a.n < b.n ? -1 : 1))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const chosenCount = Object.keys(usage).length
  return <>
    <h3>{t('Add exercise')}</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <div className="chips" style={{ margin: eqOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(50) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setEq(''); setShown(50) }}>{t(b)}</button>)}
    </div>
    <SelectRow title={t('Muscle group')} sheetTitle={t('Muscle group')} value={muscle}
      onChange={v => { setMuscle(v); setEq(''); setShown(50) }}
      options={[{ value: '', label: t('Any muscle group') }, ...MUSCLES.map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))]} />
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    <div className="list">
      {bp !== '★' && <div className="item" onClick={() => customExSheet(null, ex => onPick(ex), q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(e => <div key={e.id} className="item" onClick={() => onPick(e)}>
        <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}<Icon name="plus" className="chev" />
      </div>)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing chosen yet — add exercises and they’ll show up here.')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
export const exercisePicker = onPick => ui().openSheet(() => <ExercisePicker onPick={onPick} />)

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
function ProgressionFields({ ex, mode, c, setC, routine, unit }) {
  const options = POLICIES_FOR[mode] || ['off']
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = c.inc > 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={v => setC(x => ({ ...x, prog: v || undefined }))}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {active !== 'off' && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} onChange={v => setC(x => ({ ...x, inc: v }))} />
      {active === 'double' && <Stepper label={t('Reps from')} value={c.repsMin || Math.max(1, (c.reps || 10) - 2)}
        step={1} decimal={false} onChange={v => setC(x => ({ ...x, repsMin: v }))} />}
    </div>}
    {active === 'greyskull' && mode === 'reps' && <div className="sect-b" style={{ marginBottom: 18 }}>
      <SelectRow title={t('AMRAP miss')} sheetTitle={t('AMRAP miss')} value={c.amrapMissPolicy || ''}
        onChange={v => setC(x => ({ ...x, amrapMissPolicy: v || undefined }))}
        options={[{ value: '', label: t('Follow routine ({0})', routine?.amrapMissPolicy === 'maintain' ? t('maintain') : t('10% deload')) },
          { value: 'deload', label: t('10% deload') }, { value: 'maintain', label: t('Maintain weight') }]} />
    </div>}
  </>
}

const warmupDraftOf = warmupDraftForEditor

function warmupRowsOf(base) {
  if (Array.isArray(base.warmup)) return base.warmup.map(row => warmupDraftOf(row, base))
  const count = Math.max(0, Math.round(Number(base.warmupSets || 0)))
  if (!count) return []
  const fallback = {
    mode: base.warmupMode,
    reps: base.warmupReps,
    sec: base.warmupSec,
    weight: base.warmupWeight,
    restSec: base.warmupRestSec,
    weightPrescription: base.warmupLoadMode === 'workset'
      ? { kind: 'workset_percent', percent: base.warmupLoadPercent, fallbackWeight: base.warmupFallbackWeight }
      : ['percentage', 'current_percentage'].includes(base.warmupLoadMode)
        ? { kind: 'percentage', source: normalizePercentageSource(base.warmupLoadSource), percent: base.warmupLoadPercent, fallbackWeight: base.warmupFallbackWeight }
        : { kind: 'fixed', weight: base.warmupWeight }
  }
  return Array.from({ length: count }, () => warmupDraftOf(fallback, fallback))
}

function warmupRowsFromEditor(rows = []) {
  return rows.map(row => {
    const rowMode = row.mode === 'time' ? 'time' : 'reps'
    const rowLoad = row.loadMode === 'workset'
      ? { kind: 'workset_percent', percent: Math.max(1, Math.min(200, Math.round(Number(row.loadPercent)) || 50)), fallbackWeight: Math.max(0, Number(row.loadFallback) || 0) }
      : row.loadMode === 'percentage'
        ? { kind: 'percentage', source: normalizePercentageSource(row.loadSource), percent: Math.max(1, Math.min(200, Math.round(Number(row.loadPercent)) || 50)), fallbackWeight: Math.max(0, Number(row.loadFallback) || 0) }
        : { kind: 'fixed', weight: Math.max(0, Number(row.weight) || 0) }
    const rest = row.restSec == null ? undefined : Math.max(0, Math.round(Number(row.restSec)) || 0)
    return {
      ...(row.phase ? { phase: normalizePhase(row.phase, 'warmup') } : {}),
      mode: rowMode,
      ...(rowMode === 'time' ? { sec: Math.max(1, Math.round(Number(row.sec)) || 30) } : { reps: Math.max(1, Math.round(Number(row.reps)) || 8) }),
      weightPrescription: rowLoad,
      ...(rest == null ? {} : { restSec: rest })
    }
  })
}

function applyAutomaticProgression(config, state, routine, exerciseId) {
  const source = { ...config, id: exerciseId }
  const plan = nextPrescription(state, source, routine)
  if (!plan || plan.kind === 'first' || plan.kind === 'off') return { ...config }
  const prescription = source.weightPrescription
  const out = { ...config }
  if (plan.weight != null && (!prescription || prescription.kind === 'fixed')) out.weight = plan.weight
  if (plan.reps != null) out.reps = plan.reps
  if (plan.sec != null) out.sec = plan.sec
  if (plan.sets != null) out.sets = plan.sets
  return out
}

function WarmupFields({ c, setC, mode, unit, phaseOnly = false }) {
  const warmupRows = c.warmupRows || []
  const patchWarmup = (index, patch) => setC(x => ({
    ...x,
    warmupRows: (x.warmupRows || []).map((row, i) => i === index ? { ...row, ...patch } : row)
  }))
  const addWarmup = () => setC(x => {
    const rows = x.warmupRows || []
    const previous = rows[rows.length - 1]
    const next = previous
      ? { ...previous, phase: '' }
      : warmupDraftOf({ mode: mode === 'time' ? 'time' : 'reps', reps: c.reps, sec: c.sec, weight: c.weight })
    return { ...x, warmupRows: [...rows, next] }
  })
  const removeWarmup = index => setC(x => ({ ...x, warmupRows: (x.warmupRows || []).filter((_, i) => i !== index) }))
  return <>
    {!phaseOnly && <h4 className="sec">{t('Warm-up')}</h4>}
    {warmupRows.map((row, index) => <div key={index} className="card" style={{ marginBottom: 10, padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <h5 style={{ margin: 0 }}>{t('Warm-up set {0}', index + 1)}</h5>
        <button className="iconbtn" aria-label={t('Remove warm-up set')} onClick={() => removeWarmup(index)}><Icon name="trash" /></button>
      </div>
      <SelectRow title={t('Phase')} sheetTitle={t('Phase')} value={row.phase || ''} onChange={v => patchWarmup(index, { phase: v })}
        options={[{ value: '', label: t('Automatic') }, { value: 'warmup', label: t('Warm-up') }, { value: 'work', label: t('Work') }]} />
      <SelectRow title={t('Mode')} sheetTitle={t('Mode')} value={row.mode} onChange={v => patchWarmup(index, { mode: v })}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
      <SelectRow title={t('Warm-up load')} sheetTitle={t('Warm-up load')} value={row.loadMode}
        onChange={v => patchWarmup(index, { loadMode: v })}
        options={[{ value: 'fixed', label: t('Fixed weight') }, { value: 'percentage', label: t('% of e1RM') }, { value: 'workset', label: t('% of work-set') }]} />
      {['percentage', 'workset'].includes(row.loadMode) ? <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Percent')} value={row.loadPercent || 50} step={5} decimal={false} onChange={v => patchWarmup(index, { loadPercent: v })} />
        <Stepper label={row.mode === 'time' ? t('Seconds') : t('Reps')} value={row.mode === 'time' ? row.sec : row.reps} step={row.mode === 'time' ? 5 : 1} decimal={false}
          onChange={v => patchWarmup(index, row.mode === 'time' ? { sec: v } : { reps: v })} />
      </div> : <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Weight ({0})', unit)} value={row.weight || 0} step={2.5} onChange={v => patchWarmup(index, { weight: v })} />
        <Stepper label={row.mode === 'time' ? t('Seconds') : t('Reps')} value={row.mode === 'time' ? row.sec : row.reps} step={row.mode === 'time' ? 5 : 1} decimal={false}
          onChange={v => patchWarmup(index, row.mode === 'time' ? { sec: v } : { reps: v })} />
      </div>}
      <Stepper label={t('Rest (s)')} value={row.restSec ?? c.warmupRestSec ?? 60} step={15} decimal={false} onChange={v => patchWarmup(index, { restSec: v })} />
    </div>)}
    <Button icon="plus" onClick={addWarmup}>{t('Add warm-up set')}</Button>
    <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Warm-up rest (s)')} value={c.warmupRestSec ?? 60} step={15} decimal={false} onChange={v => setC(x => ({ ...x, warmupRestSec: v }))} />
      <Stepper label={t('Work rest (s)')} value={c.workRestSec ?? 90} step={15} decimal={false} onChange={v => setC(x => ({ ...x, workRestSec: v }))} />
    </div>
  </>
}

function WorkPhaseFields({ c, setC, mode, unit, ex, routine, historyState = null, percentageState = null, now = null }) {
  const state = useStore(s => s.S)
  const sourceState = percentageState || historyState || state
  const resolutionNow = now == null ? Date.now() : now
  const sourceDetails = c.loadMode === 'percentage'
    ? percentage1RMDetailsForExercise(sourceState, ex.id, c.loadSource || 'adaptive', { now: resolutionNow })
    : null
  const sourceEstimate = sourceDetails?.estimate
  const sourceLabel = sourceDetails?.source === 'latest' ? 'Latest session' : 'Adaptive'
  const adaptiveInputs = sourceDetails?.source === 'adaptive'
    ? sourceDetails.sessions.map(session => fmtNum(session.est)).join(' · ')
    : null
  return <>
    <div className="row cfgrow" style={{ margin: '8px 0' }}>
      <Stepper label={t('Sets')} value={c.sets || 3} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
      <Stepper label={mode === 'time' ? t('Seconds') : t('Reps')} value={mode === 'time' ? (c.sec || 45) : (c.reps || 10)} step={mode === 'time' ? 5 : 1} decimal={false}
        onChange={v => setC(x => (mode === 'time' ? { ...x, sec: v } : { ...x, reps: v }))} />
    </div>
    <div className="sect-b" style={{ marginBottom: 10 }}>
      <SelectRow title={t('Target')} sheetTitle={t('Target')} value={c.kind === 'amrap' ? 'amrap' : 'fixed'}
        onChange={v => setC(x => ({ ...x, kind: v }))}
        options={[{ value: 'fixed', label: t('Fixed target') }, { value: 'amrap', label: t('AMRAP') }]} />
    </div>
    {c.kind === 'amrap' && <div className="row cfgrow" style={{ marginBottom: 12 }}>
      {mode === 'reps'
        ? <Stepper label={t('Minimum reps')} value={c.amrapMinReps || c.reps || 1} step={1} decimal={false} onChange={v => setC(x => ({ ...x, amrapMinReps: v }))} />
        : <Stepper label={t('Maximum duration (optional)')} value={c.amrapMaxSec || 0} step={5} decimal={false} onChange={v => setC(x => ({ ...x, amrapMaxSec: v }))} />}
    </div>}
    <SelectRow title={t('Work load')} sheetTitle={t('Work load')} value={c.loadMode || 'fixed'}
      onChange={v => setC(x => ({ ...x, loadMode: v }))}
      options={[{ value: 'fixed', label: t('Fixed weight') }, { value: 'percentage', label: t('% of e1RM') }]} />
    {c.loadMode === 'percentage' && <SelectRow title={t('1RM source')} sheetTitle={t('1RM source')} value={c.loadSource || 'adaptive'}
      onChange={v => setC(x => ({ ...x, loadSource: v }))}
      options={[{ value: 'adaptive', label: t('Adaptive') }, { value: 'latest', label: t('Latest session') }]} />}
    {sourceEstimate > 0 && c.loadMode === 'percentage' && <>
      <div className="small dim" role="note">{t('{0} e1RM {1} × {2}% → {3}', t(sourceLabel), fmtNum(sourceEstimate), c.loadPercent || 50, fmtNum(sourceEstimate * (c.loadPercent || 50) / 100))} {unit}</div>
      {sourceDetails?.source === 'adaptive' && <div className="small dim" role="note">{t('Median inputs')}: {adaptiveInputs} · {t('Latest session')}: {sourceDetails.latestDate || '—'} · {t('Retention')}: {Math.round(sourceDetails.retention * 100)}%</div>}
    </>}
    {c.loadMode === 'percentage' ? <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Percent')} value={c.loadPercent || 50} step={5} decimal={false} onChange={v => setC(x => ({ ...x, loadPercent: v }))} />
      <Stepper label={mode === 'time' ? t('Seconds') : t('Reps')} value={mode === 'time' ? (c.sec || 45) : (c.reps || 10)} step={mode === 'time' ? 5 : 1} decimal={false}
        onChange={v => setC(x => (mode === 'time' ? { ...x, sec: v } : { ...x, reps: v }))} />
    </div> : <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Weight ({0})', unit)} value={c.weight || 0} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      <Stepper label={mode === 'time' ? t('Seconds') : t('Reps')} value={mode === 'time' ? (c.sec || 45) : (c.reps || 10)} step={mode === 'time' ? 5 : 1} decimal={false}
        onChange={v => setC(x => (mode === 'time' ? { ...x, sec: v } : { ...x, reps: v }))} />
    </div>}
    <Stepper label={t('Work rest (s)')} value={c.restSec ?? 90} step={15} decimal={false} onChange={v => setC(x => ({ ...x, restSec: v }))} />
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <label className="field-label" htmlFor="ex-note">{t('Notes')}</label>
      <textarea id="ex-note" className="field" rows={2} placeholder={t('e.g. stretch during the rest period')}
        value={c.notes || ''} onChange={event => setC(x => ({ ...x, notes: event.target.value || undefined }))} />
    </div>
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={unit} />
  </>
}

function ExConfig({ ex, existing, onSave, onDelete, close, routine, initial, phaseOnly = false, useLastSetup = false, historyState = null, percentageState = null, resolutionNow = null }) {
  const st = useStore(s => s.S)
  const displayHistory = historyState || st
  const cardio = isCardio(ex.id)
  const defaultBase = initial || defaultConfig(ex.id)
  const automaticSetup = !existing && !phaseOnly
    ? lastSetupFor(displayHistory, ex.id, modeOf({ ...defaultBase, id: ex.id }))
    : null
  const automaticConfig = automaticSetup
    ? applyAutomaticProgression(automaticSetup.config, displayHistory, routine, ex.id)
    : null
  const [setupSourceActive, setSetupSourceActive] = useState(() => !!automaticSetup)
  const [c, setC] = useState(() => {
    const base = existing || (automaticConfig || defaultBase)
    const prescription = base.weightPrescription
    // New exercises (nothing configured yet) default their progression rule to the
    // user's choice in Settings -> Default progression, so the add flow lines up
    // with the app-wide default. Editing keeps whatever the exercise already has.
    const prog = (existing || initial) ? base.prog : (base.prog ?? st.defaultProg ?? undefined)
    return {
      ...base,
      prog,
      warmupRows: warmupRowsOf(base),
      ...(base.kind === 'amrap' ? { kind: 'amrap' } : {}),
      ...(base.kind === 'amrap' ? { amrapMinReps: base.amrapMinReps ?? base.minReps ?? base.reps } : {}),
      ...(base.kind === 'amrap' && base.mode === 'time' && base.amrapMaxSec == null && base.cap > 0 ? { amrapMaxSec: base.cap } : {}),
      ...(prescription?.kind === 'percentage' ? { loadMode: 'percentage', loadSource: normalizePercentageSource(prescription.source), loadPercent: prescription.percent, loadFallback: prescription.fallbackWeight } : {})
    }
  })
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const warmupRows = c.warmupRows || []
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  const greyskull = mode === 'reps' && policyFor({ ...c, id: ex.id }, routine, 'reps') === 'greyskull'
  // Greyskull defaults the final work row to AMRAP, but an explicit fixed target is a
  // deliberate override. This keeps the routine policy useful without making AMRAP mandatory.
  const effectiveAmrap = !cardio && (c.kind === 'amrap' || (c.kind == null && greyskull))
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id })
  const perSide = isPerSide(c)
  const percentageHistory = percentageState || st
  const percentageDetails = c.loadMode === 'percentage'
    ? percentage1RMDetailsForExercise(percentageHistory, ex.id, c.loadSource || 'adaptive', { now: resolutionNow ?? Date.now() })
    : null
  const reusableSetup = !existing && !phaseOnly ? lastSetupFor(displayHistory, ex.id, mode) : null
  const applyLastSetup = () => {
    if (!reusableSetup) return
    const config = reusableSetup.config
    setC({ ...defaultConfig(ex.id, config.mode), ...config, warmupRows: warmupRowsOf(config) })
    setSetupSourceActive(true)
  }
  const resetExerciseDefaults = () => {
    const base = defaultConfig(ex.id, mode)
    setC({ ...base, prog: st.defaultProg || undefined, warmupRows: warmupRowsOf(base) })
    setSetupSourceActive(false)
  }
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => ({ ...defaultConfig(ex.id, m), ...x, mode: m }))
  const save = () => {
    close()
    if (phaseOnly === 'work') {
      const progressionPolicy = policyFor({ ...c, id: ex.id }, routine, mode)
      const targetKind = c.kind === 'amrap' ? 'amrap' : 'fixed'
      const amrapMinimum = Math.max(1, Math.round(Number(c.amrapMinReps ?? c.minReps ?? c.reps) || 1))
      const load = c.loadMode === 'percentage'
        ? { kind: 'percentage', source: normalizePercentageSource(c.loadSource), percent: Math.max(1, Math.min(200, Math.round(Number(c.loadPercent)) || 50)), fallbackWeight: Math.max(0, Number(c.loadFallback) || 0) }
        : { kind: 'fixed', weight: Math.max(0, Number(c.weight) || 0) }
      onSave({
        loadMode: c.loadMode === 'percentage' ? 'percentage' : 'fixed',
        ...(c.loadMode === 'percentage' ? { loadSource: normalizePercentageSource(c.loadSource) } : {}),
        sets: Math.max(1, Math.round(c.sets) || 3),
        mode: mode === 'time' ? 'time' : 'reps',
        kind: targetKind,
        ...(targetKind === 'amrap' && mode === 'reps'
          ? { amrapMinReps: amrapMinimum }
          : targetKind === 'amrap' && c.amrapMaxSec > 0
            ? { amrapMaxSec: Math.max(1, Math.round(c.amrapMaxSec)) }
            : {}),
        ...(mode === 'time'
          ? { sec: Math.max(1, Math.round(c.sec) || 45), weight: load.weight ?? 0,
            ...(c.loadMode === 'percentage' ? { weightPrescription: load } : {}) }
          : { reps: Math.max(1, Math.round(c.reps) || 10), weight: load.weight, ...(c.loadMode === 'percentage' ? { weightPrescription: load } : {}) }),
        ...(c.restSec != null ? { restSec: Math.max(0, Math.round(c.restSec)) } : {}),
        notes: c.notes || undefined,
        prog: progressionPolicy,
        progressionPolicy,
        ...(c.inc > 0 ? { inc: c.inc } : {}),
        ...(c.amrapMissPolicy ? { amrapMissPolicy: c.amrapMissPolicy } : {}),
        ...(progressionPolicy === 'double'
          ? { repsMin: Math.min(Math.max(1, Math.round(c.reps) || 10), Math.max(1, Math.round(c.repsMin) || Math.max(1, (Math.round(c.reps) || 10) - 2))) }
          : {})
      })
      return
    }
    if (phaseOnly) {
      onSave({
        warmup: warmupRowsFromEditor(c.warmupRows || []),
        ...(c.warmupRestSec != null ? { warmupRestSec: Math.max(0, Math.round(c.warmupRestSec)) } : {}),
        ...(c.workRestSec != null ? { workRestSec: Math.max(0, Math.round(c.workRestSec)) } : {})
      })
      return
    }
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    if (c.amrapMissPolicy) prog.amrapMissPolicy = c.amrapMissPolicy
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps; `side` is not — it counts
    // reps, and a timed hold has none. Switching an exercise to Time therefore drops it
    // rather than carrying a flag nothing downstream can read.
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    const load = c.loadMode === 'percentage'
      ? { kind: 'percentage', source: normalizePercentageSource(c.loadSource), percent: Math.max(1, Math.min(200, Math.round(c.loadPercent) || 50)), fallbackWeight: Math.max(0, c.loadFallback || 0) }
      : { kind: 'fixed', weight: Math.max(0, c.weight || 0) }
    const warmup = warmupRows.length ? warmupRowsFromEditor(warmupRows) : undefined
    const amrapMinimum = Math.max(1, Math.round(Number(c.amrapMinReps ?? c.minReps ?? c.reps) || 1))
    const common = {
      ...(effectiveAmrap
        ? { kind: 'amrap', ...(mode === 'reps'
          ? { amrapMinReps: amrapMinimum }
          : (c.amrapMaxSec > 0 ? { amrapMaxSec: Math.max(1, Math.round(c.amrapMaxSec)) } : {})) }
        : c.kind === 'fixed' ? { kind: 'fixed' } : {}),
      ...(warmup ? { warmup } : {}),
      ...(c.warmupRestSec != null ? { warmupRestSec: Math.max(0, Math.round(c.warmupRestSec)) } : {}),
      ...(c.workRestSec != null ? { workRestSec: Math.max(0, Math.round(c.workRestSec)) } : {}),
      notes: c.notes || undefined
    }
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8), ...common })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), prepSec: Math.max(0, Math.round(c.prepSec ?? 5)), ...common, ...flags, ...(c.loadMode === 'percentage' ? { weightPrescription: load } : {}), ...prog })
    else {
      const reps = Math.max(1, Math.round(c.reps) || 10)
      const out = { sets, mode: 'reps', reps, weight: load.weight, ...(c.loadMode === 'percentage' ? { weightPrescription: load } : {}), ...common, ...flags, ...(perSide ? { side: true } : {}), ...prog }
      if (policyFor({ ...c, id: ex.id }, routine, 'reps') === 'double') out.repsMin = Math.min(reps, Math.max(1, Math.round(c.repsMin) || Math.max(1, reps - 2)))
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      onSave(out)
    }
  }
  if (phaseOnly === 'work') return <>
    <h3>{t('Work settings')}</h3>
    <WorkPhaseFields c={c} setC={setC} mode={mode} unit={st.unit} ex={ex} routine={routine}
      historyState={displayHistory} percentageState={percentageState || displayHistory} now={resolutionNow} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
  if (phaseOnly) return <>
    <h3>{t('Warm-up settings')}</h3>
    <WarmupFields c={c} setC={setC} mode={mode} unit={st.unit} phaseOnly />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
  return <>
    <h3 className="capitalize">{ex.n}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {cuesForExercise(st, ex.id) && <div className="exnote"><b>{t('Personal cues')}</b><br />{cuesForExercise(st, ex.id)}</div>}
    <LastPerformance state={displayHistory} exerciseId={ex.id} mode={mode} />
    {reusableSetup && <div className="sect-b" style={{ marginBottom: 14 }}>
      <div className="small dim" style={{ padding: '10px 12px 0' }}>{t(setupSourceActive ? 'Using setup from {0} · {1}' : 'Last setup: {0}', reusableSetup.date || reusableSetup.summary, t(POLICY_NAME[reusableSetup.config?.prog] || 'Progression'))}</div>
      {setupSourceActive
        ? <Button size="sm" icon="refresh" style={{ margin: 10 }} onClick={resetExerciseDefaults}>{t('Use exercise defaults')}</Button>
        : <Button size="sm" icon="copy" style={{ margin: 10 }} onClick={applyLastSetup}>{t('Use last setup')}</Button>}
    </div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label={t('Speed (km/h)')} value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </> : <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {mode === 'time' && <div className="row cfgrow" style={{ marginBottom: 12 }}>
      <Stepper label={t('Prep (s)')} value={c.prepSec ?? 5} step={1} decimal={false} onChange={v => setC(x => ({ ...x, prepSec: v }))} />
      <div className="small dim" style={{ alignSelf: 'center', lineHeight: 1.35 }}>{t('Countdown before the hold starts; 0 disables it.')}</div>
    </div>}
    {!cardio && <>
      <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Target')} sheetTitle={t('Target')} value={effectiveAmrap ? 'amrap' : 'fixed'}
          onChange={v => setC(x => ({ ...x, kind: v }))}
          options={[{ value: 'fixed', label: t('Fixed target') }, { value: 'amrap', label: t('AMRAP') }]} />
      </div>
      {effectiveAmrap && <>
        {greyskull && <div className="small dim" style={{ marginBottom: 10 }}>{t('Greyskull uses the final work set as AMRAP.')}</div>}
        {mode === 'reps'
          ? <div className="row cfgrow" style={{ marginBottom: 12 }}>
            <Stepper label={t('Minimum reps')} value={c.amrapMinReps || c.reps || 1} step={1} decimal={false} onChange={v => setC(x => ({ ...x, amrapMinReps: v }))} />
          </div>
          : <div className="row cfgrow" style={{ marginBottom: 12 }}>
            <Stepper label={t('Maximum duration (optional)')} value={c.amrapMaxSec || 0} step={5} decimal={false} onChange={v => setC(x => ({ ...x, amrapMaxSec: v }))} />
            <div className="small dim" style={{ alignSelf: 'center', lineHeight: 1.35 }}>{t('The configured seconds are the minimum hold; this optional duration applies only to the final work AMRAP.')}</div>
          </div>}
      </>}
      {mode !== 'time' && <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Load')} sheetTitle={t('Load')} value={c.loadMode === 'percentage' ? 'percentage' : 'fixed'}
          onChange={v => setC(x => ({ ...x, loadMode: v }))}
          options={[{ value: 'fixed', label: t('Fixed weight') }, { value: 'percentage', label: t('% of e1RM') }]} />
      </div>}
      {c.loadMode === 'percentage' && <SelectRow title={t('1RM source')} sheetTitle={t('1RM source')} value={c.loadSource || 'adaptive'}
        onChange={v => setC(x => ({ ...x, loadSource: v }))}
        options={[{ value: 'adaptive', label: t('Adaptive') }, { value: 'latest', label: t('Latest session') }]} />}
      {percentageDetails && <div className="small dim" role="note" style={{ margin: '4px 0 8px' }}>
        {t('{0} e1RM {1} × {2}% → {3}', t(percentageDetails.source === 'latest' ? 'Latest session' : 'Adaptive'), fmtNum(percentageDetails.estimate), c.loadPercent || 50, fmtNum(percentageDetails.estimate * (c.loadPercent || 50) / 100))} {st.unit}
        {percentageDetails.source === 'adaptive' && <><br />{t('Median inputs')}: {percentageDetails.sessions.map(session => fmtNum(session.est)).join(' · ')} · {t('Latest session')}: {percentageDetails.latestDate || '—'} · {t('Retention')}: {Math.round(percentageDetails.retention * 100)}%</>}
      </div>}
      {c.loadMode === 'percentage' && <div className="row cfgrow" style={{ marginBottom: 12 }}>
        <Stepper label={t('Percent')} value={c.loadPercent || 50} step={5} decimal={false} onChange={v => setC(x => ({ ...x, loadPercent: v }))} />
        <Stepper label={t('Fallback weight ({0})', st.unit)} value={c.loadFallback || 0} step={2.5} onChange={v => setC(x => ({ ...x, loadFallback: v }))} />
      </div>}
      <WarmupFields c={c} setC={setC} mode={mode} unit={st.unit} />
    </>}
    {cardio && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Work rest (s)')} value={c.workRestSec ?? 90} step={15} decimal={false} onChange={v => setC(x => ({ ...x, workRestSec: v }))} />
    </div>}
    {mode === 'time' && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <label className="field-label" htmlFor="ex-note">{t('Notes')}</label>
      <textarea id="ex-note" className="field" rows={2} placeholder={t('e.g. stretch during the rest period')}
        value={c.notes || ''} onChange={event => setC(x => ({ ...x, notes: event.target.value || undefined }))} />
    </div>
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? t('No weight to enter — just log the reps.') : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={v => setC(x => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode === 'reps' && <Row icon="shuffle" iconTint="var(--blue)" title={t('Reps per side')}
        subtitle={perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.')}>
        {/* Turning it on rounds the target up to an even number, since half of an odd
            total is a rep one side does not get. */}
        <Switch checked={perSide} onChange={v => setC(x => ({ ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }))} />
      </Row>}
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          onChange={v => setC(x => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        onChange={v => setC(x => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add to routine')}</Button>
    {ex.custom && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine, initial, options = {}) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} initial={initial} onSave={onSave} onDelete={onDelete} routine={routine} close={close} useLastSetup={options.useLastSetup === true} historyState={options.historyState || null} percentageState={options.percentageState || null} resolutionNow={options.now ?? null} />)

export const warmupConfigSheet = (ex, existing, onSave, routine) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} routine={routine} phaseOnly close={close} />)
export const workConfigSheet = (ex, existing, onSave, routine, options = {}) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} routine={routine} phaseOnly={'work'} close={close}
  historyState={options.historyState || null} percentageState={options.percentageState || null} resolutionNow={options.now ?? null} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const [includePersonalCues, setIncludePersonalCues] = useState(false)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const exportFile = async () => {
    const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '', { includePersonalCues })
    const json = JSON.stringify(bundle, null, 2)
    const name = 'opengym-plan-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } close(); return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    close(); toast(t('Plan file saved — send it to a friend'))
  }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try { const bundle = parsePlan(rd.result); close(); planImportSheet(bundle) }
      catch (e) { toast(t('Import failed: {0}', planErrorMessage(e))) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="upload" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend imports into their own openGym — routines only, none of your workouts or weigh-ins.')}</div>
    <div className="row between" style={{ padding: '10px 2px', marginTop: 8, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Include personal cues')}</div><div className="small dim">{t('Private exercise reminders are excluded unless you turn this on.')}</div></div>
      <Switch checked={includePersonalCues} onChange={setIncludePersonalCues} />
    </div>
    {!MOBILE && <>
      <div style={{ height: 12 }} />
      <Button variant="tinted" icon="download" onClick={() => { close(); printPlan(st, user?.name || '') }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
    </>}
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const st = useStore(s => s.S)
  const [schedule, setSchedule] = useState(false)
  const [importPersonalCues, setImportPersonalCues] = useState(false)
  let unitError = null
  try { preparePlanForDestination(bundle, st.unit) } catch (e) { unitError = planErrorMessage(e) }
  const apply = () => {
    try {
      update(s => mergePlan(s, bundle, { schedule, importPersonalCues }))
    } catch (e) {
      toast(t('Import failed: {0}', planErrorMessage(e)))
      return
    }
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + t(bundle.scheduledDays === 1 ? 'scheduled on {0} day' : 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {unitError
      ? <div className="small" style={{ color: 'var(--red)', marginBottom: 14, lineHeight: 1.4 }}>{unitError}</div>
      : bundle.unit && bundle.unit !== st.unit
        ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>{t('This plan is in {0}; weights will be converted to your profile’s {1}.', bundle.unit, st.unit)}</div>
        : !bundle.unit
          ? <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('This legacy plan does not declare a weight unit. Weighted values are accepted only when no conversion is needed.')}</div>
          : null}
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    {bundle.exerciseAnnotations && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Import personal cues')}</div><div className="small dim">{t('Replace your local cues for exercises included in this file.')}</div></div>
      <Switch checked={importPersonalCues} onChange={setImportPersonalCues} />
    </div>}
    <Button variant="primary" onClick={apply} disabled={!!unitError}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === st.week[wd])
  const hasOvr = Object.prototype.hasOwnProperty.call(st.dayPlan || {}, iso)
  const [selected, setSelected] = useState(() => effectiveRoutineIds(st, iso))
  const toggle = id => setSelected(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  const save = () => {
    update(s => { s.dayPlan[iso] = selected.length ? selected.slice() : ['rest'] })
    close()
    const names = selected.map(id => (st.routines.find(r => r.id === id) || {}).name).filter(Boolean)
    toast(selected.length ? t('{0} planned for {1}', names.join(', '), fmtDate(iso)) : t('{0} set to rest', fmtDate(iso)))
  }
  const backToWeekly = () => {
    update(s => { delete s.dayPlan[iso] })
    close()
    toast(t('Back to weekly plan'))
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{hasOvr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Pick one or more routines for this date. Tap a selected routine to remove it.')}</div>
    <Button size="sm" variant="tinted" icon="calendar" style={{ marginBottom: 10 }} onClick={() => { close(); dayAssignSheet(wd) }}>{t('Change the weekly plan for {0}', t(DAYN[wd]))}</Button>
    <div className="list">
      {st.routines.filter(r => !r.draft).map(r => <div key={r.id} className="item" onClick={() => toggle(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {selected.includes(r.id) && <span className="row" style={{ gap: 6 }}>
          <span style={{ background: 'var(--acc)', color: '#fff', borderRadius: 99, minWidth: 20, height: 20, padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{selected.indexOf(r.id) + 1}</span>
          <Icon name="check" className="accent" />
        </span>}</div>)}
      <div className="item" onClick={() => setSelected([])}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{!selected.length && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" onClick={backToWeekly}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={save}>{t('Save day plans')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

export function dayViewSheet(iso) {
  ui().openSheet(close => <DayView iso={iso} close={close} />)
}

function exNameFor(st, id) {
  return st.customEx?.find(x => String(x.id) === String(id))?.n || exOr(id).n
}

function tgtOf(cfg) {
  const t = cfg.target && typeof cfg.target === 'object' && Object.keys(cfg.target).length ? cfg.target : {}
  return Object.keys(t).length ? t : cfg
}

function lastLoggedWorkWeight(st, exerciseId) {
  for (let workoutIndex = (st.workouts || []).length - 1; workoutIndex >= 0; workoutIndex--) {
    const workout = st.workouts[workoutIndex]
    for (let entryIndex = (workout.entries || []).length - 1; entryIndex >= 0; entryIndex--) {
      const entry = workout.entries[entryIndex]
      if (String(entry?.id) !== String(exerciseId)) continue
      for (let setIndex = (entry.sets || []).length - 1; setIndex >= 0; setIndex--) {
        const set = entry.sets[setIndex]
        const warmup = set?.warmup === true || set?.phase === 'warmup'
        const weight = Number(set?.w ?? set?.weight)
        if (set?.done && !warmup && Number.isFinite(weight) && weight > 0) return weight
      }
    }
  }
  return 0
}

function plannedWeightFor(st, cfg) {
  const tgt = tgtOf(cfg)
  const rw = tgt.resolvedWeight
  if (rw) return rw
  if (tgt.weight) return tgt.weight
  return lastLoggedWorkWeight(st, cfg.id)
}

export function DayView({ iso, close }) {
  const st = useStore(s => s.S)
  const plans = effectiveRoutines(st, iso)
  const q = projectStateQueue(st, { now: Date.now() })
  const items = (q.items || []).filter(i => i.source === 'programme' && i.projectedDate === iso)
  const label = iso === todayISO() ? t('Today')
    : new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
  const freeWorkouts = (st.workouts || []).filter(w => w.d === iso && !w.routineId)
  const blocks = [
    ...plans.map(r => ({
      key: r.id, type: 'routine', routineId: r.id, name: r.name, emoji: r.emoji, colour: 'var(--acc)', ex: r.ex || [],
      resumeSession: { source: 'classic', routineId: r.id, calendarDate: iso },
      status: weeklySessionStatus(st, { source: 'classic', routineId: r.id, calendarDate: iso })
    })),
    ...items.map(item => {
      const snap = item.routineSnapshot
      const live = st.routines.find(r => String(r.id) === String(item.routineId))
      // The snapshot carries the cycle-specific targets; prefer it over a live routine
      // edited after the cycle started (live is only a fallback for old programme records).
      const routine = Array.isArray(snap?.ex) ? snap : (live || snap)
      return {
        key: item.instanceId, type: 'programme', routineId: routine?.id || item.routineId,
        name: routine?.name || programmeLabelForItem(st, item), emoji: routine?.emoji,
        colour: 'var(--surface-3)', ex: (routine?.ex || snap?.ex || []),
        resumeSession: { source: 'programme', routineId: item.routineId, instanceId: item.instanceId, calendarDate: item.nominalDate },
        status: weeklySessionStatus(st, {
          source: 'programme', routineId: item.routineId, instanceId: item.instanceId,
          calendarDate: item.nominalDate, status: item.status
        })
      }
    }),
    ...freeWorkouts.map(w => ({ key: w.id, type: 'freestyle', workout: w, name: w.name || t('Freestyle'), emoji: null, colour: 'var(--surface-2)', ex: (w.entries || []).map(e => ({ id: e.id, target: e.target || {} })) })),
  ]
  const unit = st.unit || 'kg'
  const rows = blocks.flatMap(b => b.ex.map(cfg => {
    const tgt = tgtOf(cfg)
    const sets = tgt.sets || 1
    const timed = tgt.mode === 'time' || tgt.sec
    const weight = timed ? null : plannedWeightFor(st, cfg)
    return { name: exNameFor(st, cfg.id), sets, reps: timed ? null : (tgt.reps ?? ''), sec: timed ? (tgt.sec || tgt.time || 0) : null, weight, vol: (weight && tgt.reps ? sets * tgt.reps * weight : 0) }
  }))
  const totalSets = rows.reduce((a, r) => a + (r.sets || 0), 0)
  const totalVol = rows.reduce((a, r) => a + (r.vol || 0), 0)
  if (!blocks.length) return <>
    <h3>{label}</h3>
    <div className="muted" style={{ padding: '14px 4px' }}>{t('Rest day \u2014 no sessions scheduled.')}</div>
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
  return <>
    <h3>{label}</h3>
    <div className="small muted" style={{ marginBottom: 10 }}>{[exCount(rows.length), `${totalSets} ${t('sets')}`, totalVol ? fmtVol(totalVol, unit) : null].filter(Boolean).join(' \u00b7 ')}</div>
    <div className="list">
      {blocks.map(b => (
        <div key={b.key} className="item" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={b.type === 'freestyle'
          ? () => (close(), workoutDetailSheet(b.workout))
          : b.status === 'resume'
            ? () => (close(), resumeWeeklySession(b.resumeSession))
            : () => (close(), nav('/plan/r/' + b.routineId))}>
          <span className="lrow-i" style={{ background: b.colour }}><Icon name={b.emoji ? glyphOf(b.emoji) : 'sparkles'} /></span>
          <div className="grow">
            <div className="tt">{b.name}</div>
            {b.ex.map((cfg, i) => {
              const tgt = tgtOf(cfg)
              const timed = tgt.mode === 'time' || tgt.sec
              const weight = timed ? null : plannedWeightFor(st, cfg)
              const t = timed
                ? `${tgt.sets || 1} \u00d7 ${tgt.sec || tgt.time || 0}s`
                : `${tgt.sets || 1} \u00d7 ${tgt.reps ?? ''}${weight ? ' @ ' + fmtNum(weight) + ' ' + unit : ''}`
              return (
                <div key={i} className="small muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{exNameFor(st, cfg.id)}</span><span>{t}</span>
                </div>
              )
            })}
            {!b.ex.length && <div className="small muted">{t('No exercises')}</div>}
          </div>
          {b.status && b.status !== 'start' && <span className="tag">{t(b.status === 'resume' ? 'Resume' : b.status === 'incomplete' ? 'Incomplete' : b.status === 'done' ? 'Done' : b.status)}</span>}
          <Icon name="chevronRight" className="muted" />
        </div>
      ))}
    </div>
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

function DayAssign({ day, close }) {
  const st = useStore(s => s.S)
  const set = v => { update(s => { if (v) s.week[day] = v; else delete s.week[day] }); close() }
  return <>
    <h3>{t(DAYN[day])}</h3>
    <div className="list">
      <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div>{!st.week[day] && <Icon name="check" className="accent" />}</div>
      {st.routines.filter(r => !r.draft).map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {st.week[day] === r.id && <Icon name="check" className="accent" />}</div>)}
    </div>
  </>
}
export const dayAssignSheet = day => ui().openSheet(close => <DayAssign day={day} close={close} />)

export function routineDraftFromWorkout(workout) {
  const exercises = (workout?.entries || []).map(entry => {
    const target = entry?.target || {}
    const done = (entry?.sets || []).filter(set => set.done)
    const mode = modeOf({ ...target, id: entry.id })
    const source = mode === 'time'
      ? { sets: done.length || target.sets || 1, sec: Number(target.sec || done.at(-1)?.sec || 45) }
      : mode === 'cardio'
        ? { sets: done.length || target.sets || 1, min: Number(target.min || done.at(-1)?.min || 20), speed: Number(target.speed || done.at(-1)?.speed || 8) }
        : { sets: done.length || target.sets || 1, reps: Number(target.reps || done.at(-1)?.r || 10), weight: Number(target.weight || done.at(-1)?.w || 0) }
    return { id: entry.id, mode, ...source, ...(target.notes ? { notes: target.notes } : {}) }
  }).filter(entry => entry.id)
  return { id: uid(), name: workout?.name || t('Freestyle'), emoji: DEFAULT_GLYPH, ex: exercises, ...(workout?.groupMeta ? { groupMeta: cloneJson(workout.groupMeta) } : {}), draft: true }
}

/* ============================ workout detail ============================ */
function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  const isFreestyle = !w.routineId
  const editAsRoutine = () => {
    const draft = routineDraftFromWorkout(w)
    update(s => { s.routines = [...(s.routines || []), draft] })
    close()
    nav('/plan/r/' + draft.id)
  }
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(workoutVolume(w, st.unit), st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? ex.n : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.some(s => s.done) ? ['warmup', 'work'].map(phase => {
            const phaseSets = e.sets.filter(s => s.done && (isWarmupRow(s) ? 'warmup' : 'work') === phase)
            return phaseSets.length ? <span key={phase} className="phase-summary"><b>{t(phase === 'warmup' ? 'Warm-up' : 'Work')}:</b> {phaseSets.map(s => setLabel(e.id, s, e.target)).join(' · ')}</span> : null
          }) : t('no sets')}</div>
          {(() => {
            const result = amrapResultFor(e)
            if (!result) return null
            const actual = result.mode === 'time' ? fmtSec(result.actual) : fmtNum(result.actual)
            const unit = result.mode === 'time' ? t('Seconds') : t('Reps')
            return <div className="small accent" style={{ marginTop: 3 }}>{t('AMRAP')}: {actual} {unit}{result.target ? ' · ≥ ' + result.target + ' ' + unit : ''}</div>
          })()}
        </div>
      </div>
    })}
    {isFreestyle && <Button variant="tinted" icon="edit" onClick={editAsRoutine}>{t('Edit as routine')}</Button>}
    {isFreestyle && <div style={{ height: 8 }} />}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.filter(w => historyUnitCompatible(w, st.unit)).forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => historyUnitCompatible(w, st.unit) && w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + workoutVolume(w, st.unit), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], effId = effectiveRoutineId(st, iso), ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && effId ? 'ovr' : effId ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(workoutVolume(w, st.unit), st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ active-workout rest settings ============================ */
function RestSettings({ close }) {
  const st = useStore(s => s.S)
  const active = st.active
  if (!active) return <div className="empty">{t('No active workout')}</div>
  const routine = active.routineContext || st.routines.find(r => r.id === active.routineId) || {}
  const phases = [
    { key: 'warmup', field: 'warmupRestSec', label: t('Warm-up') },
    { key: 'work', field: 'workRestSec', label: t('Work') }
  ].filter(phase => active.entries.some(e => e.sets.some(s => (isWarmupRow(s) ? 'warmup' : 'work') === phase.key)))
  const phaseValue = phase => {
    const entry = active.entries.find(e => e.sets.some(s => (isWarmupRow(s) ? 'warmup' : 'work') === phase.key))
    return entry?.target?.[phase.field] ?? routine[phase.field] ?? st.restSec
  }
  const setPhase = (phase, value) => update(s => {
    const n = Number(value)
    const seconds = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
    s.active.entries.forEach(e => {
      if (!e.sets.some(set => (isWarmupRow(set) ? 'warmup' : 'work') === phase.key)) return
      e.target = { ...(e.target || {}), [phase.field]: seconds }
    })
  })
  const resetPhase = phase => update(s => {
    s.active.entries.forEach(e => { if (e.target) delete e.target[phase.field] })
  })
  const setOverride = (entryIdx, setIdx, value) => update(s => {
    const n = Number(value)
    s.active.entries[entryIdx].sets[setIdx].restSec = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
  })
  const resetOverride = (entryIdx, setIdx) => update(s => { delete s.active.entries[entryIdx].sets[setIdx].restSec })
  return <>
    <h3>{t('Rest settings')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Set phase defaults for this workout, or override an individual set. Changes apply immediately.')}</div>
    <h4 className="sec">{t('Phase defaults')}</h4>
    <div className="list" style={{ marginBottom: 16 }}>
      {phases.map(phase => {
        const inherited = !active.entries.some(e => e.target?.[phase.field] != null)
        return <div key={phase.key} className="item" style={{ alignItems: 'flex-end' }}>
          <div className="grow"><div className="tt">{phase.label}</div><div className="ss">{inherited ? t('Inherited from routine or global setting') : t('Active workout override')}</div></div>
          <Stepper label={t('Seconds')} value={phaseValue(phase)} step={15} decimal={false} onChange={v => setPhase(phase, v)} />
          {!inherited && <Button size="sm" icon="reset" onClick={() => resetPhase(phase)} aria-label={t('Reset')} />}
        </div>
      })}
    </div>
    <h4 className="sec">{t('Individual sets')}</h4>
    <div className="list">
      {active.entries.map((entry, entryIdx) => <div key={entryIdx} className="card" style={{ margin: 0 }}>
        <div className="tt capitalize" style={{ marginBottom: 8 }}>{exOr(entry.id).n}</div>
        {entry.sets.map((set, setIdx) => {
          const phase = isWarmupRow(set) ? 'warmup' : 'work'
          const resolved = restSecondsFor(set, entry.target || {}, routine, st.restSec)
          return <div key={setIdx} className="row between" style={{ padding: '7px 0', borderTop: setIdx ? '1px solid var(--sep)' : 0, alignItems: 'flex-end', gap: 8 }}>
            <div className="grow"><div className="tt" style={{ fontSize: 14 }}>{t('Set {0}', setIdx + 1)} · {t(phase === 'warmup' ? 'Warm-up' : 'Work')}</div><div className="ss">{set.restSec != null ? t('Set override') : t('Inherited: {0}s', resolved)}</div></div>
            <Stepper label={t('Seconds')} value={set.restSec ?? resolved} step={15} decimal={false} onChange={v => setOverride(entryIdx, setIdx, v)} />
            {set.restSec != null && <Button size="sm" icon="reset" onClick={() => resetOverride(entryIdx, setIdx)} aria-label={t('Reset')} />}
          </div>
        })}
      </div>)}
    </div>
    <div style={{ height: 12 }} /><Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
export const restSettingsSheet = () => ui().openSheet(close => <RestSettings close={close} />)

/* ============================ workout lifecycle ============================ */
// Session picker for days with multiple planned sessions (owner flow: small planner-style
// buttons side by side, first uncompleted auto-selected, completed sessions ticked + greyed).
// A sheet on purpose: swipe down to dismiss.
export { reconcileStartSessionChoice }

export function StartSessions({ close, iso = todayISO() }) {
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
  const todayPlans = effectiveRoutines(S, iso)
  const planStatuses = new Map(todayPlans.map(r => [r.id, weeklySessionStatus(S, {
    source: 'classic', routineId: r.id, calendarDate: iso
  })]))
  const unavailableToday = new Set(todayPlans
    .filter(r => planStatuses.get(r.id) !== 'start')
    .map(r => r.id))
  const planKey = todayPlans.map(r => r.id).join('\u0000')
  const doneKey = [...unavailableToday].sort().join('\u0000')
  const [chosen, setChosen] = useState(() => reconcileStartSessionChoice(todayPlans, unavailableToday, null))
  useEffect(() => {
    setChosen(current => reconcileStartSessionChoice(todayPlans, unavailableToday, current))
  }, [planKey, doneKey])
  const selected = todayPlans.find(r => r.id === chosen && planStatuses.get(r.id) === 'start') || null
  const others = S.routines.filter(r => !r.draft && !todayPlans.some(p => p.id === r.id))
  const go = id => { close(); startFlow(id, null, { calendarDate: iso }) }
  const resume = id => { close(); resumeWeeklySession({ source: 'classic', routineId: id, calendarDate: iso }) }
  const goQueue = () => {
    close()
    if (queueStatus === 'resume') resumeWeeklySession(queueSession)
    else startFlow(queueHead.routineId, queueHead.source === 'programme' ? queueHead : null, { calendarDate: iso })
  }
  return <>
    <h3>{t('Start workout')}</h3>
    {showQueuedSession && <div className="card" style={{ borderColor: queueBlocked ? 'var(--orange)' : 'var(--acc)' }}>
      <h4 className={queueBlocked ? 'warn' : 'accent'}>{t('Queued session')}</h4>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div><div className="big">{queueName}</div><div className="muted small">{exCount(queueRoutine.ex?.length || 0)}</div></div>
        <span className="lrow-i"><Icon name={glyphOf(queueRoutine.emoji)} /></span>
      </div>
      {queueBlocked
        ? <div className="muted small">{queueGuardUntil
          ? t('Available after {0}', new Date(queueGuardUntil).toLocaleString(dateLocale()))
          : t('Continue next time')}</div>
        : <Button variant="primary" icon="play" style={{ width: '100%' }} onClick={goQueue}>{queueStatus === 'resume' ? t('Resume') : t('Start {0}', queueName)}</Button>}
    </div>}
    <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {todayPlans.map(r => {
          const status = planStatuses.get(r.id)
          const unavailable = status !== 'start' && status !== 'resume'
          const on = !unavailable && r.id === chosen
          return <button key={r.id} disabled={unavailable} onClick={() => status === 'resume' ? resume(r.id) : setChosen(r.id)}
            className={'tag' + (on ? ' acc' : '')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', opacity: unavailable ? .5 : 1, padding: '7px 11px' }}>
            <Icon name={glyphOf(r.emoji)} /> {r.name} {status === 'resume' ? t('Resume') : status === 'incomplete' ? t('Incomplete') : unavailable && <Icon name="check" className="accent" />}
          </button>
        })}
      </div>
      {selected
        ? <Button variant="primary" icon="play" style={{ width: '100%' }} onClick={() => go(selected.id)}>{t('Start {0}', selected.name)}</Button>
        : <div className="muted small" style={{ marginBottom: 10 }}>{t('Every planned session is done today - pick another routine or go freestyle.')}</div>}
      {others.length > 0 && <>
        <h4 className="sec">{t('Other routines')}</h4>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {others.map(r => <button key={r.id} onClick={() => go(r.id)}
            className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '7px 11px' }}>
            <Icon name={glyphOf(r.emoji)} /> {r.name}
          </button>)}
        </div>
      </>}
      <div style={{ height: 10 }} />
      <Button icon="shuffle" style={{ width: '100%' }} onClick={() => { close(); startFreestyleFlow() }}>{t('Freestyle workout (pick as you go)')}</Button>
    </>
  </>
}
export const startSessionSheet = (iso = todayISO()) => ui().openSheet(close => <StartSessions close={close} iso={iso} />)

/** Explicit Start -> Freestyle intent. Unlike generic queue starts, this never projects a queue head. */
export function startFreestyleFlow() {
  bwSheet({ required: true, locked: false, onDone: bw => beginWorkout(null, bw, null, null) })
  return true
}

function programmeStartProjection(state) {
  try {
    const now = Date.now()
    const surface = programmeStartSurface(state, { now })
    return surface.front ? surface : null
  } catch {
    // A malformed optional Programme namespace must not take down the classic start flow.
    return null
  }
}

export function startFlow(routineId, programmeItem = null, context = {}) {
  const state = S()
  const calendarDate = String(context?.calendarDate || todayISO()).slice(0, 10)
  if (!programmeItem && routineId && context?.allowSettled !== true) {
    const status = weeklySessionStatus(state, { source: 'classic', routineId, calendarDate })
    if (status !== 'start') return false
  }
  const projection = programmeStartProjection(state)
  let selectedProgramme = programmeItem
  let selectedRoutineId = routineId
  const front = projection?.front
  // A guarded/invalid queue head blocks generic starts for that same session. An explicit tap
  // on a different routine remains available, but it must not silently bypass the blocked head
  // when the caller is asking to start the head itself.
  if (front && projection?.blocked && (!routineId || String(routineId) === String(front.routineId))) return false
  if (front?.source === 'programme') {
    const { front: programmeFront, eligible } = projection
    // An eligible due programme head governs the *generic* start, but an explicit tap on a
    // different routine always wins - the week card must start what it says it starts.
    if ((!routineId || routineId === programmeFront.routineId) && !projection.blocked && eligible[0]?.instanceId === programmeFront.instanceId) {
      selectedProgramme = programmeFront
      selectedRoutineId = programmeFront.routineId
    }
    // ...but a blocked/future head must never silently refuse the user's explicit start:
    // fall through to the routine the user actually tapped.
  } else if (front?.source === 'classic') {
    const { front: classicFront, eligible } = projection
    if (!projection.blocked && eligible[0]?.instanceId === classicFront.instanceId
      && (!routineId || routineId === classicFront.routineId)) {
      selectedRoutineId = classicFront.routineId
    }
    // Explicit user choice always wins over a different/blocked queue head.
  }
  if (!selectedProgramme && projection?.eligible?.length) {
    const matchingProgramme = projection.eligible.find(item => item.source === 'programme'
      && (!routineId || String(item.routineId) === String(routineId)))
    if (matchingProgramme) {
      selectedProgramme = matchingProgramme
      selectedRoutineId = matchingProgramme.routineId
    }
  }
  bwSheet({
    required: true,
    locked: false,
    onDone: bw => beginWorkout(selectedRoutineId, bw, selectedProgramme, null, { calendarDate }),
    onChooseDifferent: () => startSessionSheet(calendarDate)
  })
  return true
}

const PROGRAMME_PROVENANCE_FIELDS = ['sessionType', 'kind', 'programmeSession', 'programmeId', 'cycleId', 'instanceId', 'sessionId', 'timeZone', 'programmeStep']

function programmeProvenance(active) {
  const provenance = Object.fromEntries(PROGRAMME_PROVENANCE_FIELDS
    .filter(key => active?.[key] != null)
    .map(key => [key, active[key]]))
  const marker = programmeInstanceMarker(active)
  return marker ? { ...provenance, programmeInstance: marker } : provenance
}

const cloneJson = value => value == null ? value : JSON.parse(JSON.stringify(value))


function programmeEntries(active, classification) {
  const keepUnfinished = classification.partial
  const sourceEntries = entriesForProgrammeExit(active)
  const outcomesByOccurrence = new Map((classification.entries || [])
    .filter(entry => entry?.id != null)
    .map(entry => [entry.occurrenceId || entry.id, entry.progression]))
  return sourceEntries.map((entry, index) => {
    const outcome = outcomesByOccurrence.get(entry.occurrenceId || entry.id) ?? classification.entries[index]?.progression
    const sets = Array.isArray(entry.sets) ? entry.sets : []
    return {
      id: entry.id,
      ...(entry.occurrenceId ? { occurrenceId: entry.occurrenceId } : {}),
      ...exerciseMuscleSnapshot(exOr(entry.id)),
      sets: sets.map(set => ({ ...set })),
      topW: entry.topW || null,
      target: entry.target || null,
      plan: entry.plan || null,
      sg: entry.sg || null,
      ...(classification.partial ? { progression: outcome || 'none' } : {})
    }
  }).filter(entry => keepUnfinished ? entry.sets.length > 0 : entry.sets.some(set => set.done === true))
}

function removeProgrammeRecord(active) {
  const instanceId = active.instanceId || active.id
  useUI.getState().stopTimers()
  update(s => {
    s.workouts = s.workouts.filter(workout => {
      const sameInstance = (instanceId && workout.instanceId === instanceId)
        || workout.id === active.id
      return !(sameInstance && workout.partial === true)
    })
    if (s.programmes && typeof s.programmes === 'object' && !Array.isArray(s.programmes)) {
      s.programmes.skippedInstanceIds = (s.programmes.skippedInstanceIds || [])
        .filter(id => id !== instanceId)
    }
    if (s.programmeDispositions && typeof s.programmeDispositions === 'object' && !Array.isArray(s.programmeDispositions)) {
      const entries = { ...(s.programmeDispositions.entries || {}) }
      delete entries[instanceId]
      s.programmeDispositions = { ...s.programmeDispositions, entries }
    }
    s.active = null
  })
}

function persistProgrammeSkip(active) {
  const instanceId = active.instanceId || active.id
  const disposition = buildProgrammeSkipDisposition(active, { now: Date.now(), timeZone: active.unitTimeZone || active.timeZone })
  useUI.getState().stopTimers()
  update(s => {
    if (!s.active || s.active.id !== active.id) return
    s.workouts = s.workouts.filter(workout => {
      const sameInstance = (instanceId && workout.instanceId === instanceId)
        || workout.id === active.id
      return !(sameInstance && workout.partial === true)
    })
    const current = s.programmeDispositions && typeof s.programmeDispositions === 'object' && !Array.isArray(s.programmeDispositions)
      ? s.programmeDispositions
      : { version: 1, entries: {} }
    const entries = { ...(current.entries || {}) }
    if (instanceId && disposition.instanceId) entries[instanceId] = disposition
    s.programmeDispositions = { ...current, version: 1, entries }
    // Preserve the versioned object namespace's legacy convenience list, but never convert an
    // array-shaped S.programmes value merely to record a zero-work exit.
    if (s.programmes && typeof s.programmes === 'object' && !Array.isArray(s.programmes)) {
      const skippedInstanceIds = Array.isArray(s.programmes.skippedInstanceIds) ? s.programmes.skippedInstanceIds : []
      if (instanceId && !skippedInstanceIds.includes(instanceId)) skippedInstanceIds.push(instanceId)
      s.programmes.skippedInstanceIds = skippedInstanceIds
    }
    s.active = null
  })
}

function persistProgrammeExit(active, classification) {
  const workoutUnit = normalizeWeightUnit(active.unit ?? active.sourceUnit)
  const entries = programmeEntries(active, classification)
  const endedAt = Date.now()
  const base = {
    id: active.id,
    d: active.d,
    start: active.start,
    end: endedAt,
    routineId: active.routineId,
    name: active.name,
    bw: active.bw,
    ...programmeProvenance(active),
    ...scheduleWriteContext({ now: endedAt, timeZone: active.timeZone }),
    ...(active.partialExitBaseline ? { partialExitBaseline: cloneJson(active.partialExitBaseline) } : {}),
    ...(active.groupMeta ? { groupMeta: cloneJson(active.groupMeta) } : {}),
    entries,
    prs: []
  }
  const w = stampCompletedWorkout(base, workoutUnit)
  w.instanceId = active.instanceId || active.id
  w.partial = true
  w.complete = false
  w.owed = classification.owed
  w.schedule = classification.scheduling
  w.partialVersion = 1
  w.exitIntent = classification.intent
  w.disposition = classification.intent
  w.completion = {
    completedWorkSets: classification.completedWorkSets,
    prescribedWorkSets: classification.prescribedWorkSets,
    prescribedWorkSetsAtStart: classification.prescribedWorkSetsAtStart,
    ratio: classification.ratio,
    thresholdMet: classification.thresholdMet,
    exitIntent: classification.intent,
    disposition: classification.intent
  }
  w.vol = workoutUnit ? workoutVolume(w, workoutUnit) : 0

  useUI.getState().stopTimers()
  update(s => {
    // The active id is a synchronous lifecycle barrier. A second callback cannot append a second
    // volume-bearing record after the first callback has cleared the active session.
    if (!s.active || s.active.id !== active.id) return
    const instanceId = w.instanceId
    const existing = s.workouts.findIndex(workout => workout.partial === true
      && (workout.id === w.id || (instanceId && workout.instanceId === instanceId)))
    if (existing >= 0) s.workouts[existing] = w
    else s.workouts.push(w)
    s.active = null
  })
  nav('/home')
  return w
}

/** Persist an explicit or implicit Programme exit without changing classic workout semantics. */
export function saveProgrammeExit(intent = 'default') {
  const active = S().active
  if (!active || !isProgrammeSession(active)) return false
  const classification = classifyWorkoutExit(active, intent)
  if (!classification.record) {
    if (classification.intent === 'skip') persistProgrammeSkip(active)
    else removeProgrammeRecord(active)
    nav('/home')
    return true
  }
  if (!classification.partial) {
    doFinishWorkout()
    return true
  }
  persistProgrammeExit(active, classification)
  return true
}

function ProgrammeExit({ close, snapshot }) {
  const current = useStore(s => s.S.active)
  // The snapshot keeps the sheet renderable in server/static test renders, where Zustand's
  // server snapshot is the store's initial value rather than a later test fixture. In the live
  // client the subscribed value remains authoritative whenever it exists.
  const active = current || snapshot
  if (!active) return null
  const classification = classifyWorkoutExit(active, 'default')
  const choose = intent => {
    close()
    saveProgrammeExit(intent)
  }
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <h3>{t('Leave programme workout?')}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {classification.completedWorkSets
        ? t('{0} of {1} work sets logged. Choose what happens next.', classification.completedWorkSets, classification.prescribedWorkSets)
        : t('Nothing logged yet. You can skip this session or discard it.')}
    </div>
    {classification.record && <>
      <Button variant="primary" icon="reset" onClick={() => choose('continue')}>{t('Continue next time')}</Button>
      <div style={{ height: 8 }} />
    </>}
    <Button icon="flag" onClick={() => choose('skip')}>{t('Finish and skip')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="danger" onClick={() => choose('discard')}>{t('Discard')}</Button>
  </div>
}

export const programmeExitSheet = () => {
  const active = S().active
  if (!active || !isProgrammeSession(active)) return null
  return ui().openSheet(close => <ProgrammeExit close={close} snapshot={active} />, { kind: 'center', locked: true })
}

export function discardWorkout() {
  if (!S().active) return false
  const sourceWorkoutId = S().active.sourceWorkoutId
  useUI.getState().stopTimers()
  update(s => {
    if (sourceWorkoutId) s.workouts = s.workouts.filter(workout => workout.id !== sourceWorkoutId)
    s.active = null
  })
  nav('/home')
  return true
}

/** Restore only the exact unfinished record selected from a first-party weekly surface. */
export function resumeWeeklySession(session = {}) {
  const record = resumableWeeklyWorkout(S(), session)
  if (!record) return false
  const active = cloneJson(record)
  for (const key of ['end', 'vol', 'prs', 'plannedComplete', 'complete', 'partial', 'owed', 'schedule', 'partialVersion', 'exitIntent', 'disposition', 'completion']) delete active[key]
  active.entries = cloneJson(Array.isArray(record.resumeEntries) ? record.resumeEntries : record.entries || [])
  delete active.resumeEntries
  active.sourceWorkoutId = record.id
  active.cur = Math.max(0, (active.entries || []).findIndex(entry => (entry.sets || []).some(set => set.done !== true)))
  active.entries = (active.entries || []).map(entry => ({
    ...entry,
    plan: entry.plan || { policy: entry.target?.prog || 'off', kind: 'resume' },
    sets: (entry.sets || []).map(set => ({ ...set }))
  }))
  useUI.getState().stopTimers()
  update(s => {
    if (s.active || !s.workouts.some(workout => workout.id === record.id)) return
    s.lastFinishedSession = null
    s.lastFinishedUndo = null
    s.active = active
  })
  if (S().active?.sourceWorkoutId !== record.id) return false
  nav('/workout')
  return true
}

function programmeHoldPlan(cfg, previous, plan, unit = 'kg') {
  const target = previous?.target || {}
  const completed = Array.isArray(previous?.sets) ? [...previous.sets].reverse().find(set => set?.done === true) : null
  const mode = modeOf(cfg)
  const factor = 1 - Math.min(90, Math.max(0, Number(cfg.programmeDeloadPercent) || 10)) / 100
  const priorWeight = Number(target.weight ?? completed?.w) || 0
  const configuredWeight = Number(cfg.weight) || 0
  const priorReps = Number(target.reps ?? completed?.r) || 0
  const configuredReps = Number(cfg.reps) || 0
  const preDeloadWeight = Number(cfg.programmePreDeloadWeight) || 0
  const preDeloadReps = Number(cfg.programmePreDeloadReps) || 0
  const held = {
    ...plan,
    kind: 'hold',
    programmeHoldDisposition: 'deload',
    why: [t('Programme deload — volume is reduced and progression pauses this week.')]
  }
  if (mode === 'time') {
    const priorSec = Number(target.sec ?? completed?.sec) || 0
    const configuredSec = Number(cfg.sec ?? cfg.seconds) || 0
    const prepared = Number(cfg.programmePreDeloadSec) > 0
    const configuredIsDeload = configuredSec > 0 && (!priorSec || prepared || configuredSec < priorSec)
    held.sec = configuredIsDeload ? configuredSec : priorSec > 0 ? Math.max(1, Math.round(priorSec * factor)) : configuredSec
    held.programmeHoldSec = Number(cfg.programmePreDeloadSec) > 0
      ? Number(cfg.programmePreDeloadSec)
      : priorSec > 0 ? priorSec : configuredSec
    if (configuredWeight > 0 || priorWeight > 0) {
      const holdWeight = preDeloadWeight || priorWeight
      if (holdWeight > 0) held.programmeHoldWeight = holdWeight
    }
  }
  else if (mode === 'reps') {
    const step = Number(cfg.inc) > 0 ? Number(cfg.inc) : defaultIncrement(cfg.id, unit)
    // A prepared Programme snapshot already contains the displayed deload target when history
    // cannot supply a compatible pre-deload load. Scale only from an actual prior target; doing
    // so otherwise applies the deload a second time at workout start.
    const weighted = configuredWeight > 0 || priorWeight > 0
    const configuredIsDeload = configuredWeight > 0 && (!priorWeight || preDeloadWeight > 0 || configuredWeight < priorWeight)
    if (weighted) {
      held.weight = configuredIsDeload ? configuredWeight : priorWeight > 0 ? Math.round((priorWeight * factor) / step) * step : configuredWeight
      const holdWeight = preDeloadWeight || priorWeight
      if (holdWeight > 0) held.programmeHoldWeight = holdWeight
    } else {
      held.weight = 0
    }
    const repsConfiguredIsDeload = !weighted && configuredReps > 0 && (!priorReps || preDeloadReps > 0 || configuredReps < priorReps)
    held.reps = weighted ? configuredReps || priorReps : repsConfiguredIsDeload ? configuredReps : priorReps > 0 ? Math.max(1, Math.floor(priorReps * factor)) : configuredReps
    held.programmeHoldReps = preDeloadReps || priorReps || configuredReps
  }
  return held
}

// Forced lighter session when repeating a freestyle workout with deload: same
// exercises, one step lighter (bottom of the rep range for bodyweight work).
function deloadPlanFor(cfg, unit) {
  const mode = modeOf(cfg)
  const inc = cfg.inc > 0 ? cfg.inc : defaultIncrement(cfg.id, unit)
  const selected = cfg.selectedEntry || {}
  const performed = (selected.sets || []).filter(set => isWorkRow(set) && set.done === true)
  const maxPerformed = field => performed.length
    ? Math.max(0, ...performed.map(set => Number(set[field]) || 0))
    : Number(cfg[field]) || 0
  const baselineWeight = maxPerformed('w')
  const baselineSec = maxPerformed('sec')
  const baselineReps = maxPerformed('r')
  if (mode === 'time') {
    const sec = baselineSec > DEFAULT_SEC_INCREMENT ? deloadTo(baselineSec, DEFAULT_SEC_INCREMENT) : baselineSec
    return { policy: 'linear', kind: 'deload', sec, why: ['Deload session — lighter load, same exercises.'] }
  }
  if (baselineWeight > 0) {
    const weight = baselineWeight > inc ? deloadTo(baselineWeight, inc) : baselineWeight
    return { policy: 'linear', kind: 'deload', weight, why: ['Deload session — lighter load, same exercises.'] }
  }
  const reps = baselineReps > 1 ? Math.max(1, Math.floor(baselineReps * 0.9)) : baselineReps
  return { policy: 'linear', kind: 'deload', weight: 0, reps, why: ['Deload session — lighter load, same exercises.'] }
}

export function beginWorkout(routineId, bw, programmeItem = null, entriesSource = null, context = {}) {
  const st = S()
  if (st.active) return
  const sourceUnit = normalizeWeightUnit(st.unit) || 'kg'
  const sourceState = { ...st, unit: sourceUnit }
  const historyPolicy = entriesSource?.selectedWorkout
    ? { kind: 'selected-freestyle', workout: cloneJson(entriesSource.selectedWorkout) }
    : routineId == null && !programmeItem
      ? { kind: 'fresh-freestyle' }
      : null
  const historyState = activeWorkoutHistoryState(sourceState, historyPolicy ? { historyPolicy } : null)
  useUI.getState().stopTimers()
  const snapshot = programmeItem?.routineSnapshot
  if (entriesSource?.unit && normalizeWeightUnit(entriesSource.unit) && normalizeWeightUnit(entriesSource.unit) !== sourceUnit) {
    ui().toast(t('This workout is in {0}; repeating it in {1} is blocked to protect the logged weights.', normalizeWeightUnit(entriesSource.unit), sourceUnit))
    return
  }
  const r = entriesSource && Array.isArray(entriesSource.ex)
    ? entriesSource
    : snapshot && Array.isArray(snapshot.ex)
      ? snapshot
      : routineId ? st.routines.find(x => x.id === routineId) : null
  if (programmeItem && (!r || !Array.isArray(r.ex) || !r.ex.length)) {
    ui().toast(t('This session has no exercises — edit the routine in the programme first'))
    return
  }
  if (routineId && r && (!Array.isArray(r.ex) || !r.ex.length)) {
    ui().toast(t('This routine has no exercises yet — add some in Plan first'))
    return
  }
  if (entriesSource && r.ex.some(cfg => !cfg?.id || !EXIDX[cfg.id])) {
    ui().toast(t('This session contains an exercise that is no longer available — nothing to repeat'))
    return
  }
  if (entriesSource && r.ex.some(cfg => cfg.unit && normalizeWeightUnit(cfg.unit) !== sourceUnit)) {
    ui().toast(t('This workout is in {0}; repeating it in {1} is blocked to protect the logged weights.', normalizeWeightUnit(entriesSource.unit), sourceUnit))
    return
  }
  // right weight already on the screen instead of being told about it afterwards.
  // `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  const freshOccurrenceSeen = new Map()
  const resolutionNow = Date.now()
  const freshEntries = (r ? r.ex : []).map((cfg, index) => {
    const selectedEntry = cfg.selectedEntry || null
    const targetCfg = { ...cfg }
    delete targetCfg.selectedEntry
    const phaseConfig = { ...targetCfg, ...(r?.phases ? { phases: r.phases } : {}) }
    const hasWork = hasSelectedWorkPhase(phaseConfig)
    const occurrenceId = occurrenceIdForEntry(cfg, index, freshOccurrenceSeen)
    const previous = selectedEntry
      ? { d: entriesSource?.selectedWorkout?.d, sets: (selectedEntry.sets || []).filter(set => isWorkRow(set) && set.done === true), target: selectedEntry.target || null, occurrenceId }
      : lastEntryFor(historyState, cfg.id, undefined, occurrenceId)
    const increment = cfg.inc > 0 ? cfg.inc : defaultIncrement(cfg.id, sourceUnit)
    const resolveContext = { state: historyState, exerciseId: cfg.id, now: resolutionNow, unit: sourceUnit }
    const resolvedWeight = hasWork ? resolveTargetLoad(targetCfg, previous || [], increment, resolveContext) : 0
    const percentage = hasWork && targetCfg.weightPrescription?.kind === 'percentage'
    const resolved = percentage
      ? { ...targetCfg, occurrenceId, weight: resolvedWeight, resolvedWeight }
      : { ...targetCfg, occurrenceId }
    const progressionState = historyState
    const calculatedPlan = hasWork ? nextPrescription(progressionState, resolved, r) : { policy: 'off', kind: 'off' }
    const programmeInitial = programmeItem?.weekIndex === 1 && resolved.programmeInitial === true
    const plan = entriesSource?.deload
      ? deloadPlanFor({ ...resolved, selectedEntry }, sourceUnit)
      : resolved.programmeWeekMode === 'deload'
        ? programmeHoldPlan(resolved, previous, calculatedPlan, sourceUnit)
        : programmeInitial
          ? { policy: resolved.prog || calculatedPlan.policy || 'off', kind: 'first' }
          : calculatedPlan
    const sessionTarget = {
      ...resolved,
      ...(r?.phases ? { phases: r.phases } : {}),
      ...(plan.programmeHoldDisposition === 'deload'
        ? {
            programmeHoldDisposition: plan.programmeHoldDisposition,
            ...(plan.programmeHoldWeight != null ? { programmeHoldWeight: plan.programmeHoldWeight } : {}),
            ...(plan.programmeHoldReps != null ? { programmeHoldReps: plan.programmeHoldReps } : {}),
            ...(plan.programmeHoldSec != null ? { programmeHoldSec: plan.programmeHoldSec } : {})
          }
        : {})
    }
    const sessionCfg = sessionConfigFor(sessionTarget, plan)
    const workSets = hasWork
      ? (selectedEntry
        ? (selectedEntry.sets || []).filter(set => isWorkRow(set)).map(set => ({ ...set, done: false }))
        : buildSets(historyState, sessionCfg, { preferLast: !!entriesSource?.selectedWorkout }))
      : []
    const plannedSets = hasWork && entriesSource?.deload ? buildSets({ ...historyState, workouts: [] }, sessionCfg) : workSets
    const prescribedSets = applyPrescription(
      entriesSource?.deload ? plannedSets : workSets,
      sessionPlanFor(resolved, plan)
    )
    const materializedSets = prependWarmupSets(sessionCfg, prescribedSets, previous || [], increment, resolveContext)
    return {
      id: cfg.id,
      occurrenceId,
      sg: cfg.sg,
      target: { ...sessionCfg, unit: sourceUnit },
      plan,
      sets: applyPersistedAmrapTargets({ target: sessionCfg, sets: materializedSets }, cfg.amrapTargets).sets
    }
  })
  const entries = freshEntries
  const programmeFields = programmeItem ? {
    sessionType: 'programme',
    kind: 'programme',
    programmeSession: true,
    programmeId: programmeItem.programmeId ?? null,
    cycleId: programmeItem.cycleId ?? null,
    instanceId: programmeItem.instanceId ?? null,
    sessionId: programmeItem.sessionTemplateId ?? null,
    timeZone: programmeItem.cycleTimeZone ?? programmeItem.timeZone ?? null,
    programmeStep: {
      weekIndex: programmeItem.weekIndex ?? null,
      weekday: programmeItem.weekday ?? null,
      ordinal: programmeItem.ordinal ?? null,
      nominalDate: programmeItem.nominalDate ?? null,
      projectedDate: programmeItem.projectedDate ?? null
    },
    locationId: programmeItem.locationId ?? null,
    partialExitBaseline: partialExitBaseline(entries)
  } : {}
  update(s => {
    s.lastFinishedSession = null
    s.lastFinishedUndo = null
    s.active = {
      id: uid(), d: programmeItem ? todayISO() : String(context?.calendarDate || todayISO()).slice(0, 10), start: Date.now(), routineId, name: r ? r.name : t('Freestyle'),
      bw: bw || null, cur: 0, unit: sourceUnit, sourceUnit,
      ...(programmeItem && snapshot ? { routineContext: cloneJson(snapshot) } : {}),
      ...(r?.groupMeta ? { groupMeta: cloneJson(r.groupMeta) } : {}),
      ...(!programmeItem && r ? { routineEntryMap: freshEntries.map((entry, routineIndex) => ({ occurrenceId: entry.occurrenceId, routineIndex, id: entry.id })) } : {}),
      ...(historyPolicy ? { historyPolicy } : {}),
      entries, ...programmeFields
    }
  })
  nav('/workout')
}
function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  const activeUnit = A?.unit || A?.sourceUnit || st.unit
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  const historyState = activeWorkoutHistoryState(st, A)
  const canConfirm = !!entry && shouldConfirmWorkingWeight(entry, 'reps')
  const repsWorkRows = entry ? workRowsForMode(entry, 'reps').filter(s => s.done) : []
  const maxSet = S().fullSetsDefault === false
    ? Math.max(0, ...repsWorkRows.map(s => s.w || 0))
    : bestFullSetWeight(entry, entry?.target)
  const prevBest = entry ? Math.max(cachedWeightFor(historyState.exWeights?.[entry.id], activeUnit), bestWeightFor({ ...historyState, unit: activeUnit }, entry.id)) : 0
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry || !canConfirm) close() }, [!entry, canConfirm])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
  if (!entry || !ex || !canConfirm) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const unit = s.active?.unit || s.active?.sourceUnit || activeUnit
      if (workRowsForMode(entry, 'reps').some(s => s.done)) {
        // Scoped history controls the value shown in this workout. The persistent cache is a
        // global integrity boundary, so merge against the actual compatible global entry rather
        // than allowing a fresh or selected session to downgrade it.
        const cur = cachedWeightFor(s.exWeights?.[entry.id], unit)
        const cache = weightCacheEntry(Math.max(n, cur), todayISO(), unit)
        if (cache) s.exWeights[entry.id] = cache
      }
    })
    close()
    if (advance && unitDone) {
      if (isLastUnit) workoutCompleteSheet()               // whole workout done → finish/continue prompt
      else update(s => { s.active.cur = units[unitIdx + 1][0] })
    } else toast(t('Tracked — next time starts at {0}', fmtNum(cachedWeightFor(S().exWeights?.[entry.id], activeUnit)) + ' ' + activeUnit))
  }
  return <>
    <h3 className="capitalize row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', ex.n)}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={activeUnit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {activeUnit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={isLastUnit ? null : 'chevronRight'} onClick={() => commit(true)}>{isLastUnit ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

// End-of-exercise summary disabled: confirm the working weight automatically (heaviest
// done set, else previous best, else the target) and advance exactly like TopWeight's
// "Save & next exercise" would - so the weight cache still updates without the popup.
export function autoConfirmTopWeight(entryIdx) {
  const st = useStore.getState().S
  const A = st.active
  if (!A) return
  const activeUnit = A.unit || A.sourceUnit || st.unit
  const entry = A.entries[entryIdx]
  if (!entry) return
  const units = supersetUnits(A.entries)
  const unit = unitOf(units, entryIdx)
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
  const repsWorkRows = workRowsForMode(entry, 'reps').filter(x => x.done)
  const maxSet = st.fullSetsDefault === false
    ? Math.max(0, ...repsWorkRows.map(x => x.w || 0))
    : bestFullSetWeight(entry, entry?.target)
  const historyState = activeWorkoutHistoryState(st, A)
  const prevBest = Math.max(cachedWeightFor(historyState.exWeights?.[entry.id], activeUnit), bestWeightFor({ ...historyState, unit: activeUnit }, entry.id))
  const n = Math.round((Math.max(maxSet, prevBest) || entry.target.weight || 0) * 10) / 10
  update(s => {
    s.active.entries[entryIdx].topW = n
    if (workRowsForMode(entry, 'reps').some(x => x.done)) {
      // Keep the active UI scoped, but never let its lower value overwrite a higher global
      // compatible cache entry.
      const cur = cachedWeightFor(s.exWeights?.[entry.id], activeUnit)
      const cache = weightCacheEntry(Math.max(n, cur), todayISO(), activeUnit)
      if (cache) s.exWeights[entry.id] = cache
    }
  })
  if (isLastUnit) workoutCompleteSheet()
  else update(s => { s.active.cur = units[unitIdx + 1][0] })
}

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

function rollbackFinishedSideEffects(state, undo) {
  if (!undo) return
  const workouts = Array.isArray(state.workouts) ? state.workouts : (state.workouts = [])
  if (undo.replacedWorkout) {
    const currentIndex = workouts.findIndex(workout => (
      (undo.instanceId && workout.instanceId === undo.instanceId)
      || (workout.id === undo.workoutId && workout.end === undo.workoutEnd)
    ))
    if (currentIndex >= 0) workouts[currentIndex] = cloneJson(undo.replacedWorkout)
    else {
      const index = Math.max(0, Math.min(undo.replacedIndex, workouts.length))
      workouts.splice(index, 0, cloneJson(undo.replacedWorkout))
    }
  } else {
    const currentIndex = workouts.findIndex(workout => workout.id === undo.workoutId && workout.end === undo.workoutEnd)
    if (currentIndex >= 0) workouts.splice(currentIndex, 1)
  }
  const previousExWeights = undo.previousExWeights || {}
  state.exWeights = state.exWeights && typeof state.exWeights === 'object' ? state.exWeights : {}
  Object.entries(previousExWeights).forEach(([id, previous]) => {
    if (previous?.present) state.exWeights[id] = cloneJson(previous.value)
    else delete state.exWeights[id]
  })
  if (Object.prototype.hasOwnProperty.call(undo, 'programmesBefore')) state.programmes = cloneJson(undo.programmesBefore)
}

export function undoFinish() {
  const snapshot = S().lastFinishedSession
  if (!snapshot || S().active) return false
  useUI.getState().closeAll()
  let restored = false
  update(s => {
    if (!s.lastFinishedSession || s.active) return
    rollbackFinishedSideEffects(s, s.lastFinishedUndo)
    s.active = cloneJson(s.lastFinishedSession)
    s.lastFinishedSession = null
    s.lastFinishedUndo = null
    restored = true
  })
  if (!restored) return false
  nav('/workout')
  return true
}

function FinishSummary({ w, prs, e1prs = [], close }) {
  const st = useStore(s => s.S)
  const unit = normalizeWeightUnit(w.unit) || st.unit
  const phaseVol = volumeByPhase(w, unit)
  const phaseSets = setsByPhase(w, unit)
  const amraps = w.entries.map(e => ({ entry: e, result: amrapResultFor(e) })).filter(x => x.result)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(workoutVolume(w, unit), unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsDone(w)}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    <div className="small dim" style={{ textAlign: 'left', margin: '10px 0 14px' }}>
      {t('Warm-up')}: {phaseSets.warmup} {t('sets')} · {fmtVol(phaseVol.warmup, unit)} &nbsp;|&nbsp; {t('Work')}: {phaseSets.work} {t('sets')} · {fmtVol(phaseVol.work, unit)}
    </div>
    {amraps.length > 0 && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      <h4 className="sec" style={{ marginBottom: 6 }}>{t('AMRAP')}</h4>
      {amraps.map(({ entry, result }) => {
        const ex = EXIDX[entry.id]
        const actual = result.mode === 'time' ? fmtSec(result.actual) : fmtNum(result.actual)
        const unit = result.mode === 'time' ? t('Seconds') : t('Reps')
        return <div key={entry.id} className="small accent row" style={{ gap: 5 }}>
          <Icon name="arrowUp" style={{ fontSize: 13 }} />{ex ? ex.n : (entry.n || entry.id)} · {actual} {unit}{result.target ? ' · ≥ ' + result.target + ' ' + unit : ''}
        </div>
      })}
    </div>}
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} {(EXIDX[id] || {}).n || id}</div>)}
      {e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {(EXIDX[p.id] || {}).n || p.id} · {fmtNum(p.est)} {unit}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="reset" onClick={() => { close(); undoFinish() }}>{t('Undo finish')}</Button>
  </div>
}
export function finishWorkout() {
  const A = S().active
  if (!A) return
  if (isProgrammeSession(A)) {
    const classification = classifyWorkoutExit(A, 'default')
    // Programme sessions get the three-way completion screen whenever work remains. A fully
    // completed Programme session keeps the native finish summary; zero-work sessions omit the
    // owed action but still offer skip/discard in the same screen.
    if (classification.outcome !== 'complete') { programmeExitSheet(); return }
    doFinishWorkout()
    return
  }
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const finishedSession = cloneJson(A)
  const programme = isProgrammeSession(A)
  const workoutUnit = normalizeWeightUnit(A.unit ?? A.sourceUnit)
  const endedAt = Date.now()
  const completedPlannedWork = programme
    ? classifyWorkoutExit(A, 'default').outcome === 'complete'
    : A.entries.length > 0
      && A.entries.every(entry => entry.sets.length > 0 && entry.sets.every(set => set.done === true))
  const writeContext = programme ? scheduleWriteContext({ now: endedAt, timeZone: A.timeZone }) : {}
  const historyState = workoutUnit ? { ...st, unit: workoutUnit } : null
  useUI.getState().stopTimers()
  const prs = []
  const e1prs = []
  A.entries.forEach(e => {
    const repsWorkRows = workRowsForMode(e, 'reps').filter(s => s.done)
    const mx = Math.max(0, ...repsWorkRows.map(s => s.w || 0))
    if (mx > 0 && historyState && mx > bestWeightFor(historyState, e.id)) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const completionEntry = historyState
      ? stampCompletedWorkout({ entries: [e] }, workoutUnit).entries[0]
      : null
    const rec = historyState ? is1RMRecord(historyState, e.id, completionEntry) : null
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = stampCompletedWorkout({
    id: A.id, d: A.d, start: A.start, end: endedAt, routineId: A.routineId, name: A.name, bw: A.bw,
    ...(programme ? { complete: completedPlannedWork } : { plannedComplete: completedPlannedWork }),
    ...(!programme && !completedPlannedWork ? { resumeEntries: cloneJson(A.entries) } : {}),
    ...(programme ? programmeProvenance(A) : {}),
    ...(programme ? writeContext : {}),
    ...(A.groupMeta ? { groupMeta: cloneJson(A.groupMeta) } : {}),
    // `target` (what the session prescribed) is kept alongside the sets: without it a
    // finished workout cannot say whether it hit its reps, and a timed session reads back
    // as "0 reps". It is what the progression engine works from.
    entries: A.entries.map(e => ({
      id: e.id,
      ...(e.occurrenceId ? { occurrenceId: e.occurrenceId } : {}),
      ...exerciseMuscleSnapshot(exOr(e.id)),
      sets: e.sets,
      topW: e.topW || null,
      target: e.target || null,
      plan: e.plan || null,
      sg: e.sg || null
    })).filter(e => e.sets.some(s => s.done)),
    prs
  }, workoutUnit)
  if (programme) w.instanceId = A.instanceId || A.id
  w.vol = workoutUnit ? workoutVolume(w, workoutUnit) : 0
  const partialIndex = A.sourceWorkoutId
    ? st.workouts.findIndex(workout => workout.id === A.sourceWorkoutId)
    : programme && w.instanceId
      ? st.workouts.findIndex(workout => workout.partial === true && workout.instanceId === w.instanceId)
      : -1
  const previousExWeights = Object.fromEntries(A.entries.map(entry => {
    const present = Object.prototype.hasOwnProperty.call(st.exWeights || {}, entry.id)
    return [entry.id, { present, value: present ? cloneJson(st.exWeights[entry.id]) : null }]
  }))
  const finishedUndo = {
    workoutId: w.id,
    workoutEnd: w.end,
    instanceId: w.instanceId || null,
    replacedIndex: partialIndex,
    replacedWorkout: partialIndex >= 0 ? cloneJson(st.workouts[partialIndex]) : null,
    previousExWeights,
    ...(programme ? { programmesBefore: cloneJson(st.programmes) } : {})
  }
  update(s => {
    w.entries.forEach(e => {
      const repsWorkRows = workRowsForMode(e, 'reps').filter(s => s.done)
      const mx = Math.max(0, ...repsWorkRows.map(x => x.w || 0))
      if (workoutUnit && repsWorkRows.length > 0 && mx > 0) {
        const cur = cachedWeightFor(s.exWeights?.[e.id], workoutUnit)
        if (mx > cur) {
          const cache = weightCacheEntry(mx, w.d, workoutUnit)
          if (cache) s.exWeights[e.id] = cache
        }
      }
    })
    if (partialIndex >= 0) s.workouts[partialIndex] = w
    else s.workouts.push(w)
    s.lastFinishedSession = finishedSession
    s.lastFinishedUndo = finishedUndo
    s.active = null
  })
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
}
