import { useState } from 'react'
import { lastPerformancesFor, setLabel, isBw } from '../lib/history.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'

function performanceSummary(exerciseId, performance) {
  const target = { id: exerciseId, mode: performance.mode, bodyweight: performance.bodyweight ?? isBw({ id: exerciseId }) }
  return performance.sets.map(set => setLabel(exerciseId, set, target)).join(', ')
}

export default function LastPerformance({ state, exerciseId, mode, occurrenceId = null, className = '' }) {
  const [expanded, setExpanded] = useState(false)
  const performances = lastPerformancesFor(state, exerciseId, mode, occurrenceId)
  if (!performances.length) return null
  const latest = performances[0]
  const toggle = event => {
    event.stopPropagation()
    setExpanded(value => !value)
  }
  return <div className={'last-performance ' + className} data-testid="last-performance" onClick={event => event.stopPropagation()}>
    <div className="last-performance-summary">
      <span className="last-performance-label">{t('Last performance')}</span>
      <span className="last-performance-value">{fmtDate(latest.date)} · {performanceSummary(exerciseId, latest)}</span>
      <button type="button" className="last-performance-toggle" aria-expanded={expanded} onClick={toggle}>
        {expanded ? t('Hide last 3') : t('Show last 3')}
      </button>
    </div>
    {expanded && <div className="last-performance-list" role="list">
      {performances.map((performance, index) => <div key={performance.date + ':' + performance.occurrenceId + ':' + index} className="last-performance-session" role="listitem">
        <div className="last-performance-session-head">
          <span>{fmtDate(performance.date)}</span>
          <span>{performance.pr ? t('PR') : ''}</span>
        </div>
        <div>{performanceSummary(exerciseId, performance)}</div>
        {performance.e1rm != null && <div className="last-performance-metric">{t('e1RM')} ~{fmtNum(performance.e1rm)}</div>}
      </div>)}
    </div>}
  </div>
}
