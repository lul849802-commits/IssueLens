"use client";
import { useState } from "react";
export function ShareButton() { const [copied,setCopied]=useState(false); async function copy(){ await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(()=>setCopied(false),1600); } return <button className="secondary" type="button" onClick={copy}>{copied?"链接已复制":"分享当前链接"}</button>; }
