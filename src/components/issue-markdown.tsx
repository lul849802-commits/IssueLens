import type { ReactNode } from "react";

import styles from "./issue-markdown.module.css";

type Block =
  | { type: "code"; value: string; language: string }
  | { type: "heading"; value: string; level: number }
  | { type: "quote"; value: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "paragraph"; value: string };

export function IssueMarkdown({ value }: { value: string }) {
  if (!value.trim()) return <p className={styles.empty}>作者未提供正文。</p>;
  const blocks = parseBlocks(value);

  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function renderBlock(block: Block, key: number) {
  if (block.type === "code") return <pre key={key}><code data-language={block.language || undefined}>{block.value}</code></pre>;
  if (block.type === "quote") return <blockquote key={key}>{renderInline(block.value)}</blockquote>;
  if (block.type === "list") {
    const items = block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
    return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
  }
  if (block.type === "heading") {
    if (block.level === 1) return <h3 key={key}>{renderInline(block.value)}</h3>;
    if (block.level === 2) return <h4 key={key}>{renderInline(block.value)}</h4>;
    return <h5 key={key}>{renderInline(block.value)}</h5>;
  }
  return <p key={key}>{renderInline(block.value)}</p>;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) { code.push(lines[index] ?? ""); index += 1; }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", value: code.join("\n"), language: (fence[1] ?? "").trim() });
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", value: heading[2] ?? "", level: (heading[1] ?? "").length });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^\s*>\s?/, "")); index += 1;
      }
      blocks.push({ type: "quote", value: quote.join(" ") });
      continue;
    }

    const listMatch = line.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/);
        if (!item || Boolean(item[1]) !== ordered) break;
        items.push(item[2] ?? ""); index += 1;
      }
      blocks.push({ type: "list", items, ordered });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "")) {
      paragraph.push((lines[index] ?? "").trim()); index += 1;
    }
    blocks.push({ type: "paragraph", value: paragraph.join(" ") });
  }
  return blocks;
}

function isBlockStart(line: string) {
  return /^\s*(?:```|#{1,6}\s|>\s?|(?:\d+\.|[-*+])\s+)/.test(line);
}

function renderInline(value: string): ReactNode[] {
  const pattern = /(`[^`]+`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else if (match[2] && match[3] && safeLink(match[3])) nodes.push(<a href={match[3]} target="_blank" rel="noreferrer" key={match.index}>{match[2]}</a>);
    else if (match[4] || match[5]) nodes.push(<strong key={match.index}>{match[4] ?? match[5]}</strong>);
    else nodes.push(token);
    cursor = pattern.lastIndex;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
