import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtNum, localTZ } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { POLICY_NAME, POLICIES } from '../lib/progression.js'
import {
  activeProgrammeCycleFor,
  programmeDefinitionOf,
  programmeCycleOf,
  pickupExerciseRows,
  repeatProgrammeCycleInState,
  startProgrammeCycleInState
} from '../lib/programmes-ui.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, Stepper } from '../components/ui.jsx'

const clone = value => JSON.parse(JSON.stringify(value))
const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)))
const round = value => Math.round(Number(value) * 10) / 10
const WEEK_MODES = ['normal', 'deload', 'rest']
const modeLabel = mode => mode === 'deload' ? t('Deload') : mode === 'rest' ? t('Rest') : t('Normal')

function snapshotDefinition(cycle) {
  const snapshot = cycle?.programmeSnapshot || {}
  return { ...clone(snapshot), id: snapshot.id || cycle?.programmeId, weeks: clone(snapshot.weeks || cycle?.snapshot?.weeks || []) }
}

function rowStep(row) {
  if (row.mode === 'time') return 5
  if (row.mode === 'cardio' || row.unit === 'min') return 1
  if (row.unit === 'reps') return 1
  if (Number(row.cfg?.inc) > 0) return Number(row.cfg.inc)
  return 2.5
}

function snapValue(value, step) {
  return step > 0 ? round(Math.round(value / step) * step) : round(value)
}

export function valueForRow(row, loadMode, deloadPercent, values = {}) {
  if (values[row.key] != null) return values[row.key]
  const factor = loadMode === 'deload' && row.mode !== 'cardio'
    ? 1 - deloadPercent / 100
    : 1
  const adjusted = Math.max(0, row.baseline * factor)
  return loadMode === 'deload' && row.mode === 'reps'
    ? row.unit === 'reps' ? Math.max(1, Math.floor(adjusted)) : snapValue(adjusted, rowStep(row))
    : round(adjusted)
}

export function suggestionForRow(row, loadMode = 'highest', deloadPercent = 10) {
  if (loadMode === 'deload') return valueForRow(row, 'deload', deloadPercent)
  return row.suggestion != null ? row.suggestion : valueForRow(row, 'highest', deloadPercent)
}

export function pickupStartOptions({ rows = [], values = {}, loadMode = 'highest', deloadPercent = 10 }) {
  return {
    startingValues: Object.fromEntries(rows.map(row => [row.key, valueForRow(row, loadMode, deloadPercent, values)])),
    startingValueModes: Object.fromEntries(rows.filter(row => row.mode === 'reps').map(row => [row.key, row.unit === 'reps' ? 'reps' : 'weight'])),
    startingValuesAreFinal: true
  }
}

export function startProgrammePickupInState(state, {
  definition,
  repeat = false,
  cycleId = null,
  rows = [],
  values = {},
  loadMode = 'highest',
  deloadPercent = 10,
  progression = definition?.progression || 'linear',
  weeks = definition?.weeks || [],
  lengthWeeks = weeks.length || 1,
  unit = state?.unit,
  timeZone = localTZ()
} = {}) {
  if (!definition?.id) return null
  const options = {
    startMode: loadMode,
    deloadPercent,
    progression,
    weeks,
    lengthWeeks,
    ...pickupStartOptions({ rows, values, loadMode, deloadPercent }),
    unit,
    timeZone
  }
  return repeat
    ? repeatProgrammeCycleInState(state, cycleId || definition.id, options)
    : startProgrammeCycleInState(state, definition, options)
}

export default function ProgrammePickup() {
  const nav = useNavigate()
  const location = useLocation()
  const S = useStore(state => state.S)
  const update = useStore(state => state.update)
  const toast = useUI(state => state.toast)
  const request = location.state || {}
  const cycle = request.cycleId ? programmeCycleOf(S, request.cycleId) : null
  const repeat = request.mode === 'repeat' || request.repeat === true
  const programmeId = request.programmeId || cycle?.programmeId
  const definition = repeat && cycle ? snapshotDefinition(cycle) : programmeDefinitionOf(S, programmeId) || snapshotDefinition(cycle)
  const active = activeProgrammeCycleFor(S, programmeId)
  const [loadMode, setLoadMode] = useState('highest')
  const [deloadPercent, setDeloadPercent] = useState(10)
  const [progression, setProgression] = useState(definition?.progression || 'linear')
  const initialLength = definition?.weeks?.length || cycle?.lengthWeeks || 1
  const [length, setLength] = useState(initialLength)
  const [weekModes, setWeekModes] = useState(() => (definition?.weeks || []).map(week => week.mode || 'normal'))
  const [openWeek, setOpenWeek] = useState(0)
  const [values, setValues] = useState({})

  const rows = useMemo(() => definition ? pickupExerciseRows(S, definition, { progression, now: Date.now() }) : [], [S, definition, progression])
  const title = repeat ? t('Repeat programme') : t('Start programme')
  const disabled = !definition?.id || !!active || !rows.length
  const modeOptions = useMemo(() => [
    { value: 'highest', label: t('Highest working weight') },
    { value: 'deload', label: t('Lighter restart') }
  ], [])

  const setRowValue = (row, value) => setValues(previous => ({ ...previous, [row.key]: Math.max(0, round(value)) }))
  const applySuggestion = row => setRowValue(row, suggestionForRow(row, loadMode, deloadPercent))
  const applyAllSuggestions = () => setValues(_previous => Object.fromEntries(rows.map(row => [row.key, suggestionForRow(row, loadMode, deloadPercent)])))

  const changeLength = value => {
    const nextLength = clamp(value, 1, 52)
    setLength(nextLength)
    setWeekModes(previous => Array.from({ length: nextLength }, (_, index) => previous[index] || definition?.weeks?.[index]?.mode || 'normal'))
  }

  const definitionWeeks = definition?.weeks || []
  const cycleWeeks = Array.from({ length }, (_, index) => ({
    ...(clone(definitionWeeks[index] || definitionWeeks[definitionWeeks.length - 1] || { days: [] })),
    weekIndex: index + 1,
    mode: weekModes[index] || 'normal'
  }))

  const start = () => {
    if (disabled || !definition?.id) return
    let created = null
    update(state => {
      const options = {
        definition,
        repeat,
        cycleId: cycle?.id,
        rows,
        values,
        loadMode,
        deloadPercent,
        progression,
        weeks: cycleWeeks,
        lengthWeeks: length,
        unit: S.unit,
        timeZone: localTZ()
      }
      created = startProgrammePickupInState(state, options)
    })
    if (!created) return
    toast?.(repeat ? t('Programme repeated') : t('Programme started'))
    nav('/plan')
  }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{title}</h1><div className="sub">{definition?.name || t('Programme')}</div></div>
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
    {!definition?.id ? <div className="empty"><div className="ico"><Icon name="info" /></div>{t('Programme not found')}<br />{t('Return to Plan and choose a programme.')}</div> : <>
      <div className="card">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span className="lrow-i" style={{ background: 'var(--acc-soft)', color: 'var(--acc)', fontSize: 22 }}><Icon name="dumbbell" /></span>
          <div className="grow"><div className="tt">{definition.name}</div><div className="ss">{t('{0} weeks', length)} · {t('Progression: {0}', progression)}</div></div>
        </div>
        {active && <div className="small" style={{ color: 'var(--yellow)', marginTop: 12 }}>{t('This programme already has an active cycle.')}</div>}
      </div>

      <h4 className="sec">{t('Progression')}</h4>
      <select className="field" value={progression} onChange={event => setProgression(event.target.value)} aria-label={t('Progression')}>
        {POLICIES.map(policy => <option key={policy} value={policy}>{t(POLICY_NAME[policy])}</option>)}
      </select>

      <h4 className="sec">{t('Starting load')}</h4>
      <Segmented value={loadMode} onChange={setLoadMode} options={modeOptions} />
      <div className="small dim" style={{ margin: '10px 2px 14px', lineHeight: 1.45 }}>{repeat ? t('Create a new active cycle from the completed programme snapshot.') : t('Choose how the first week should load before you start.')}</div>
      {loadMode === 'deload' && <div className="card" style={{ marginBottom: 12 }}>
        <Stepper value={deloadPercent} step={1} onChange={value => setDeloadPercent(clamp(value, 1, 50))} label={t('Deload percentage')} unit="%" decimal={false} />
      </div>}

      <h4 className="sec">{t('Programme length')}</h4>
      <div className="card" style={{ marginBottom: 12 }}>
        <Stepper value={length} step={1} onChange={changeLength} label={t('Number of weeks')} unit={t('weeks')} decimal={false} />
      </div>

      <h4 className="sec">{t('Week modes')}</h4>
      <div className="week-mode-list">
        {weekModes.map((mode, index) => <div key={index} className={'week-mode-row' + (openWeek === index ? ' is-open' : '')}>
          <button type="button" className="week-mode-toggle" aria-expanded={openWeek === index} onClick={() => setOpenWeek(current => current === index ? -1 : index)}>
            <strong>{t('Week')} {index + 1}</strong><span className="tag">{modeLabel(mode)}</span><Icon name={openWeek === index ? 'chevronUp' : 'chevronDown'} />
          </button>
          {openWeek === index && <div className="week-mode-options"><Segmented value={mode} onChange={value => setWeekModes(previous => previous.map((item, itemIndex) => itemIndex === index ? value : item))}
            options={WEEK_MODES.map(item => ({ value: item, label: modeLabel(item) }))} /></div>}
        </div>)}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', margin: '18px 0 8px', gap: 8 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Exercise starting targets')}</h4>
        <Button size="sm" variant="tinted" icon="sparkles" onClick={applyAllSuggestions} disabled={!rows.length}>{t('Apply all')}</Button>
      </div>
      {rows.length ? <div className="list pickup-target-list">
        {rows.map(row => <div key={row.key} className="item pickup-target-row" style={{ display: 'block', padding: '10px 12px' }}>
          {(() => {
            const bodyweight = row.mode === 'reps' && row.unit === 'reps'
            return <>
          <div className="pickup-target-head">
            <span className="pickup-target-copy"><strong>{row.name}</strong>
              <span className="small dim" style={{ display: 'block', marginTop: 3 }}>
                {row.mode === 'reps' && row.unit !== 'reps' && (t('Previous best:') + ' ' + fmtNum(row.best || row.baseline) + ' ' + row.unit)}
                {row.mode === 'reps' && row.unit !== 'reps' && row.e1rm > 0 && (' · ' + t('1RM ~{0} {1}', fmtNum(row.e1rm), row.unit))}
                {row.mode === 'reps' && row.unit !== 'reps' && (' · ' + t('target {0} reps', row.targetReps))}
                {row.mode === 'reps' && row.unit === 'reps' && t('Bodyweight · target {0} reps', row.targetReps)}
                {row.mode === 'time' && t('Target {0} seconds per set', row.suggestion || row.baseline || row.cfg?.sec || 0)}
                {row.mode === 'cardio' && t('Target {0} minutes', row.suggestion || row.baseline || row.cfg?.min || 0)}
              </span>
            </span>
            {row.mode === 'reps' && !bodyweight && <Button size="sm" variant="ghost" onClick={() => applySuggestion(row)}>{t('Use suggestion')}</Button>}
          </div>
          {row.mode === 'reps' && !bodyweight && <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center' }}>
            <Stepper value={valueForRow(row, loadMode, deloadPercent, values)} step={rowStep(row)}
              onChange={value => setRowValue(row, value)} unit={row.unit} />
            <span className="small dim grow pickup-suggestion-copy">
              {row.unit !== 'reps' && row.e1rm > 0
                ? t('Suggested: {0} {1} — from ~{2} 1RM at {3} reps', suggestionForRow(row, loadMode, deloadPercent) || 0, row.unit, fmtNum(row.e1rm), row.targetReps)
                : t('Suggested: {0} {1}', suggestionForRow(row, loadMode, deloadPercent) || 0, row.unit)}
            </span>
          </div>}
          {(row.mode !== 'reps' || bodyweight) && <div className="pickup-fixed-target"><span className="pickup-fixed-value">{bodyweight ? `${fmtNum(row.targetReps)} ${t('reps')} × ${row.cfg?.sets || 1}` : `${fmtNum(valueForRow(row, loadMode, deloadPercent, values))} ${row.unit === 's' ? t('seconds') : row.unit} × ${row.cfg?.sets || 1}`}</span><span className="small dim">{t('Target')}</span></div>}
            </>
          })()}
        </div>)}
      </div> : <div className="empty"><div className="ico"><Icon name="info" /></div>{t('No exercises in this programme')}</div>}

      <Button variant="primary" icon="play" style={{ width: '100%', marginTop: 16 }} disabled={disabled} onClick={start}>{repeat ? t('Repeat programme') : t('Start cycle')}</Button>
    </>}
  </div>
}