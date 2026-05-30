"use client"

import { useState, useEffect, useRef, memo } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface SplitFlapTextProps {
  value: string
  charset?: string
  direction?: "up" | "down" | "flat"
  flipSpeedMs?: number
  baseFlips?: number
  staggerDelay?: number
}

const SplitFlapTile = memo(function SplitFlapTile({
  targetChar,
  charset,
  direction,
  index,
  flipSpeedMs,
  baseFlips,
  staggerDelay,
}: {
  targetChar: string
  charset: string
  direction: "up" | "down" | "flat"
  index: number
  flipSpeedMs: number
  baseFlips: number
  staggerDelay: number
}) {
  const [displayChar, setDisplayChar] = useState(targetChar)
  const [isFlipping, setIsFlipping] = useState(false)
  const prevCharRef = useRef(targetChar)

  useEffect(() => {
    if (prevCharRef.current !== targetChar) {
      setIsFlipping(true)
      const totalFlips = baseFlips + index * 2
      let flipCount = 0

      const flipInterval = setInterval(() => {
        if (flipCount < totalFlips) {
          const randomChar = charset[Math.floor(Math.random() * charset.length)]
          setDisplayChar(randomChar)
          flipCount++
        } else {
          setDisplayChar(targetChar)
          setIsFlipping(false)
          clearInterval(flipInterval)
        }
      }, flipSpeedMs)

      prevCharRef.current = targetChar
      return () => clearInterval(flipInterval)
    }
  }, [targetChar, charset, index, flipSpeedMs, baseFlips])

  const directionColorClass =
    direction === "up" ? "text-emerald-500" : direction === "down" ? "text-red-500" : "text-foreground"

  return (
    <motion.div
      className="relative inline-flex items-center justify-center"
      style={{
        width: "1.05em",
        height: "1.6em",
      }}
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * staggerDelay }}
    >
      <div
        className={cn(
          "relative w-full h-full flex items-center justify-center rounded",
          "bg-neutral-900 border border-foreground/15",
          "font-mono text-base font-medium tabular-nums",
          directionColorClass,
          isFlipping && "animate-pulse",
        )}
      >
        {displayChar}
        {/* Center divider for split-flap aesthetic */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-foreground/20 pointer-events-none" />
      </div>
    </motion.div>
  )
})

export const SplitFlapText = memo(function SplitFlapText({
  value,
  charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  direction = "flat",
  flipSpeedMs = 45,
  baseFlips = 6,
  staggerDelay = 0.06,
}: SplitFlapTextProps) {
  const chars = value.split("")

  return (
    <div className="inline-flex items-center gap-[0.08em]">
      {chars.map((char, index) => (
        <SplitFlapTile
          key={`${index}-${char}`}
          targetChar={char}
          charset={charset}
          direction={direction}
          index={index}
          flipSpeedMs={flipSpeedMs}
          baseFlips={baseFlips}
          staggerDelay={staggerDelay}
        />
      ))}
    </div>
  )
})
