import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, completedRoutineIdsForDate, reconcileStartSessionChoice, streakWeeks, lastBW, setsDoneActive, workoutsForUnit } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, beginWorkout, repeatFreestyleSheet, goalSheet, dayOverrideSheet, dayViewSheet, calendarSheet, startFlow, startSessionSheet, loadStarterPlan, bwDeltaColor } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { projectStateQueue, scheduleWriteContext } from '../lib/programmes.js'
import { programmeColourForItem, programmeLabelForItem, programmeNameForItem } from '../lib/programmes-ui.js'
import './Home.css'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)

  const now = Date.now()
  const today = new Date(now)
  const programmeTimeZone = S.programmes?.timeZone
    || S.programmes?.cycles?.find(cycle => cycle?.timeZone)?.timeZone
    || S.timeZone
    || null
  const todayISOValue = todayISO()
  const programmeTodayISO = programmeTimeZone
    ? scheduleWriteContext({ now, timeZone: programmeTimeZone }).calendarDate
    : todayISOValue
  const [selectedISO, setSelectedISO] = useState(todayISOValue)
  const todayPlans = effectiveRoutines(S, selectedISO)
  const routine = todayPlans[0]
  const programmeQueue = projectStateQueue(S, { now })
  const programmeToday = programmeQueue.items
    .filter(item => item.source === 'programme'
      && (item.projectedDate === (selectedISO === todayISOValue ? programmeTodayISO : selectedISO)
        || programmeQueue.dispositions?.[item.instanceId]?.calendarDate === (selectedISO === todayISOValue ? programmeTodayISO : selectedISO)))
    .map(item => {
      // Dispositions intentionally remain separate from the calendar projection so a skip does
      // not mutate the immutable cycle snapshot. Merge the matching disposition at the render
      // boundary, otherwise the Today row would still advertise a skipped session as Start.
      const disposition = programmeQueue.dispositions?.[item.instanceId]
      if (!disposition) return item
      const status = disposition.disposition === 'skip'
        ? 'skipped'
        : disposition.disposition === 'finish' ? 'finished' : item.status
      return { ...item, status, disposition }
    })
  // A persisted skip is a disposition rather than a changed calendar item. Keep its original
  // routine snapshot available on the queue row so the status remains visible on the scheduled
  // date even though the queue's next unresolved front has moved on.
  const programmeStatus = item => item?.status === 'owed'
    ? t('Continue next time')
    : item?.status === 'skipped'
      ? t('Finish and skip')
      : item?.status === 'finished' || item?.status === 'partial-advanced' ? t('Done') : null
  const doneToday = completedRoutineIdsForDate(S, selectedISO)
  const dayFreestyle = (S.workouts || []).filter(w => w.d === selectedISO && !w.routineId)
  const openRoutineId = reconcileStartSessionChoice(todayPlans, doneToday, null)
  const openRoutine = todayPlans.find(r => r.id === openRoutineId) || null
  const todayOvr = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, selectedISO)
  const isPast = selectedISO < todayISOValue
  const selectedLabel = selectedISO === todayISOValue
    ? t('Today')
    : new Date(selectedISO + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' })
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const unitWorkouts = workoutsForUnit(S)
  const doneDays = new Set(unitWorkouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso), ovr = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, iso), done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff.length ? ' ovr' : eff.length ? ' plan' : ''
    const programmeItem = programmeQueue.items.find(item => item.source === 'programme' && item.projectedDate === iso)
    const programmeColour = programmeColourForItem(S, programmeItem)
    strip.push(<div key={i} className={'wday' + (iso === todayISOValue ? ' today' : '') + (iso === selectedISO ? ' sel' : '')} onClick={() => setSelectedISO(iso)} onContextMenu={e => { e.preventDefault(); dayOverrideSheet(iso) }}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} style={programmeColour ? { background: programmeColour } : undefined} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = unitWorkouts.filter(w => weekKey(w.d) === weekKey(todayISOValue)).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  const openRoutineDetail = routineId => {
    const currentRoutine = S.routines.find(candidate => String(candidate.id) === String(routineId) && !candidate.draft)
    if (currentRoutine) nav('/plan/r/' + encodeURIComponent(currentRoutine.id))
    else dayViewSheet(selectedISO)
  }

  // Starting is reserved for the explicit button. The row itself is the view/edit target.
  const onTodayStart = event => {
    event?.stopPropagation()
    if (S.active) nav('/workout')
    else if (isPast) { dayViewSheet(selectedISO); return }
    else if (todayPlans.length === 1 && openRoutine && !doneToday.has(openRoutine.id)) startFlow(openRoutine.id)
    else if (todayPlans.length) startSessionSheet(selectedISO)
    else if (programmeQueue.eligible.length && programmeQueue.front
      && !(programmeQueue.front.source === 'classic' && doneToday.has(programmeQueue.front.routineId))) {
      const head = programmeQueue.front
      startFlow(head.routineId, head.source === 'programme' ? head : null)
    }
    else dayOverrideSheet(selectedISO)
  }
  const onTodayRow = () => {
    if (S.active) nav('/workout')
    else if (isPast) dayViewSheet(selectedISO)
    else if (todayPlans.length === 1 && openRoutine) openRoutineDetail(openRoutine.id)
    else if (todayPlans.length) startSessionSheet(selectedISO)
    else dayOverrideSheet(selectedISO)
  }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'openGym'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="today-row" onClick={onTodayRow}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{selectedLabel}</div>
            <div className={'ttl' + (!S.active && todayPlans.length > 1 ? ' home-routine-list' : '')}>{S.active ? t('{0} — in progress', S.active.name) : todayPlans.length > 1 ? todayPlans.map(r => <span key={r.id} className="home-routine">{r.name}</span>) : todayPlans.length ? todayPlans[0].name : t('Rest day')}{todayOvr && todayPlans.length ? <span className="home-routine-meta"> · {t('rescheduled')}</span> : null}</div>
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : isPast
            ? <span className="row" style={{ gap: 8 }} onClick={e => e.stopPropagation()}>
                {doneToday.has(todayPlans[0]?.id) && <Icon name="check" className="accent" />}
                <Button variant="ghost" className="dim" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => dayViewSheet(selectedISO)}>{t('View')}</Button>
                <Button variant="primary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => startFlow(openRoutine ? openRoutine.id : (todayPlans[0]?.id ?? null))}>{t('Repeat')}</Button>
              </span>
            : openRoutine || todayPlans.length
              ? <span className="row" style={{ gap: 8 }} onClick={e => e.stopPropagation()}>
                  <Button variant="ghost" className="dim" aria-label={t('Edit day')} style={{ padding: '6px 9px' }} onClick={() => dayOverrideSheet(selectedISO)}><Icon name="pencil" /></Button>
                  {openRoutine ? <Button type="button" variant="primary" size="sm" className="home-start-action" aria-label={t('Start session')} onClick={onTodayStart}>{t('Start')}</Button> : todayPlans.length ? <span className="tag">{t('Done')}</span> : null}
                </span>
              : <Icon name="plus" className="chev" />}
      </div>
      {programmeToday.map(item => !S.active && (() => {
        const dispositionLabel = programmeStatus(item)
        const canStart = !['skipped', 'finished', 'partial-advanced'].includes(item.status)
        const routineName = item.routineSnapshot?.name
          || S.routines.find(r => r.id === item.routineId)?.name
          || item.routineId
          || t('Routine')
        const label = programmeLabelForItem(S, item)
        const onProgrammeStart = event => {
          event.stopPropagation()
          startFlow(item.routineId, item)
        }
        return <div key={item.instanceId} className="today-row" aria-label={label} style={{ borderTop: '1px solid var(--line)' }} onClick={() => canStart ? openRoutineDetail(item.routineId) : dayViewSheet(selectedISO)}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <span className="lrow-i" style={{ background: programmeColourForItem(S, item) || 'var(--surface-3)' }}>
              <Icon name={item.routineSnapshot ? glyphOf(item.routineSnapshot.emoji) : 'calendar'} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="lbl2">{programmeNameForItem(S, item)}</div>
              <div className="ttl">{routineName}</div>
            </div>
          </div>
          {isPast
            ? <span className="row" style={{ gap: 8 }} onClick={e => e.stopPropagation()}>
                {doneToday.has(item.routineId) && <Icon name="check" className="accent" />}
                <Button variant="ghost" className="dim" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => dayViewSheet(selectedISO)}>{t('View')}</Button>
                <Button variant="primary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => startFlow(item.routineId, item)}>{t('Repeat')}</Button>
              </span>
            : <span className="row" style={{ gap: 8 }} onClick={e => e.stopPropagation()}>
                <Button variant="ghost" className="dim" aria-label={t('Edit day')} style={{ padding: '6px 9px' }} onClick={() => dayOverrideSheet(selectedISO)}><Icon name="pencil" /></Button>
                {canStart
                  ? <Button type="button" variant="primary" size="sm" className="home-start-action" aria-label={t('Start session')} onClick={onProgrammeStart}>{t('Start')}</Button>
                  : <span className="tag">{dispositionLabel}</span>}
              </span>}
        </div>
      })())}
      {dayFreestyle.map(w => !S.active && (
        <div key={w.id} className="today-row" style={{ borderTop: '1px solid var(--line)' }} onClick={() => dayViewSheet(selectedISO)}>
          <div className="row" style={{ gap: 9, minWidth: 0 }}>
            <span className="lrow-i" style={{ background: 'var(--surface-2)' }}>
              <Icon name="sparkles" />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="lbl2">{t('Freestyle')}</div>
              <div className="ttl">{w.name || t('Session')}</div>
            </div>
          </div>
          <span className="row" style={{ gap: 8 }} onClick={e => e.stopPropagation()}>
            <Icon name="check" className="accent" />
            <Button variant="ghost" className="dim" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => dayViewSheet(selectedISO)}>{t('View')}</Button>
            <Button variant="primary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => repeatFreestyleSheet(S, w, (source, bw) => beginWorkout(null, bw, null, source))}>{t('Repeat')}</Button>
          </span>
        </div>
      ))}
    </div>

    {!S.routines.some(r => !r.draft) && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(unitWorkouts.length === 1 ? '{0} workout total' : '{0} workouts total', unitWorkouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>
  </div>
}
