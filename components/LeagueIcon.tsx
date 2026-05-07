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
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const cleanSrc =
    typeof src === "string" && src.trim().length > 0 ? src.trim() : null;
  const failed = cleanSrc !== null && failedSrc === cleanSrc;

  const fallbackText =
    typeof fallback === "string"
      ? fallback.trim().slice(0, 4).toUpperCase()
      : fallback;

  const imageClassName = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white p-[2px]",
    className
  );

  const fallbackClassName = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/[0.03]",
    className
  );

  if (!cleanSrc || failed) {
    return (
      <span
        className={fallbackClassName}
        style={{ width: size, height: size }}
        aria-label={alt}
        title={alt}
      >
        <span
          className="max-w-full truncate px-[1px] text-center text-[8px] font-bold leading-none text-neutral-500"
          style={{ fontSize: Math.max(7, Math.min(9, size / 3)) }}
        >
          {fallbackText ?? alt.slice(0, 1).toUpperCase()}
        </span>
      </span>
    );
  }

  return (
    <span
      className={imageClassName}
      style={{ width: size, height: size }}
      title={alt}
    >
      <img
        src={cleanSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(cleanSrc)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
