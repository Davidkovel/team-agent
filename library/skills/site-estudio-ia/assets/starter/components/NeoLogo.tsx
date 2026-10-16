"use client";

import { motion } from "framer-motion";

type Size = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<Size, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-5xl md:text-6xl",
  xl: "text-7xl md:text-8xl",
};

const circleMap: Record<Size, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-32 h-32 md:w-40 md:h-40",
  xl: "w-44 h-44 md:w-56 md:h-56",
};

interface NeoLogoProps {
  size?: Size;
  withCircle?: boolean;
  animated?: boolean;
  className?: string;
}

export default function NeoLogo({
  size = "md",
  withCircle = false,
  animated = true,
  className = "",
}: NeoLogoProps) {
  const text = (
    <motion.span
      className={`font-mono font-semibold text-accent ${sizeMap[size]}`}
      style={{ textShadow: "0 0 18px rgba(0,255,136,0.55)" }}
      animate={
        animated
          ? {
              textShadow: [
                "0 0 12px rgba(0,255,136,0.35)",
                "0 0 24px rgba(0,255,136,0.65)",
                "0 0 12px rgba(0,255,136,0.35)",
              ],
            }
          : undefined
      }
      transition={
        animated
          ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      {"</ND>"}
    </motion.span>
  );

  if (!withCircle) {
    return <span className={className}>{text}</span>;
  }

  return (
    <motion.div
      className={`relative flex items-center justify-center rounded-full bg-[#060913] border border-subtle ${circleMap[size]} ${className}`}
      animate={
        animated
          ? {
              boxShadow: [
                "0 0 16px rgba(0,255,136,0.2)",
                "0 0 40px rgba(0,255,136,0.45)",
                "0 0 16px rgba(0,255,136,0.2)",
              ],
            }
          : undefined
      }
      transition={
        animated
          ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      {text}
    </motion.div>
  );
}
