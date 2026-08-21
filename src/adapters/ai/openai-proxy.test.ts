import { describe, expect, it, vi } from "vitest";

import { configureOpenAIProxy } from "./openai-proxy";

describe("configureOpenAIProxy", () => {
  it("does nothing when no server-side proxy is configured", () => {
    const setter = vi.fn();
    expect(configureOpenAIProxy(undefined, setter)).toBe(false);
    expect(setter).not.toHaveBeenCalled();
  });

  it("installs an HTTP CONNECT proxy dispatcher", () => {
    const setter = vi.fn();
    expect(configureOpenAIProxy("http://127.0.0.1:7897", setter)).toBe(true);
    expect(setter).toHaveBeenCalledOnce();
  });

  it("rejects unsupported proxy protocols", () => {
    expect(() => configureOpenAIProxy("socks5://127.0.0.1:7897", vi.fn())).toThrow(
      "OPENAI_PROXY_PROTOCOL_UNSUPPORTED",
    );
  });
});
