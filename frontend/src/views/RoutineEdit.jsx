import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet, groupMetaSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, SelectRow } from '../components/ui.jsx'
import Stepper from '../components/Stepper.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'
import { normalizePhaseList } from '../lib/workout-model.js'

export function resolveRoutineDeepLinkTarget(rows, rawIndex, exId, rawOccurrence) {
  const list = Array.isArray(rows) ? rows : []
  if (!exId) return null
  const occurrence = rawOccurrence == null || rawOccurrence === '' ? null : Number(rawOccurrence)
  const matches = list.filter(row => row?.dataset?.exId === exId)
  if (Number.isInteger(occurrence) && occurrence >= 0) return matches[occurrence] || null
  const index = rawIndex == null || rawIndex === '' ? null : Number(rawIndex)
  const indexed = Number.isInteger(index) && index >= 0 ? list[index] : null
  if (indexed?.dataset?.exId === exId) return indexed
  return matches.length === 1 ? matches[0] : null
}

export const ROUTINE_LONG_PRESS_MS = 380
export const ROUTINE_DRAG_SLOP = 8

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

function cleanupGroupMeta(routine) {
  if (!routine?.groupMeta || typeof routine.groupMeta !== 'object') return
  const live = new Set((routine.ex || [])
    .filter((exercise, index, exercises) => exercise?.sg
      && (exercises[index - 1]?.sg === exercise.sg || exercises[index + 1]?.sg === exercise.sg))
    .map(exercise => exercise.sg))
  Object.keys(routine.groupMeta).forEach(id => {
    if (!live.has(id)) delete routine.groupMeta[id]
  })
  if (!Object.keys(routine.groupMeta).length) delete routine.groupMeta
}

// Reorder canonical exercise units rather than individual rows. A superset therefore moves as
// one contiguous block, and every drop slot is between units: neither a plain exercise nor a
// different superset can be inserted between linked members.
export function reorderRoutineUnit(exercises, sourceIndex, targetSlot) {
  if (!Array.isArray(exercises) || !exercises.length) return false
  const units = supersetUnits(exercises)
  const sourceUnitPosition = units.findIndex(unit => unit.includes(sourceIndex))
  if (sourceUnitPosition < 0) return false
  const remainingUnits = units.filter((_, index) => index !== sourceUnitPosition)
  const slot = clamp(Number.isFinite(targetSlot) ? Math.trunc(targetSlot) : sourceUnitPosition, 0, remainingUnits.length)
  if (slot === sourceUnitPosition) return false

  const sourceUnit = units[sourceUnitPosition]
  const moved = exercises.splice(sourceUnit[0], sourceUnit.length)
  const insertAt = remainingUnits.slice(0, slot).reduce((count, unit) => count + unit.length, 0)
  exercises.splice(insertAt, 0, ...moved)
  cleanupSg(exercises)
  return true
}

function unitGeometry(list, exercises) {
  const rows = new Map([...list.querySelectorAll('[data-routine-row]')]
    .map(row => [Number(row.dataset.exIndex), row]))
  return supersetUnits(exercises).map((unit, unitPosition) => {
    const rects = unit.map(index => rows.get(index)?.getBoundingClientRect()).filter(Boolean)
    if (rects.length !== unit.length) return null
    const top = Math.min(...rects.map(rect => rect.top))
    const bottom = Math.max(...rects.map(rect => rect.bottom))
    return { unit, unitPosition, top, bottom, center: top + (bottom - top) / 2 }
  }).filter(Boolean)
}

function scrollHostFor(node) {
  for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY
    if (/(auto|scroll)/.test(overflowY) && parent.scrollHeight > parent.clientHeight) return parent
  }
  return window
}

function autoScrollVelocity(host, clientY) {
  const edge = 64
  const maxStep = 14
  let top, bottom, scrollTop, maxScroll
  if (host === window) {
    const root = document.scrollingElement || document.documentElement
    top = 0
    bottom = window.innerHeight || root.clientHeight
    scrollTop = window.scrollY || root.scrollTop || 0
    maxScroll = Math.max(root.scrollHeight, document.body?.scrollHeight || 0) - bottom
  } else {
    const rect = host.getBoundingClientRect()
    top = rect.top
    bottom = rect.bottom
    scrollTop = host.scrollTop
    maxScroll = host.scrollHeight - host.clientHeight
  }
  if (clientY < top + edge && scrollTop > 0) {
    return -Math.ceil(maxStep * clamp((top + edge - clientY) / edge, 0, 1))
  }
  if (clientY > bottom - edge && scrollTop < maxScroll) {
    return Math.ceil(maxStep * clamp((clientY - (bottom - edge)) / edge, 0, 1))
  }
  return 0
}

function useRoutineReorder(exercises, onDrop) {
  const listRef = useRef(null)
  const gestureRef = useRef(null)
  const exercisesRef = useRef(exercises)
  const onDropRef = useRef(onDrop)
  const suppressClick = useRef(false)
  const suppressClickTimer = useRef(null)
  const [drag, setDrag] = useState(null)
  exercisesRef.current = exercises
  onDropRef.current = onDrop
  const hasRows = exercises.length > 0

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    let autoScrollFrame = null

    const clearAutoScroll = () => {
      if (autoScrollFrame != null) window.cancelAnimationFrame(autoScrollFrame)
      autoScrollFrame = null
    }

    const clearLongPress = gesture => {
      if (gesture?.timer != null) window.clearTimeout(gesture.timer)
      if (gesture) gesture.timer = null
    }

    const pointInsideList = (clientX, clientY) => {
      const rect = list.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    }

    const finishGesture = (gesture, commit, clientX = gesture?.lastX, clientY = gesture?.lastY) => {
      if (!gesture || gestureRef.current !== gesture) return
      clearLongPress(gesture)
      clearAutoScroll()
      gestureRef.current = null
      if (!gesture.active) return

      // A lifted row owns the eventual compatibility click even when the gesture is cancelled.
      suppressClick.current = true
      window.clearTimeout(suppressClickTimer.current)
      suppressClickTimer.current = window.setTimeout(() => { suppressClick.current = false }, 0)
      setDrag(null)
      if (commit && pointInsideList(clientX, clientY) && gesture.targetSlot !== gesture.sourceUnitPosition) {
        onDropRef.current(gesture.sourceIndex, gesture.targetSlot)
      }
    }

    const indicatorPosition = (geometry, gesture, targetSlot, sourceTop, listRect) => {
      // The source still occupies its layout slot while its painted box moves. For the unchanged
      // slot, anchor the marker to that placeholder rather than the large visual gap around it.
      if (targetSlot === gesture.sourceUnitPosition) return sourceTop - listRect.top
      const remaining = geometry.filter(unit => unit.unitPosition !== gesture.sourceUnitPosition)
      if (!remaining.length) return sourceTop - listRect.top
      let clientTop
      if (targetSlot <= 0) clientTop = remaining[0].top
      else if (targetSlot >= remaining.length) clientTop = remaining[remaining.length - 1].bottom
      else clientTop = (remaining[targetSlot - 1].bottom + remaining[targetSlot].top) / 2
      return clamp(clientTop - listRect.top, 0, listRect.bottom - listRect.top)
    }

    const updateDrag = (gesture, clientX, clientY, scheduleScroll = true) => {
      if (gestureRef.current !== gesture || !gesture.active) return
      const currentExercises = exercisesRef.current
      const units = supersetUnits(currentExercises)
      const currentSourceUnit = units[gesture.sourceUnitPosition]
      if (!currentSourceUnit || currentSourceUnit.join(',') !== gesture.sourceUnit.join(',')) {
        finishGesture(gesture, false)
        return
      }

      const listRect = list.getBoundingClientRect()
      const sourceTop = listRect.top + gesture.sourceTopOffset
      const sourceBottom = listRect.top + gesture.sourceBottomOffset
      const rawDelta = clientY - gesture.grabOffset - sourceTop
      const minDelta = listRect.top - sourceTop
      const maxDelta = listRect.bottom - sourceBottom
      const deltaY = clamp(rawDelta, Math.min(minDelta, maxDelta), Math.max(minDelta, maxDelta))
      const geometry = unitGeometry(list, currentExercises)
      const remaining = geometry.filter(unit => unit.unitPosition !== gesture.sourceUnitPosition)
      const probeY = clamp(clientY, listRect.top, listRect.bottom)
      const movedPastSlop = Math.hypot(clientX - gesture.startX, clientY - gesture.startY) > ROUTINE_DRAG_SLOP
      const targetSlot = movedPastSlop
        ? remaining.reduce((slot, unit) => slot + (probeY > unit.center ? 1 : 0), 0)
        : gesture.sourceUnitPosition
      const indicatorTop = indicatorPosition(geometry, gesture, targetSlot, sourceTop, listRect)

      gesture.lastX = clientX
      gesture.lastY = clientY
      gesture.deltaY = deltaY
      gesture.targetSlot = targetSlot
      setDrag({
        sourceFirst: gesture.sourceUnit[0],
        sourceLast: gesture.sourceUnit[gesture.sourceUnit.length - 1],
        deltaY,
        targetSlot,
        indicatorTop,
      })
      if (scheduleScroll && autoScrollFrame == null) autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
    }

    function runAutoScroll() {
      autoScrollFrame = null
      const gesture = gestureRef.current
      if (!gesture?.active) return
      const amount = autoScrollVelocity(gesture.scrollHost, gesture.lastY)
      if (!amount) return
      if (gesture.scrollHost === window) window.scrollBy(0, amount)
      else gesture.scrollHost.scrollTop += amount
      updateDrag(gesture, gesture.lastX, gesture.lastY, false)
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
    }

    const lift = gesture => {
      if (gestureRef.current !== gesture) return
      const geometry = unitGeometry(list, exercisesRef.current)
      const source = geometry.find(unit => unit.unit.includes(gesture.sourceIndex))
      if (!source) {
        finishGesture(gesture, false)
        return
      }
      const listRect = list.getBoundingClientRect()
      gesture.active = true
      gesture.timer = null
      gesture.sourceUnitPosition = source.unitPosition
      gesture.sourceUnit = source.unit
      gesture.sourceTopOffset = source.top - listRect.top
      gesture.sourceBottomOffset = source.bottom - listRect.top
      gesture.grabOffset = gesture.lastY - source.top
      gesture.targetSlot = source.unitPosition
      gesture.deltaY = 0
      gesture.scrollHost = scrollHostFor(list)
      window.clearTimeout(suppressClickTimer.current)
      suppressClick.current = true
      updateDrag(gesture, gesture.lastX, gesture.lastY)
    }

    const beginGesture = (event, input, pointerId, clientX, clientY) => {
      if (gestureRef.current) return
      const target = event.target
      if (!target?.closest || target.closest('button,a,input,textarea,select,[data-nodrag]')) return
      const row = target.closest('[data-routine-row]')
      if (!row || !list.contains(row)) return
      const sourceIndex = Number(row.dataset.exIndex)
      if (!Number.isInteger(sourceIndex)) return
      const gesture = {
        input, pointerId, sourceIndex,
        startX: clientX, startY: clientY, lastX: clientX, lastY: clientY,
        active: false, timer: null,
      }
      gesture.timer = window.setTimeout(() => lift(gesture), ROUTINE_LONG_PRESS_MS)
      gestureRef.current = gesture
    }

    const abandonPendingGesture = gesture => {
      clearLongPress(gesture)
      if (gestureRef.current === gesture) gestureRef.current = null
    }

    const matchingTouch = (touches, pointerId) => Array.from(touches || []).find(touch => touch.identifier === pointerId)
    const onTouchStart = event => {
      if (event.touches.length !== 1) {
        finishGesture(gestureRef.current, false)
        return
      }
      const touch = event.touches[0]
      beginGesture(event, 'touch', touch.identifier, touch.clientX, touch.clientY)
    }
    const onTouchMove = event => {
      const gesture = gestureRef.current
      if (!gesture || gesture.input !== 'touch') return
      if (event.touches.length !== 1) {
        if (gesture.active) event.preventDefault()
        finishGesture(gesture, false)
        return
      }
      const touch = matchingTouch(event.touches, gesture.pointerId)
      if (!touch) return
      if (!gesture.active) {
        if (Math.hypot(touch.clientX - gesture.startX, touch.clientY - gesture.startY) > ROUTINE_DRAG_SLOP) abandonPendingGesture(gesture)
        else { gesture.lastX = touch.clientX; gesture.lastY = touch.clientY }
        return
      }
      event.preventDefault()
      updateDrag(gesture, touch.clientX, touch.clientY)
    }
    const onTouchEnd = event => {
      const gesture = gestureRef.current
      if (!gesture || gesture.input !== 'touch') return
      const touch = matchingTouch(event.changedTouches, gesture.pointerId)
      if (!touch) return
      if (gesture.active) event.preventDefault()
      finishGesture(gesture, gesture.active, touch.clientX, touch.clientY)
    }
    const onTouchCancel = event => {
      const gesture = gestureRef.current
      if (!gesture || gesture.input !== 'touch') return
      if (gesture.active) event.preventDefault()
      finishGesture(gesture, false)
    }
    const onMouseDown = event => {
      if (event.button !== 0) return
      beginGesture(event, 'mouse', 'mouse', event.clientX, event.clientY)
    }
    const onMouseMove = event => {
      const gesture = gestureRef.current
      if (!gesture || gesture.input !== 'mouse') return
      if (!gesture.active) {
        if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > ROUTINE_DRAG_SLOP) abandonPendingGesture(gesture)
        else { gesture.lastX = event.clientX; gesture.lastY = event.clientY }
        return
      }
      event.preventDefault()
      updateDrag(gesture, event.clientX, event.clientY)
    }
    const onMouseUp = event => {
      const gesture = gestureRef.current
      if (!gesture || gesture.input !== 'mouse') return
      if (gesture.active) event.preventDefault()
      finishGesture(gesture, gesture.active, event.clientX, event.clientY)
    }
    const onKeyDown = event => {
      const gesture = gestureRef.current
      if (event.key !== 'Escape' || !gesture?.active) return
      event.preventDefault()
      finishGesture(gesture, false)
    }
    const onContextMenu = event => {
      if (gestureRef.current?.active && event.target.closest?.('[data-routine-row]')) event.preventDefault()
    }
    const onNativeDragStart = event => {
      if (event.target.closest?.('[data-routine-row]')) event.preventDefault()
    }
    const onWindowBlur = () => finishGesture(gestureRef.current, false)

    list.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd, { passive: false })
    document.addEventListener('touchcancel', onTouchCancel, { passive: false })
    list.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)
    list.addEventListener('contextmenu', onContextMenu)
    list.addEventListener('dragstart', onNativeDragStart)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      clearLongPress(gestureRef.current)
      clearAutoScroll()
      window.clearTimeout(suppressClickTimer.current)
      suppressClick.current = false
      gestureRef.current = null
      list.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
      list.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
      list.removeEventListener('contextmenu', onContextMenu)
      list.removeEventListener('dragstart', onNativeDragStart)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [hasRows])

  const consumeClick = event => {
    if (!suppressClick.current) return false
    suppressClick.current = false
    window.clearTimeout(suppressClickTimer.current)
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  return { listRef, drag, consumeClick }
}

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  // A draft (freestyle session opened in the editor) is ephemeral: leaving without an
  // explicit save discards it. The ref tracks whether the routine is still a draft.
  const draftRef = useRef(!!(r && r.draft))
  useEffect(() => () => {
    if (draftRef.current) update(s => { s.routines = s.routines.filter(x => !(x.id === id && x.draft)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const saveDraft = () => {
    update(s => { const target = s.routines.find(x => x.id === id); if (target) delete target.draft })
    draftRef.current = false
  }
  // Deep link from a programme exercise row: scroll to that exercise and flash it.
  const [params] = useSearchParams()
  const flashTarget = useRef(null)
  useEffect(() => {
    const rawExi = params.get('exi')
    const rawExo = params.get('exo')
    const exId = params.get('ex')
    if (!r || (!exId && (rawExi == null || rawExi.trim() === ''))) return
    // wait for the list to settle, then scroll + flash
    const timer = setTimeout(() => {
      const rows = [...document.querySelectorAll('.routine-list .item')]
      const row = resolveRoutineDeepLinkTarget(rows, rawExi, exId, rawExo)
      if (row) {
        flashTarget.current = row
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        row.classList.add('ex-row-flash')
        setTimeout(() => row.classList.remove('ex-row-flash'), 1800)
      }
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!r, params])
  const edit = fn => update(s => {
    const routine = s.routines.find(x => x.id === id)
    if (!routine) return
    fn(routine.ex)
    cleanupGroupMeta(routine)
  })
  const reorder = useRoutineReorder(r?.ex || [], (sourceIndex, targetSlot) => {
    edit(exercises => { reorderRoutineUnit(exercises, sourceIndex, targetSlot) })
  })
  if (!r) return null

  const move = (i, dir) => edit(ex => { const j = i + dir; if (j < 0 || j >= ex.length) return;[ex[i], ex[j]] = [ex[j], ex[i]]; cleanupSg(ex) })
  const toggleLink = i => update(s => {
    const routine = s.routines.find(candidate => candidate.id === id)
    if (!routine || i < 1) return
    const ex = routine.ex, cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else {
      const gid = prev.sg || ('sg' + uid())
      prev.sg = gid; cur.sg = gid
      routine.groupMeta = routine.groupMeta || {}
      routine.groupMeta[gid] = routine.groupMeta[gid] || { kind: 'superset' }
    }
    cleanupSg(ex)
    cleanupGroupMeta(routine)
  })

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())

  return <div className="narrow routine-editor">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={[...new Set([...POLICIES_FOR.reps, 'time'])].map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>
    {r.prog === 'greyskull' && <div className="sect-b" style={{ marginBottom: 12 }}>
      <SelectRow title={t('AMRAP miss')} sheetTitle={t('AMRAP miss')} value={r.amrapMissPolicy || 'deload'}
        onChange={v => update(s => { s.routines.find(x => x.id === id).amrapMissPolicy = v })}
        options={[{ value: 'deload', label: t('10% deload') }, { value: 'maintain', label: t('Maintain weight') }]} />
    </div>}
    <div className="sect-b" style={{ marginBottom: 12 }}>
      <SelectRow title={t('Routine phases')} sheetTitle={t('Routine phases')} value={Array.isArray(r.phases) ? r.phases.join(',') : ''}
        onChange={value => update(s => {
          const routine = s.routines.find(x => x.id === id)
          const phases = normalizePhaseList(value)
          if (phases == null) delete routine.phases
          else routine.phases = phases
        })}
        options={[{ value: '', label: t('Automatic') }, { value: 'warmup', label: t('Warm-up') }, { value: 'work', label: t('Work') }, { value: 'warmup,work', label: t('Warm-up + work') }]} />
    </div>
    <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Warm-up rest (s)')} value={r.warmupRestSec ?? 60} step={15} decimal={false}
        onChange={v => update(s => { s.routines.find(x => x.id === id).warmupRestSec = v })} />
      <Stepper label={t('Work rest (s)')} value={r.workRestSec ?? 90} step={15} decimal={false}
        onChange={v => update(s => { s.routines.find(x => x.id === id).workRestSec = v })} />
    </div>

    {r.ex.length ? <div ref={reorder.listRef} className={'list routine-list' + (reorder.drag ? ' is-reordering' : '')}>{r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const isDragging = reorder.drag && i >= reorder.drag.sourceFirst && i <= reorder.drag.sourceLast
      return <div key={i} className={'routine-drag-row' + (isDragging ? ' is-dragging' : '')} data-routine-row data-ex-index={i}
        style={isDragging ? { transform: `translate3d(0, ${reorder.drag.deltaY}px, 0)` } : undefined}>
        {unitFirst.has(i) && <div className="ss-label" onClick={event => { event.stopPropagation(); groupMetaSheet(id, e.sg) }}><Icon name="link" />{r.groupMeta?.[e.sg]?.label || t(r.groupMeta?.[e.sg]?.kind === 'complex' ? 'Complex' : 'Superset')}{r.groupMeta?.[e.sg]?.cues && <span className="small dim"> · {r.groupMeta[e.sg].cues}</span>}</div>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} data-ex-index={i} data-ex-id={e.id}
          data-ex-occurrence={r.ex.slice(0, i).filter(candidate => String(candidate.id) === String(e.id)).length} onClick={event => {
          if (reorder.consumeClick(event)) return
          exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }), r)
        }}>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{ex.n}</div><div className="ss">{exLine(e, S.unit)}</div>{e.notes && <div className="routine-note small dim">{e.notes}</div>}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" aria-label="Move up" style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label="Move down" style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>
          </div>
        </div>
      </div>
    })}{reorder.drag && <div className="routine-drop-indicator" data-testid="routine-drop-indicator" aria-hidden="true"
      style={{ top: `${reorder.drag.indicatorTop}px` }} />}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}</div>
    <Button variant="primary" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {r.draft ? <Button variant="primary" icon="check" onClick={saveDraft}>{t('Save routine')}</Button>
      : <Button variant="ghost" icon="copy" onClick={() => {
      const newId = uid()
      update(s => {
        const source = s.routines.find(candidate => candidate.id === id)
        if (!source) return
        // Duplicate the complete routine schema, not a hand-maintained list of fields.
        s.routines.push({ ...JSON.parse(JSON.stringify(source)), id: newId })
      })
      nav('/plan/r/' + newId)
    }}>{t('Save as routine')}</Button>}
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: r.draft ? t('Discard this routine?') : t('Delete routine?'),
      message: r.draft ? t('The freestyle session stays in your history; only the draft is discarded.') : t('“{0}” and its exercises will be removed.', r.name),
      confirmText: r.draft ? t('Discard') : t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan).forEach(k => {
            const value = s.dayPlan[k]
            if (Array.isArray(value)) {
              const kept = value.filter(x => x !== id)
              if (kept.length) s.dayPlan[k] = kept
              else delete s.dayPlan[k]
            } else if (value === id) delete s.dayPlan[k]
          })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}
