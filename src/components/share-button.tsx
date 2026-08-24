"use client";

import { useState } from "react";

export function ShareButton({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button className={className ?? "secondary"} type="button" onClick={copy}>
      {copied ? "已复制" : "复制只读链接"}
    </button>
  );
}
