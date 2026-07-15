"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
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
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await copyText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    timerRef.current = setTimeout(() => setStatus("idle"), 1600);
  }, [text]);

  const copied = status === "copied";
  const failed = status === "error";

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? `${label} copied` : failed ? `Could not copy ${label}` : `Copy ${label}`}
      className={cn(
        "group inline-flex min-h-11 items-center gap-2 px-3 font-mono text-[10px] uppercase tracking-[0.05em]",
        "text-quiet transition-colors hover:bg-private-soft hover:text-private",
        className,
      )}
    >
      {copied ? (
        <>
          <Check size={14} strokeWidth={2} className="text-private" />
          <span className="text-private" aria-live="polite">
            copied
          </span>
        </>
      ) : failed ? (
        <>
          <AlertCircle size={14} strokeWidth={1.8} className="text-risk" />
          <span className="text-risk" aria-live="polite">
            copy failed
          </span>
        </>
      ) : (
        <>
          <Copy size={14} strokeWidth={1.75} />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the selection-based copy path.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Copy command was rejected");
  }
}
