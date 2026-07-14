'use client';

import React, { useRef, useEffect, useCallback, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ScrollContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fixed max-height for the scroll region */
  maxHeight?: string | number;
  /** Show top/bottom scroll shadow indicators */
  shadows?: boolean;
  /** Preserve scroll position across re-renders (pass a stable key) */
  scrollKey?: string;
}

// Global scroll position memory — keyed by scrollKey
const scrollMemory = new Map<string, number>();

export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(
  ({ maxHeight, shadows = true, scrollKey, className, children, style, ...props }, ref) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const resolvedRef = (ref as React.RefObject<HTMLDivElement>) ?? innerRef;

    // Restore scroll position
    useEffect(() => {
      if (!scrollKey) return;
      const el = resolvedRef.current;
      if (!el) return;
      const saved = scrollMemory.get(scrollKey);
      if (saved !== undefined) {
        el.scrollTop = saved;
      }
    }, [scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Save scroll position on scroll
    const handleScroll = useCallback(() => {
      if (!scrollKey) return;
      const el = resolvedRef.current;
      if (el) scrollMemory.set(scrollKey, el.scrollTop);
    }, [scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const resolvedMaxHeight =
      typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

    return (
      <div
        ref={resolvedRef}
        onScroll={handleScroll}
        className={cn(
          'arm-scroll',
          shadows && 'arm-scroll-shadow',
          className
        )}
        style={{
          maxHeight: resolvedMaxHeight,
          ...style,
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ScrollContainer.displayName = 'ScrollContainer';
