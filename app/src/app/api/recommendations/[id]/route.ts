import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { loadRecommendationDetail } from '@/lib/recommendation-detail'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = (await createServerClient()) as any
    const detail = await loadRecommendationDetail(supabase, id)

    if (!detail) {
      return NextResponse.json({ error: 'Recommendation not found.' }, { status: 404 })
    }

    return NextResponse.json(detail)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load recommendation detail.' },
      { status: 500 },
    )
  }
}
