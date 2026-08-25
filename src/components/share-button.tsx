"use client";

import { useState } from "react";

export function ShareButton({ className, href }: { className?: string; href?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const shareUrl = href ? new URL(href, window.location.origin).toString() : window.location.href;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button className={className ?? "secondary"} type="button" onClick={copy}>
      {copied ? "已复制" : "复制只读链接"}
    </button>
  );
}
