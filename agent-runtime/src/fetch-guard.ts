import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type ProviderFetchPolicy = {
  kind: "openai" | "deepseek" | "ollama" | "openai-compatible";
  baseUrl: string;
};

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;
export type FetchTransport = (request: Request, address: ResolvedAddress) => Promise<Response>;

const SAFE_CALLBACK_URL = "http://127.0.0.1:8001/api/v1/internal/agent/tools";
const OLLAMA_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

const nonPublicIpv4 = new BlockList();
const nonPublicIpv6 = new BlockList();
const localIpv4 = new BlockList();
const localIpv6 = new BlockList();

function block(
  list: BlockList,
  address: string,
  prefix: number,
  family: "ipv4" | "ipv6",
): void {
  list.addSubnet(address, prefix, family);
}

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  block(nonPublicIpv4, address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  block(localIpv4, address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  block(nonPublicIpv6, address, prefix, "ipv6");
}

for (const [address, prefix] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  block(localIpv6, address, prefix, "ipv6");
}

function bareHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicIpv4.check(address, "ipv4");
  if (family === 6) return !nonPublicIpv6.check(address, "ipv6");
  return false;
}

function isLocalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return localIpv4.check(address, "ipv4");
  if (family === 6) return localIpv6.check(address, "ipv6");
  return false;
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("provider_url_invalid");
  }
  if (url.username || url.password || url.hash) throw new Error("provider_url_invalid");
  return url;
}

function basePath(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return path || "/";
}

function isWithinBase(target: URL, base: URL): boolean {
  if (target.origin !== base.origin) return false;
  const path = basePath(base);
  if (path === "/") return target.pathname.startsWith("/");
  return target.pathname === path || target.pathname.startsWith(`${path}/`);
}

function assertProviderBase(policy: ProviderFetchPolicy): URL {
  const base = parseUrl(policy.baseUrl);
  if (base.search) throw new Error("provider_url_invalid");
  if (policy.kind === "ollama") {
    if (
      base.protocol !== "http:" ||
      !OLLAMA_HOSTS.has(base.hostname) ||
      base.port !== "11434" ||
      basePath(base) !== "/v1"
    ) {
      throw new Error("ollama_url_not_allowed");
    }
    return base;
  }
  if (base.protocol !== "https:") throw new Error("provider_https_required");
  return base;
}

const defaultResolveHost: ResolveHost = async (hostname) => {
  const literal = bareHostname(hostname);
  const family = isIP(literal);
  if (family) return [{ address: literal, family } as ResolvedAddress];
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family: resolvedFamily }) => ({
    address,
    family: resolvedFamily as 4 | 6,
  }));
};

async function resolveAndValidate(
  target: URL,
  policy: ProviderFetchPolicy,
  resolveHost: ResolveHost,
): Promise<ResolvedAddress> {
  const addresses = await resolveHost(bareHostname(target.hostname));
  if (!addresses.length) throw new Error("provider_host_unresolved");
  if (policy.kind === "ollama") {
    if (target.hostname === "localhost" && addresses.some(({ address }) => !isLocalAddress(address))) {
      throw new Error("ollama_host_not_local");
    }
    if (
      target.hostname === "host.docker.internal" &&
      addresses.some(({ address }) => !isLocalAddress(address))
    ) {
      throw new Error("ollama_host_not_local");
    }
  } else if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("provider_host_not_public");
  }
  const address = addresses[0];
  if (!address) throw new Error("provider_host_unresolved");
  return address;
}

function responseHeaders(headers: import("node:http").IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.append(name, value);
    }
  }
  return result;
}

export const pinnedFetchTransport: FetchTransport = async (request, address) => {
  const target = new URL(request.url);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
  return await new Promise<Response>((resolve, reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send(
      target,
      {
        method: request.method,
        headers,
        lookup: pinnedLookup,
        family: address.family,
        signal: request.signal,
        ...(target.protocol === "https:" && !isIP(bareHostname(target.hostname))
          ? { servername: target.hostname }
          : {}),
      },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          incoming.resume();
          reject(new Error("provider_redirect_blocked"));
          return;
        }
        const hasBody = request.method !== "HEAD" && ![204, 205, 304].includes(status);
        resolve(
          new Response(
            hasBody ? (Readable.toWeb(incoming) as unknown as BodyInit) : null,
            {
              status,
              ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
              headers: responseHeaders(incoming.headers),
            },
          ),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end(body);
  });
};

export function createProviderFetchGuard(options: {
  getPolicy: () => ProviderFetchPolicy | undefined;
  getCallbackUrl: () => string | undefined;
  resolveHost?: ResolveHost;
  transport?: FetchTransport;
}): typeof fetch {
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const transport = options.transport ?? pinnedFetchTransport;
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, { ...init, redirect: "manual" });
    const target = parseUrl(request.url);
    const callbackUrl = options.getCallbackUrl();
    if (callbackUrl && target.href === callbackUrl) {
      if (callbackUrl !== SAFE_CALLBACK_URL) throw new Error("tool_callback_url_not_allowed");
      const response = await transport(request, { address: "127.0.0.1", family: 4 });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error("provider_redirect_blocked");
      }
      return response;
    }

    const policy = options.getPolicy();
    if (!policy) throw new Error("provider_fetch_context_missing");
    const base = assertProviderBase(policy);
    if (!isWithinBase(target, base)) throw new Error("provider_target_outside_base");
    const address = await resolveAndValidate(target, policy, resolveHost);
    const response = await transport(request, address);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("provider_redirect_blocked");
    }
    return response;
  }) as typeof fetch;
}
