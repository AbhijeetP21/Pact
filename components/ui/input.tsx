import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // text-base on small screens: iOS Safari force-zooms the whole page
        // when a focused input's font is under 16px, which "enlarges" the UI
        // and leaves it stuck zoomed. 16px suppresses that behavior.
        'flex h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base sm:text-sm shadow-sm transition-[color,box-shadow] outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
