'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Avatar({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Renders the avatar image, falling back to nothing (revealing the sibling
 * AvatarFallback beneath it) when there is no src or the image fails to load.
 */
function AvatarImage({
  className,
  onError,
  src,
  ...props
}: React.ComponentProps<'img'>) {
  const [failed, setFailed] = React.useState(false)

  if (!src || failed) return null

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-slot="avatar-image"
      src={src}
      alt={props.alt ?? ''}
      className={cn('absolute inset-0 size-full object-cover', className)}
      onError={(e) => {
        setFailed(true)
        onError?.(e)
      }}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
