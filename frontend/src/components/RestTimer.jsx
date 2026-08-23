import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const prep = useUI(s => s.prep)
  const work = useUI(s => s.work)
  const { addRest, stopRest, finishWorkEarly, stopWork, skipPrep, logWorkWithExtra, logWorkPlanned } = useUI()
  const on = work || prep || timer
  // The bar is fixed above the tab bar and floats over whatever is beneath it — during a
  // rest that was the next set's row. Extra bottom padding lets the page scroll clear.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  if (!on) return null
  const pct = (on.left / on.total) * 100

  if (prep) return (
    <div id="timer" className="prepping" role="status" aria-live="assertive" aria-label={t('Preparation countdown')}>
      <div className="t">{clock(prep.left)}</div>
      <div className="grow">
        <div className="lbl">{t('Get ready')}{prep.label ? ' · ' + prep.label : ''}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      <Button size="sm" variant="primary" onClick={skipPrep}>{t('Start now')}</Button>
    </div>
  )

  if (work?.done) return (
    <div id="timer" className="working ready">
      <div className="head">
        <span className="sr-only" role="status">{t('Time\'s up!')}</span>
        <div className="t">{t('Time\'s up!')}{work.left < 0 ? ' +' + clock(-work.left) : ''}</div>
        {work.label && <div className="lbl">{work.label}</div>}
        <div className="bar"><i style={{ width: '100%' }} /></div>
      </div>
      <div className="acts">
        <Button size="sm" variant="primary" onClick={logWorkWithExtra}>{work.left < 0 ? t('Log +{0}s', -work.left) : t('Log {0}s', work.total)}</Button>
        <Button size="sm" variant="tinted" onClick={logWorkPlanned}>{t('Keep {0}s', work.total)}</Button>
        <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      </div>
    </div>
  )
  if (work) return (
    <div id="timer" className="working" role="status" aria-live="polite" aria-atomic="true">
      <div className="t">{clock(work.left)}</div>
      <div className="grow">
        {work.label && <div className="lbl">{work.label}</div>}
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
    </div>
  )
  if (timer?.done) return (
    <div id="timer" className="rest ready" role="status" aria-live="polite" aria-atomic="true">
      <div className="head">
        <div className="t">{t('Ready!')}</div>
        <div className="bar"><i style={{ width: '100%' }} /></div>
      </div>
      <div className="acts">
        <Button size="sm" variant="tinted" icon="plus" onClick={() => addRest(15)}>15s</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Dismiss')}</Button>
      </div>
    </div>
  )
  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: clock and bar
  // read at a glance, controls get their own row. −15 and +15 sit together in number-line
  // order; Skip is pushed to the far edge, away from the button you tap to buy more time.
  return (
    <div id="timer" className="rest" role="status" aria-live="polite" aria-atomic="true">
      <div className="head">
        <div className="t">{clock(timer.left)}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className="acts">
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Skip')}</Button>
      </div>
    </div>
  )
}
