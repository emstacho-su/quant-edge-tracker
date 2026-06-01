// src/components/ui/animated-logo.tsx

import React from 'react';
import { motion } from 'framer-motion';
import { Hexagon, Activity } from 'lucide-react';
import { cn } from "@/lib/utils";

interface AnimatedLogoProps {
  collapsed?: boolean;
  className?: string;
}

export const AnimatedLogo: React.FC<AnimatedLogoProps> = ({ collapsed, className }) => {
  return (
    <motion.div 
      className={cn("flex items-center gap-3 overflow-hidden whitespace-nowrap", className)}
      initial="initial"
      animate="animate"
      whileHover="hover"
    >
      <motion.div 
        className="relative flex shrink-0 size-9 items-center justify-center rounded-xl bg-gradient-to-br from-chart-1/20 to-chart-2/20 shadow-inner border border-chart-1/30"
        variants={{
          initial: { rotate: -90, scale: 0.8, opacity: 0 },
          animate: { rotate: 0, scale: 1, opacity: 1, transition: { duration: 0.6, type: "spring", bounce: 0.5 } },
          hover: { scale: 1.1, rotate: 180, transition: { duration: 0.4 } }
        }}
      >
        <Hexagon className="absolute size-8 text-chart-1/40 stroke-[1.5]" />
        <Activity className="size-5 text-chart-1 z-10" />
      </motion.div>
      
      <motion.div
        className="flex flex-col"
        variants={{
          animate: { width: collapsed ? 0 : 'auto', opacity: collapsed ? 0 : 1 },
        }}
        transition={{ duration: 0.2 }}
      >
        <span className="text-base font-extrabold tracking-tighter bg-gradient-to-r from-chart-1 to-chart-2 bg-clip-text text-transparent leading-none">
          QUANT
        </span>
        <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase leading-none mt-1">
          Edge Tracker
        </span>
      </motion.div>
    </motion.div>
  );
};
