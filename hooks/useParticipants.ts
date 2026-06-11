'use client'

import { useCallback, useMemo, useState } from 'react'

import type { Participant, PresencePayload } from '@/types'

/**
 * Idempotent, peerId-keyed roster of call participants derived from presence
 * plus per-peer media/connection updates. Safe to feed duplicate presence
 * sync/join events — entries are merged, never duplicated. The local user is
 * always sorted first.
 */
export function useParticipants() {
  const [byId, setById] = useState<Map<string, Participant>>(new Map())

  const participants = useMemo(() => {
    return Array.from(byId.values()).sort((a, b) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
      return a.peerId.localeCompare(b.peerId)
    })
  }, [byId])

  /** Insert or merge a participant from a presence payload. */
  const upsertFromPresence = useCallback(
    (payload: PresencePayload, opts?: { isLocal?: boolean }) => {
      setById((prev) => {
        const next = new Map(prev)
        const existing = next.get(payload.peerId)
        next.set(payload.peerId, {
          peerId: payload.peerId,
          userId: payload.userId,
          displayName: payload.displayName,
          avatarUrl: payload.avatarUrl,
          stream: existing?.stream ?? null,
          connectionState:
            existing?.connectionState ?? (opts?.isLocal ? 'connected' : 'new'),
          audioEnabled: existing?.audioEnabled ?? true,
          videoEnabled: existing?.videoEnabled ?? true,
          isLocal: opts?.isLocal ?? existing?.isLocal ?? false,
        })
        return next
      })
    },
    [],
  )

  /** Shallow-merge a patch onto an existing participant (no-op if unknown). */
  const patch = useCallback(
    (peerId: string, changes: Partial<Participant>) => {
      setById((prev) => {
        const existing = prev.get(peerId)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(peerId, { ...existing, ...changes })
        return next
      })
    },
    [],
  )

  const setStream = useCallback(
    (peerId: string, stream: MediaStream | null) => patch(peerId, { stream }),
    [patch],
  )

  const setConnectionState = useCallback(
    (peerId: string, connectionState: Participant['connectionState']) =>
      patch(peerId, { connectionState }),
    [patch],
  )

  const remove = useCallback((peerId: string) => {
    setById((prev) => {
      if (!prev.has(peerId)) return prev
      const next = new Map(prev)
      next.delete(peerId)
      return next
    })
  }, [])

  /** Remove everyone except the local user (e.g. on reconnect). */
  const clearRemote = useCallback(() => {
    setById((prev) => {
      const next = new Map<string, Participant>()
      for (const [id, p] of prev) if (p.isLocal) next.set(id, p)
      return next
    })
  }, [])

  const reset = useCallback(() => setById(new Map()), [])

  return {
    participants,
    upsertFromPresence,
    patch,
    setStream,
    setConnectionState,
    remove,
    clearRemote,
    reset,
  }
}

export type UseParticipantsReturn = ReturnType<typeof useParticipants>
