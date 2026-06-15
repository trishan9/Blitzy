import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, request as undiciRequest } from "undici";
import { DEMO } from "./demo-flags";

export class SsrfBlocked extends Error {
  readonly httpStatus = 400;
  constructor(readonly reason: string, readonly detail?: string) {
    super("the supplied URL is not permitted");
    this.name = "SsrfBlocked";
  }
}

export function allowedHosts(): Set<string> {
  return new Set(
    (process.env.SSRF_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

const METADATA_ADDRESSES = new Set(["169.254.169.254", "fd00:ec2::254", "100.100.100.200"]);

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }>;

const defaultResolver: Resolver = async (hostname) => {
  const r = await dnsLookup(hostname);
  return { address: r.address, family: r.family };
};

export function classifyAddress(address: string): string | null {
  if (METADATA_ADDRESSES.has(address.toLowerCase())) return "cloud-metadata";

  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return "unparseable-address";
  }

  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      const v4 = v6.toIPv4Address();
      if (METADATA_ADDRESSES.has(v4.toString())) return "cloud-metadata";
      return v4.range() === "unicast" ? null : `blocked-range:${v4.range()}`;
    }
  }

  const range = addr.range();
  return range === "unicast" ? null : `blocked-range:${range}`;
}

export async function validateUrl(
  raw: string,
  resolver: Resolver = defaultResolver
): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlocked("malformed-url");
  }

  if (url.username !== "" || url.password !== "") throw new SsrfBlocked("userinfo-present");

  if (url.protocol !== "https:") throw new SsrfBlocked("scheme", url.protocol);

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowedHosts().has(host)) throw new SsrfBlocked("host-not-allowlisted", host);

  const { address, family } = await resolver(url.hostname);
  const denied = classifyAddress(address);
  if (denied) throw new SsrfBlocked(denied, address);

  return { url, address, family };
}

function pinnedDispatcher(address: string, family: number): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address, family === 6 ? 6 : 4);
      },
    },
    headersTimeout: 5_000,
    bodyTimeout: 10_000,
  });
}

const MAX_BYTES = 5 * 1024 * 1024;

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  finalUrl: string;
}

export async function safeFetch(
  raw: string,
  hops = 3,
  resolver: Resolver = defaultResolver
): Promise<SafeFetchResult> {
  if (DEMO.DISABLE_SSRF_GUARD) {
    const res = await undiciRequest(raw);
    return {
      status: res.statusCode,
      headers: res.headers as SafeFetchResult["headers"],
      body: Buffer.from(await res.body.arrayBuffer()),
      finalUrl: raw,
    };
  }

  const { url, address, family } = await validateUrl(raw, resolver);
  const dispatcher = pinnedDispatcher(address, family);

  try {
    const res = await undiciRequest(url, {
      dispatcher,
      headersTimeout: 5_000,
      bodyTimeout: 10_000,
      headers: { host: url.host },
    });

    if (isRedirect(res.statusCode)) {
      const location = res.headers.location;
      if (!location || typeof location !== "string") throw new SsrfBlocked("redirect-no-location");
      if (hops === 0) throw new SsrfBlocked("too-many-redirects");
      const next = new URL(location, url).toString();
      return safeFetch(next, hops - 1, resolver);
    }

    const body = await readCapped(res.body, MAX_BYTES);
    return {
      status: res.statusCode,
      headers: res.headers as SafeFetchResult["headers"],
      body,
      finalUrl: url.toString(),
    };
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readCapped(
  body: AsyncIterable<Buffer | Uint8Array>,
  max: number
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > max) throw new SsrfBlocked("response-too-large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
