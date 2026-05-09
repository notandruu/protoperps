"use client"

import { cn } from "@/lib/utils"
import { Minus } from "lucide-react"

interface ChangeBadgeProps {
  value: number   // the pct or absolute change
  direction: "up" | "down" | "flat"
  suffix?: string
}

export function ChangeBadge({ value, direction, suffix = "%" }: ChangeBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-light tabular-nums",
        direction === "up" && "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 dark:bg-emerald-950/40",
        direction === "down" && "bg-red-500/15 text-red-500 border border-red-500/30 dark:bg-red-950/40",
        direction === "flat" && "bg-muted text-muted-foreground border border-border",
      )}
    >
      {direction === "up" && (
        <svg className="h-3 w-3 fill-current" viewBox="0 0 12 12">
          <path d="M6 2L10 10H2L6 2Z" />
        </svg>
      )}
      {direction === "down" && (
        <svg className="h-3 w-3 fill-current" viewBox="0 0 12 12">
          <path d="M6 10L2 2H10L6 10Z" />
        </svg>
      )}
      {direction === "flat" && <Minus className="h-3 w-3" />}
      <span>
        {value >= 0 ? "+" : ""}
        {value.toFixed(4)}{suffix}
      </span>
    </div>
  )
}
