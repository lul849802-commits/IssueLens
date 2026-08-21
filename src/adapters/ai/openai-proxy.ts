import { ProxyAgent, setGlobalDispatcher, type Dispatcher } from "undici";

type DispatcherSetter = (dispatcher: Dispatcher) => void;

export function configureOpenAIProxy(
  proxyUrl: string | undefined,
  setDispatcher: DispatcherSetter = setGlobalDispatcher,
): boolean {
  if (!proxyUrl) return false;
  const parsed = new URL(proxyUrl);
  if (!(["http:", "https:"] as const).includes(parsed.protocol as "http:" | "https:")) {
    throw new Error("OPENAI_PROXY_PROTOCOL_UNSUPPORTED");
  }
  setDispatcher(new ProxyAgent(parsed.href));
  return true;
}
