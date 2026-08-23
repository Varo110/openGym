import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'
import { useUI } from './useUI.js'
import { normalizeState } from '../lib/state.js'
import { normalizeDayPlan } from '../lib/history.js'
import { reconcileProgrammeCyclesInState } from '../lib/programmes-ui.js'

const KEY = 'gym_state_v1'
export const DEF = {
  schemaVersion: 3,
  unit: 'kg', restSec: 90, prepSec: 5, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, lastFinishedSession: null, lastFinishedUndo: null, customEx: [], exerciseAnnotations: {}, programmes: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // defaultProg: the user's default progression rule from Settings (null = built-in).
  // endSummary: show the locked summary popup when a workout is finished.
  defaultProg: null, endSummary: true,
  // fullSetsDefault: the end-of-exercise default weight only counts sets lifted to the
  // full target reps/time (missed final sets don't set the default). false = any done set.
  fullSetsDefault: true
}
const clone = o => JSON.parse(JSON.stringify(o))

function withoutRoutineDrafts(state) {
  const next = clone(state)
  if (Array.isArray(next.routines)) next.routines = next.routines.filter(routine => !routine?.draft)
  return next
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const state = normalizeState(normalizeDayPlan(JSON.parse(raw)), DEF)
      const completed = reconcileProgrammeCyclesInState(state, { now: Date.now(), timeZone: localTZ() })
      if (completed.length) localStorage.setItem(KEY, JSON.stringify(state))
      return state
    }
  } catch (e) { /* ignore */ }
  return normalizeState(DEF, DEF)
}

function hasStoredState() {
  try {
    const state = JSON.parse(localStorage.getItem(KEY))
    return !!state && typeof state === 'object' && !Array.isArray(state)
  } catch { return false }
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)
const CONFLICT_BACKUP_KEY = 'gym_sync_conflict_backup_v1'

function syncGenerationOf(state) {
  const generation = Number(state?.syncGeneration)
  return Number.isSafeInteger(generation) && generation >= 0 ? generation : 0
}

function unsyncedWorkoutIds(local, server) {
  const serverIds = new Set((server.workouts || []).map(workout => workout?.id).filter(Boolean))
  return (local.workouts || []).map(workout => workout?.id).filter(id => id && !serverIds.has(id))
}

function saveConflictBackup(local, server) {
  const serverGeneration = syncGenerationOf(server)
  try {
    const existing = JSON.parse(localStorage.getItem(CONFLICT_BACKUP_KEY) || 'null')
    if (existing?.serverGeneration === serverGeneration) return
  } catch (e) { /* replace malformed or legacy backup with the current bounded recovery record */ }
  const missingHistory = unsyncedWorkoutIds(local, server)
  const newerLocal = (local._ts || 0) > (server._ts || 0)
  const dirty = localStorage.getItem('gym_dirty') === '1'
  if (!dirty && !newerLocal && !missingHistory.length) return
  try {
    localStorage.setItem(CONFLICT_BACKUP_KEY, JSON.stringify({
      version: 1,
      serverGeneration,
      savedAt: Date.now(),
      reason: 'server-sync-generation',
      unsyncedWorkoutIds: missingHistory,
      state: clone(local),
    }))
  } catch (e) { /* local conflict backup is best effort; never block the server-managed recovery */ }
}

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  let nativeWrite = Promise.resolve()

  // Keep full-state file writes ordered: overlapping Capacitor writes could otherwise let an
  // older active-workout snapshot finish last and resurrect discarded or stale progress.
  const nativeSaveOrdered = state => {
    const snapshot = clone(state)
    nativeWrite = nativeWrite.then(() => nativeSave(snapshot))
    return nativeWrite
  }

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSaveOrdered(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    const hadActive = !!get().S.active
    const next = normalizeDayPlan(normalizeState(S, DEF))
    reconcileProgrammeCyclesInState(next, { now: Date.now(), timeZone: localTZ() })
    next._ts = Date.now()
    registerCustom(next.customEx)
    localStorage.setItem(KEY, JSON.stringify(next))
    set({ S: next })
    if (MOBILE) {
      if (hadActive || next.active) {
        clearTimeout(saveTm)
        saveTm = null
        nativeSaveOrdered(next)
        syncReminder(next)
      } else nativePersist()
    }
    if (push && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return
      if (MOBILE && saveTm) {
        clearTimeout(saveTm)
        saveTm = null
        nativeSaveOrdered(get().S)
      }
      if (pushTm) {
        clearTimeout(pushTm)
        pushTm = null
        get().pushState()
      }
    })
  }

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    useUI.getState().stopWork()
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,

    purgeRoutineDrafts() {
      const state = get().S
      if (!Array.isArray(state?.routines) || !state.routines.some(routine => routine?.draft)) return false
      persist(withoutRoutineDrafts(state), false)
      return true
    },

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) {
      useUI.getState().stopWork()
      persist(withoutRoutineDrafts(S), push)
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    config: null,
    async loadConfig() {
      if (get().config) return get().config
      try { const c = await api('/api/config'); set({ config: c }); return c }
      catch { return null }
    },

    setUser(u) {
      if (u) { localStorage.setItem('gym_user', JSON.stringify(u)); localStorage.removeItem('gym_guest') }
      else localStorage.removeItem('gym_user')
      set({ user: u })
    },

    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      try { await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: get().S }) }); localStorage.removeItem('gym_dirty') }
      catch (e) { localStorage.setItem('gym_dirty', '1') }
    },
    async pullState() {
      try {
        const { state } = await api('/api/data')
        const S = get().S
        const dirty = localStorage.getItem('gym_dirty') === '1'
        const serverGeneration = syncGenerationOf(state)
        const localGeneration = syncGenerationOf(S)
        const generationAhead = serverGeneration > localGeneration
        const managedGeneration = serverGeneration > 0 || localGeneration > 0
        const legacyPull = !managedGeneration && (!hasData(S) || ((state?._ts || 0) >= (S._ts || 0) && !dirty))
        if (state && (generationAhead || legacyPull)) {
          if (generationAhead) saveConflictBackup(S, state)
          const active = S.active
          const next = normalizeDayPlan(normalizeState(state, DEF))
          next.active = active || null
          const sourceWorkoutId = active?.sourceWorkoutId
          if (sourceWorkoutId && !next.workouts.some(workout => workout.id === sourceWorkoutId)) {
            const sourceWorkout = S.workouts.find(workout => workout.id === sourceWorkoutId)
            if (sourceWorkout) next.workouts.push(clone(sourceWorkout))
          }
          persist(withoutRoutineDrafts(next), false)
          if (generationAhead) localStorage.removeItem('gym_dirty')
        } else if (hasData(S) && (!managedGeneration || (dirty && serverGeneration === localGeneration))) {
          get().purgeRoutineDrafts()
          await get().pushState()
        }
      } catch (e) { /* offline — keep local */ }
      get().purgeRoutineDrafts()
    },

    async signOut() {
      try { await get().pushState(); await api('/api/logout', { method: 'POST', body: '{}' }) } catch (e) { /* */ }
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState()   // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        const hasLocal = hasStoredState()
        if (saved && (!hasLocal || (saved._ts || 0) > (S._ts || 0))) {
          persist(withoutRoutineDrafts(Object.assign(clone(DEF), saved)), false)
        } else if (hasLocal) {
          nativeSaveOrdered(withoutRoutineDrafts(S))   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        get().purgeRoutineDrafts()
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().purgeRoutineDrafts()
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      get().purgeRoutineDrafts()
      set({ ready: true })
    }
  }
})

export { hasData, loadState }
