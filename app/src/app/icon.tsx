import { ImageResponse } from 'next/og'

export const size = {
  width: 512,
  height: 512,
}

export const contentType = 'image/png'

export default function Icon() {
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
            'radial-gradient(circle at top left, #2c2a35 0%, #15141b 42%, #09090d 100%)',
          borderRadius: 116,
          color: '#f8f7f3',
          fontSize: 220,
          fontWeight: 700,
          letterSpacing: -14,
        }}
      >
        A
      </div>
    ),
    size,
  )
}
