import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_ADMIN_USER_ID = (process.env.ADMIN_USER_ID ?? '00000000-0000-0000-0000-000000000001').trim()

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { note } = (await request.json().catch(() => ({}))) as { note?: string }
  const supabase = createAdminClient() as any

  const { error } = await supabase
    .from('signal_events')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: DEFAULT_ADMIN_USER_ID,
      review_note: note?.trim() || null,
    })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
