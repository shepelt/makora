import React, { useState, useRef, useCallback, useEffect } from 'react';

const THRESHOLD = 80; // Pull distance to trigger refresh
const MAX_PULL = 120; // Maximum pull distance

// Find the scrollable parent element
function findScrollableParent(element) {
  if (!element) return null;

  let current = element;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function PullToRefresh({ onRefresh, disabled, children }) {
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef(0);
  const containerRef = useRef(null);
  const pullDistanceRef = useRef(0); // Track pull distance for event handlers

  // Keep ref in sync with state
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  // Check if document is scrolled to top
  const isAtDocumentTop = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    // Find the actual scrollable element (could be the container or a child)
    const scrollable = findScrollableParent(container.querySelector('.mu-editor')) || container;
    return scrollable.scrollTop <= 0;
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (disabled) return;

    // Only track if at top of scroll
    if (!isAtDocumentTop()) return;

    touchStartY.current = e.touches[0].clientY;
  }, [disabled, isAtDocumentTop]);

  const handleTouchMove = useCallback((e) => {
    if (disabled || touchStartY.current === 0) return;

    // Only allow pull if at top of scroll
    if (!isAtDocumentTop()) {
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
  }, [disabled, isAtDocumentTop]);

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
