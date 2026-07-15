import { cn } from "@/lib/cn";

export function Wordmark({
  size = "base",
  accentDigits = false,
  className,
}: {
  size?: "sm" | "base" | "lg";
  accentDigits?: boolean;
  className?: string;
}) {
  const sizeClass = size === "sm" ? "text-[15px]" : size === "lg" ? "text-2xl" : "text-[17px]";
  return (
    <span
      className={cn("font-mono tracking-[-0.04em] lowercase select-none", sizeClass, className)}
    >
      <span className="text-ink">px</span>
      <span className={accentDigits ? "text-private" : "text-ink"}>402</span>
    </span>
  );
}
