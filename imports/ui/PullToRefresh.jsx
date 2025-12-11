import React, { useState, useRef, useCallback, useEffect } from 'react';

const THRESHOLD = 80; // Pull distance to trigger refresh
const MAX_PULL = 120; // Maximum pull distance

export function PullToRefresh({ onRefresh, disabled, children }) {
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef(0);
  const scrollableRef = useRef(null);
  const containerRef = useRef(null);
  const pullDistanceRef = useRef(0); // Track pull distance for event handlers

  // Keep ref in sync with state
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  const handleTouchStart = useCallback((e) => {
    if (disabled) return;

    // Only track if at top of scroll
    const scrollable = scrollableRef.current;
    if (scrollable && scrollable.scrollTop > 0) return;

    touchStartY.current = e.touches[0].clientY;
  }, [disabled]);

  const handleTouchMove = useCallback((e) => {
    if (disabled || touchStartY.current === 0) return;

    // Only allow pull if at top of scroll
    const scrollable = scrollableRef.current;
    if (scrollable && scrollable.scrollTop > 0) {
      touchStartY.current = 0;
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;

    if (diff > 0) {
      // Apply resistance - pull gets harder as you go
      const distance = Math.min(diff * 0.5, MAX_PULL);
      setPullDistance(distance);

      // Prevent default scroll when pulling
      if (distance > 10) {
        e.preventDefault();
      }
    }
  }, [disabled]);

  const handleTouchEnd = useCallback(() => {
    if (disabled) return;

    const currentPullDistance = pullDistanceRef.current;
    if (currentPullDistance >= THRESHOLD && onRefresh) {
      onRefresh();
    }
    setPullDistance(0);
    touchStartY.current = 0;
  }, [onRefresh, disabled]);

  // Attach touch events with { passive: false } to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const showIndicator = pullDistance > 10;

  return (
    <div
      ref={containerRef}
      className="h-full relative overflow-hidden"
    >
      {/* Pull indicator */}
      {showIndicator && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center justify-center transition-transform"
          style={{
            top: Math.max(pullDistance - 40, 8),
            opacity: Math.min(progress * 2, 1)
          }}
        >
          <div
            className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-blue-500"
            style={{
              transform: `rotate(${progress * 360}deg)`,
            }}
          />
        </div>
      )}

      {/* Content with pull transform */}
      <div
        ref={scrollableRef}
        className="h-full overflow-auto"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : 'none',
          transition: pullDistance === 0 ? 'transform 0.2s ease-out' : 'none'
        }}
      >
        {children}
      </div>
    </div>
  );
}
