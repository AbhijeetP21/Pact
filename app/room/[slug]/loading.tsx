import { Loader2 } from 'lucide-react'

export default function RoomLoading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Opening room…</p>
    </main>
  )
}
