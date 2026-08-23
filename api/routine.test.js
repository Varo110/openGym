import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveRoutineId } from './routine.js';
import { effectiveRoutineIds } from '../frontend/src/lib/history.js';

const ISO = '2026-07-27'; // Monday (getDay() === 1)
const routines = [{ id: 'push' }, { id: 'pull' }];

const stateFor = (override, weekly = 'push') => ({
  routines,
  week: { 1: weekly },
  dayPlan: override === undefined ? {} : { [ISO]: override }
});

const cases = [
  ['weekly valid', undefined, 'push'],
  ['weekly stale', undefined, null, 'gone'],
  ['valid scalar override', 'pull', 'pull'],
  ['stale scalar override falls through', 'gone', 'push'],
  ['rest scalar override', 'rest', null],
  ['ordered list override uses first valid id', ['pull', 'push'], 'pull'],
  ['mixed stale and valid list keeps valid order', ['gone', 'pull', 'push'], 'pull'],
  ['stale non-empty list falls through', ['gone'], 'push'],
  ['empty list is explicit rest', [], null],
  ['rest in a list is explicit rest', ['pull', 'rest'], null],
  ['null malformed override falls through', null, 'push'],
  ['object malformed override falls through', { id: 'pull' }, 'push'],
  ['numeric malformed override falls through', 7, 'push']
];

test('server routine resolution matches frontend effectiveRoutineIds', () => {
  for (const [label, override, expected, weekly] of cases) {
    const state = stateFor(override, weekly);
    const frontend = effectiveRoutineIds(state, ISO)[0] || null;
    assert.equal(frontend, expected, `${label}: frontend fixture expectation`);
    assert.equal(effectiveRoutineId(state, ISO), frontend, label);
  }
});