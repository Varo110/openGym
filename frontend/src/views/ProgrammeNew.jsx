import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { localTZ, uid, DAYN } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { POLICY_NAME, POLICIES } from '../lib/progression.js'
import {
  addProgrammeDefinitionInState,
  copyProgrammeWeekToTargets,
  createProgrammeDefinition,
  cycleWeekMode,
  programmeCycleOf,
  PROGRAMME_COLOURS,
  programmeEditorDefinitionForCycle,
  programmeDefinitionOf,
  programmeBuilderSources,
  programmeWeeksFromSource,
  sanitizeProgrammeWeeks,
  setProgrammeDaySessions,
  syncProgrammeRoutineSnapshots,
  updateActiveProgrammeCycleInState
} from '../lib/programmes-ui.js'
import { EXDB } from '../lib/exercises.js'
import { modeOf } from '../lib/history.js'
import { exConfigSheet, exercisePicker } from '../sheets.jsx'
import LastPerformance from '../components/LastPerformance.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, Stepper, TextField } from '../components/ui.jsx'

const clone = value => JSON.parse(JSON.stringify(value))
const WEEK_MODES = ['normal', 'deload', 'rest']
const MODE_COLOR = { deload: 'var(--orange)', rest: 'var(--red)' }
const modeLabel = mode => mode === 'normal'
  ? t('Normal')
  : <span style={{ color: MODE_COLOR[mode] }}>{mode === 'deload' ? t('Deload') : t('Rest')}</span>

export function saveProgrammeInState(state, definition, { editCycleId = null, pendingRoutines = {} } = {}) {
  Object.values(pendingRoutines).filter(routine => (routine?.ex || []).length > 0).forEach(routine => {
    const existing = (state.routines || []).find(item => String(item.id) === String(routine.id))
    if (existing) Object.assign(existing, clone(routine))
    else (state.routines || (state.routines = [])).push(clone(routine))
  })
  return editCycleId
    ? updateActiveProgrammeCycleInState(state, editCycleId, definition)
    : addProgrammeDefinitionInState(state, definition)
}

export function cancelProgrammeEdit(nav) {
  nav('/plan')
}

function routineSession(routine, weekIndex, weekday, sessionIndex) {
  const suffix = `${routine.id}:w${weekIndex}:d${weekday}:s${sessionIndex + 1}`
  return {
    id: suffix,
    sessionTemplateId: suffix,
    routineId: routine.id,
    routineSnapshot: clone(routine)
  }
}

function dayOf(week, weekday) {
  return (week?.days || []).find(day => Number(day.weekday) === Number(weekday)) || { weekday, sessions: [] }
}

function routineSnapshotFor(routines, session) {
  const id = session?.routineId || session?.routineSnapshot?.id
  return routines.find(routine => String(routine.id) === String(id)) || session?.routineSnapshot || null
}

function hydrateRoutineSnapshots(weeks, routines) {
  return (weeks || []).map(week => ({
    ...clone(week),
    days: (week.days || []).map(day => ({
      ...clone(day),
      sessions: (day.sessions || []).map(session => {
        const routine = routineSnapshotFor(routines, session)
        return routine ? { ...clone(session), routineId: routine.id, routineSnapshot: clone(routine) } : clone(session)
      })
    }))
  }))
}

function RoutineDraftEditor({ routine, state, onChange, onDone, onCancel }) {
  if (!routine) return null
  const updateExercise = (index, next) => onChange({ ...routine, ex: routine.ex.map((cfg, i) => i === index ? { ...clone(next), id: routine.ex[i].id } : cfg) })
  const addExercise = () => exercisePicker(exercise => exConfigSheet(exercise, null, cfg => onChange({ ...routine, ex: [...routine.ex, { ...clone(cfg), id: exercise.id }] }), null, routine, undefined, { useLastSetup: true, historyState: state }))
  return <div data-testid="programme-routine-editor-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 14 }} onClick={onCancel}>
    <div className="card programme-routine-editor" data-testid="programme-routine-editor" style={{ width: 'min(94vw, 430px)', maxHeight: '88vh', overflowY: 'auto', padding: 14 }} onClick={event => event.stopPropagation()}>
    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
      <strong>{t('Edit routine')}</strong>
      <Button size="sm" variant="ghost" onClick={onCancel}>{t('Cancel')}</Button>
    </div>
    <TextField value={routine.name || ''} aria-label={t('Routine name')} onChange={event => onChange({ ...routine, name: event.target.value })} />
    <div className="list" style={{ marginTop: 8 }}>
      {(routine.ex || []).map((cfg, index) => <div key={`${cfg.id}:${index}`} className="row" style={{ gap: 7, padding: '7px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <span className="grow">{EXDB.find(exercise => exercise.id === cfg.id)?.n || cfg.name || cfg.id}
          <LastPerformance state={state} exerciseId={cfg.id} mode={modeOf(cfg)} occurrenceId={`${cfg.id}#${(routine.ex || []).slice(0, index).filter(candidate => String(candidate.id) === String(cfg.id)).length + 1}`} />
        </span>
        <Button size="sm" variant="ghost" onClick={() => exConfigSheet(EXDB.find(exercise => exercise.id === cfg.id) || cfg, cfg, next => updateExercise(index, next), () => onChange({ ...routine, ex: routine.ex.filter((_, i) => i !== index) }), routine)}>{t('Edit')}</Button>
      </div>)}
    </div>
    {!routine.ex?.length && <div className="small dim" style={{ padding: '8px 0' }}>{t('Add at least one exercise before saving this routine.')}</div>}
    <div className="row" style={{ gap: 7, justifyContent: 'flex-end', marginTop: 10 }}>
      <Button size="sm" variant="tinted" icon="plus" onClick={addExercise}>{t('Add exercise')}</Button>
      <Button size="sm" variant="primary" icon="check" onClick={onDone}>{t('Done')}</Button>
    </div>
    </div>
  </div>
}

export default function ProgrammeNew() {
  const location = useLocation()
  const nav = useNavigate()
  const S = useStore(state => state.S)
  const update = useStore(state => state.update)
  const editCycleId = location.state?.mode === 'edit-cycle' ? location.state.cycleId : null
  const editCycle = useMemo(() => editCycleId ? programmeCycleOf(S, editCycleId) : null, [S, editCycleId])
  const editProgrammeId = location.state?.mode === 'edit' ? location.state.programmeId : null
  const editDefinition = useMemo(() => editCycle
    ? programmeEditorDefinitionForCycle(editCycle)
    : programmeDefinitionOf(S, editProgrammeId), [S, editCycle, editProgrammeId])
  const initialWeeks = editDefinition?.weeks || editDefinition?.snapshot?.weeks || programmeWeeksFromSource(S, 'current', 8)
  const [name, setName] = useState(() => editDefinition?.name || '')
  const [length, setLength] = useState(() => editDefinition?.lengthWeeks || initialWeeks.length || 8)
  const [progression, setProgression] = useState(() => editDefinition?.progression || 'linear')
  const [colour, setColour] = useState(() => editDefinition?.colour ?? editDefinition?.color ?? null)
  const [source, setSource] = useState(() => editDefinition ? `programme:${editDefinition.id}` : 'current')
  const [weeks, setWeeks] = useState(() => clone(initialWeeks))
  const [selectedWeek, setSelectedWeek] = useState(0)
  const [copyTargets, setCopyTargets] = useState([])
  const [selectedDay, setSelectedDay] = useState(1)
  const [draftRoutines, setDraftRoutines] = useState({})
  const [routineDraft, setRoutineDraft] = useState(null)

  const sources = useMemo(() => programmeBuilderSources(S), [S])
  const current = weeks[selectedWeek] || weeks[0]
  const currentDay = dayOf(current, selectedDay)
  const routines = Array.isArray(S.routines) ? S.routines : []
  const snapshotRoutines = useMemo(() => (weeks || []).flatMap(week => (week.days || []).flatMap(day => (day.sessions || []).map(session => session.routineSnapshot).filter(Boolean))), [weeks])
  const routineOptions = useMemo(() => {
    const known = new Map()
    for (const routine of routines) if (!draftRoutines[routine.id]) known.set(String(routine.id), routine)
    for (const routine of Object.values(draftRoutines)) known.set(String(routine.id), routine)
    for (const routine of snapshotRoutines) if (!known.has(String(routine.id))) known.set(String(routine.id), routine)
    return [...known.values()]
  }, [routines, draftRoutines, snapshotRoutines])
  const routineById = routineId => routineOptions.find(routine => String(routine.id) === String(routineId)) || null

  const changeLength = value => {
    const nextLength = Math.max(1, Math.min(52, Math.round(Number(value) || 1)))
    setLength(nextLength)
    setWeeks(previous => {
      if (nextLength <= previous.length) return previous.slice(0, nextLength).map((week, index) => ({ ...week, weekIndex: index + 1 }))
      const additions = programmeWeeksFromSource(S, source, nextLength).slice(previous.length)
      return [...previous, ...additions]
    })
    setCopyTargets(targets => targets.filter(index => index < nextLength))
  }

  const changeSource = nextSource => {
    setSource(nextSource)
    const selectedSource = sources.find(option => option.value === nextSource)
    if (selectedSource?.progression) setProgression(selectedSource.progression)
    setWeeks(programmeWeeksFromSource(S, nextSource, length))
    setSelectedWeek(0)
    setSelectedDay(1)
    setCopyTargets([])
  }

  const updateDay = sessions => {
    setWeeks(previous => setProgrammeDaySessions(previous, selectedWeek, selectedDay, sessions))
  }

  const addSession = routine => {
    if (!routine) return
    updateDay([...(currentDay.sessions || []), routineSession(routine, selectedWeek + 1, selectedDay, currentDay.sessions?.length || 0)])
  }

  const addRoutine = () => {
    const routine = {
      id: `routine:${uid()}`,
      name: `${t('New routine')} ${routines.length + 1}`,
      emoji: 'dumbbell',
      prog: 'linear',
      ex: []
    }
    setDraftRoutines(previous => ({ ...previous, [routine.id]: routine }))
    addSession(routine)
    setRoutineDraft(clone(routine))
  }

  const openRoutineEditor = routine => {
    if (!routine?.id) return
    setRoutineDraft(clone(routineById(routine.id) || routine))
  }

  const updateRoutineDraft = routine => setRoutineDraft(routine ? clone(routine) : null)

  const removeRoutineSessions = routineId => {
    setWeeks(previous => previous.map(week => ({
      ...clone(week),
      days: (week.days || []).map(day => ({
        ...clone(day),
        sessions: (day.sessions || []).filter(session => String(session.routineId || session.routineSnapshot?.id) !== String(routineId))
      }))
    })))
  }

  const persistRoutine = routine => {
    if (!routine?.id || !(routine.ex || []).length) {
      if (routine?.id) removeRoutineSessions(routine.id)
      setDraftRoutines(previous => {
        const next = { ...previous }
        delete next[routine?.id]
        return next
      })
      setRoutineDraft(null)
      return
    }
    setDraftRoutines(previous => ({ ...previous, [routine.id]: clone(routine) }))
    setWeeks(previous => syncProgrammeRoutineSnapshots(previous, routine))
    update(state => {
      const existing = state.routines.find(item => String(item.id) === String(routine.id))
      if (existing) Object.assign(existing, clone(routine))
      else state.routines.push(clone(routine))
    })
    setRoutineDraft(null)
  }

  const cancelRoutineEdit = () => {
    if (routineDraft && !routines.some(routine => String(routine.id) === String(routineDraft.id))) removeRoutineSessions(routineDraft.id)
    setDraftRoutines(previous => {
      const next = { ...previous }
      delete next[routineDraft?.id]
      return next
    })
    setRoutineDraft(null)
  }

  const changeSessionRoutine = (sessionIndex, routineId) => {
    if (!routineId) {
      updateDay(currentDay.sessions.filter((_, index) => index !== sessionIndex))
      return
    }
    const routine = routineById(routineId)
    if (!routine) return
    updateDay(currentDay.sessions.map((session, index) => index === sessionIndex
      ? routineSession(routine, selectedWeek + 1, selectedDay, index)
      : session))
  }

  const copyWeek = () => {
    if (!copyTargets.length) return
    setWeeks(previous => copyProgrammeWeekToTargets(previous, selectedWeek, copyTargets))
    setCopyTargets([])
  }

  const save = () => {
    const drafts = { ...draftRoutines, ...(routineDraft?.id ? { [routineDraft.id]: routineDraft } : {}) }
    const validDrafts = Object.fromEntries(Object.entries(drafts).filter(([, routine]) => (routine.ex || []).length))
    const allRoutines = [...routines.filter(routine => !drafts[routine.id]), ...Object.values(validDrafts)]
    const hydratedWeeks = hydrateRoutineSnapshots(weeks, allRoutines)
    const cleanWeeks = sanitizeProgrammeWeeks(hydratedWeeks).map(week => ({
      ...week,
      days: (week.days || []).map(day => ({
        ...day,
        sessions: (day.sessions || []).filter(session => {
          const rid = String(session.routineId || session.routineSnapshot?.id || '')
          if (!rid.startsWith('routine:')) return true
          return !!(session.routineSnapshot?.ex || []).length
        })
      }))
    }))
    const definition = createProgrammeDefinition({
      id: editDefinition?.id,
      name: name.trim() || t('Untitled programme'),
      progression,
      colour,
      weeks: cleanWeeks,
      timeZone: localTZ()
    }, { lengthWeeks: length })
    update(state => {
      saveProgrammeInState(state, definition, { editCycleId, pendingRoutines: validDrafts })
    })
    cancelProgrammeEdit(nav)
  }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t(editDefinition ? 'Edit programme' : 'New programme')}</h1><div className="sub">{t('Build a reusable training cycle')}</div></div>
      <button className="iconbtn" onClick={() => cancelProgrammeEdit(nav)} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>

    <div className="card">
      <label className="field-label" htmlFor="programme-name">{t('Programme name')}</label>
      <TextField id="programme-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('e.g. PPL Strength')} />
      <div className="sect-b" style={{ marginTop: 14 }}>
        <Stepper value={length} step={1} onChange={changeLength} label={t('Number of weeks')} unit={t('weeks')} decimal={false} />
      </div>
      <label className="field-label" htmlFor="programme-progression" style={{ marginTop: 14 }}>{t('Progression')}</label>
      <select id="programme-progression" className="field" value={progression} onChange={event => setProgression(event.target.value)}>
        {POLICIES.map(policy => <option key={policy} value={policy}>{t(POLICY_NAME[policy])}</option>)}
      </select>
      <div className="field-label" style={{ marginTop: 14 }}>{t('Programme colour')}</div>
      <div className="row" role="radiogroup" aria-label={t('Programme colour')} style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" data-testid="programme-colour-none" aria-pressed={colour == null}
          aria-label={t('No colour')} title={t('No colour')} onClick={() => setColour(null)}
          style={{ width: 28, height: 28, padding: 0, borderRadius: '50%', border: colour == null ? '3px solid var(--label)' : '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--label-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="xmark" style={{ fontSize: 13 }} />
        </button>
        {PROGRAMME_COLOURS.map(option => <button key={option.key} type="button" data-testid={`programme-colour-${option.key}`}
          aria-pressed={colour === option.key} aria-label={`${t('Programme colour')}: ${option.key}`} title={option.key}
          onClick={() => setColour(option.key)}
          style={{ width: 28, height: 28, padding: 0, borderRadius: '50%', border: colour === option.key ? '3px solid var(--label)' : '1px solid var(--line)', background: option.css }} />)}
      </div>
    </div>

    {!editDefinition && <>
    <h4 className="sec">{t('Start with')}</h4>
    <select className="field" value={source} onChange={event => changeSource(event.target.value)} aria-label={t('Start with')}>
      {sources.map(option => <option key={option.value} value={option.value}>{option.kind === 'programme' ? `${t('Clone')}: ${option.label}` : t(option.label)}</option>)}
    </select>
    <div className="small dim" style={{ margin: '10px 2px 16px', lineHeight: 1.45 }}>
      {source === 'current' ? t('Copies this week’s routines into each programme week. You can edit the templates later.')
        : source === 'blank' ? t('Creates empty weeks. Add routines when you are ready to start the cycle.')
          : t('Clones the selected programme. Week modes and sessions remain editable.')}
    </div>
    </>}

    <h4 className="sec">{t('Week templates')}</h4>
    <div className="programme-builder-weeks" role="tablist" aria-label={t('Week templates')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(78px,1fr))', gap: 7 }}>
      {weeks.map((week, index) => <button key={index} type="button" role="tab" aria-selected={selectedWeek === index}
        className={'card' + (selectedWeek === index ? ' active' : '')} style={{ padding: 9, textAlign: 'left', cursor: 'pointer', border: selectedWeek === index ? '2px solid var(--acc)' : '1px solid var(--line)' }}
        onClick={() => { setSelectedWeek(index); setCopyTargets([]) }}>
        <strong>{t('Week')} {index + 1}</strong>
        <span className="small dim" style={{ display: 'block', marginTop: 4 }}>{modeLabel(week.mode)}</span>
        <span className="small" style={{ display: 'block', marginTop: 3 }}>{(week.days || []).reduce((count, day) => count + (day.sessions || []).length, 0)} {t('sessions')}</span>
      </button>)}
    </div>

    {current && <>
      <div className="row" style={{ justifyContent: 'space-between', margin: '14px 0 8px', gap: 8 }}>
        <div className="small dim">{t('Week')} {selectedWeek + 1} · {t('Mode')}</div>
        <Segmented value={current.mode || 'normal'} onChange={mode => setWeeks(previous => previous.map((week, index) => index === selectedWeek ? cycleWeekMode(week, mode) : week))}
          options={WEEK_MODES.map(mode => ({ value: mode, label: modeLabel(mode) }))} />
      </div>

      <div className="card" style={{ padding: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <strong>{t('Copy week')}</strong>
          <Button size="sm" variant="tinted" icon="copy" disabled={!copyTargets.length} onClick={copyWeek}>{t('Copy')}</Button>
        </div>
        <div className="small dim" style={{ margin: '5px 0 8px' }}>{t('Copy this week to any selected destination weeks.')}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {weeks.map((week, index) => index === selectedWeek ? null : <button key={index} type="button" className={'tag' + (copyTargets.includes(index) ? ' acc' : '')}
            onClick={() => setCopyTargets(targets => targets.includes(index) ? targets.filter(item => item !== index) : [...targets, index])}
            aria-pressed={copyTargets.includes(index)}>{t('Week')} {index + 1}</button>)}
        </div>
      </div>

      <h4 className="sec">{t('Day sessions')}</h4>
      <div className="list programme-builder-days">
        {[1, 2, 3, 4, 5, 6, 7].map(weekday => {
          const day = dayOf(current, weekday)
          const jsDay = weekday === 7 ? 0 : weekday
          const editing = selectedDay === weekday
          return <div key={weekday} className="item" style={{ display: 'block', padding: '10px 12px' }}>
            <button type="button" className="row" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', padding: 0, textAlign: 'left' }} onClick={() => setSelectedDay(weekday)}>
              <span className="grow"><strong>{t(DAYN[jsDay])}</strong><span className="small dim" style={{ display: 'block', marginTop: 2 }}>{day.sessions?.length ? `${day.sessions.length} ${t('sessions')}` : t('Rest day')}</span></span>
              <Icon name={editing ? 'chevronUp' : 'chevronDown'} />
            </button>
            {editing && <div style={{ marginTop: 10 }}>
              {(day.sessions || []).map((session, sessionIndex) => <div key={session.id || sessionIndex} className="row" style={{ gap: 6, marginBottom: 7 }}>
                <select className="field grow" value={session.routineId || session.routineSnapshot?.id || ''} onChange={event => changeSessionRoutine(sessionIndex, event.target.value)} aria-label={t('Select routine')}>
                  {routineOptions.map(routine => <option key={routine.id} value={routine.id}>{routine.name || t('Unnamed routine')}</option>)}
                </select>
                {(session.routineId || session.routineSnapshot?.id) && <>
                  <Button size="sm" variant="ghost" onClick={() => openRoutineEditor(routineById(session.routineId || session.routineSnapshot?.id) || session.routineSnapshot)}>{t('Edit routine')}</Button>
                  <button type="button" className="iconbtn" aria-label={t('Remove session')} title={t('Remove session')} onClick={() => changeSessionRoutine(sessionIndex, '')}><Icon name="xmark" /></button>
                </>}
              </div>)}
              <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
                {routineOptions.length > 0 && <select className="field" style={{ flex: 1, minWidth: 150 }} defaultValue="" onChange={event => { const routine = routineById(event.target.value); if (routine) addSession(routine); event.target.value = '' }} aria-label={t('Add session')}>
                  <option value="">{t('Add session')}</option>
                  {routineOptions.map(routine => <option key={routine.id} value={routine.id}>{routine.name || t('Unnamed routine')}</option>)}
                </select>}
                <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
              </div>
            </div>}
          </div>
        })}
      </div>
      <RoutineDraftEditor routine={routineDraft} state={S} onChange={updateRoutineDraft} onDone={() => persistRoutine(routineDraft)} onCancel={cancelRoutineEdit} />
    </>}

    <Button variant="primary" icon="check" style={{ width: '100%', marginTop: 16 }} onClick={save}>{t('Save programme')}</Button>
  </div>
}