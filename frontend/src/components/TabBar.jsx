import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, reconcileStartSessionChoice, weeklySessionStatus } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { resumeWeeklySession, startSessionSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')
  const todayPlans = effectiveRoutines(S, todayISO())
  const statuses = todayPlans.map(plan => weeklySessionStatus(S, {
    source: 'classic', routineId: plan.id, calendarDate: todayISO()
  }))
  const unavailableIds = new Set(todayPlans.filter((_, index) => statuses[index] !== 'start').map(plan => plan.id))
  const openRoutineId = reconcileStartSessionChoice(todayPlans, unavailableIds, null)
  const settledLabel = statuses.includes('resume') ? t('Resume') : statuses.includes('incomplete') ? t('Incomplete') : t('Done')

  const startWorkout = () => {
    if (!S.active) {
      const resumableIndex = statuses.findIndex(status => status === 'resume')
      if (resumableIndex >= 0) {
        resumeWeeklySession({ source: 'classic', routineId: todayPlans[resumableIndex].id, calendarDate: todayISO() })
        return
      }
      if (todayPlans.length === 1 && openRoutineId && todayPlans[0].ex.length) { onStart(openRoutineId); return }
      if (todayPlans.length > 1 || (todayPlans.length === 1 && !openRoutineId)) { startSessionSheet(); return }
    }
    nav('/workout')
  }
  const navigateTab = to => {
    // Timers (rest, prep, work) are app-global: they keep running and stay visible
    // on every screen (owner req). Nothing stops them on navigation.
    nav(to)
  }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => navigateTab(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button className={'start' + (S.active || statuses.includes('resume') ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active || statuses.includes('resume') ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : todayPlans.length && !openRoutineId ? settledLabel : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
