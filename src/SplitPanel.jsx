import React, { useState, useRef, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'makora:splitPanelWidth';
const MOBILE_BREAKPOINT = 768; // px

// Hook to detect mobile screen size
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

export function SplitPanel({ left, right, defaultWidth = 250, minWidth = 150, maxWidth = 500, showRightPane = false }) {
  const isMobile = useIsMobile();

  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
        return parsed;
      }
    }
    return defaultWidth;
  });
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const widthRef = useRef(width);

  const handleMouseDown = useCallback((e) => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.min(maxWidth, Math.max(minWidth, e.clientX - rect.left));
      widthRef.current = newWidth;
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Save width to localStorage on mouse up
      localStorage.setItem(STORAGE_KEY, widthRef.current.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [minWidth, maxWidth]);

  const handleTouchStart = useCallback((e) => {
    isDragging.current = true;
    document.body.style.userSelect = 'none';

    const handleTouchMove = (e) => {
      if (!isDragging.current || !containerRef.current) return;
      const touch = e.touches[0];
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.min(maxWidth, Math.max(minWidth, touch.clientX - rect.left));
      widthRef.current = newWidth;
      setWidth(newWidth);
    };

    const handleTouchEnd = () => {
      isDragging.current = false;
      document.body.style.userSelect = '';
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      localStorage.setItem(STORAGE_KEY, widthRef.current.toString());
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
  }, [minWidth, maxWidth]);

  // Mobile: render both panes but show only one (keeps both mounted for state preservation)
  if (isMobile) {
    return (
      <div ref={containerRef} className="h-full relative">
        <div className={`h-full overflow-hidden ${showRightPane ? 'hidden' : ''}`}>{left}</div>
        <div className={`absolute inset-0 h-full overflow-hidden ${showRightPane ? '' : 'hidden'}`}>{right}</div>
      </div>
    );
  }

  // Desktop: show both panes with resizable divider
  return (
    <div ref={containerRef} className="flex h-full">
      {/* Left panel */}
      <div style={{ width }} className="flex-shrink-0 overflow-hidden">
        {left}
      </div>

      {/* Divider - wider touch target for mobile */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="w-2 bg-gray-200 hover:bg-blue-400 active:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors touch-none"
      />

      {/* Right panel */}
      <div className="flex-1 overflow-hidden">
        {right}
      </div>
    </div>
  );
}
