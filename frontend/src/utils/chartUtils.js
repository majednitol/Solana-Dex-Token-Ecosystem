export function getRolling6Months() {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.toLocaleDateString('en-US', { month: 'short' }))
  }
  return months
}

export function getMonthBoundaries() {
  const now = new Date()
  const boundaries = []
  for (let i = 5; i >= 0; i--) {
    const y = now.getFullYear()
    const m = now.getMonth() - i
    const start = Date.UTC(y, m, 1)
    const end = Date.UTC(y, m + 1, 0, 23, 59, 59, 999)
    boundaries.push({ start, end })
  }
  return boundaries
}

export function niceYAxisTicks(dataMax, tickCount = 4) {
  if (!dataMax || dataMax <= 0) return [0, 1, 2, 3]
  const rawStep = dataMax / (tickCount - 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const niceSteps = [1, 2, 2.5, 5, 10]
  const normalized = rawStep / magnitude
  let niceStep = magnitude * 10
  for (const s of niceSteps) {
    if (normalized <= s) {
      niceStep = s * magnitude
      break
    }
  }
  const niceMax = Math.ceil(dataMax / niceStep) * niceStep
  const ticks = []
  for (let v = 0; v <= niceMax; v += niceStep) {
    ticks.push(parseFloat(v.toPrecision(10)))
  }
  if (ticks.length < 2) ticks.push(niceStep)
  return ticks
}

export function aggregateToMonthlyBins(candles, mode = 'avg') {
  if (!Array.isArray(candles) || candles.length === 0) return [0, 0, 0, 0, 0, 0]
  const boundaries = getMonthBoundaries()
  const bins = boundaries.map(() => [])

  for (const candle of candles) {
    const raw = candle.time || candle.bucket
    const t = typeof raw === 'number' ? raw : new Date(raw).getTime()
    if (isNaN(t)) continue
    for (let i = 0; i < boundaries.length; i++) {
      if (t >= boundaries[i].start && t <= boundaries[i].end) {
        bins[i].push(candle)
        break
      }
    }
  }

  return bins.map(bin => {
    if (bin.length === 0) return 0
    if (mode === 'sum') {
      return bin.reduce((s, c) => s + (c.volume || 0), 0)
    }
    return bin.reduce((s, c) => s + (c.close || 0), 0) / bin.length
  })
}

export function formatTickValue(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  if (v >= 1) return v.toFixed(0)
  if (v >= 0.01) return v.toFixed(2)
  if (v >= 0.001) return v.toFixed(3)
  return v.toString()
}
