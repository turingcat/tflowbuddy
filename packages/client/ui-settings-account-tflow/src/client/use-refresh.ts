/** Shared refresh lifecycle for account and usage sections. */
import { useEffect, useRef, useState } from 'react'

/**
 * Refresh on mount and keep retry state while the section remains mounted.
 * @param refresh - Publisher owning the loading and failure snapshots.
 * @returns Retry state and an operation that observes completion.
 */
export function useRefresh(refresh: () => Promise<void>): { busy: boolean; runRefresh: () => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { void runRefresh() }, [refresh])

  async function runRefresh(): Promise<void> {
    setBusy(true)
    try { await refresh() }
    catch (error) {
      // The owning publisher reports the failure through its snapshot.
      void error
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return { busy, runRefresh }
}
