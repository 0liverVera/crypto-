// Token metadata resolution for CandleTG serverless routes.
// Primary: Helius DAS API (HELIUS_API_KEY) + IPFS metadata JSON for socials.
// Fallback: Jupiter token list. Underscore prefix keeps this off Vercel's router.

export interface TokenMeta {
  name: string;
  ticker: string;
  logo: string | null;
  ca: string;
  website: string | null;
  twitter: string | null;
}

type MetadataJson = {
  name?: string;
  symbol?: string;
  image?: string;
  website?: string;
  twitter?: string;
  external_url?: string;
};

type HeliusResponse = {
  result?: {
    content?: {
      json_uri?: string;
      metadata?: { name?: string; symbol?: string; external_url?: string };
      links?: { image?: string; external_url?: string };
      files?: { cdn_uri?: string }[];
    };
  };
};

type JupToken = { address: string; name: string; symbol: string; logoURI?: string };

// Normalise a Twitter/X URL or handle into a clean https://x.com/handle URL.
function normaliseTwitter(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i.test(t)) {
    return t.replace(/^https?:\/\/(www\.)?twitter\.com/i, "https://x.com");
  }
  const handle = t.replace(/^@/, "");
  if (/^[a-zA-Z0-9_]{1,50}$/.test(handle)) return `https://x.com/${handle}`;
  return null;
}

// Normalise a website URL — ensures https:// prefix, rejects non-http schemes
// (javascript:, data:, file:) that could be injected via malicious metadata.
function normaliseWebsite(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^(javascript|data|file|vbscript):/i.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-zA-Z0-9]/.test(t)) {
    const candidate = `https://${t}`;
    if (URL.canParse(candidate)) return candidate;
  }
  return null;
}

// IPFS gateways tried in order — first success wins.
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
] as const;

// Fetch the metadata JSON URI for social links (Pump.fun stores them in IPFS,
// not in the DAS response directly). Caps response at 256 KB.
async function fetchMetaJson(uri: string): Promise<MetadataJson | null> {
  const cid  = uri.startsWith("ipfs://") ? uri.slice(7) : null;
  const urls = cid ? IPFS_GATEWAYS.map((gw) => `${gw}${cid}`) : [uri];
  const MAX_BYTES = 256 * 1024;

  for (const resolvedUrl of urls) {
    try {
      const res = await fetch(resolvedUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) continue;
      const text = new TextDecoder().decode(buf);
      return JSON.parse(text) as MetadataJson;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetches token name, ticker, logo, website, and twitter/X.
 * Returns null if the token cannot be found via either source.
 */
export async function fetchTokenMeta(ca: string): Promise<TokenMeta | null> {
  // 1. Helius DAS API
  if (process.env.HELIUS_API_KEY) {
    try {
      const res = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "candletg", method: "getAsset", params: { id: ca } }),
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = (await res.json()) as HeliusResponse;
      const asset = data?.result;
      if (asset?.content?.metadata?.name) {
        let website: string | null = null;
        let twitter: string | null = null;

        const jsonUri = asset.content.json_uri;
        if (jsonUri) {
          const meta = await fetchMetaJson(jsonUri);
          if (meta) {
            website = normaliseWebsite(meta.website ?? meta.external_url);
            twitter = normaliseTwitter(meta.twitter);
          }
        }

        if (!website) {
          website = normaliseWebsite(
            asset.content.links?.external_url ?? asset.content.metadata?.external_url
          );
        }

        return {
          name: asset.content.metadata.name,
          ticker: asset.content.metadata.symbol ?? "???",
          logo: asset.content.links?.image ?? asset.content.files?.[0]?.cdn_uri ?? null,
          ca,
          website,
          twitter,
        };
      }
    } catch (e) {
      console.error("[candle-tg] Helius fetch error:", e);
    }
  }

  // 2. Jupiter token list fallback
  try {
    const jupRes = await fetch("https://token.jup.ag/all", {
      signal: AbortSignal.timeout(8000),
    });
    const jupTokens = (await jupRes.json()) as JupToken[];
    const token = jupTokens.find((t) => t.address === ca);
    if (token) {
      return { name: token.name, ticker: token.symbol, logo: token.logoURI ?? null, ca, website: null, twitter: null };
    }
  } catch (e) {
    console.error("[candle-tg] Jupiter fetch error:", e);
  }

  return null;
}
