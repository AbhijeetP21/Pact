'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ShareLinkCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied to clipboard')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy automatically. Select and copy the link.')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        readOnly
        value={url}
        aria-label="Shareable room link"
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={copy}
        aria-label="Copy link"
        className="size-10 shrink-0"
      >
        {copied ? (
          <Check className="size-4 text-primary" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </div>
  )
}
