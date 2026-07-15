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
      tokens.push({ text: line.slice(i), cls: "text-quiet italic" });
      return tokens;
    }

    // Block comment /* ... */ (single-line only - multi-line not used on the page)
    if (ch === "/" && line[i + 1] === "*") {
      let j = i + 2;
      while (j < n - 1 && !(line[j] === "*" && line[j + 1] === "/")) j += 1;
      const end = j < n - 1 ? j + 2 : n;
      tokens.push({ text: line.slice(i, end), cls: "text-quiet italic" });
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
      tokens.push({ text: line.slice(i, j + 1), cls: "text-private" });
      i = j + 1;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9_]/.test(line[j] ?? "")) j += 1;
      tokens.push({ text: line.slice(i, j), cls: "text-signal" });
      i = j;
      continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j] ?? "")) j += 1;
      const word = line.slice(i, j);
      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, cls: "text-risk" });
      } else if (TYPES.has(word)) {
        tokens.push({ text: word, cls: "text-private" });
      } else if (line[j] === "(") {
        tokens.push({ text: word, cls: "text-ink" });
      } else {
        tokens.push({ text: word, cls: "text-ink/90" });
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
      tokens.push({ text: ch, cls: "text-quiet" });
      i += 1;
      continue;
    }
    tokens.push({ text: line.slice(i, j), cls: "text-quiet" });
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
    <div className="group relative min-w-0 max-w-full">
      <div className="border border-ink bg-paper-bright">
        <div className="flex min-h-12 items-center justify-between border-b border-ink bg-paper-deep/40 pl-4">
          <div className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.05em] text-quiet">
            {filename}
          </div>
          <CopyButton text={copyText ?? code} label="copy" />
        </div>
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <pre className="m-0 w-max min-w-full px-4 py-5 font-mono text-[12px] leading-[1.75] sm:text-[13px]">
            <code>
              {lines.map((line, idx) => (
                <span key={idx} className="block">
                  {tokenize(line).map((t, j) => (
                    <span key={j} className={t.cls}>
                      {t.text}
                    </span>
                  ))}
                  {line.length === 0 ? "\u00a0" : null}
                </span>
              ))}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
