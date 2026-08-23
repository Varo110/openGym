import { useState } from 'react'
import { fmtDate, fmtNum, DAYS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { EXIDX } from '../lib/exercises.js'
import { supersetUnits } from '../lib/history.js'
import {
  programmeCycleItems,
  programmePRSummary,
  programmeProgressSummary,
  programmeProjection,
  programmeSummary,
  programmeTimelineForCycle,
  programmeWeekState
} from '../lib/programmes-ui.js'

const statusColor = {
  done: 'var(--acc)',
  current: 'var(--acc)',
  deload: 'var(--orange)',
  rest: 'var(--red)',
  normal: 'var(--surface-3)'
}

function dateOnly(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const at = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null
}

export function ProgrammeWeekStrip({ cycle, items = [], now, compact = false }) {
  const summary = programmeSummary({}, cycle, { now, timeZone: cycle?.timeZone })
  const weeks = summary.weeks.length ? summary.weeks : Array.from({ length: summary.totalWeeks }, (_, index) => ({ weekIndex: index + 1 }))
  const current = summary.currentWeek
  return <div className="programme-week-strip" aria-label={t('Programme weeks')} style={{ display: 'flex', gap: 5, padding: compact ? '7px 0 0' : '10px 0 0' }}>
    {weeks.map((week, index) => {
      const state = programmeWeekState(week, index)
      const weekNumber = state.index
      const weekItems = items.filter(item => Number(item.weekIndex) === weekNumber)
      const settled = weekItems.length > 0 && weekItems.every(item => ['completed', 'partial-advanced', 'skipped'].includes(item.status))
      const kind = settled ? 'done' : weekNumber === current ? 'current' : state.mode
      return <span key={weekNumber} title={t('Week {0}: {1}', weekNumber, t(state.label))}
        style={{ flex: 1, minWidth: 12, height: compact ? 5 : 7, borderRadius: 4, background: statusColor[kind] || statusColor.normal, opacity: kind === 'normal' && weekNumber > current ? .55 : 1, outline: kind === 'current' ? '2px solid color-mix(in srgb,var(--acc) 38%,transparent)' : undefined, outlineOffset: 1 }} />
    })}
  </div>
}

const settledProgrammeStatuses = new Set(['completed', 'partial-advanced', 'skipped'])

function routineForItem(item) {
  return item?.routineSnapshot || item?._session?.routineSnapshot || item?.routine || {}
}

function programmeDayLabel(weekday) {
  const value = Number(weekday)
  const day = value === 7 ? 0 : value
  return t(DAYS[Number.isInteger(day) && day >= 0 && day < DAYS.length ? day : 0])
}

function programmeItemMeta(item) {
  const routine = routineForItem(item)
  const configuredExercises = Array.isArray(routine.ex) ? routine.ex : []
  const exerciseCount = Array.isArray(item?.exercises) ? item.exercises.length : configuredExercises.length
  const setCount = configuredExercises.reduce((sum, exercise) => sum + Math.max(0, Number(exercise?.sets) || 0), 0)
  const exerciseKey = exerciseCount === 1 ? '{0} exercise' : '{0} exercises'
  return `${t(exerciseKey, exerciseCount)} · ${t('{0} sets', setCount)}`
}

function programmeStatus(item, isNext) {
  if (isNext) return { className: 'is-next', label: t('Next') }
  if (settledProgrammeStatuses.has(item?.status)) return { className: 'is-done', label: t('Done') }
  return { className: 'is-planned', label: t('Planned') }
}

export function ActiveProgrammeCard({ state, cycle, now, projection, onComplete, onOpen }) {
  const summary = programmeSummary(state, cycle, { now, timeZone: cycle?.timeZone })
  const queue = projection || (state ? programmeProjection(state, { now, timeZone: cycle?.timeZone }) : null)
  const projected = queue?.items?.filter(item => item.cycleId === cycle.id) || []
  const items = projected.length ? projected : programmeCycleItems(cycle, { now, timeZone: cycle?.timeZone })
  const sessions = items.length
  const open = () => onOpen?.(cycle)
  const content = <>
    <div className="row" style={{ alignItems: 'center', gap: 10 }}>
      <span className="lrow-i" style={{ background: 'var(--acc-soft)', color: 'var(--acc)', fontSize: 22 }}><Icon name={glyphOf(summary.emoji)} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="tt">{summary.name}</span>
          <span className="tag acc">{t('Active')}</span>
          <span className="tag">{t('Week {0} of {1}', summary.currentWeek, summary.totalWeeks)}</span>
        </div>
        <div className="ss">{summary.progression ? t('Progression: {0}', summary.progression) : t('{0} programme sessions', sessions)}</div>
      </div>
    </div>
    <ProgrammeWeekStrip cycle={cycle} items={items} now={now} />
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
      <Button size="sm" variant="ghost" icon="flag" onClick={event => { event.stopPropagation(); onComplete?.(cycle) }}>{t('Complete early')}</Button>
      {onOpen && <Button size="sm" variant="tinted" trailingIcon="chevronRight" onClick={event => { event.stopPropagation(); open() }}>{t('View programme')}</Button>}
    </div>
  </>
  return <article className="card programme-card" data-testid="active-programme-card">{content}</article>
}

// Superset groups: consecutive exercises sharing an sg value render as one
// bracketed A1/A2/A3… group (any group size, mirrors the approved mockup C).
function renderSupersetGroups(rows, rowKey, nameOf, targetOf, notesOf, sgOf, restOf, onExercise) {
  const groups = supersetUnits(rows).map(indices => {
    const members = indices.map(index => rows[index])
    return {
      sg: members.length > 1 ? sgOf(members[0]) : null,
      rows: members,
      indices
    }
  })
  const occurrenceOf = (row, index) => rows
    .slice(0, index + 1)
    .filter(candidate => String(candidate?.id) === String(row?.id)).length - 1
  const activate = (event, row, index) => {
    if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return
    if (event?.type === 'keydown') event.preventDefault()
    onExercise?.(row, index, occurrenceOf(row, index))
  }
  let ssIndex = 0
  return groups.map((group) => {
    if (!group.sg) {
      const row = group.rows[0]
      const index = group.indices[0]
      return (
        <div className="prog-exercise-row" key={rowKey(row)} data-testid="programme-exercise-timeline" role="button" tabIndex={0}
          onClick={event => activate(event, row, index)} onKeyDown={event => activate(event, row, index)} style={{ cursor: 'pointer' }}>
          <span className="prog-exercise-name">{nameOf(row)}</span>
          <span className="prog-exercise-meta"><span className="prog-exercise-target">{targetOf(row)}</span></span>
          {notesOf(row) && <span className="prog-exercise-note dim">{notesOf(row)}</span>}
        </div>
      )
    }
    ssIndex += 1
    const isGiant = group.rows.length > 2
    return (
      <div className="prog-ssg" key={rowKey(group.rows[0])} data-testid="programme-superset-group">
        <div className="prog-ssg-head">
          <span className="tag acc">{isGiant ? t('Giant set') : t('Superset')} {ssIndex}</span>
        </div>
        <div className="prog-ssg-bracket">
          {group.rows.map((row, i) => {
            const index = group.indices[i]
            const rest = restOf(row)
            const notes = notesOf(row)
            return (
              <div className="prog-exercise-row prog-ssg-row" key={rowKey(row)} role="button" tabIndex={0}
                onClick={event => activate(event, row, index)} onKeyDown={event => activate(event, row, index)} style={{ cursor: 'pointer' }}>
                <span className="prog-ssg-label">{'A' + (i + 1)}</span>
                <span className="prog-exercise-name">{nameOf(row)}</span>
                <span className="prog-ssg-target">{targetOf(row)}</span>
                {rest != null && <span className="prog-ssg-rest">{t('rest {0} s', rest)}</span>}
                {notes && <span className="prog-ssg-note dim" style={{ flexBasis: '100%', paddingLeft: 30, fontSize: 10.5, lineHeight: 1.4 }}>{notes}</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  })
}

export function ActiveProgrammeDetail({ state, cycle, now, projection, onClose, onComplete, onEdit, onExercise }) {
  const summary = programmeSummary(state, cycle, { now, timeZone: cycle?.timeZone })
  const queue = projection || programmeProjection(state, { now, timeZone: cycle?.timeZone })
  const statusByInstance = new Map((queue?.items || []).filter(item => item.cycleId === cycle.id).map(item => [item.instanceId, item]))
  const timeline = programmeTimelineForCycle(state, cycle, { now, timeZone: cycle?.timeZone })
  const groups = timeline.weeks.map(group => ({
    ...group,
    items: group.items.map(item => ({
      ...item,
      ...(statusByInstance.get(item.instanceId) || {}),
      status: statusByInstance.get(item.instanceId)?.status || item.status || 'pending'
    }))
  }))
  const currentGroup = groups.find(group => group.index === timeline.currentWeek) || groups[0] || null
  // The Monday (dd/mm) of any programme week, anchored on the cycle's week-1 start.
  const mondayOfWeek = weekIndex => {
    const anchor = timeline.cycle?.week1StartDate
    if (!anchor) return null
    const day = new Date(anchor + 'T12:00:00')
    day.setDate(day.getDate() + (Number(weekIndex) - 1) * 7)
    return String(day.getDate()).padStart(2, '0') + '/' + String(day.getMonth() + 1).padStart(2, '0')
  }
  const ddmmOf = iso => (iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) : '')
  const [selectedWeek, setSelectedWeek] = useState(() => currentGroup?.index || summary.currentWeek)
  const [nextOpen, setNextOpen] = useState(false)
  const [expandedSessions, setExpandedSessions] = useState(() => new Set())
  const selectedGroup = groups.find(group => group.index === selectedWeek) || currentGroup
  const nextItem = groups.flatMap(group => group.items).find(item => !settledProgrammeStatuses.has(item.status)) || null
  const selectWeek = weekIndex => {
    setSelectedWeek(weekIndex)
    setNextOpen(true)
    setExpandedSessions(new Set())
  }
  const toggleSession = instanceId => {
    setExpandedSessions(previous => {
      const next = new Set(previous)
      if (next.has(instanceId)) next.delete(instanceId)
      else next.add(instanceId)
      return next
    })
  }
  const renderExerciseRows = item => renderSupersetGroups(
    item?.exercises || [],
    exercise => exercise.key,
    exercise => exercise.name,
    exercise => `${exercise.last} → ${exercise.next}`,
    exercise => exercise.notes,
    exercise => exercise.sg,
    exercise => exercise.rest,
    (exercise, index, occurrence) => onExercise?.(item?.routineId || item?.routineSnapshot?.id, exercise.id, index, occurrence)
  )
  return <section className="card programme-detail" data-testid="active-programme-detail" aria-label={t('Programme timeline')}>
    <div className="prog-detail-head row">
      <div><h3 style={{ margin: 0 }}>{summary.name}</h3><div className="small dim">{t('Programme timeline')} · {t('Week {0} of {1}', summary.currentWeek, summary.totalWeeks)}</div></div>
      <button className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
    <div className="prog-pills" role="tablist" aria-label={t('Programme weeks')}>
      {groups.map(group => <button
        key={group.index}
        type="button"
        role="tab"
        aria-selected={group.index === selectedGroup?.index}
        aria-label={t('Week {0} of {1}', group.index, summary.totalWeeks)}
        data-testid={`programme-week-pill-${group.index}`}
        className={`prog-pill${group.index === timeline.currentWeek ? ' is-current' : ''}${group.index === selectedGroup?.index ? ' is-selected' : ''}${group.mode === 'deload' ? ' is-deload' : ''}${group.mode === 'rest' ? ' is-rest' : ''}`}
        onClick={() => selectWeek(group.index)}
      >{group.index}{mondayOfWeek(group.index) && <span className="prog-pill-date">{mondayOfWeek(group.index)}</span>}</button>)}
    </div>
    {nextItem && <article className="prog-next" data-testid="programme-next-up">
      <button type="button" className="prog-next-toggle" data-testid="programme-next-toggle" aria-expanded={nextOpen} onClick={() => setNextOpen(open => !open)}>
        <span className="prog-next-day"><span className="tag acc">{t('Next').toUpperCase()}</span><span>{programmeDayLabel(nextItem.weekday)}</span></span>
        <span className="grow"><strong className="prog-session-title">{nextItem.routineName || nextItem.routineSnapshot?.name || nextItem.routineId || t('Session')}</strong><span className="prog-session-meta">{programmeItemMeta(nextItem)}</span></span>
        <Icon name="chevronRight" className={`prog-chevron${nextOpen ? ' is-open' : ''}`} />
      </button>
      <div className={`prog-exercises${nextOpen ? ' is-open' : ''}`}>
        {renderExerciseRows(nextItem)}
      </div>
    </article>}
    {selectedGroup && <>
      <div className={`prog-week-label${selectedGroup.mode === 'deload' ? ' is-deload' : ''}${selectedGroup.mode === 'rest' ? ' is-rest' : ''}`} data-testid="programme-week-label">{t('Week')} {selectedGroup.index} · {t('sessions')}{selectedGroup.mode === 'deload' ? ' · ' + t('deload') : selectedGroup.mode === 'rest' ? ' · ' + t('rest week') : ''}</div>
      {selectedGroup.items.length ? <div className="prog-day-list" data-testid="programme-day-list">
        {[1, 2, 3, 4, 5, 6, 7].map(weekday => {
          const dayItems = selectedGroup.items.filter(item => Number(item.weekday) === weekday)
          if (!dayItems.length) return null
          return <div key={weekday} className={`prog-day-row${selectedGroup.mode === 'deload' ? ' is-deload' : ''}${selectedGroup.mode === 'rest' ? ' is-rest' : ''}`} data-testid="programme-day-row">
            <div className="prog-day-head">
              <span className="tag acc prog-session-day">{programmeDayLabel(weekday)}</span>
              <span className="prog-day-date dim">{ddmmOf(dayItems[0].projectedDate)}</span>
            </div>
            <div className="prog-day-sessions">
        {dayItems.map(item => {
          const open = expandedSessions.has(item.instanceId)
          const isNext = nextItem?.instanceId === item.instanceId
          const status = programmeStatus(item, isNext)
          return <article className={`prog-session${open ? ' is-open' : ''}`} key={item.instanceId}>
            <button type="button" className="prog-session-toggle" data-testid="programme-session-row" aria-expanded={open} onClick={() => toggleSession(item.instanceId)}>
              <span className="tag acc prog-session-day">{programmeDayLabel(item.weekday)}</span>
              <span className="grow"><strong className="prog-session-title">{item.routineName || item.routineSnapshot?.name || item.routineId || t('Session')}</strong><span className="prog-session-meta">{programmeItemMeta(item)}</span></span>
              <span className={`prog-status ${status.className}`}>{status.label}</span>
              <Icon name="chevronRight" className={`prog-chevron${open ? ' is-open' : ''}`} />
            </button>
            <div className={`prog-exercises${open ? ' is-open' : ''}`}>
              {renderExerciseRows(item)}
            </div>
          </article>
        })}
            </div>
          </div>
        })}
      </div> : <div className={`small dim prog-empty-week${selectedGroup.mode === 'deload' ? ' is-deload' : ''}${selectedGroup.mode === 'rest' ? ' is-rest' : ''}`}>{selectedGroup.mode === 'deload' ? t('Deload week') : t('Rest week')}</div>}
    </>}
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
      {onEdit && <Button size="sm" variant="tinted" icon="edit" onClick={() => onEdit?.(cycle)}>{t('Edit programme')}</Button>}
      <Button size="sm" variant="ghost" icon="flag" onClick={() => onComplete?.(cycle)}>{t('Complete early')}</Button>
    </div>
  </section>
}

export function ReadyProgrammeDetail({ definition, onStart, onClose, onEdit, effortKind = 'none', customEx = [], onExercise }) {
  const [selectedWeek, setSelectedWeek] = useState(() => 1)
  const [openSession, setOpenSession] = useState(null)
  const weeks = Array.isArray(definition?.weeks) ? definition.weeks : []
  const sessions = weeks.reduce((count, week) => count + (week?.days || []).reduce((n, day) => n + (day?.sessions || []).length, 0), 0)
  const selected = weeks[selectedWeek - 1] || weeks[0] || null
  const exerciseTarget = cfg => {
    const bits = []
    if (cfg.sets != null) bits.push(cfg.sets + ' × ' + (cfg.reps != null ? cfg.reps : cfg.sec != null ? cfg.sec + 's' : '?'))
    // The target effort scale follows the user's main-menu setting: RIR as stored, or
    // the RPE reading (RPE = 10 - RIR) when the user thinks in RPE.
    if (cfg.rir != null) bits.push(effortKind === 'rpe' ? 'RPE ' + Math.max(0, 10 - cfg.rir) : 'RIR ' + cfg.rir)
    return bits.join(' ')
  }
  return <section className="card programme-detail" data-testid="ready-programme-detail" aria-label={t('Programme preview')}>
    <div className="prog-detail-head row">
      <div><h3 style={{ margin: 0 }}>{definition?.name || t('Programme')}</h3><div className="small dim">{t('{0} weeks', weeks.length || 1)}{sessions ? ' · ' + t('{0} planned sessions', sessions) : ''}{definition?.progression ? ' · ' + t('Progression: {0}', definition.progression) : ''}</div></div>
      <button className="iconbtn" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
    </div>
    <div className="prog-pills" role="tablist" aria-label={t('Programme weeks')}>
      {weeks.map((week, index) => {
        const weekIndex = Number(week?.weekIndex ?? index + 1)
        const mode = week?.mode || 'normal'
        return <button key={weekIndex} type="button" role="tab"
          aria-selected={weekIndex === selectedWeek}
          aria-label={t('Week {0} of {1}', weekIndex, weeks.length)}
          data-testid={`ready-week-pill-${weekIndex}`}
          className={`prog-pill${weekIndex === selectedWeek ? ' is-selected' : ''}${mode === 'deload' ? ' is-deload' : ''}${mode === 'rest' ? ' is-rest' : ''}`}
          onClick={() => setSelectedWeek(weekIndex)}
        >{weekIndex}</button>
      })}
    </div>
    {selected && <>
      <div className={`prog-week-label${selected.mode === 'deload' ? ' is-deload' : ''}${selected.mode === 'rest' ? ' is-rest' : ''}`}>{t('Week')} {selectedWeek} · {t('sessions')}{selected.mode === 'deload' ? ' · ' + t('deload') : selected.mode === 'rest' ? ' · ' + t('rest week') : ''}</div>
      {(() => {
        const dayRows = (selected.days || []).filter(day => (day.sessions || []).length)
        if (!dayRows.length) return <div className={`small dim prog-empty-week${selected.mode === 'deload' ? ' is-deload' : ''}${selected.mode === 'rest' ? ' is-rest' : ''}`}>{selected.mode === 'deload' ? t('Deload week') : t('Rest week')}</div>
        return <div className="prog-day-list" data-testid="ready-day-list">
          {dayRows.map(day => <div key={day.weekday} className={`prog-day-row${selected.mode === 'deload' ? ' is-deload' : ''}${selected.mode === 'rest' ? ' is-rest' : ''}`}>
            <div className="prog-day-head">
              <span className="tag acc prog-session-day">{programmeDayLabel(day.weekday)}</span>
            </div>
            <div className="prog-day-sessions">
              {(day.sessions || []).map((session, sessionIndex) => {
                const routine = session.routineSnapshot || session.routine || {}
                const ex = Array.isArray(routine.ex) ? routine.ex : []
                const sessionKey = session.id || session.sessionTemplateId || `${day.weekday}:${sessionIndex}`
                const isOpen = openSession === sessionKey
                return <div key={sessionKey} className={'prog-session' + (isOpen ? ' is-open' : '')}>
                  <button type="button" className="prog-session-toggle" style={{ minHeight: 0, padding: '10px 12px' }} aria-expanded={isOpen}
                    onClick={() => setOpenSession(current => current === sessionKey ? null : sessionKey)}>
                    <span className="grow"><strong className="prog-session-title">{routine.name || session.routineId || t('Session')}</strong><span className="prog-session-meta">{ex.length ? t('{0} exercises · {1} sets', ex.length, ex.reduce((n, cfg) => n + (cfg.sets || 0), 0)) : ''}</span></span>
                    <Icon name="chevronRight" className={`prog-chevron${isOpen ? ' is-open' : ''}`} />
                  </button>
                  {isOpen && ex.length ? <div className="prog-exercises is-open">
                    {renderSupersetGroups(
                      ex,
                      cfg => cfg.id + ':' + (cfg.sg || 'plain') + ':' + ex.indexOf(cfg),
                      cfg => exerciseDisplayName(cfg, customEx),
                      cfg => exerciseTarget(cfg),
                      cfg => cfg.notes,
                      cfg => cfg.sg || null,
                      cfg => cfg.workRestSec != null ? Number(cfg.workRestSec) : null,
                      (cfg, index, occurrence) => onExercise?.(session.routineId || session.routineSnapshot?.id || routine.id, cfg.id, index, occurrence)
                    )}
                  </div> : null}
                </div>
              })}
            </div>
          </div>)}
        </div>
      })()}
    </>}
    <div className="prog-detail-actions row" style={{ justifyContent: 'flex-end', gap: 8, padding: '12px 12px 4px' }}>
      <Button size="sm" variant="tinted" icon="pencil" onClick={() => onEdit?.(definition)}>{t('Edit')}</Button>
      <Button size="sm" variant="primary" icon="play" onClick={() => onStart?.(definition)}>{t('Start programme')}</Button>
    </div>
  </section>
}

function exerciseDisplayName(cfg, customEx = []) {
  if (cfg?.name || cfg?.n) return cfg.name || cfg.n
  const custom = customEx.find(item => String(item.id) === String(cfg?.id))
  if (custom?.n) return custom.n
  return EXIDX[cfg?.id]?.n || cfg?.id
}

export function ReadyProgrammeRow({ definition, done = false, onStart, onOpen }) {
  const weeks = Array.isArray(definition?.weeks) ? definition.weeks.length : Number(definition?.lengthWeeks) || 1
  const sessions = Array.isArray(definition?.weeks)
    ? definition.weeks.reduce((count, week) => count + (week?.days || []).reduce((dayCount, day) => dayCount + (day?.sessions || []).length, 0), 0)
    : 0
  return <div className="item programme-ready-row" data-testid="ready-programme-row" role="button" tabIndex={0} onClick={() => onOpen?.(definition)} style={{ cursor: 'pointer' }}>
    <span className="lrow-i" style={{ background: 'var(--blue-soft, color-mix(in srgb,var(--blue) 16%,transparent))', color: 'var(--blue)' }}><Icon name={glyphOf(definition?.emoji)} /></span>
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="tt">{definition?.name || t('Programme')} <span className="tag" style={{ marginLeft: 5 }}>{done ? t('Done') : t('Ready')}</span></div>
      <div className="ss">{t('{0} weeks', weeks)}{sessions ? ' · ' + t('{0} planned sessions', sessions) : ''}{definition?.progression ? ' · ' + t('Progression: {0}', definition.progression) : ''}</div>
    </div>
    <Button size="xs" variant="tinted" icon="play" onClick={event => { event.stopPropagation(); onStart?.(definition) }}>{t('Start')}</Button>
    <Icon name="chevronRight" className="chev" />
  </div>
}

export function CompletedProgrammeRow({ cycle, state, onRepeat }) {
  const [progressOpen, setProgressOpen] = useState(false)
  const summary = programmeSummary(state, cycle, { now: Date.now(), timeZone: cycle?.timeZone })
  const started = dateOnly(cycle?.startedAt || cycle?.createdAt)
  const ended = dateOnly(cycle?.completedAt)
  const workouts = (state?.workouts || []).filter(workout => workout?.cycleId === cycle?.id || workout?.programmeInstance?.cycleId === cycle?.id)
  const sessions = cycle?.completedSessions ?? workouts.filter(workout => workout?.complete !== false).length
  const prs = cycle?.prSummary || programmePRSummary(state, cycle)
  const prText = prs.length ? prs.slice(0, 3).map(pr => `${pr.name} ${fmtNum(pr.value)} ${pr.unit}`).join(' · ') : t('No PRs recorded')
  const progress = cycle?.progressSummary || programmeProgressSummary(state, cycle)
  const fmtRow = value => (value == null ? '—' : fmtNum(value))
  const arrow = ' → '
  return <div className="item programme-completed-row" data-testid="completed-programme-row" style={{ display: 'block' }}>
    <div className="programme-completed-main" onClick={() => setProgressOpen(open => !open)} role="button" aria-expanded={progressOpen}>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tt" style={{ fontSize: 15 }}>{summary.name} <span className="tag" style={{ marginLeft: 5 }}>{t('Completed')}</span></div>
        <div className="ss">{started && ended ? `${fmtDate(started, false)} – ${fmtDate(ended, false)}` : t('Completed programme')} · {t('{0} weeks', summary.totalWeeks)} · {t('{0} sessions', sessions)}</div>
        <div className="small dim" style={{ marginTop: 4 }}>{t('PRs')}: {prText}</div>
      </div>
      <Icon name="chevronRight" className={'prog-chevron' + (progressOpen ? ' is-open' : '')} />
    </div>
    <div className="programme-completed-actions">
      <span className="small dim">{t('Repeat from here')}</span>
      <Button size="sm" variant="tinted" icon="reset" aria-label={t('Repeat {0}', summary.name)} onClick={event => { event.stopPropagation(); onRepeat?.(cycle) }}>{t('Repeat')}</Button>
    </div>
    {progressOpen && <div className="prog-progress" data-testid="programme-progress-summary">
      {progress.length ? <div className="prog-progress-table-wrap" role="region" aria-label={t('Programme progress')} tabIndex="0"><table className="prog-progress-table">
        <thead><tr><th>{t('Exercise')}</th><th>{t('Weight')}</th><th>{t('1RM')}</th><th>{t('Volume')}</th></tr></thead>
        <tbody>
          {progress.map(row => <tr key={row.name}>
            <td className="prog-progress-name">{row.name}</td>
            <td>{row.weight ? `${fmtRow(row.weight.first)}${arrow}${fmtRow(row.weight.last)} ${row.unit}` : '—'}</td>
            <td>{row.rm1 ? `${fmtRow(row.rm1.first)}${arrow}${fmtRow(row.rm1.last)} ${row.unit}` : '—'}</td>
            <td>{row.volume ? `${fmtRow(row.volume.first)}${arrow}${fmtRow(row.volume.last)} ${row.unit}` : '—'}</td>
          </tr>)}
        </tbody>
      </table></div> : <div className="small dim">{t('No completed sessions in this programme')}</div>}
      <div className="small dim" style={{ marginTop: 6 }}>{t('Week 1 → final week: best working weight, estimated 1RM and total volume per exercise.')}</div>
    </div>}
  </div>
}