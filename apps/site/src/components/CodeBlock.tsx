import { CopyButton } from "./CopyButton";

// Lightweight token-based highlighter. Not full TS parsing; tuned for the two
// snippets shown on the landing page. Avoids shipping a heavy highlighter.

type Token = { text: string; cls: string };

const KEYWORDS = new Set([
  "import",
  "from",
  "const",
  "let",
  "var",
  "function",
  "async",
  "await",
  "new",
  "return",
  "export",
  "default",
  "if",
  "else",
  "as",
  "type",
  "interface",
]);

const TYPES = new Set(["Hono", "Px402Client"]);

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    const ch = line[i] ?? "";

    // Comment to end of line
    if (ch === "/" && line[i + 1] === "/") {
      tokens.push({ text: line.slice(i), cls: "text-muted italic" });
      return tokens;
    }

    // Block comment /* ... */ (single-line only — multi-line not used on the page)
    if (ch === "/" && line[i + 1] === "*") {
      let j = i + 2;
      while (j < n - 1 && !(line[j] === "*" && line[j + 1] === "/")) j += 1;
      const end = j < n - 1 ? j + 2 : n;
      tokens.push({ text: line.slice(i, end), cls: "text-muted italic" });
      i = end;
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < n && line[j] !== quote) {
        if (line[j] === "\\") j += 2;
        else j += 1;
      }
      tokens.push({ text: line.slice(i, j + 1), cls: "text-emerald-300/90" });
      i = j + 1;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9_]/.test(line[j] ?? "")) j += 1;
      tokens.push({ text: line.slice(i, j), cls: "text-amber-300/90" });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j] ?? "")) j += 1;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, cls: "text-violet-300/90" });
      } else if (TYPES.has(word)) {
        tokens.push({ text: word, cls: "text-cyan-300/90" });
      } else if (line[j] === "(") {
        tokens.push({ text: word, cls: "text-fg" });
      } else {
        tokens.push({ text: word, cls: "text-fg/90" });
      }
      i = j;
      continue;
    }

    // Punctuation / whitespace
    let j = i;
    while (j < n && !/[A-Za-z0-9_$"'`/]/.test(line[j] ?? "")) {
      // stop before next significant token
      if (line[j] === "/" && line[j + 1] === "/") break;
      j += 1;
    }
    if (j === i) {
      // Unmatched single character (e.g. stray "/" between tokens). Emit one
      // char and advance so we never spin forever.
      tokens.push({ text: ch, cls: "text-muted-strong" });
      i += 1;
      continue;
    }
    tokens.push({ text: line.slice(i, j), cls: "text-muted-strong" });
    i = j;
  }

  return tokens;
}

export function CodeBlock({
  filename,
  code,
  copyText,
}: {
  filename: string;
  code: string;
  copyText?: string;
}) {
  const lines = code.split("\n");

  return (
    <div className="group relative">
      <div className="absolute inset-y-0 left-0 w-[2px] bg-accent/80 rounded-full" />
      <div className="border border-border bg-surface rounded-md overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-2/40">
          <div className="font-mono text-[12px] text-muted">{filename}</div>
          <CopyButton text={copyText ?? code} label="copy" />
        </div>
        <div className="overflow-x-auto">
          <pre className="m-0 px-4 py-4 font-mono text-[13px] leading-[1.65] min-w-full">
            <code>
              {lines.map((line, idx) => (
                <span key={idx} className="block">
                  {tokenize(line).map((t, j) => (
                    <span key={j} className={t.cls}>
                      {t.text}
                    </span>
                  ))}
                  {line.length === 0 ? " " : null}
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
