import { memo, useMemo } from 'react'

function SparklineChart({ data, color = '#00d68f', width = 120, height = 40 }) {
  if (!data || data.length === 0) return null

  const pathD = useMemo(() => {
    let min = data[0], max = data[0]
    for (let i = 1; i < data.length; i++) {
      if (data[i] < min) min = data[i]
      if (data[i] > max) max = data[i]
    }
    const range = max - min || 1
    const stepX = width / (data.length - 1 || 1)

    const points = []
    for (let i = 0; i < data.length; i++) {
      const x = i * stepX
      const y = height - 2 - ((data[i] - min) / range) * (height - 4)
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    }
    return `M${points.join(' L')}`
  }, [data, width, height])

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  )
}

export default memo(SparklineChart)
