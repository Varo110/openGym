import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYS, uid, exCount, todayISO, fmtDate, isoOf, localTZ } from '../lib/format.js'
import { effortOf, effectiveRoutines, effectiveRoutineIds } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { dayOverrideSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import {
  activeProgrammeCycles,
  completeProgrammeCycleInState,
  completedProgrammeCycles,
  programmeColourForItem,
  programmeLabelForItem,
  programmeProjection,
  readyProgrammeDefinitions
} from '../lib/programmes-ui.js'
import { ActiveProgrammeCard, ActiveProgrammeDetail, ReadyProgrammeDetail, ReadyProgrammeRow } from '../components/ProgrammeCard.jsx'
import { confirmSheet } from '../sheets.jsx'

export function planRowRoutineIds(S, iso) {
  const dayPlan = S?.dayPlan || {}
  if (Object.prototype.hasOwnProperty.call(dayPlan, iso)) return effectiveRoutineIds(S, iso)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const routineId = S?.week?.[wd]
  return routineId && (S?.routines || []).some(r => r.id === routineId) ? [routineId] : []
}

function programmeRowsForDate(iso, projection) {
  return (projection?.items || [])
    .filter(item => item.source === 'programme' && item.projectedDate === iso)
    .sort((a, b) => Number(a.weekIndex || 0) - Number(b.weekIndex || 0) || Number(a.ordinal || 0) - Number(b.ordinal || 0))
}

function uniqueProgrammeLabels(S, items) {
  const seen = new Set()
  return items.filter(item => {
    const key = item.instanceId || `${item.programmeId || ''}:${item.cycleId || ''}:${item.weekIndex || ''}:${item.routineId || ''}:${item.ordinal || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(item => ({ item, label: programmeLabelForItem(S, item) }))
}

function programmeTagStyle(S, item, base = {}) {
  const colour = programmeColourForItem(S, item)
  if (!colour) return base
  return {
    ...base,
    color: colour,
    background: `color-mix(in srgb, ${colour} 16%, transparent)`,
    border: `1px solid color-mix(in srgb, ${colour} 38%, transparent)`
  }
}

export function activeProgrammeEditState(cycle) {
  return { mode: 'edit-cycle', cycleId: cycle?.id || null, programmeId: cycle?.programmeId || null }
}

// Set when an exercise row deep-links into a routine editor; Plan restores the
// originating programme detail on the way back (back button = one screen).
let programmeReturnTo = null

export default function Plan() {
  useEffect(() => {
    if (!programmeReturnTo) return
    const { kind, id } = programmeReturnTo
    programmeReturnTo = null
    if (kind === 'active') setOpenCycleId(id)
    else if (kind === 'ready') setOpenReadyId(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // The week schedule is a rolling 8-day window: the current day holds the first slot and
  // everything shifts along as days pass, instead of weekdays living in fixed positions.
  const rollingISO = offset => {
    const day = new Date(todayISO() + 'T12:00:00')
    day.setDate(day.getDate() + offset)
    return isoOf(day)
  }
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [date, setDate] = useState(todayISO())
  const [openCycleId, setOpenCycleId] = useState(null)
  const [openReadyId, setOpenReadyId] = useState(null)
  const now = Date.now()
  const overrides = Object.keys(S.dayPlan || {}).sort()
  const activeCycles = activeProgrammeCycles(S)
  const readyDefinitions = readyProgrammeDefinitions(S)
  const completedCycles = completedProgrammeCycles(S)
  const openCycle = activeCycles.find(cycle => cycle.id === openCycleId) || null
  // Keep the mixed projection alive on the Plan surface so cards and week chips use the same
  // queue boundary as Home and Workout rather than re-deriving a calendar from templates.
  const programmeQueue = programmeProjection(S, { now, timeZone: localTZ() })

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  const completeEarly = cycle => confirmSheet({
    title: t('Complete programme early?'),
    message: t('This keeps the completed cycle in Stats and removes its future sessions from the plan.'),
    confirmText: t('Complete early'),
    onConfirm: () => {
      update(s => { completeProgrammeCycleInState(s, cycle.id, { reason: 'early' }) })
      useUI.getState().toast(t('Programme completed'))
    }
  })

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Programmes & weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>

    <h4 className="sec">{t('Active programmes')}</h4>
    {activeCycles.length ? activeCycles.map(cycle => <ActiveProgrammeCard key={cycle.id} state={S} cycle={cycle} now={now} projection={programmeQueue}
      onOpen={item => setOpenCycleId(item.id)} onComplete={completeEarly} />) : (
      <div className="muted small" style={{ padding: '0 4px 4px' }}>{t('No active programmes')}</div>
    )}
    {openCycle && <ActiveProgrammeDetail state={S} cycle={openCycle} now={now} projection={programmeQueue}
      onClose={() => { programmeReturnTo = null; setOpenCycleId(null) }} onComplete={completeEarly}
      onEdit={cycle => nav('/programme/new', { state: activeProgrammeEditState(cycle) })}
      onExercise={(routineId, exId, index, occurrence) => {
        programmeReturnTo = { kind: 'active', id: openCycle.id }
        routineId && nav(`/plan/r/${routineId}?ex=${encodeURIComponent(exId)}&exi=${index}&exo=${occurrence}`)
      }} />}

    <h4 className="sec">{t('Week schedule')}</h4>
    {/* Rolling week grid like Home, with the routines/programmes under each day. */}
    <div className="pweek">
      {Array.from({ length: 8 }, (_, offset) => {
        const iso = rollingISO(offset)
        const overridden = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, iso)
        const shown = planRowRoutineIds(S, iso)
        const programmeItems = programmeRowsForDate(iso, programmeQueue)
        const programmeLabels = uniqueProgrammeLabels(S, programmeItems)
        const programmeRoutineIds = new Set(programmeItems
          .map(item => item.routineId || item.routineSnapshot?.id)
          .filter(Boolean)
          .map(id => String(id)))
        const standaloneShown = shown.filter(pid => !programmeRoutineIds.has(String(pid)))
        const hasPlan = shown.length || programmeLabels.length
        // The calculated queue is intentionally read here even when no programme lands on this
        // date: it makes malformed optional programme data fail closed without changing routine
        // rows and keeps this surface tied to the same projected queue snapshot.
        const queueItems = programmeQueue.items.filter(item => item.projectedDate === iso && item.source === 'programme')
        const visibleProgrammeLabels = programmeLabels.length ? programmeLabels : uniqueProgrammeLabels(S, queueItems)
        // Calendar cells are deliberately short: the full routine/programme name is
        // available on tap, while the strip stays readable instead of repeating a clipped
        // "Functional Hype..." label in every column.
        const compactLabel = value => {
          const text = String(value || '').trim()
          if (!text) return t('Rest')
          if (text.includes(' · ')) return text.split(' · ')[0].slice(0, 5)
          const words = text.split(/\s+/).filter(Boolean)
          return words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('').toUpperCase() : text.slice(0, 5)
        }
        const weekday = new Date(iso + 'T12:00:00').getDay()
        return <div key={iso} data-iso={iso} className={'wday pday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
          <div className="lbl">{t(DAYS[weekday])}</div>
          <div className="num">{iso.slice(8, 10)}<span className="dim pday-month">/{iso.slice(5, 7)}</span></div>
          <div className="pday-tags">
            {visibleProgrammeLabels.map(({ item, label }) => <span key={`${item.instanceId}:${label}`} className="tag programme-tag pday-tag" style={programmeTagStyle(S, item)} aria-label={label} title={label}>{compactLabel(label)}</span>)}
            {standaloneShown.map((pid, i) => {
              const routine = S.routines.find(x => x.id === pid)
              return routine ? <span key={pid} className="tag acc pday-tag" aria-label={routine.name} title={routine.name}>{overridden && <b style={{ marginRight: 3 }}>{i + 1}.</b>}{compactLabel(routine.name)}</span> : null
            })}
            {!hasPlan && !visibleProgrammeLabels.length && <span className="tag pday-tag">{t('Rest')}</span>}
          </div>
        </div>
      })}
    </div>

    <div className="row between" style={{ marginTop: 14, marginBottom: 10 }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Ready programmes')} <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>— {t('start anytime')}</span></h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={() => nav('/programme/new')}>{t('New programme')}</Button>
    </div>
    {readyDefinitions.length ? <div className="list">{readyDefinitions.map(definition => <ReadyProgrammeRow key={definition.id} definition={definition}
      done={completedCycles.some(cycle => String(cycle.programmeId) === String(definition.id))}
      onStart={item => nav('/programme/pickup', { state: { programmeId: item.id, mode: 'start' } })}
      onOpen={item => setOpenReadyId(item.id)} />)}</div> : (
      <div className="empty"><div className="ico"><Icon name="sparkles" /></div>{t('No ready programmes')}<br />{t('Create a programme from your current week or start with blank weeks.')}</div>
    )}
    {openReadyId && (() => {
      const definition = readyDefinitions.find(d => String(d.id) === String(openReadyId))
      if (!definition) return null
      return <div style={{ marginTop: 12 }}><ReadyProgrammeDetail definition={definition} effortKind={effortOf(S)} customEx={S.customEx || []}
        onClose={() => { programmeReturnTo = null; setOpenReadyId(null) }}
        onEdit={item => nav('/programme/new', { state: { mode: 'edit', programmeId: item.id } })}
        onStart={item => nav('/programme/pickup', { state: { programmeId: item.id, mode: 'start' } })}
        onExercise={(routineId, exId, index, occurrence) => {
          programmeReturnTo = { kind: 'ready', id: definition.id }
          routineId && nav(`/plan/r/${routineId}?ex=${encodeURIComponent(exId)}&exi=${index}&exo=${occurrence}`)
        }} /></div>
    })()}

    <h4 className="sec">{t('Date-specific plans')}</h4>
    <div className="small dim" style={{ margin: '-4px 2px 10px', lineHeight: 1.4 }}>{t('Add or remove multiple routines for one date without changing the weekly schedule.')}</div>
    <div className="row" style={{ gap: 8, marginBottom: 10 }}>
      <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label={t('Date')} style={{ minWidth: 0, flex: 1 }} />
      <Button size="sm" variant="tinted" icon="calendar" onClick={() => date && dayOverrideSheet(date)}>{t('Edit day')}</Button>
    </div>
    {overrides.length > 0 && <div className="list">{overrides.map(iso => {
      const plans = effectiveRoutines(S, iso)
      return <div key={iso} className="item" onClick={() => dayOverrideSheet(iso)}>
        <div className="grow"><div className="tt">{fmtDate(iso, true)}</div><div className="ss">{plans.length ? plans.map(r => r.name).join(' + ') : t('Rest')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    })}</div>}

    <div className="row between" style={{ marginTop: 14, marginBottom: 10 }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
    </div>
    {S.routines.some(r => !r.draft) ? <div className="list">{S.routines.filter(r => !r.draft).map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
      <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
      <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
      <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
      <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
    </>}
  </div>
}
