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
  const sizeClass =
    size === "sm" ? "text-[15px]" : size === "lg" ? "text-2xl" : "text-[17px]";
  return (
    <span
      className={cn(
        "font-mono font-bold tracking-[-0.02em] lowercase select-none",
        sizeClass,
        className,
      )}
    >
      <span className="text-fg">px</span>
      <span className={accentDigits ? "text-accent" : "text-fg"}>402</span>
    </span>
  );
}
