import assert from 'node:assert/strict'
import test from 'node:test'

import { formatStoredCalendarDate } from './briefings'

test('formatStoredCalendarDate renders the stored calendar date without timezone drift', () => {
  assert.equal(formatStoredCalendarDate('2026-08-19'), 'Aug 19, 2026')
})

test('formatStoredCalendarDate keeps the empty-state copy for missing dates', () => {
  assert.equal(formatStoredCalendarDate(''), 'No briefing date')
})
