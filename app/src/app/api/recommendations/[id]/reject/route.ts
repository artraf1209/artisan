import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RouteError } from '@/lib/execute-trade'
import { DEFAULT_ADMIN_USER_ID, type QueueType } from '@/lib/queue'

type RejectBody = {
  queue_type?: QueueType
  note?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as RejectBody
    const queueType = body.queue_type

    if (queueType !== 'recommendation' && queueType !== 'position_review') {
      throw new RouteError('queue_type must be recommendation or position_review.', 400)
    }

    const supabase = createAdminClient() as any
    const patch = {
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: DEFAULT_ADMIN_USER_ID,
      review_note: body.note?.trim() || null,
    }

    const table = queueType === 'recommendation' ? 'recommendations' : 'position_reviews'
    const { error } = await supabase.from(table).update(patch).eq('id', id)

    if (error) {
      throw new RouteError(error.message, 500)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unexpected rejection error.' },
      { status: 500 },
    )
  }
}
