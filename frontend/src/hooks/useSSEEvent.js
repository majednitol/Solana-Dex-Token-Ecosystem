import { useCallback, useRef, useEffect } from 'react'
import { useTradeStream } from './useChartData'

export function useSSEEvent(channel, callback) {
  const cbRef = useRef(callback)
  cbRef.current = callback

  useTradeStream(useCallback((data) => {
    if (data.channel === channel) {
      cbRef.current(data)
    }
  }, [channel]))
}

export function useSSERefresh(channel, refreshFn, debounceMs = 500) {
  const timerRef = useRef(null)
  const refreshRef = useRef(refreshFn)
  refreshRef.current = refreshFn

  useSSEEvent(channel, useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (refreshRef.current) refreshRef.current()
    }, debounceMs)
  }, [debounceMs, channel]))

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
}
