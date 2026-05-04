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
          background:
            'radial-gradient(circle at top left, #2c2a35 0%, #17151d 45%, #0c0b10 100%)',
          borderRadius: 44,
          color: '#f8f7f3',
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -6,
        }}
      >
        A
      </div>
    ),
    size,
  )
}
