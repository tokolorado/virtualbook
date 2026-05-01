// components/LeagueIcon.tsx
"use client";

import type { ReactNode } from "react";
import { useState } from "react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type LeagueIconProps = {
  src?: string | null;
  alt: string;
  size?: number;
  fallback?: ReactNode;
  className?: string;
};

export function LeagueIcon({
  src,
  alt,
  size = 18,
  fallback,
  className,
}: LeagueIconProps) {
  const [failed, setFailed] = useState(false);

  const cleanSrc =
    typeof src === "string" && src.trim().length > 0 ? src.trim() : null;

  const baseClassName = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/[0.03]",
    className
  );

  if (!cleanSrc || failed) {
    return (
      <span
        className={baseClassName}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span className="text-[9px] font-bold leading-none text-neutral-500">
          {fallback ?? alt.slice(0, 1).toUpperCase()}
        </span>
      </span>
    );
  }

  return (
    <span
      className={baseClassName}
      style={{ width: size, height: size }}
      title={alt}
    >
      <img
        src={cleanSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}