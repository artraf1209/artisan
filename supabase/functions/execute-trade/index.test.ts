import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { mapExecutionStatus, mapIntentStatus } from './index.ts'

Deno.test('mapExecutionStatus covers every Alpaca order status', () => {
  assertEquals(mapExecutionStatus('filled'), 'filled')
  assertEquals(mapExecutionStatus('partially_filled'), 'partial')
  assertEquals(mapExecutionStatus('rejected'), 'rejected')
  assertEquals(mapExecutionStatus('canceled'), 'cancelled')
  assertEquals(mapExecutionStatus('cancelled'), 'cancelled')

  for (const status of ['expired', 'done_for_day', 'stopped', 'suspended']) {
    assertEquals(mapExecutionStatus(status), 'expired')
  }

  for (const status of [
    'new',
    'accepted',
    'pending_new',
    'accepted_for_bidding',
    'calculated',
    'pending_cancel',
    'pending_replace',
    null,
    undefined,
  ]) {
    assertEquals(mapExecutionStatus(status as string | null | undefined), 'pending')
  }

  // Unrecognized values fail safe to 'pending' rather than throwing.
  assertEquals(mapExecutionStatus('some_future_alpaca_status'), 'pending')
})

Deno.test('mapExecutionStatus is case-insensitive', () => {
  assertEquals(mapExecutionStatus('FILLED'), 'filled')
  assertEquals(mapExecutionStatus('Partially_Filled'), 'partial')
})

Deno.test('mapIntentStatus: filled always wins regardless of filledQty', () => {
  assertEquals(mapIntentStatus('filled', 100), 'filled')
  assertEquals(mapIntentStatus('filled', null), 'filled')
})

Deno.test('mapIntentStatus: rejected and cancelled pass through unchanged', () => {
  assertEquals(mapIntentStatus('rejected', null), 'rejected')
  assertEquals(mapIntentStatus('cancelled', null), 'cancelled')
})

Deno.test('mapIntentStatus: expired derives partial vs expired from filledQty', () => {
  assertEquals(mapIntentStatus('expired', 0), 'expired')
  assertEquals(mapIntentStatus('expired', null), 'expired')
  assertEquals(mapIntentStatus('expired', 5), 'partial')
})

Deno.test('mapIntentStatus: pending and partial (still open) both map to submitted', () => {
  assertEquals(mapIntentStatus('pending', null), 'submitted')
  assertEquals(mapIntentStatus('partial', 3), 'submitted')
})
