import { describe, expect, it } from 'vitest'
import { EXDB, matchesExerciseSearch, searchScore } from './exercises.js'

describe('built-in military press identity', () => {
  it('renames only the 1457 identity and adds the supported overhead-press note', () => {
    expect(EXDB.find(ex => ex.id === '1457')).toEqual({
      id: '1457',
      n: 'military press',
      bp: 'shoulders',
      eq: 'barbell',
      tg: 'delts',
      mg: 'triceps',
      sm: ['triceps', 'upper back'],
      st: [
        'Stand with your feet shoulder-width apart and hold the barbell with an overhand grip, slightly wider than shoulder-width.',
        'Lift the barbell to shoulder height, keeping your elbows slightly in front of the bar.',
        'Press the barbell overhead, extending your arms fully.',
        'Lower the barbell back to shoulder height and repeat for the desired number of repetitions.'
      ],
      img: '1457-Kyd9Rz5.jpg',
      gif: '1457-Kyd9Rz5.gif',
      desc: 'Also known as Overhead Press.'
    })
  })
})

describe('matchesExerciseSearch', () => {
  it('includes private personal cues in custom-exercise search', () => {
    expect(matchesExerciseSearch({ id: 'x', n: 'Split squat', cues: 'keep the front heel heavy' }, 'front heel')).toBe(true)
  })

  it('safely searches a minimal legacy custom exercise', () => {
    const exercise = { id: 'x', n: 'Legacy lift', bp: 'back' }
    expect(() => matchesExerciseSearch(exercise, 'squat')).not.toThrow()
    expect(matchesExerciseSearch(exercise, 'squat')).toBe(false)
    expect(matchesExerciseSearch(exercise, 'legacy lift')).toBe(true)
  })

  it('keeps case-insensitive matching across optional scalar and list fields', () => {
    const exercise = {
      id: 'x', n: 'Cable press', tg: 'UPPER', eq: 'Band', sm: ['Chest'],
      muscleGroups: ['Triceps'], desc: 'Control the tempo'
    }
    expect(matchesExerciseSearch(exercise, 'upper')).toBe(true)
    expect(matchesExerciseSearch(exercise, 'BAND')).toBe(true)
    expect(matchesExerciseSearch(exercise, 'chest')).toBe(true)
    expect(matchesExerciseSearch(exercise, 'TRICEPS')).toBe(true)
    expect(matchesExerciseSearch(exercise, 'TEMPO')).toBe(true)
  })

  it('matches typo-tolerant subsequences', () => {
    const bench = { id: 'x', n: 'Bench Press', tg: 'Chest', eq: 'Barbell' }
    expect(matchesExerciseSearch(bench, 'bnch')).toBe(true)
    expect(matchesExerciseSearch(bench, 'benh')).toBe(true)
    expect(matchesExerciseSearch(bench, 'zzz')).toBe(false)
  })

  it('ranks exact and prefix matches above later substrings', () => {
    const bench = { id: 'x', n: 'Bench Press', tg: 'Chest', eq: 'Barbell' }
    const flat = { id: 'y', n: 'Flat Bench Press', tg: 'Chest', eq: 'Barbell' }
    const incline = { id: 'z', n: 'Incline Bench Press', tg: 'Chest', eq: 'Barbell' }
    expect(searchScore(bench, 'bench')).toBeGreaterThan(searchScore(flat, 'bench'))
    expect(searchScore(bench, 'bench')).toBeGreaterThan(searchScore(incline, 'bench'))
    expect(searchScore(bench, 'bench')).toBeGreaterThan(0)
    expect(searchScore(bench, 'zzz')).toBe(0)
  })

  it('matches multi-word queries in any word order', () => {
    const bench = { id: 'x', n: 'Bench Press', tg: 'Chest', eq: 'Barbell' }
    expect(matchesExerciseSearch(bench, 'press bench')).toBe(true)
    expect(matchesExerciseSearch(bench, 'bench press')).toBe(true)
    expect(searchScore(bench, 'press bench')).toBeGreaterThan(0)
    expect(matchesExerciseSearch(bench, 'press row')).toBe(false)
    expect(matchesExerciseSearch(bench, 'cable press')).toBe(false)
  })
})
