#!/usr/bin/env node
// Guards the locale contract shared by every translated source string:
//
//   node scripts/check-locales.mjs
//
// The locale dictionaries must have the same key set, and every literal source key passed
// to t() must exist in every pack. The latter is deliberately source-derived: a key absent
// from every locale cannot be discovered by comparing the locale dictionaries to one another.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const EXPECTED_LOCALES = ['de', 'es', 'fr', 'hi', 'it', 'ko', 'pl', 'pt', 'ru', 'tr', 'zh']

// These source strings predate the locale contract and are documented baseline exceptions
// (some demo-only copy, some legacy controls not yet included in the packs). Keep the
// exceptions explicit: a newly added source literal is not allowed to disappear from every
// pack silently.
export const BASELINE_SOURCE_KEY_EXCEPTIONS = new Set([
  'Work load',
  'Work settings',
  'Live demo — everything stays in this browser.',
  'Start the demo',
  'This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.',
  'Self-host it in a minute →',
  'Date',
  'Demo',
  'Self-host openGym',
  'Passkey sign-in, sync across your devices, your own data.',
  'You’re in the demo',
  'Example data, stored only in this browser — change anything you like.',
  'Reset demo data',
  'Reset demo data?',
  'Puts the example plan, workouts and weigh-ins back the way they started.',
  'Demo data reset',
  'Make superset with previous',
  'Make superset with next'
])

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const defaultLocalesDir = join(scriptDir, '..', 'src', 'locales')
export const defaultSourceDir = join(scriptDir, '..', 'src')

const IDENTIFIER_PART = /[A-Za-z0-9_$]/

function isIdentifierPart(ch) {
  return ch !== undefined && IDENTIFIER_PART.test(ch)
}

function skipTrivia(source, start) {
  let i = start
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++
      continue
    }
    if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i + 2)
      i = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    break
  }
  return i
}

function decodeJsString(raw) {
  let value = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') {
      value += raw[i]
      continue
    }

    const next = raw[++i]
    if (next === undefined) break
    if (next === '\n') continue
    if (next === '\r') {
      if (raw[i + 1] === '\n') i++
      continue
    }
    if (next === 'n') value += '\n'
    else if (next === 'r') value += '\r'
    else if (next === 't') value += '\t'
    else if (next === 'b') value += '\b'
    else if (next === 'f') value += '\f'
    else if (next === 'v') value += '\v'
    else if (next === '0') value += '\0'
    else if (next === 'x') {
      const hex = raw.slice(i + 1, i + 3)
      value += /^[0-9a-f]{2}$/i.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : 'x'
      if (hex.length === 2) i += 2
    } else if (next === 'u') {
      if (raw[i + 1] === '{') {
        const close = raw.indexOf('}', i + 2)
        const hex = close === -1 ? '' : raw.slice(i + 2, close)
        if (/^[0-9a-f]+$/i.test(hex)) {
          value += String.fromCodePoint(parseInt(hex, 16))
          i = close
        } else value += 'u'
      } else {
        const hex = raw.slice(i + 1, i + 5)
        value += /^[0-9a-f]{4}$/i.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : 'u'
        if (hex.length === 4) i += 4
      }
    } else {
      // Quotes, backslashes, backticks, and JavaScript identity escapes all retain the
      // escaped character in the resulting source string.
      value += next
    }
  }
  return value
}

function readQuoted(source, start) {
  const quote = source[start]
  let raw = ''
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === quote) return { value: decodeJsString(raw), end: i + 1 }
    if (ch === '\\' && i + 1 < source.length) {
      raw += ch + source[i + 1]
      i += 2
      continue
    }
    raw += ch
    i++
  }
  return { value: decodeJsString(raw), end: source.length }
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function addSourceKey(inventory, key, file, source, offset) {
  const locations = inventory.get(key) || []
  locations.push(`${file}:${lineNumber(source, offset)}`)
  inventory.set(key, locations)
}

// Scan template expressions as code while ignoring their literal text. This keeps source
// keys inside HTML/template output visible without treating arbitrary template prose as a
// translation call.
function scanTemplate(source, start, onLiteral, captureStatic = false) {
  let i = start + 1
  let raw = ''
  let hasExpression = false
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\' && i + 1 < source.length) {
      raw += ch + source[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      if (captureStatic && !hasExpression) onLiteral(decodeJsString(raw), start)
      return i + 1
    }
    if (ch === '$' && source[i + 1] === '{') {
      hasExpression = true
      i = scanExpression(source, i + 2, onLiteral)
      continue
    }
    raw += ch
    i++
  }
  if (captureStatic && !hasExpression) onLiteral(decodeJsString(raw), start)
  return source.length
}

function scanDynamicArgument(source, start, onLiteral) {
  let i = start
  let ternaryDepth = 0
  let branchExpected = false
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0

  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i + 2)
      i = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    const ch = source[i]
    if (ch === "'" || ch === '"') {
      const literal = readQuoted(source, i)
      if (branchExpected) {
        onLiteral(literal.value, i)
        branchExpected = false
      }
      i = literal.end
      continue
    }
    if (ch === '`') {
      const branchLiteral = (key, offset) => {
        if (branchExpected) {
          onLiteral(key, offset)
          branchExpected = false
        }
      }
      i = scanTemplate(source, i, branchLiteral, true)
      continue
    }
    if (ch === '(') parenDepth++
    else if (ch === ')') {
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return
      parenDepth--
    } else if (ch === '[') bracketDepth++
    else if (ch === ']') bracketDepth--
    else if (ch === '{') braceDepth++
    else if (ch === '}') braceDepth--
    else if (ch === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return
    else if (ch === '?' && source[i + 1] !== '?' && source[i + 1] !== '.' && source[i - 1] !== '?') {
      ternaryDepth++
      branchExpected = true
    } else if (ch === ':' && ternaryDepth > 0) {
      ternaryDepth--
      branchExpected = true
    } else if (branchExpected && !/[\s([{!~+\-]/.test(ch)) {
      branchExpected = false
    }
    i++
  }
}

function scanCallArgument(source, start, onLiteral) {
  const arg = skipTrivia(source, start)
  if (source[arg] === "'" || source[arg] === '"') {
    const literal = readQuoted(source, arg)
    onLiteral(literal.value, arg)
  } else if (source[arg] === '`') {
    scanTemplate(source, arg, onLiteral, true)
  } else {
    scanDynamicArgument(source, arg, onLiteral)
  }
}

function scanExpression(source, start, onLiteral) {
  let depth = 1
  let i = start
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i + 2)
      i = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    const ch = source[i]
    if (ch === "'" || ch === '"') {
      i = readQuoted(source, i).end
      continue
    }
    if (ch === '`') {
      i = scanTemplate(source, i, onLiteral)
      continue
    }
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
      i++
      continue
    }
    if (ch === 't' && !isIdentifierPart(source[i - 1]) && source[i - 1] !== '.' && !isIdentifierPart(source[i + 1])) {
      const open = skipTrivia(source, i + 1)
      if (source[open] === '(') scanCallArgument(source, open + 1, onLiteral)
    }
    i++
  }
  return source.length
}

function scanSourceText(source, file, inventory) {
  let i = 0
  const onLiteral = (key, offset) => addSourceKey(inventory, key, file, source, offset)
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const newline = source.indexOf('\n', i + 2)
      i = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    const ch = source[i]
    if (ch === "'" || ch === '"') {
      i = readQuoted(source, i).end
      continue
    }
    if (ch === '`') {
      i = scanTemplate(source, i, onLiteral)
      continue
    }
    if (ch === 't' && !isIdentifierPart(source[i - 1]) && source[i - 1] !== '.' && !isIdentifierPart(source[i + 1])) {
      const open = skipTrivia(source, i + 1)
      if (source[open] === '(') scanCallArgument(source, open + 1, onLiteral)
    }
    i++
  }
}

function sourceFiles(rootDir) {
  const files = []
  const visit = (dir, parts = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (entry.name === 'locales') continue
        visit(join(dir, entry.name), [...parts, entry.name])
        continue
      }
      if (!entry.isFile() || !['.js', '.jsx'].includes(entry.name.slice(entry.name.lastIndexOf('.')))) continue
      if (entry.name.includes('.test.')) continue
      files.push({ path: join(dir, entry.name), name: [...parts, entry.name].join('/') })
    }
  }
  visit(rootDir)
  return files
}

export function collectSourceInventory(rootDir = defaultSourceDir) {
  const inventory = new Map()
  for (const file of sourceFiles(rootDir)) scanSourceText(readFileSync(file.path, 'utf8'), file.name, inventory)
  return inventory
}

function placeholderTokens(value) {
  return String(value).match(/\{\d+\}/g) || []
}

function sameTokens(left, right) {
  if (left.length !== right.length) return false
  const counts = new Map()
  for (const token of left) counts.set(token, (counts.get(token) || 0) + 1)
  for (const token of right) {
    const remaining = counts.get(token) || 0
    if (!remaining) return false
    if (remaining === 1) counts.delete(token)
    else counts.set(token, remaining - 1)
  }
  return counts.size === 0
}

function entriesOf(dictionaries) {
  return dictionaries instanceof Map ? [...dictionaries.entries()] : Object.entries(dictionaries)
}

export function validateLocaleDictionaries({ dictionaries = {}, sourceInventory = new Map(), sourceKeyExceptions = new Set() } = {}) {
  const entries = entriesOf(dictionaries)
  const errors = []
  const seen = new Map()
  const union = new Set()

  for (const [, dictionary] of entries) {
    for (const key of Object.keys(dictionary || {})) {
      union.add(key)
      seen.set(key, (seen.get(key) || 0) + 1)
    }
  }

  for (const [locale, dictionary] of entries) {
    const keys = new Set(Object.keys(dictionary || {}))
    const missing = [...union].filter(key => !keys.has(key))
    const orphans = [...union].filter(key => keys.has(key) && seen.get(key) === 1)
    if (missing.length || orphans.length) {
      errors.push(`\n${locale}.js: ${keys.size}/${union.size} keys`)
      for (const key of missing) errors.push(`  missing:   ${JSON.stringify(key)}`)
      for (const key of orphans) errors.push(`  only here: ${JSON.stringify(key)}`)
    }

    for (const key of keys) {
      const value = dictionary[key]
      if (typeof value !== 'string') {
        errors.push(`${locale}.js: translation is not a string: ${JSON.stringify(key)}`)
        continue
      }
      if (!value.trim()) errors.push(`${locale}.js: blank translation: ${JSON.stringify(key)}`)
      const expected = placeholderTokens(key)
      const actual = placeholderTokens(value)
      if (!sameTokens(expected, actual)) {
        errors.push(`${locale}.js: placeholder mismatch for ${JSON.stringify(key)} (expected ${expected.join(', ') || 'none'}; found ${actual.join(', ') || 'none'})`)
      }
    }
  }

  for (const [key, locations] of entriesOf(sourceInventory)) {
    const allowMissing = sourceKeyExceptions.has(key)
    for (const [locale, dictionary] of entries) {
      const hasKey = Object.prototype.hasOwnProperty.call(dictionary || {}, key)
      if (!hasKey) {
        if (!allowMissing) {
          errors.push(`${locale}.js: source key missing: ${JSON.stringify(key)} (${locations[0] || 'source'})`)
        }
        continue
      }
      const value = dictionary[key]
      if (typeof value !== 'string') {
        errors.push(`${locale}.js: source key is not a string: ${JSON.stringify(key)}`)
        continue
      }
      if (!value.trim()) errors.push(`${locale}.js: source key is blank: ${JSON.stringify(key)}`)
      const expected = placeholderTokens(key)
      const actual = placeholderTokens(value)
      if (!sameTokens(expected, actual)) {
        errors.push(`${locale}.js: source key placeholder mismatch for ${JSON.stringify(key)} (expected ${expected.join(', ') || 'none'}; found ${actual.join(', ') || 'none'})`)
      }
    }
  }

  const checkedSourceKeys = [...entriesOf(sourceInventory)].filter(([key]) => !sourceKeyExceptions.has(key)).length
  return { failed: errors.length > 0, errors, union, sourceKeys: sourceInventory.size, checkedSourceKeys }
}

export async function loadLocaleDictionaries(localesDirectory = defaultLocalesDir) {
  const files = readdirSync(localesDirectory).filter(file => file.endsWith('.js')).sort()
  const dictionaries = new Map()
  const errors = []
  for (const file of files) {
    const locale = file.replace(/\.js$/, '')
    try {
      const { default: dictionary } = await import(pathToFileURL(join(localesDirectory, file)).href)
      if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
        errors.push(`${file}: no default-exported object`)
      } else dictionaries.set(locale, dictionary)
    } catch (error) {
      errors.push(`${file}: failed to load (${error.message})`)
    }
  }
  return { files, dictionaries, errors }
}

export async function runCheck({ localesDirectory = defaultLocalesDir, sourceDirectory = defaultSourceDir, sourceKeyExceptions = BASELINE_SOURCE_KEY_EXCEPTIONS } = {}) {
  const loaded = await loadLocaleDictionaries(localesDirectory)
  const sourceInventory = collectSourceInventory(sourceDirectory)
  const actualLocales = new Set(loaded.dictionaries.keys())
  const localeErrors = [
    ...EXPECTED_LOCALES.filter(locale => !actualLocales.has(locale)).map(locale => `Missing expected locale pack: ${locale}.js`),
    ...[...actualLocales].filter(locale => !EXPECTED_LOCALES.includes(locale)).map(locale => `Unexpected locale pack: ${locale}.js`),
    ...loaded.errors
  ]
  const result = validateLocaleDictionaries({ dictionaries: loaded.dictionaries, sourceInventory, sourceKeyExceptions })
  result.errors.unshift(...localeErrors)
  result.failed = result.errors.length > 0
  result.locales = loaded.dictionaries
  return result
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const result = await runCheck()
  if (result.failed) {
    for (const error of result.errors) console.error(error)
    console.error('\nLocale inventory check failed. Every source key must be present, nonblank, and placeholder-safe in every locale.')
    process.exitCode = 1
  } else {
    console.log(`${result.locales.size} locales, ${result.union.size} keys each — in sync with ${result.checkedSourceKeys} checked source t() keys (${result.sourceKeys - result.checkedSourceKeys} documented baseline exceptions).`)
  }
}
