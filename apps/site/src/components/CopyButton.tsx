"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export function CopyButton({
  text,
  label = "copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      const t = setTimeout(() => setCopied(false), 1400);
      return () => clearTimeout(t);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : `Copy ${label}`}
      className={cn(
        "group inline-flex items-center gap-1.5 px-2 py-1 rounded text-[12px] font-mono",
        "text-muted hover:text-fg hover:bg-surface-2",
        "transition-colors cursor-pointer",
        className,
      )}
    >
      {copied ? (
        <>
          <Check size={13} strokeWidth={2} className="text-accent" />
          <span className="text-accent">copied</span>
        </>
      ) : (
        <>
          <Copy size={13} strokeWidth={1.75} />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
