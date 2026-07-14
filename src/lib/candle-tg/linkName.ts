// Ticker-substring anti-squat validation for the verify channel's public username.
//
// Why this exists: the verify channel can claim a public `t.me/<name>` username
// via the builder Telegram account. Without scoping, that lets crafted POSTs
// squat arbitrary names (e.g. `t.me/coinbase`) via the builder.
//
// Policy: the user's `linkName` must contain the resolved token's ticker as a
// substring (after sanitising both to lowercase ASCII alphanumerics). Shared by
// the UI (auto-suggest), /api/candle-tg/check-link, and /api/candle-tg/build so
// there is a single source of truth for the policy.

// Telegram public-username constraint: 5–32 chars, must start with a letter,
// allowed chars are letters/digits/underscores.
export const TG_USERNAME = /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

// Minimum sanitised ticker length for the substring check to be meaningful.
// A 1-letter ticker makes "must contain the ticker as a substring" trivially
// satisfied by any English word. Anchoring to ≥ 3 alphanumerics keeps the
// anti-squat property meaningful.
const MIN_TICKER_LENGTH = 3;

export type LinkNameResult =
  | { ok: true; linkName: string }
  // Sanitised form doesn't contain the resolved ticker (e.g. `coinbase_verify`
  // for a $PEPE token). Caller should 400 with `expected` and refund any
  // consumed rate-limit slot.
  | { ok: false; kind: "off-ticker"; expected: string }
  // Token's ticker can't form a valid Telegram username (purely non-ASCII,
  // leading digit after sanitisation, or sanitised+`_verify` exceeds 32 chars).
  | { ok: false; kind: "ticker-incompatible" }
  // User's linkName didn't pass the TG_USERNAME format regex on its own.
  | { ok: false; kind: "invalid-format" };

/**
 * Sanitise a ticker for use in suggestions and substring matching: lowercase
 * ASCII alphanumerics only. Strips spaces, dots, `$`, emojis, Cyrillic
 * homoglyphs, etc. Exported for the UI's auto-suggest logic.
 */
export function sanitiseTicker(ticker: string): string {
  return ticker.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Compute the suggested default verify-link name for a token. Returns null if
 * the ticker can't form a valid TG username — too short (< MIN_TICKER_LENGTH),
 * sanitises to empty, leading-digit, or sanitised + `_verify` exceeds the
 * 32-char limit (caller should hide the field).
 */
export function suggestedLinkName(ticker: string): string | null {
  const sanitised = sanitiseTicker(ticker);
  const candidate = `${sanitised}_verify`;
  if (sanitised.length < MIN_TICKER_LENGTH) return null;
  if (!TG_USERNAME.test(candidate)) return null;
  return candidate;
}

/**
 * Validate a user-supplied verify-link name against the resolved token's ticker.
 *
 * Policy: the sanitised user input must CONTAIN the sanitised ticker as a
 * substring. So for $PEPE, `pepe_verify`, `pepe_official`, `pepecoin_community`,
 * `app_pepe_verify` are accepted; `coinbase_verify`, `anthropic_official` are not.
 *
 * Pre-condition: `linkNameRaw` is non-empty. Empty input should be handled by
 * the caller as "no branded link requested — fall back to hash invite".
 */
export function validateLinkName(
  linkNameRaw: string,
  ticker: string,
): LinkNameResult {
  // Format check first: must be a syntactically valid TG username on its own.
  if (!TG_USERNAME.test(linkNameRaw)) {
    return { ok: false, kind: "invalid-format" };
  }

  const canonicalName   = linkNameRaw.toLowerCase().replace(/^@/, "");
  const tickerSanitised = sanitiseTicker(ticker);
  // Suggested default (used in the error response so the UI can pre-fill).
  const expected        = suggestedLinkName(ticker) ?? `${tickerSanitised}_verify`;

  // Ticker must yield ≥ MIN_TICKER_LENGTH alphanumeric chars after sanitising.
  if (tickerSanitised.length < MIN_TICKER_LENGTH) {
    return { ok: false, kind: "ticker-incompatible" };
  }

  // Strip non-ASCII alphanumerics from user input the same way we strip the
  // ticker — defeats Cyrillic-homoglyph and emoji-injection attempts.
  const userCore = canonicalName.replace(/[^a-z0-9]/g, "");

  if (!userCore.includes(tickerSanitised)) {
    return { ok: false, kind: "off-ticker", expected };
  }

  return { ok: true, linkName: canonicalName };
}
