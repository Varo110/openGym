import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const browsers = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  ...['/root/.cache/ms-playwright'].flatMap(root => {
    try {
      return readdirSync(root).filter(name => name.startsWith('chromium-'))
        .map(name => join(root, name, 'chrome-linux64', 'chrome'))
    } catch { return [] }
  })
]
const executable = browsers.find(path => {
  try { return statSync(path).isFile() } catch { return false }
})

const browsersStarted = []
let sequence = 0
const pending = new Map()

async function connectChromium() {
  if (!executable) throw new Error('Chromium executable not found')
  const profile = join(tmpdir(), `opengym-amrap-hit-${process.pid}-${sequence++}`)
  const browser = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  browsersStarted.push(browser)
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Chromium endpoint timeout: ${output}`)), 10000)
    browser.stderr.on('data', chunk => {
      output += chunk
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    browser.once('exit', code => reject(new Error(`Chromium exited before endpoint: ${code}`)))
  })
  const root = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    root.addEventListener('open', resolve, { once: true })
    root.addEventListener('error', reject, { once: true })
  })
  root.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, message => message.error ? reject(new Error(message.error.message)) : resolve(message.result))
    root.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId, flatten: true })
  return { root, send, sessionId: attached.sessionId }
}

function fixture(width) {
  return `<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style>
    <main style="width:${width}px;padding:0 8px"><div class="card">
      <div class="setgroup" data-group="previous">
        <div class="setrow work" data-hit-zone="above"><span class="n">0</span><div class="stp w"><button data-adjacent="previous-weight">−</button><span class="val">55</span><button>+</button></div><div class="stp r"><button data-adjacent="previous-reps">−</button><span class="val">5</span><button>+</button></div><button class="check" data-adjacent="previous-check">✓</button></div>
      </div>
      <div class="setgroup" data-group="first">
        <div class="setrow work" data-hit-zone="same-row"><span class="n">1</span><div class="stp w"><button data-adjacent="weight">−</button><span class="val">60</span><button>+</button></div><div class="stp r"><button data-adjacent="reps">−</button><span class="val">5</span><button>+</button></div><button class="check" data-adjacent="check">✓</button></div>
        <div class="amrap-role-row"><button type="button" data-adjacent="amrap-role" class="amrap-role-control role-progression">★ AMRAP · progression</button><div class="amrap-target-inline" data-amrap-target><button data-adjacent="amrap-target-minus">−</button><span class="amrap-target-value">5 reps</span><button data-adjacent="amrap-target-plus">+</button></div></div>
      </div>
      <div class="setgroup" data-group="second">
        <div class="setrow work" data-hit-zone="below"><span class="n">2</span><div class="stp w"><button data-adjacent="next-weight">−</button><span class="val">60</span><button>+</button></div><div class="stp r"><button data-adjacent="next-reps">−</button><span class="val">5</span><button>+</button></div><button class="check" data-adjacent="next-check">✓</button></div>
        <button type="button" class="amrap-role-control role-none">+ AMRAP</button>
      </div>
    </div></main>`
}

afterAll(() => browsersStarted.forEach(browser => browser.kill('SIGTERM')))

describe('AMRAP compact target in real Chromium', () => {
  it.each([320, 375])('keeps a compact target in flow at %ipx without stealing adjacent controls', async width => {
    const { root, send, sessionId } = await connectChromium()
    await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: true }, sessionId)
    await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(fixture(width))}` }, sessionId)
    await new Promise(resolve => setTimeout(resolve, 50))
    const evaluation = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const control = document.querySelector('[data-group="first"] .amrap-role-control')
      const rect = control.getBoundingClientRect()
      const interiorWidth = Math.floor(rect.width)
      const interiorHeight = Math.floor(rect.height)
      const pixelCenters = []
      const pixelMisses = []
      for (let y = 0; y < interiorHeight; y++) for (let x = 0; x < interiorWidth; x++) {
        const hit = document.elementFromPoint(rect.left + x + 0.5, rect.top + y + 0.5)
        const routes = hit?.closest('button') === control
        pixelCenters.push(routes)
        if (!routes && pixelMisses.length < 12) pixelMisses.push({ x, y, hit: hit?.outerHTML?.slice(0, 120) || null })
      }
      const edgeInterior = []
      for (let x = 0; x < interiorWidth; x++) {
        edgeInterior.push(document.elementFromPoint(rect.left + x + 0.5, rect.top + 0.01)?.closest('button') === control)
        edgeInterior.push(document.elementFromPoint(rect.left + x + 0.5, rect.bottom - 0.01)?.closest('button') === control)
      }
      for (let y = 0; y < interiorHeight; y++) {
        edgeInterior.push(document.elementFromPoint(rect.left + 0.01, rect.top + y + 0.5)?.closest('button') === control)
        edgeInterior.push(document.elementFromPoint(rect.right - 0.01, rect.top + y + 0.5)?.closest('button') === control)
      }
      const adjacent = [...document.querySelectorAll('[data-adjacent]:not([data-adjacent^="amrap"])')].map(button => {
        const box = button.getBoundingClientRect()
        return { name: button.dataset.adjacent, x: box.left + box.width / 2, y: box.top + box.height / 2,
          routes: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('button') === button }
      })
      const targetButtons = [...document.querySelectorAll('[data-amrap-target] button')]
      const targetValue = document.querySelector('[data-amrap-target] .amrap-target-value')
      const targetRects = targetButtons.map(button => {
        const box = button.getBoundingClientRect()
        return { name: button.dataset.adjacent, left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          x: box.left + box.width / 2, y: box.top + box.height / 2,
          routes: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest('button') === button }
      })
      const targetValueRect = targetValue.getBoundingClientRect()
      window.activationCounts = {}
      document.querySelectorAll('[data-adjacent]').forEach(button => button.addEventListener('click', () => {
        const name = button.dataset.adjacent
        window.activationCounts[name] = (window.activationCounts[name] || 0) + 1
      }))
      const roleLabels = ['★ AMRAP · progression', 'AMRAP', '+ AMRAP']
      control.addEventListener('click', () => {
        const cycle = Number(control.dataset.cycle || 0) + 1
        control.dataset.cycle = String(cycle)
        control.textContent = roleLabels[cycle % roleLabels.length]
      })
      const adjacentPoint = (x, y) => document.elementFromPoint(x, y)?.closest('[data-hit-zone]')?.dataset.hitZone || null
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const centerRoutes = document.elementFromPoint(center.x, center.y)?.closest('button') === control
      const above = adjacentPoint(center.x, rect.top - 1)
      const below = adjacentPoint(center.x, rect.bottom + 1.5)
      const nextRowTop = document.querySelector('[data-group="second"] .setrow').getBoundingClientRect().top
      const targetStyle = getComputedStyle(targetValue)
      const targetButtonStyle = getComputedStyle(targetButtons[0])
      return { pixelCentersPass: pixelCenters.every(Boolean), pixelCenterCount: pixelCenters.length, pixelMisses,
        edgeInteriorPass: edgeInterior.every(Boolean), edgeInteriorCount: edgeInterior.length,
        adjacent, visibleHeight: rect.height, visibleWidth: rect.width, nextRowTop,
        overlapsNext: rect.bottom > nextRowTop, lineHeight: getComputedStyle(control).lineHeight,
        noTextClip: control.scrollWidth <= control.clientWidth, center, centerRoutes, above, below,
        targetRects, targetValueRect: { left: targetValueRect.left, right: targetValueRect.right, top: targetValueRect.top, bottom: targetValueRect.bottom },
        targetStyle: { border: targetStyle.border, borderWidth: targetStyle.borderWidth, background: targetStyle.backgroundColor, boxShadow: targetStyle.boxShadow },
        targetButtonStyle: { border: targetButtonStyle.border, borderWidth: targetButtonStyle.borderWidth, background: targetButtonStyle.backgroundColor, boxShadow: targetButtonStyle.boxShadow },
        targetOverflow: document.querySelector('[data-amrap-target]').scrollWidth <= document.querySelector('[data-amrap-target]').clientWidth }
    })()` }, sessionId)

    expect(evaluation.exceptionDetails).toBeUndefined()
    const measured = evaluation.result.value
    expect(measured, JSON.stringify(measured.pixelMisses)).toMatchObject({ pixelCentersPass: true, edgeInteriorPass: true,
      overlapsNext: false, lineHeight: '16px' })
    expect(measured.visibleWidth).toBeGreaterThanOrEqual(44)
    expect(measured.visibleHeight).toBeGreaterThanOrEqual(18)
    expect(measured.visibleHeight).toBeLessThanOrEqual(22)
    expect(measured.noTextClip).toBe(true)
    expect(measured.centerRoutes).toBe(true)
    expect(measured.pixelCenterCount).toBe(Math.floor(measured.visibleWidth) * Math.floor(measured.visibleHeight))
    expect(measured.edgeInteriorCount).toBe(2 * (Math.floor(measured.visibleWidth) + Math.floor(measured.visibleHeight)))
    expect(measured.adjacent.map(hit => hit.routes)).toEqual([true, true, true, true, true, true, true, true, true])
    expect(measured.targetRects.map(hit => hit.name)).toEqual(['amrap-target-minus', 'amrap-target-plus'])
    expect(measured.targetRects.every(hit => hit.routes && hit.right > hit.left && hit.bottom > hit.top)).toBe(true)
    expect(measured.targetRects[0].right).toBeLessThan(measured.targetValueRect.left)
    expect(measured.targetValueRect.right).toBeLessThan(measured.targetRects[1].left)
    expect(measured.targetRects[0].y).toBeCloseTo(measured.targetRects[1].y, 1)
    expect(measured.targetValueRect.top).toBeGreaterThanOrEqual(measured.targetRects[0].top)
    expect(measured.targetValueRect.bottom).toBeLessThanOrEqual(measured.targetRects[0].bottom)
    expect(measured.targetStyle.borderWidth).toBe('0px')
    expect(measured.targetStyle.boxShadow).toBe('none')
    expect(measured.targetButtonStyle.borderWidth).toBe('0px')
    expect(measured.targetButtonStyle.boxShadow).toBe('none')
    expect(measured.targetOverflow).toBe(true)

    for (const hit of measured.targetRects) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, sessionId)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, sessionId)
    }

    for (const hit of measured.adjacent) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, sessionId)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, sessionId)
    }

    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: measured.center.x, y: measured.center.y, button: 'left', clickCount: 1 }, sessionId)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: measured.center.x, y: measured.center.y, button: 'left', clickCount: 1 }, sessionId)
    const centerHit = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const control = document.querySelector('[data-adjacent="amrap-role"]')
      return { activations: window.activationCounts['amrap-role'] || 0, cycle: Number(control.dataset.cycle || 0), label: control.textContent }
    })()` }, sessionId)
    expect(centerHit.result.value).toEqual({ activations: 1, cycle: 1, label: 'AMRAP' })
    const activations = await send('Runtime.evaluate', { returnByValue: true, expression: 'window.activationCounts' }, sessionId)
    expect(activations.result.value).toEqual({
      'previous-weight': 1, 'previous-reps': 1, 'previous-check': 1,
      weight: 1, reps: 1, check: 1, 'amrap-role': 1, 'amrap-target-minus': 1, 'amrap-target-plus': 1,
      'next-weight': 1, 'next-reps': 1, 'next-check': 1
    })
    root.close()
  }, 15000)
})
