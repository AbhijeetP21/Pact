import { cn } from '@/lib/utils'

const STATE_STYLES: Record<
  RTCPeerConnectionState,
  { color: string; label: string; pulse?: boolean }
> = {
  new: { color: 'bg-amber-500', label: 'Connecting', pulse: true },
  connecting: { color: 'bg-amber-500', label: 'Connecting', pulse: true },
  connected: { color: 'bg-green-500', label: 'Connected' },
  disconnected: { color: 'bg-amber-500', label: 'Reconnecting', pulse: true },
  failed: { color: 'bg-red-500', label: 'Connection failed' },
  closed: { color: 'bg-red-500', label: 'Disconnected' },
}

/** A small status dot reflecting a peer's ICE/connection state. */
export function ConnectionBadge({
  state,
  className,
}: {
  state: RTCPeerConnectionState
  className?: string
}) {
  const { color, label, pulse } = STATE_STYLES[state] ?? STATE_STYLES.new

  return (
    <span
      className={cn('relative inline-flex size-2.5', className)}
      role="status"
      aria-label={label}
      title={label}
    >
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-75',
            color,
          )}
        />
      )}
      <span className={cn('relative inline-flex size-2.5 rounded-full', color)} />
    </span>
  )
}
