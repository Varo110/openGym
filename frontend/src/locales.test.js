import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { collectSourceInventory, validateLocaleDictionaries } from '../scripts/check-locales.mjs'
import { BODYPARTS } from './lib/exercises.js'

const settings = readFileSync(new URL('./views/Settings.jsx', import.meta.url), 'utf8')
const sourceDir = dirname(fileURLToPath(import.meta.url))
const start = settings.indexOf('function ProgrammeLibrary')
const end = settings.indexOf('\n}\n\nexport default function Settings', start)
const programmeKeys = [...settings.slice(start, end).matchAll(/t\('([^']+)'/g)].map(match => match[1])
const locales = ['de', 'es', 'fr', 'it', 'pt', 'pl', 'tr', 'ru', 'zh', 'ko', 'hi']
const phase1RequiredKeys = [
  'AMRAP miss',
  '10% deload',
  'Maintain weight',
  'Minimum reps',
  'Maximum duration (optional)',
  'Follow routine ({0})',
  'This plan is in {0}; weights will be converted to your profile’s {1}.',
  'This legacy plan does not declare a weight unit. Weighted values are accepted only when no conversion is needed.',
  'Finish the active workout before changing units.',
  'Note: switching units never converts logged numbers; finish an active workout first.',
  'reps',
  'seconds',
  'maintain',
  'The configured seconds are the minimum hold; this optional duration applies only to the final work AMRAP.',
  'Enter a positive weight and reps for a valid estimate.'
]
const phase1ReviewedLabels = [
  'Est. 1RM',
  'Estimated 1RM',
  'Estimated 1RM per workout',
  'Best estimated 1RM:',
  'Training review'
]
const phase1ErrorKeys = [
  'Plan import rejected: the bundle weight unit is missing or unknown.',
  'Plan import rejected: the bundle weight unit is missing; refusing to guess kg or lb.',
  'Plan import rejected: descendant weight unit at {0} is missing or unknown.',
  'Plan import rejected: descendant weight unit at {0} conflicts with the bundle unit ({1}).'
]
const historyProgressionKeys = [
  'Last performance', 'Show last 3', 'Hide last 3', 'e1RM', 'PR',
  'No automatic progression · targets stay where you set them.',
  '{0} · no compatible completed session yet — this target sets the baseline.',
  'Bodyweight · every set was clean → aim for {0} reps.',
  'Bodyweight · every set was clean → add a set and go back to {0} reps.',
  'Linear progression · completed all prescribed reps last session → +{0} {1}.',
  'Greyskull LP · AMRAP minimum met last session → +{0} {1}.',
  'Greyskull LP · AMRAP reached twice the target → double jump +{0} {1}.',
  'Double progression · top of the rep range reached → +{0} {1}, back to {2} reps.',
  'Add time · every set held for the full duration → +{0}s.',
  'Add time · repeated short sessions → back off to {0}s and build up again.',
  'Add time · last session came up short → repeat the same target.',
  '{0} · missed reps trigger a reset → {1} {2}.',
  'Double progression · same weight → aim for {0} reps.',
  'Greyskull LP · AMRAP minimum missed → maintain the current weight.',
  'Programme deload · progression paused — resume the pre-deload target before adding load.',
  'Progression paused · complete the prescribed work before progressing.',
  'No progression-driver set · hold the current target.',
  '{0} · missed reps → repeat the current target.'
]

const customMergeKeys = [
  'Custom exercises',
  'Review custom exercises',
  'Imported names that did not match the catalogue stay custom until you choose a match.',
  '{0} custom exercises to review',
  'Choose a catalogue match for each imported exercise, or keep it as custom. Suggestions are ranked and never change dates.',
  'No custom exercises to review',
  '{0} logged entries',
  'No logged entries — kept here for review',
  'Used',
  'Unused',
  'Catalogue choices for {0}',
  'Keep as custom',
  'Leave this exercise unchanged',
  'No close catalogue match',
  'Merge selected',
  '{0} custom exercises merged'
]
const cueLongFormKeys = [
  'Private reminders for this exercise. They stay with your account unless you explicitly include them when sharing a plan.',
  'Personal cues (optional) — reminders that are specific to you',
  'Group cues (optional) — instructions for this linked group',
  'Private exercise reminders are excluded unless you turn this on.',
  'Replace your local cues for exercises included in this file.'
]

describe('Personal programmes localization', () => {
  it('has every programme-library key in every non-English dictionary', () => {
    expect(programmeKeys.length).toBeGreaterThan(0)
    for (const locale of locales) {
      const source = readFileSync(new URL(`./locales/${locale}.js`, import.meta.url), 'utf8')
      for (const key of programmeKeys) expect(source).toContain(`'${key}'`)
    }
  })

  it('has the Phase 1 required-key inventory and localized plan-unit errors in every dictionary', async () => {
    expect(phase1RequiredKeys).toHaveLength(15)
    const keys = [...phase1RequiredKeys, ...phase1ReviewedLabels, ...phase1ErrorKeys]
    for (const locale of locales) {
      const dictionary = (await import(`./locales/${locale}.js`)).default
      for (const key of keys) {
        expect(Object.hasOwn(dictionary, key), `${locale} is missing ${key}`).toBe(true)
        expect(dictionary[key], `${locale} has an empty translation for ${key}`).toEqual(expect.any(String))
        expect(dictionary[key].trim(), `${locale} has a blank translation for ${key}`).not.toBe('')
        if (key.includes('{0}')) expect(dictionary[key]).toContain('{0}')
        if (key.includes('{1}')) expect(dictionary[key]).toContain('{1}')
      }
    }
  }, 20000)

  it('has every custom-exercise merge key in every dictionary', async () => {
    for (const locale of locales) {
      const dictionary = (await import(`./locales/${locale}.js`)).default
      for (const key of customMergeKeys) {
        expect(Object.hasOwn(dictionary, key), `${locale} is missing ${key}`).toBe(true)
        expect(dictionary[key], `${locale} has an empty translation for ${key}`).toEqual(expect.any(String))
        expect(dictionary[key].trim(), `${locale} has a blank translation for ${key}`).not.toBe('')
        if (key.includes('{0}')) expect(dictionary[key]).toContain('{0}')
      }
    }
  })

  it('translates every long-form personal and group cue string in each non-English dictionary', async () => {
    for (const locale of locales) {
      const dictionary = (await import(`./locales/${locale}.js`)).default
      for (const key of cueLongFormKeys) {
        expect(dictionary[key], `${locale} is missing ${key}`).toEqual(expect.any(String))
        expect(dictionary[key].trim(), `${locale} has a blank translation for ${key}`).not.toBe('')
        expect(dictionary[key], `${locale} left the cue string in English`).not.toBe(key)
      }
    }
  })

  it('translates universal last-performance and policy-labelled progression copy in every dictionary', async () => {
    for (const locale of locales) {
      const dictionary = (await import(`./locales/${locale}.js`)).default
      for (const key of historyProgressionKeys) {
        expect(dictionary[key], `${locale} is missing ${key}`).toEqual(expect.any(String))
        expect(dictionary[key].trim(), `${locale} has a blank translation for ${key}`).not.toBe('')
        expect(dictionary[key], `${locale} left the history/progression key in English`).not.toBe(key)
        for (const placeholder of key.match(/\{\d+\}/g) || []) expect(dictionary[key]).toContain(placeholder)
      }
    }
  })

  it('has every runtime body-part chip key in every non-English dictionary', async () => {
    expect(BODYPARTS).toContain('full body')
    for (const locale of locales) {
      const dictionary = (await import(`./locales/${locale}.js`)).default
      for (const key of BODYPARTS) {
        expect(Object.hasOwn(dictionary, key), `${locale} is missing body-part ${key}`).toBe(true)
        expect(dictionary[key], `${locale} has an empty body-part translation for ${key}`).toEqual(expect.any(String))
        expect(dictionary[key].trim(), `${locale} has a blank body-part translation for ${key}`).not.toBe('')
      }
    }
  })
})

describe('Source-derived locale inventory gate', () => {
  it('collects literal translation keys from production source', () => {
    const inventory = collectSourceInventory(sourceDir)
    expect(inventory.has('Today’s sessions')).toBe(true)
    expect(inventory.has('Every planned session is done today - pick another routine or go freestyle.')).toBe(true)
    expect(inventory.has('Ready')).toBe(true)
    expect(inventory.has('Recovering')).toBe(true)
    expect(inventory.has('Fatigued')).toBe(true)
  })

  it('names a source key that is missing from every locale pack', async () => {
    const dictionaries = Object.fromEntries(await Promise.all(
      locales.map(async locale => [locale, (await import(`./locales/${locale}.js`)).default])
    ))
    const sourceKey = 'Source-only message {0}'
    const result = validateLocaleDictionaries({
      dictionaries,
      sourceInventory: new Map([[sourceKey, ['fixture.js:1']]])
    })

    expect(result.failed).toBe(true)
    expect(result.errors.join('\\n')).toContain(`source key missing: ${JSON.stringify(sourceKey)}`)
  })

  it('rejects a provided baseline exception when its value is blank', async () => {
    const sourceKey = 'Legacy source message'
    const dictionaries = Object.fromEntries(await Promise.all(
      locales.map(async locale => {
        const dictionary = (await import(`./locales/${locale}.js`)).default
        return [locale, { ...dictionary, [sourceKey]: '   ' }]
      })
    ))
    const result = validateLocaleDictionaries({
      dictionaries,
      sourceInventory: new Map([[sourceKey, ['fixture.js:1']]]),
      sourceKeyExceptions: new Set([sourceKey])
    })

    expect(result.failed).toBe(true)
    expect(result.errors.join('\\n')).toContain(`source key is blank: ${JSON.stringify(sourceKey)}`)
  })

  it('rejects a source translation whose placeholders do not match', async () => {
    const sourceKey = 'Source message {0} {1}'
    const dictionaries = Object.fromEntries(await Promise.all(
      locales.map(async locale => {
        const dictionary = (await import(`./locales/${locale}.js`)).default
        return [locale, { ...dictionary, [sourceKey]: 'Translated {0}' }]
      })
    ))
    const result = validateLocaleDictionaries({
      dictionaries,
      sourceInventory: new Map([[sourceKey, ['fixture.js:1']]])
    })

    expect(result.failed).toBe(true)
    expect(result.errors.join('\\n')).toContain(`source key placeholder mismatch for ${JSON.stringify(sourceKey)}`)
  })
})
