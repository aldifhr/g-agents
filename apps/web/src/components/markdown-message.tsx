"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

/**
 * Renders an agent's reply as Markdown.
 *
 * Fenced code blocks get a copy button; everything else is styled by the
 * `.bubble-prose` rules in globals.css. Raw HTML is never rendered.
 */
export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="bubble-prose break-words text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  function copy(event: React.MouseEvent<HTMLButtonElement>) {
    const pre = event.currentTarget.closest("pre");
    const code = pre?.querySelector("code")?.textContent ?? "";
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group relative my-2">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-medium text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
