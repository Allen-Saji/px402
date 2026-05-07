import { SITE } from "./site";

// Fetched at build / request time. Cached for 1h.
export async function getStarCount(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${SITE.githubRepo}`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { stargazers_count?: number };
    if (typeof data.stargazers_count === "number") {
      return data.stargazers_count;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatStars(count: number | null): string {
  if (count === null) return "Star";
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(count);
}
