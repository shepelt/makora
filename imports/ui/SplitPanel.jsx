import React, { useState, useRef, useCallback } from 'react';

const STORAGE_KEY = 'makora:splitPanelWidth';

export function SplitPanel({ left, right, defaultWidth = 250, minWidth = 150, maxWidth = 500 }) {
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

  return (
    <div ref={containerRef} className="flex h-full">
      {/* Left panel */}
      <div style={{ width }} className="flex-shrink-0 overflow-hidden">
        {left}
      </div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 transition-colors"
      />

      {/* Right panel */}
      <div className="flex-1 overflow-hidden">
        {right}
      </div>
    </div>
  );
}
