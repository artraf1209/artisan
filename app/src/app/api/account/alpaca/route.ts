import { NextResponse } from 'next/server'
import { fetchAlpacaAccountState } from '@/lib/alpaca'

export async function GET() {
  try {
    const account = await fetchAlpacaAccountState()
    return NextResponse.json(account)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Alpaca account state.' },
      { status: 500 },
    )
  }
}
