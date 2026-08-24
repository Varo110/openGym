import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { Button, NumberField } from './ui.jsx'
import Icon from './Icon.jsx'
import {
  applyPickupSuggestion,
  buildPickupAction,
  derivePickupSuggestions,
  pickupExercisesFromProgramme,
  pickupCycleFor,
  pickupRows,
  resolvePickupContext,
  PICKUP_POLICIES,
  PICKUP_MODES,
  savedPickupPolicy,
  stepDeloadPercent,
  updatePickupValue,
} from '../lib/programme-pickup.js'

const policyLabelKeys = { linear: 'Linear', greyskull: 'Greyskull LP', double: 'Double', time: 'Time', off: 'No automatic' }

function Stepper({ row, onChange }) {
  if (row.cardio) return <span className="tag dim">{t('no load')}</span>
  const step = row.bodyweight ? (row.kind === 'time' ? 5 : 1) : row.increment
  const adjust = direction => onChange(Math.max(row.bodyweight ? 1 : 0, Number((Number(row.value || 0) + direction * step).toFixed(2))))
  return <div className="pickup-controls" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <button className="stbtn" style={{ width: 26, height: 26 }} aria-label={t('Decrease')} onClick={() => adjust(-1)}>−</button>
    <div className="pickup-value" style={{ width: 52, textAlign: 'center' }}>
      <NumberField className="pickup-value-input" style={{ width: 52, boxSizing: 'border-box', textAlign: 'center' }} value={row.value ?? ''} decimal={!row.bodyweight || row.kind === 'time'} onChange={onChange} />
      <div className="muted" style={{ fontSize: 11 }}>{row.bodyweight ? (row.kind === 'time' ? t('seconds') : t('reps')) : row.unit || ''}</div>
    </div>
    <button className="stbtn" style={{ width: 26, height: 26 }} aria-label={t('Increase')} onClick={() => adjust(1)}>＋</button>
  </div>
}

export default function ProgrammePickupSheet({ programme, cycle, exercises, workouts, unit, savedPolicy, startMode, mode: pickupMode, percent: pickupPercent, onSave, onStart } = {}) {
  const location = useLocation()
  const S = useStore(s => s.S)
  const state = location.state || {}
  const initialStartMode = startMode || (state.mode === 'repeat' || state.mode === 'start' ? state.mode : null) || state.intent || state.startMode || 'start'
  const context = resolvePickupContext({
    state: { ...state, mode: initialStartMode },
    namespace: S.programmes,
    programme: programme || state.programme || null,
    cycle: cycle || state.cycle || null,
  })
  const selectedProgramme = context.programme || programme || state.programme || null
  const selectedCycle = context.cycle || selectedProgramme?.cycle || pickupCycleFor(selectedProgramme)
  const list = Array.isArray(exercises) ? exercises : pickupExercisesFromProgramme(selectedProgramme, selectedCycle)
  const activeUnit = unit || S.unit || 'kg'
  const history = workouts ?? S.workouts ?? []
  const requestedLoadMode = pickupMode || state.loadMode || state.pickupMode || (PICKUP_MODES.includes(state.mode) ? state.mode : null)
  const initialMode = PICKUP_MODES.includes(requestedLoadMode) ? requestedLoadMode : 'max'
  const initialPercent = Math.max(50, Math.min(100, Number(pickupPercent ?? state.percent ?? 90) || 90))
  const initialPolicy = savedPickupPolicy({ programme: selectedProgramme, cycle: selectedCycle, state, savedPolicy })
  const suggestions = derivePickupSuggestions({ workouts: history, exercises: list, unit: activeUnit, now: state.now ?? Date.now() })
  const [mode, setMode] = useState(initialMode)
  const [percent, setPercent] = useState(initialPercent)
  const [policy, setPolicy] = useState(initialPolicy)
  const [rows, setRows] = useState(() => pickupRows({ exercises: list, workouts: history, unit: activeUnit, mode: initialMode, percent: initialPercent, suggestions }))
  const canContinue = context.valid !== false && !!context.programmeId && (initialStartMode !== 'repeat' || !!context.cycleId)
  const displayRows = rows.map(row => ({ ...row, unit: activeUnit }))
  const rebuildRows = (nextMode, nextPercent, previousRows) => pickupRows({ exercises: list, workouts: history, unit: activeUnit, mode: nextMode, percent: nextPercent, suggestions, previousRows })
  const changeMode = next => {
    setMode(next)
    setRows(current => rebuildRows(next, percent, current))
  }
  const changePercent = delta => {
    const next = stepDeloadPercent(percent, delta)
    setPercent(next)
    if (mode === 'deload') setRows(current => rebuildRows(mode, next, current))
  }
  const applyAll = () => setRows(current => current.map(applyPickupSuggestion))
  const save = () => {
    const action = buildPickupAction({
      intent: initialStartMode,
      loadMode: mode,
      percent,
      policy,
      rows,
      programme: selectedProgramme,
      cycle: selectedCycle,
      programmeId: context.programmeId,
      cycleId: context.cycleId,
      unit: activeUnit,
    })
    const persist = typeof onSave === 'function' ? onSave : typeof onStart === 'function' ? onStart : state.onSave
    // The sheet is a contract boundary, not a lifecycle writer. A missing route
    // callback must not pretend that a cycle was persisted or return an inert action.
    return typeof persist === 'function' ? persist(action) : false
  }
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start / Repeat')}</h1><div className="sub">{t('Where to pick up')}</div></div></div>
    <h4 className="sec">{t('Where to pick up')}</h4>
    <div className="card">
      {PICKUP_MODES.map(option => <button key={option} className="row" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0 }} onClick={() => changeMode(option)}>
        <span className={'radio ' + (mode === option ? 'on' : '')} />
        <span className="grow"><b>{t(option === 'max' ? 'Highest working weight' : '% deload')}</b><span className="muted small" style={{ display: 'block' }}>{t(option === 'max' ? 'Your best logged weights — the default.' : 'Lighter restart — any cut you like; results snap to your load increments.')}</span>
        {option === 'deload' && <span className="stepper" style={{ marginTop: 7, display: 'flex' }} onClick={event => event.stopPropagation()}><button className="stbtn" onClick={() => changePercent(-5)}>−</button><b style={{ minWidth: 50, textAlign: 'center' }}>{percent}%</b><button className="stbtn" onClick={() => changePercent(5)}>＋</button></span>}</span>
      </button>)}
      {rows.some(row => row.suggestion != null && !row.cardio) && <Button size="sm" onClick={applyAll}>✨ {t("Apply each row's suggestion")}</Button>}
    </div>
    <h4 className="sec">{t('Starting weights — then tweak any')}</h4>
    <div className="card">
      {displayRows.map(row => <div className="row exrow" key={row.id} style={{ alignItems: 'center' }}>
        <div className="grow"><div className="tt" style={{ fontSize: 14 }}>{row.n || row.name || t('Unknown exercise')} {row.defaultIncrement && <span className="tag dim">{t('Default')}</span>}</div>{row.bodyweight && <div className="muted small">{t('bodyweight')}</div>}</div>
        {!row.cardio && row.suggestion != null && <button className="iconbtn" aria-label={t('Apply suggestion')} onClick={() => setRows(current => current.map(item => item.id === row.id ? applyPickupSuggestion(item) : item))}><Icon name="sparkles" /></button>}
        <Stepper row={row} onChange={value => setRows(current => updatePickupValue(current, row.id, value))} />
      </div>)}
    </div>
    <p className="muted small pickup-help">{t('Bodyweight rows pick up on target reps (or seconds for timed holds) — no weight involved.')}</p>
    <p className="muted small pickup-help">{t('Cardio keeps its last target; there is no load to pick up.')}</p>
    <h4 className="sec">{t('Progression style — for this cycle')}</h4>
    <p className="muted small pickup-help">{t('This choice is saved per cycle, so a repeat can use a different progression style.')}</p>
    <div className="card"><div className="chips">{PICKUP_POLICIES.map(option => <button key={option} className={'opt ' + (policy === option ? 'on' : '')} onClick={() => setPolicy(option)}>{t(policyLabelKeys[option])}</button>)}</div></div>
    <Button variant="primary" disabled={!canContinue} onClick={save}>{t('Continue')}</Button>
  </div>
}
