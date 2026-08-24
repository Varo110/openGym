import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ICON_NAMES } from './Icon.jsx'

const source = readFileSync(new URL('./Icon.jsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../views/Settings.jsx', import.meta.url), 'utf8')

describe('Icon external/open control', () => {
  it('keeps a visible external icon registered instead of rendering an unknown name', () => {
    expect(ICON_NAMES).toContain('external')
    expect(source).toMatch(/external:\s*<.*path/)
    expect(settingsSource).toContain('icon="external"')
    expect(settingsSource).toContain("aria-label={t('Open programme')}")
  })
})
