import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0B0C0E',
          border: '8px solid #FFB300',
          borderRadius: 36,
          color: '#FFB300',
          fontSize: 42,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: 1,
        }}
      >
        AR
      </div>
    ),
    size,
  )
}
