'use client';

import React, { useRef, useEffect, useCallback, forwardRef } from 'react';
import { cn } from '@/lib/utils';
import { useScrollShadows } from '@/hooks/use-scroll-shadows';

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

/**
 * Inner component that holds the ref so useScrollShadows can observe it.
 * Separated from the forwardRef wrapper to keep hook rules clean.
 */
const ScrollContainerInner = forwardRef<HTMLDivElement, ScrollContainerProps & { resolvedRef: React.RefObject<HTMLDivElement | null> }>(
  ({ maxHeight, shadows = true, scrollKey, className, children, style, resolvedRef, ...props }, _ref) => {
    const { hasTopShadow, hasBottomShadow } = useScrollShadows(resolvedRef);

    // Restore scroll position
    useEffect(() => {
      if (!scrollKey) return;
      const el = resolvedRef.current;
      if (!el) return;
      const saved = scrollMemory.get(scrollKey);
      if (saved !== undefined) el.scrollTop = saved;
    }, [scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleScroll = useCallback(() => {
      if (!scrollKey) return;
      const el = resolvedRef.current;
      if (el) scrollMemory.set(scrollKey, el.scrollTop);
    }, [scrollKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const resolvedMaxHeight = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

    return (
      <div
        ref={resolvedRef}
        onScroll={handleScroll}
        className={cn('arm-scroll', shadows && 'arm-scroll-shadow', className)}
        style={{ maxHeight: resolvedMaxHeight, ...style }}
        data-shadow-top={shadows && hasTopShadow ? 'true' : 'false'}
        data-shadow-bottom={shadows && hasBottomShadow ? 'true' : 'false'}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ScrollContainerInner.displayName = 'ScrollContainerInner';

export const ScrollContainer = forwardRef<HTMLDivElement, ScrollContainerProps>(
  (props, ref) => {
    const innerRef = useRef<HTMLDivElement>(null);
    const resolvedRef = (ref as React.RefObject<HTMLDivElement>) ?? innerRef;
    return <ScrollContainerInner {...props} resolvedRef={resolvedRef} />;
  }
);

ScrollContainer.displayName = 'ScrollContainer';
