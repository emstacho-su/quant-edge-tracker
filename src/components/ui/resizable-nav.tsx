// src/components/ui/resizable-nav.tsx

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from "@/lib/utils";

export interface ResizableLayoutProps {
  sidebar: (isCollapsed: boolean) => React.ReactNode;
  children: React.ReactNode;
  initialNavWidth?: number;
  minNavWidth?: number;
  maxNavWidth?: number;
  collapseThreshold?: number;
}

export const ResizableLayout: React.FC<ResizableLayoutProps> = ({
  sidebar,
  children,
  initialNavWidth = 240,
  minNavWidth = 72,
  maxNavWidth = 400,
  collapseThreshold = 140,
}) => {
  const [navWidth, setNavWidth] = useState<number>(initialNavWidth);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = event.clientX - containerRect.left;
    const clamped = Math.max(minNavWidth, Math.min(maxNavWidth, newWidth));
    setNavWidth(clamped);
  }, [isDragging, minNavWidth, maxNavWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const isCollapsed = navWidth < collapseThreshold;
  const effectiveNavWidth = isCollapsed ? minNavWidth : navWidth;

  return (
    <div ref={containerRef} className="flex h-screen w-full overflow-hidden bg-transparent">
      <aside
        className="relative flex-shrink-0 border-r border-border/20 bg-card/40 backdrop-blur-xl flex flex-col z-20 shadow-[4px_0_24px_rgba(0,0,0,0.2)]"
        style={{
          width: `${effectiveNavWidth}px`,
          transition: isDragging ? 'none' : 'width 0.3s cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {sidebar(isCollapsed)}
      </aside>
      
      {/* Resizer Handle */}
      <div
        className={cn(
          "relative z-30 w-[6px] -ml-[3px] cursor-ew-resize group flex items-center justify-center transition-all",
          isDragging ? "bg-chart-1/20" : "hover:bg-chart-1/10"
        )}
        onMouseDown={handleMouseDown}
      >
        <div className={cn(
          "h-8 w-1 rounded-full transition-colors backdrop-blur-sm",
          isDragging ? "bg-chart-1 shadow-[0_0_8px_var(--color-chart-1)]" : "bg-border/50 group-hover:bg-chart-1/50"
        )} />
      </div>
      
      <main className="flex-1 overflow-auto bg-transparent relative z-10 flex flex-col">
        {children}
      </main>
    </div>
  );
};
