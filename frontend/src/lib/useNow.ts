import { useEffect, useState } from 'react'

/**
 * Current epoch ms, refreshed every `intervalMs` (default 30 s) so relative-time
 * labels age without a data change. The timer is cleared on unmount; only the
 * components that render a relative time should subscribe.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      clearInterval(timer)
    }
  }, [intervalMs])
  return now
}
