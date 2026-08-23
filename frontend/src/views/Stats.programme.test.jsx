import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./Stats.jsx', import.meta.url), 'utf8')

describe('Stats programme history surface', () => {
  it('renders completed cycles as a dedicated compact section with a repeat action', () => {
    expect(source).toContain('CompletedProgrammeRow')
    expect(source).toContain("t('Completed programmes')")
    expect(source).toContain("nav('/programme/pickup'")
    expect(source).toContain('completedProgrammeCycles')
  })
})
