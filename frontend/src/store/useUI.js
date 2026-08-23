import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useStore } from './useStore.js'

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline.
const pushRestTimer = sec => { if (useStore.getState().user) api('/api/push/rest-timer', { method: 'POST', body: JSON.stringify({ seconds: sec }) }).catch(() => {}) }
const cancelPushRestTimer = () => { if (useStore.getState().user) api('/api/push/rest-timer/cancel', { method: 'POST', body: '{}' }).catch(() => {}) }

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window
let requestRestNotificationPermissionP = null

const requestRestNotificationPermission = async () => {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  if (!requestRestNotificationPermissionP) {
    requestRestNotificationPermissionP = Notification.requestPermission()
      .then(perm => perm === 'granted')
      .catch(() => false)
      .finally(() => {
        requestRestNotificationPermissionP = null
      })
  }
  return requestRestNotificationPermissionP
}

const maybeRestNotification = async () => {
  if (!notificationsSupported()) return
  if (!document.hidden && document.visibilityState !== 'hidden') return
  if (Notification.permission !== 'granted' && !(await requestRestNotificationPermission())) return
  try {
    // Android Chrome forbids the Notification constructor (Illegal constructor) - the
    // service-worker registration path is the one that actually pops there.
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg?.showNotification) {
      reg.showNotification(t('Rest over — next set!'), { body: t('Rest over — next set!') })
      return
    }
    new Notification(t('Rest over — next set!'), { body: t('Rest over — next set!') })
  } catch {
    // Intentionally ignore: notification APIs vary by browser and policy in edge cases.
  }
}

let toastTm = null
let timerInt = null
let timerTick = null
let prepInt = null
let prepTick = null
let workInt = null
let workTick = null
let prepDone = null
let workDone = null
let workGeneration = 0
const MAX_WORK_OVERTIME_SEC = 15 * 60

const clearRestTicker = () => {
  if (timerInt) clearInterval(timerInt)
  timerInt = null
  if (timerTick) document.removeEventListener('visibilitychange', timerTick)
  timerTick = null
}

const clearWorkTicker = () => {
  if (workInt) clearInterval(workInt)
  workInt = null
  if (workTick) document.removeEventListener('visibilitychange', workTick)
  workTick = null
}

const armRestTicker = (set, get) => {
  clearRestTicker()
  timerTick = () => {
    const tm = get().timer
    if (!tm || tm.done) { clearRestTicker(); return }
    const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
    if (left === tm.left) return
    const snd = useStore.getState().S.sound
    if (left <= 0) {
      // The ready state is inert: stop the interval/listener before alerting so this expiry can
      // fire only once. addRest() explicitly arms a fresh countdown when the user adds time.
      clearRestTicker()
      beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
      vibrate([200, 100, 200]); maybeRestNotification(); get().toast(t('Rest over — next set!'))
      set({ timer: { ...tm, left: 0, done: true } })
      return
    }
    if (left <= 3) beep(snd, 660, 0.1)
    set({ timer: { ...tm, left } })
  }
  timerInt = setInterval(timerTick, 1000)
  document.addEventListener('visibilitychange', timerTick)
}

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  toastMsg: '',
  timer: null,         // rest countdown between sets — { left, total, endsAt }
  prep: null,          // preparation countdown before a timed set — { left, total, endsAt, label }
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label }

  openSheet(render, { kind = 'sheet', locked = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { get().stopTimers(); set({ sheets: [] }) },
  // Synchronous lifecycle barrier: invalidate work callbacks and cancel the server-backed rest
  // notification before any caller mutates, clears, persists, or navigates the active workout.
  stopTimers() { get().stopWork(); get().stopRest() },
  // Navigation/tab changes must never kill a running rest countdown: only the set-bound
  // timers (work/prep) are invalidated, the rest popup stays visible app-wide (owner req).
  stopWorkAndPrep() {
    if (workInt) clearInterval(workInt); workInt = null
    if (workTick) document.removeEventListener('visibilitychange', workTick); workTick = null
    if (prepInt) clearInterval(prepInt); prepInt = null
    if (prepTick) document.removeEventListener('visibilitychange', prepTick); prepTick = null
    workDone = null; prepDone = null
    set({ work: null, prep: null })
  },
  // Removing an active set/exercise is a synchronous lifecycle event. Do not rely on a later
  // callback noticing that its set disappeared; clear every timer phase now.
  stopTimersForRemoval() { get().stopTimers() },

  toast(msg) {
    set({ toastMsg: msg })
    clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },

  startRest(sec) {
    const seconds = Number(sec)
    if (!(seconds > 0)) return
    // Work and rest are mutually exclusive in both directions. In particular, a finished work
    // popup must not be allowed to cover a newly started rest countdown. A completed hold still
    // represents the planned work the user performed, so preserve it before another timer
    // displaces the popup; a running hold was abandoned and stays silent.
    if (get().work?.done) get().logWorkPlanned()
    else get().stopWork()
    get().stopRest()
    const endsAt = Date.now() + sec * 1000
    set({ timer: { left: sec, total: sec, endsAt } })
    requestRestNotificationPermission()
    pushRestTimer(sec)
    armRestTicker(set, get)
  },
  addRest(sec) {
    const tm = get().timer
    if (!tm) return
    const now = Date.now()
    const remaining = Math.max(0, Math.round((tm.endsAt - now) / 1000))
    const left = remaining + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    set({ timer: { ...tm, left, total: tm.total + sec, endsAt: now + left * 1000, done: false } })
    if (!timerInt) armRestTicker(set, get)
    pushRestTimer(left)
  },
  stopRest() {
    clearRestTicker()
    if (get().timer) cancelPushRestTimer()
    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec)` is called both when the countdown reaches zero and on an early
     finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a 0:45
     hold records 0:38 rather than crediting the full target. */
  startWork(sec, label, onDone, prepSec = 0) {
    if (get().work?.done) get().logWorkPlanned()
    else get().stopWork()
    get().stopRest()
    const generation = ++workGeneration
    const total = Math.max(1, Math.round(sec) || 1)
    workDone = onDone
    const launch = () => {
      if (generation !== workGeneration) return
      const endsAt = Date.now() + total * 1000
      set({ prep: null, work: { left: total, total, endsAt, label } })
      workTick = () => {
        if (generation !== workGeneration) return
        const wk = get().work
        if (!wk) return
        // Overtime is useful, but it must not keep a global interval rendering forever.
        // Freeze at a generous bound; the popup remains actionable until logged/cancelled.
        const rawLeft = Math.round((wk.endsAt - Date.now()) / 1000)
        const left = Math.max(-MAX_WORK_OVERTIME_SEC, rawLeft)
        if (left === wk.left) return
        const snd = useStore.getState().S.sound
        if (left <= 0 && !wk.done) {
          beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
          vibrate([200, 100, 200])
          // Time's up but the clock KEEPS COUNTING (overtime). Nothing is logged yet:
          // the user picks "log with extra" or "log planned" from the popup, which lets
          // them push beyond the planned hold and still log it in one tap.
          set({ work: { ...wk, left, done: true } })
          if (rawLeft <= -MAX_WORK_OVERTIME_SEC) clearWorkTicker()
          return
        }
        if (left <= 3 && left > 0) beep(snd, 660, 0.1)
        set({ work: { ...wk, left } })
        if (rawLeft <= -MAX_WORK_OVERTIME_SEC) clearWorkTicker()
      }
      workInt = setInterval(workTick, 1000)
      document.addEventListener('visibilitychange', workTick)
    }
    prepDone = launch
    const prepTotal = Math.max(0, Math.round(prepSec) || 0)
    if (!prepTotal) { launch(); return }
    const endsAt = Date.now() + prepTotal * 1000
    set({ prep: { left: prepTotal, total: prepTotal, endsAt, label }, work: null })
    prepTick = () => {
      if (generation !== workGeneration) return
      const prep = get().prep
      if (!prep) return
      const left = Math.max(0, Math.round((prep.endsAt - Date.now()) / 1000))
      if (left === prep.left) return
      if (left <= 0) {
        if (prepInt) clearInterval(prepInt); prepInt = null
        if (prepTick) document.removeEventListener('visibilitychange', prepTick); prepTick = null
        const done = prepDone
        prepDone = null
        set({ prep: null })
        const snd = useStore.getState().S.sound
        beep(snd, 1040, 0.12); vibrate(30)
        if (done) done()
        return
      }
      set({ prep: { ...prep, left } })
    }
    // (the orphaned duplicate workTick below is removed in step 2)
    prepInt = setInterval(prepTick, 1000)
    document.addEventListener('visibilitychange', prepTick)
  },
  // The hold ran past the planned time ("Time's up!"): the user chooses what to log.
  // With the extra time -> planned + overtime; without -> just the planned time.
  logWorkWithExtra() {
    const wk = get().work
    if (!wk?.done) return
    const extra = Math.max(0, -wk.left)
    const held = Math.max(1, Math.round(wk.total + extra))
    const done = workDone
    get().stopWork()
    if (done) done(held)
  },
  logWorkPlanned() {
    const wk = get().work
    if (!wk?.done) return
    const held = Math.max(1, Math.round(wk.total))
    const done = workDone
    get().stopWork()
    if (done) done(held)
  },
  // Leave the preparation countdown immediately and begin the work timer.
  skipPrep() {
    const done = prepDone
    if (!done) return
    if (prepInt) clearInterval(prepInt); prepInt = null
    if (prepTick) document.removeEventListener('visibilitychange', prepTick); prepTick = null
    prepDone = null
    set({ prep: null })
    done()
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const elapsed = Math.max(1, wk.total - wk.left)
    const done = workDone
    vibrate(30)
    get().stopWork()
    if (done) done(elapsed)
  },
  // Abandon without logging anything.
  stopWork() {
    clearWorkTicker()
    workDone = null
    set({ prep: null, work: null })
  }
}))
