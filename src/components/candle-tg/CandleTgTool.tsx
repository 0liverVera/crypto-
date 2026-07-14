import React, { useState, useEffect } from "react";
import { Icon } from "./Icon";
import { useCopied } from "./useCopied";
import { sanitiseTicker } from "../../lib/candle-tg/linkName";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Activity { ca: string; chain: string; timestamp: number; }
interface TokenInfo { name: string; ticker: string; }

// ── Constants ─────────────────────────────────────────────────────────────────
const STEPS = [
  "token_metadata_fetched",
  "community_group_created",
  "safeguard_gate_configured",
  "verify_channel_created",
  "safeguard_portal_live",
  "safeguard_greetings_configured",
  "community_ready",
];

// Chain selector was removed; only Solana ships in v1. ETH/Base entries removed
// as dead code — re-add when multi-chain metadata fetching lands (Phase 3).
const CHAIN_COLOR: Record<string, string> = {
  Solana: "#9945ff",
};

const ACTIVITY_KEY = "candle-tg-activity";

const MONO = "var(--font-mono), ui-monospace, monospace";

function timeAgo(timestamp: number) {
  const mins = Math.floor((Date.now() - timestamp) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.1em", fontFamily: MONO }}>
      ── {text}
    </div>
  );
}

function TerminalHeader({ path, live }: { path: string; live: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      fontSize: 11, color: "var(--muted-2)", fontFamily: MONO,
    }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: "#fe3232", flexShrink: 0 }} />
      <span style={{ width: 10, height: 10, borderRadius: 999, background: "#9945ff", flexShrink: 0 }} />
      <span style={{ width: 10, height: 10, borderRadius: 999, background: "var(--accent)", flexShrink: 0 }} />
      <span style={{ marginLeft: 6 }}>{path}</span>
      <div style={{ flex: 1 }} />
      {live && (
        <span style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            width: 5, height: 5, borderRadius: 999, background: "var(--accent)", flexShrink: 0,
            boxShadow: "0 0 6px rgba(50,254,159,0.8)", animation: "cePulse 1.8s ease infinite",
          }} />
          live
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function ToolCardInner() {
  const [ca, setCa]               = useState("");
  const [username, setUsername]   = useState("");
  const chain = "Solana";
  const [running, setRunning]     = useState(false);
  const [done, setDone]           = useState(false);
  const [progress, setProgress]   = useState(0);
  const [link, setLink]           = useState("");
  const [groupLink, setGroupLink] = useState("");
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [error, setError]         = useState("");
  const [activity, setActivity]   = useState<Activity[]>(() => {
    try {
      const stored = typeof window !== "undefined" ? localStorage.getItem(ACTIVITY_KEY) : null;
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is Activity =>
          typeof e?.ca === "string" &&
          typeof e?.chain === "string" &&
          typeof e?.timestamp === "number"
      );
    } catch { return []; }
  });
  const [unconfigured, setUnconfigured] = useState(false);
  const [copied, copy]            = useCopied();
  const abortRef = React.useRef<AbortController | null>(null);
  const [customPin, setCustomPin]         = useState(false);
  const [customPinText, setCustomPinText] = useState("");
  const [customPinImageB64, setCustomPinImageB64] = useState<string | null>(null);
  const [customPinImageName, setCustomPinImageName] = useState<string>("");
  const [linkName, setLinkName]           = useState("");
  // Whether the user has manually edited linkName. Stops the auto-suggest
  // effect from clobbering their input if they backspace and retype.
  const [linkNameTouched, setLinkNameTouched] = useState(false);
  // Live availability status of `linkName`. Updated by the debounced check.
  type LinkStatus =
    | { state: "idle" }
    | { state: "checking" }
    | { state: "available" }
    | { state: "taken" }
    | { state: "reserved" }
    | { state: "invalid"; reason: string }
    | { state: "off-ticker"; expected: string }
    | { state: "ticker-incompatible" }
    | { state: "error"; reason: string };
  const [linkStatus, setLinkStatus] = useState<LinkStatus>({ state: "idle" });
  // Resolved token preview (from /api/token, fetched when CA is entered).
  // Used to auto-suggest the linkName default.
  const [resolvedTicker, setResolvedTicker] = useState<string | null>(null);
  // After build: what the server reported about the branded-link claim.
  // null = no linkName attempted; true = claimed; false = fell back to hash invite.
  const [linkNameClaimed, setLinkNameClaimed] = useState<boolean | null>(null);
  // Canonical server-validated name (lowercase). Used in the orange notice so
  // we display what was actually attempted, not what the user typed.
  const [claimedName, setClaimedName] = useState<string>("");

  // Abort any in-flight build fetch on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Check whether TG is configured on this deployment
  useEffect(() => {
    fetch("/api/candle-tg/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ _probe: true }) })
      .then(async (r) => { if (r.status === 503) setUnconfigured(true); })
      .catch(() => {});
  }, []);

  // Debounced token-metadata fetch when CA is entered. Drives:
  // (1) the auto-suggested linkName default (`<ticker>_verify`)
  // (2) the ticker badge shown below the linkName hint
  useEffect(() => {
    const trimmed = ca.trim();
    if (!trimmed) {
      // Reset on CA-clear. The react-hooks/set-state-in-effect rule fires here
      // because it would prefer derived state, but doing so would require
      // restructuring all the linkStatus / resolvedTicker state into a single
      // useReducer keyed on the input — a bigger refactor than the rule's
      // payoff. The functional updater is a no-op when already null, so the
      // perf concern (cascading renders) doesn't apply.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResolvedTicker(s => s === null ? s : null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/candle-tg/token?ca=${encodeURIComponent(trimmed)}`);
        if (!res.ok) { if (!cancelled) setResolvedTicker(null); return; }
        const data = (await res.json()) as { ticker?: string };
        if (cancelled) return;
        const ticker = (data.ticker ?? "").trim();
        setResolvedTicker(ticker || null);
        // Auto-suggest only if the user hasn't typed anything yet.
        if (!linkNameTouched && ticker) {
          const sanitised = sanitiseTicker(ticker);
          if (sanitised) setLinkName(`${sanitised}_verify`);
        }
      } catch {
        if (!cancelled) setResolvedTicker(null);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ca]);

  // Debounced availability check on linkName. Calls /api/check-link which
  // resolves the username on Telegram via MTProto + applies ticker-substring
  // validation (same helper as /api/build, single source of truth).
  useEffect(() => {
    const trimmed = linkName.trim();
    // Same rationale as the resolvedTicker effect above — react-hooks/
    // set-state-in-effect prefers derived state; the refactor cost outweighs
    // the rule's payoff here. Functional updater is a no-op when already idle.
    if (!trimmed || !ca.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkStatus(s => s.state === "idle" ? s : { state: "idle" });
      return;
    }
    setLinkStatus({ state: "checking" });
    let cancelled = false;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/candle-tg/check-link?name=${encodeURIComponent(trimmed)}&ca=${encodeURIComponent(ca.trim())}`,
          { signal: controller.signal },
        );
        const data = (await res.json()) as
          | { status: "available" }
          | { status: "taken" }
          | { status: "reserved" }
          | { status: "invalid"; reason: string }
          | { status: "off-ticker"; expected: string; ticker: string }
          | { status: "ticker-incompatible"; ticker: string }
          | { status: "error"; reason: string };
        if (cancelled) return;
        switch (data.status) {
          case "available":           setLinkStatus({ state: "available" }); break;
          case "taken":               setLinkStatus({ state: "taken" }); break;
          case "reserved":            setLinkStatus({ state: "reserved" }); break;
          case "invalid":             setLinkStatus({ state: "invalid", reason: data.reason }); break;
          case "off-ticker":          setLinkStatus({ state: "off-ticker", expected: data.expected }); break;
          case "ticker-incompatible": setLinkStatus({ state: "ticker-incompatible" }); break;
          case "error":               setLinkStatus({ state: "error", reason: data.reason }); break;
          default: {
            // Exhaustiveness check — if the server adds a new status, TS errors here.
            const _exhaustive: never = data;
            void _exhaustive;
            setLinkStatus({ state: "error", reason: "Unknown response from server." });
          }
        }
      } catch {
        if (!cancelled) setLinkStatus({ state: "error", reason: "Could not reach server." });
      }
    }, 650);
    return () => { cancelled = true; clearTimeout(t); controller.abort(); };
  }, [linkName, ca]);

  async function handleBuild(e: React.FormEvent) {
    e.preventDefault();
    if (!ca.trim() || !username.trim() || running) return;
    setDone(false); setProgress(0); setLink(""); setGroupLink(""); setTokenInfo(null); setError("");
    setLinkNameClaimed(null);
    setClaimedName("");
    setRunning(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let apiDone = false;
    // UI-11: step animation is decorative UX — does NOT reflect real API progress.
    // Real-time status polling would require a start+poll split endpoint (future work).
    const animateSteps = async () => {
      for (let i = 1; i <= STEPS.length; i++) {
        await new Promise<void>((r) => setTimeout(r, 1200 + Math.random() * 600));
        if (apiDone) { setProgress(STEPS.length); break; }
        setProgress(i);
      }
    };
    const animPromise = animateSteps();

    try {
      const res  = await fetch("/api/candle-tg/build", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ca, chain, username,
          linkName: linkName.trim() ? linkName.trim() : undefined,
          customPinText: customPin && customPinText.trim() ? customPinText.trim() : undefined,
          customPinImageB64: customPin && customPinImageB64 ? customPinImageB64 : undefined,
        }),
      });
      const data = await res.json() as {
        inviteLink?: string;
        groupInviteLink?: string;
        token?: TokenInfo;
        linkName?: string;
        linkNameClaimed?: boolean;
        error?: string;
      };
      apiDone = true;
      await animPromise;
      setProgress(STEPS.length);

      if (data.inviteLink) {
        setLink(data.inviteLink);
        setGroupLink(data.groupInviteLink ?? "");
        setTokenInfo(data.token ?? null);
        setLinkNameClaimed(data.linkNameClaimed ?? null);
        setClaimedName(data.linkName ?? "");
        const newEntry: Activity = { ca: ca.slice(0, 8) + "..." + ca.slice(-4), chain, timestamp: Date.now() };
        setActivity((prev) => {
          const next = [newEntry, ...prev].slice(0, 10);
          try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next)); } catch {}
          return next;
        });
        setDone(true);
      } else {
        // Build failed — keep `done` false so the Build button stays visible
        // and all the form values stay typed. User can adjust whatever field
        // caused the failure (e.g. fix the verify link name) and resubmit
        // without having to retype the CA and Telegram username from scratch.
        setError(data.error ?? "something went wrong. please try again.");
        setProgress(0);
      }
    } catch {
      apiDone = true;
      // Network/abort failure — same idea: stay on the form so the user can retry.
      setError("could not reach server — please try again.");
      setProgress(0);
    }

    setRunning(false);
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setCustomPinImageB64(null); setCustomPinImageName(""); return; }
    if (file.size > 4 * 1024 * 1024) { setError("image must be under 4 MB"); return; }
    setCustomPinImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setCustomPinImageB64(result.split(",")[1] ?? null);
    };
    reader.readAsDataURL(file);
  }

  function handleReset() {
    setCa(""); setUsername(""); setProgress(0); setDone(false);
    setLink(""); setGroupLink(""); setTokenInfo(null); setError("");
    setCustomPin(false); setCustomPinText(""); setCustomPinImageB64(null); setCustomPinImageName("");
    setLinkName(""); setLinkNameTouched(false); setLinkStatus({ state: "idle" });
    setLinkNameClaimed(null); setClaimedName(""); setResolvedTicker(null);
  }

  // ── Unconfigured state ──────────────────────────────────────────────────────
  if (unconfigured) {
    return (
      <div style={{
        background: "#05070a", border: "1px solid rgba(50,254,159,0.18)",
        borderRadius: 10, overflow: "hidden", fontFamily: MONO,
      }}>
        <TerminalHeader path="candle-tg: ~/builder" live={false} />
        <div style={{ padding: "22px 26px", fontSize: 12, color: "var(--muted-2)" }}>
          ── CandleTG is not configured on this deployment. contact @000000z.
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: MONO }}>

      {/* ── Build card ── */}
      <div style={{
        position: "relative", overflow: "hidden",
        background: "#05070a",
        border: "1px solid rgba(50,254,159,0.18)",
        borderRadius: 10,
      }}>
        {/* Scanline overlay (UI-8) */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(to bottom, rgba(50,254,159,0.02) 0, rgba(50,254,159,0.02) 1px, transparent 1px, transparent 4px)",
        }} />
        {/* Animated glow (UI-8) */}
        <div style={{
          position: "absolute", right: -30, top: -30,
          width: 260, height: 260, pointerEvents: "none",
          background: "radial-gradient(circle, rgba(50,254,159,0.22) 0%, transparent 65%)",
          filter: "blur(10px)", animation: "ceGlowShift 9s ease-in-out infinite",
        }} />

        <TerminalHeader path="candle-tg: ~/builder" live />

        <div style={{ padding: "22px 26px", position: "relative" }}>

          {/* Eyebrow */}
          <div style={{ fontSize: 11, color: "var(--muted-2)", letterSpacing: "0.1em", marginBottom: 6 }}>
            › paste a contract address. get a community.
          </div>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SectionLabel text="contract_address" />
              <input
                style={{
                  height: 40, width: "100%", background: "#000",
                  border: "1px solid rgba(50,254,159,0.3)", borderRadius: 6,
                  color: "#fff", fontFamily: MONO, fontSize: 12, padding: "0 12px",
                  outline: "none", opacity: running ? 0.45 : 1,
                }}
                type="text"
                placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAs"
                value={ca}
                onChange={(e) => setCa(e.target.value)}
                disabled={running}
                spellCheck={false}
                autoComplete="off"
                onFocus={(e) => { e.target.style.boxShadow = "0 0 0 2px rgba(50,254,159,0.2)"; }}
                onBlur={(e)  => { e.target.style.boxShadow = "none"; }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SectionLabel text="tg_username" />
              <input
                style={{
                  height: 40, width: "100%", background: "#000",
                  border: "1px solid rgba(50,254,159,0.3)", borderRadius: 6,
                  color: "#fff", fontFamily: MONO, fontSize: 12, padding: "0 12px",
                  outline: "none", opacity: running ? 0.45 : 1,
                }}
                type="text"
                placeholder="@yourusername"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={running}
                spellCheck={false}
                autoComplete="off"
                onFocus={(e) => { e.target.style.boxShadow = "0 0 0 2px rgba(50,254,159,0.2)"; }}
                onBlur={(e)  => { e.target.style.boxShadow = "none"; }}
              />
            </div>

            {/* Verify channel link name — ticker-substring (anti-squat) + live availability */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SectionLabel text="verify link name (optional)" />
              <div style={{ position: "relative" }}>
                <input
                  style={{
                    height: 40, width: "100%", background: "rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 6, color: "rgba(255,255,255,0.85)", fontFamily: MONO, fontSize: 12,
                    padding: "0 38px 0 12px", outline: "none",
                    boxSizing: "border-box",
                  }}
                  type="text"
                  placeholder={resolvedTicker
                    ? `e.g. ${sanitiseTicker(resolvedTicker)}_verify`
                    : "e.g. pepe_verify"}
                  value={linkName}
                  onChange={(e) => {
                    setLinkName(e.target.value.trim().replace(/^@/, ""));
                    setLinkNameTouched(true);
                  }}
                  disabled={running}
                  spellCheck={false}
                  autoComplete="off"
                  onFocus={(e) => { e.target.style.boxShadow = "0 0 0 2px rgba(50,254,159,0.2)"; }}
                  onBlur={(e)  => { e.target.style.boxShadow = "none"; }}
                />
                {/* Live availability indicator */}
                <span style={{
                  position: "absolute", right: 10, top: 0, bottom: 0,
                  display: "flex", alignItems: "center",
                  fontSize: 14, fontFamily: MONO, pointerEvents: "none",
                }}>
                  {linkStatus.state === "checking"  && <span style={{ color: "var(--muted-2)" }}>⋯</span>}
                  {linkStatus.state === "available" && <span style={{ color: "var(--accent)" }}>✓</span>}
                  {linkStatus.state === "taken"     && <span style={{ color: "#f97316" }}>✗</span>}
                  {linkStatus.state === "reserved"  && <span style={{ color: "#f97316" }}>✗</span>}
                  {(linkStatus.state === "invalid" || linkStatus.state === "off-ticker" ||
                    linkStatus.state === "ticker-incompatible" || linkStatus.state === "error")
                    && <span style={{ color: "#fe3232" }}>✗</span>}
                </span>
              </div>
              {/* Status-dependent helper text */}
              <span style={{ fontSize: 10, color: "var(--muted-2)", fontFamily: MONO, minHeight: 14 }}>
                {linkStatus.state === "idle" && (
                  <>── must contain the token&apos;s ticker (e.g. <code style={{ color: "var(--accent)" }}>pepe_verify</code>, <code style={{ color: "var(--accent)" }}>pepe_community</code>). leave blank for a regular invite link.</>
                )}
                {linkStatus.state === "checking" && <>── checking <code>t.me/{linkName}</code>…</>}
                {linkStatus.state === "available" && (
                  <span style={{ color: "var(--accent)" }}>── <code>t.me/{linkName}</code> is available.</span>
                )}
                {linkStatus.state === "taken" && (
                  <span style={{ color: "#f97316" }}>── <code>t.me/{linkName}</code> is already taken on telegram. try a different name.</span>
                )}
                {linkStatus.state === "reserved" && (
                  <span style={{ color: "#f97316" }}>── <code>t.me/{linkName}</code> is reserved on telegram (banned word or system-protected). pick a different name.</span>
                )}
                {linkStatus.state === "off-ticker" && (
                  <span style={{ color: "#fe3232" }}>── name must contain the token&apos;s ticker. try <code style={{ color: "var(--accent)" }}>{linkStatus.expected}</code>.</span>
                )}
                {linkStatus.state === "ticker-incompatible" && (
                  <span style={{ color: "#fe3232" }}>── this token&apos;s ticker can&apos;t form a public link. leave blank for a regular invite.</span>
                )}
                {linkStatus.state === "invalid" && (
                  <span style={{ color: "#fe3232" }}>── {linkStatus.reason}</span>
                )}
                {linkStatus.state === "error" && (
                  <span style={{ color: "#fe3232" }}>── {linkStatus.reason}</span>
                )}
              </span>
            </div>


            {/* Custom pinned message toggle */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              <button
                type="button"
                onClick={() => setCustomPin((v) => !v)}
                disabled={running}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "none", border: "none", cursor: running ? "default" : "pointer",
                  padding: "6px 0", opacity: running ? 0.45 : 1,
                }}
              >
                <span style={{
                  width: 28, height: 16, borderRadius: 999, flexShrink: 0,
                  background: customPin ? "var(--accent)" : "rgba(255,255,255,0.1)",
                  position: "relative", transition: "background 0.2s",
                }}>
                  <span style={{
                    position: "absolute", top: 2, left: customPin ? 14 : 2,
                    width: 12, height: 12, borderRadius: 999,
                    background: customPin ? "#021510" : "rgba(255,255,255,0.4)",
                    transition: "left 0.2s",
                  }} />
                </span>
                <span style={{ fontSize: 11, color: customPin ? "var(--accent)" : "var(--muted-2)", fontFamily: MONO }}>
                  custom_pinned_message
                </span>
              </button>

              {customPin && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                  {/* Custom message textarea */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <SectionLabel text="pin_message_text" />
                    <textarea
                      rows={5}
                      placeholder={"Welcome to [Token] Official\n\nYour message here…"}
                      value={customPinText}
                      onChange={(e) => setCustomPinText(e.target.value)}
                      disabled={running}
                      style={{
                        width: "100%", background: "#000",
                        border: "1px solid rgba(50,254,159,0.3)", borderRadius: 6,
                        color: "#fff", fontFamily: MONO, fontSize: 12,
                        padding: "10px 12px", outline: "none", resize: "vertical",
                        opacity: running ? 0.45 : 1, boxSizing: "border-box", lineHeight: 1.6,
                      }}
                      onFocus={(e) => { e.target.style.boxShadow = "0 0 0 2px rgba(50,254,159,0.2)"; }}
                      onBlur={(e)  => { e.target.style.boxShadow = "none"; }}
                    />
                  </div>

                  {/* Image upload */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <SectionLabel text="pin_image (optional)" />
                    <label style={{
                      display: "flex", alignItems: "center", gap: 10,
                      height: 40, background: "#000",
                      border: "1px solid rgba(50,254,159,0.3)", borderRadius: 6,
                      padding: "0 12px", cursor: running ? "default" : "pointer",
                      opacity: running ? 0.45 : 1,
                    }}>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        disabled={running}
                        style={{ display: "none" }}
                      />
                      <span style={{ fontSize: 11, color: "var(--accent)", fontFamily: MONO }}>
                        {customPinImageName ? `✓ ${customPinImageName}` : "choose image…"}
                      </span>
                      {customPinImageName && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); setCustomPinImageB64(null); setCustomPinImageName(""); }}
                          style={{
                            marginLeft: "auto", background: "none", border: "none",
                            color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 14, padding: 0,
                          }}
                        >×</button>
                      )}
                    </label>
                    <span style={{ fontSize: 10, color: "var(--muted-2)", fontFamily: MONO }}>
                      ── image sent with the pin message. max 4 MB.
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Build / reset buttons — shown side by side while editing,
                so a failed build can be retried (Build) or wiped clean (Reset)
                without losing the rest of the typed values. After a successful
                build, only Reset remains (the form has no more work to do). */}
            {!done ? (
              <div style={{ display: "flex", gap: 8 }}>
                {(() => {
                  // Disable Build when:
                  //  - required fields are empty
                  //  - a build is already running
                  //  - the user typed a linkName but it isn't `available`
                  //    (taken, off-ticker, invalid, checking, etc.) — letting
                  //    them click would just produce a 400 on the server.
                  const linkBlocking = linkName.trim().length > 0 && linkStatus.state !== "available";
                  const disabled = !ca.trim() || !username.trim() || running || linkBlocking;
                  return (
                <button
                  type="button"
                  onClick={handleBuild}
                  disabled={disabled}
                  style={{
                    flex: 1,
                    padding: "9px 14px", height: 40,
                    background: "var(--accent)", color: "#021510",
                    border: "none", borderRadius: 6,
                    fontWeight: 700, fontSize: 12, fontFamily: MONO,
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.45 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {running ? (
                    <>
                      <span style={{
                        width: 12, height: 12, borderRadius: "50%",
                        border: "2px solid rgba(0,0,0,0.25)", borderTopColor: "#021510",
                        animation: "spin 0.7s linear infinite", flexShrink: 0,
                      }} />
                      building…
                    </>
                  ) : "./build"}
                </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={running}
                  style={{
                    padding: "9px 14px", height: 40,
                    background: "transparent", color: "#fff",
                    border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
                    fontSize: 12, fontFamily: MONO,
                    cursor: running ? "default" : "pointer",
                    opacity: running ? 0.45 : 1,
                  }}
                >
                  ./reset
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleReset}
                style={{
                  padding: "9px 14px", height: 40,
                  background: "transparent", color: "#fff",
                  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
                  fontSize: 12, fontFamily: MONO,
                  cursor: "pointer",
                }}
              >
                ./reset
              </button>
            )}

            {/* Error */}
            {error && (
              <div style={{
                fontSize: 11, color: "var(--tier-low)",
                background: "rgba(254,50,50,0.07)",
                border: "1px solid rgba(254,50,50,0.18)",
                borderRadius: 6, padding: "8px 12px", lineHeight: 1.6,
              }}>
                › {error}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "20px -26px" }} />

          {/* Build status */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionLabel text="build_status" />
            <div style={{ display: "flex", flexDirection: "column" }}>
              {STEPS.map((step, i) => {
                const completed = progress > i;
                const active    = running && progress === i;
                return (
                  <div
                    key={step}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "7px 0",
                      borderBottom: i < STEPS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                      border: completed ? "1.5px solid var(--accent)"
                            : active   ? "1.5px solid rgba(255,255,255,0.35)"
                            :            "1.5px solid rgba(255,255,255,0.1)",
                      background: completed ? "rgba(50,254,159,0.12)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: completed ? "0 0 8px rgba(50,254,159,0.2)" : "none",
                      animation: active ? "cePulse 1s ease infinite" : "none",
                    }}>
                      {completed && <Icon name="check" size={9} style={{ color: "var(--accent)" }} />}
                    </div>
                    <span style={{
                      fontFamily: MONO, fontSize: 11,
                      color: completed ? "var(--muted)" : active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.15)",
                      transition: "color 0.25s",
                    }}>
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Result */}
          {done && link && (
            <>
              <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "20px -26px" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <SectionLabel text="community_live" />
                  {tokenInfo && (
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--muted)" }}>
                      {tokenInfo.name}{" "}
                      <span style={{ color: "var(--accent)" }}>${tokenInfo.ticker}</span>
                    </span>
                  )}
                </div>

                {/* Group invite link — for the owner to join directly as Founder */}
                {groupLink && (
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted-2)", fontFamily: MONO, marginBottom: 4 }}>
                      ── if not automatically added, use this link to join as founder
                    </div>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: "#000", border: "1px solid rgba(50,254,159,0.5)",
                      borderRadius: 6, padding: "8px 12px",
                    }}>
                      <span style={{
                        flex: 1, fontFamily: MONO, fontSize: 11, color: "var(--accent)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {groupLink}
                      </span>
                      <a href={groupLink} target="_blank" rel="noopener noreferrer"
                        style={{
                          flexShrink: 0, padding: "5px 10px",
                          background: "transparent", border: "1px solid rgba(50,254,159,0.3)",
                          color: "var(--accent)", borderRadius: 6,
                          fontSize: 11, fontFamily: MONO, textDecoration: "none",
                        }}>open</a>
                    </div>
                  </div>
                )}

                {/* Verify channel link — share publicly */}
                <div>
                  <div style={{ fontSize: 10, color: "var(--muted-2)", fontFamily: MONO, marginBottom: 4 }}>
                    ── verify channel (share publicly)
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#000", border: "1px solid rgba(50,254,159,0.3)",
                    borderRadius: 6, padding: "8px 12px",
                  }}>
                    <span style={{
                      flex: 1, fontFamily: MONO, fontSize: 11, color: "var(--accent)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {link}
                    </span>
                    <a
                      href={link} target="_blank" rel="noopener noreferrer"
                      style={{
                        flexShrink: 0, padding: "5px 10px",
                        background: "transparent", border: "1px solid rgba(50,254,159,0.3)",
                        color: "var(--accent)", borderRadius: 6,
                        fontSize: 11, fontFamily: MONO, textDecoration: "none",
                      }}
                    >
                      open
                    </a>
                    <button
                      type="button"
                      onClick={() => copy(link)}
                      style={{
                        flexShrink: 0, padding: "5px 10px",
                        background: "transparent", border: "1px solid rgba(50,254,159,0.3)",
                        color: "var(--accent)", borderRadius: 6, cursor: "pointer",
                        fontSize: 11, fontFamily: MONO,
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                    >
                      <Icon name={copied ? "check" : "copy"} size={11} />
                      {copied ? "copied" : "copy"}
                    </button>
                  </div>
                  {linkNameClaimed === false && claimedName && (
                    <div style={{
                      marginTop: 6, fontSize: 10, color: "#f97316", fontFamily: MONO,
                    }}>
                      ── note: <code>t.me/{claimedName}</code> was unavailable on telegram — using invite link instead.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Stats + activity feed card ── */}
      <div style={{
        background: "#05070a",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10, overflow: "hidden",
      }}>
        <TerminalHeader path="candle-tg: ~/stats" live={false} />
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { label: "build_time",  value: "< 90s", note: "wall clock",             accent: "var(--accent)" },
              { label: "chain",       value: "SOL",    note: "solana" },
              { label: "steps",       value: "7",      note: "fully automated" },
            ].map((s) => (
              <div key={s.label} style={{
                flex: 1, padding: "12px 14px",
                background: "#05070a", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, fontFamily: MONO,
              }}>
                <div style={{ fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.1em" }}>── {s.label}</div>
                <div style={{
                  fontSize: 26, fontWeight: 500, marginTop: 6, lineHeight: 1,
                  color: s.accent ?? "#fff", letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums", // UI-12
                }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 5 }}>{s.note}</div>
              </div>
            ))}
          </div>

          {/* Activity feed */}
          <div>
            <div style={{ marginBottom: 8 }}>
              <SectionLabel text="recent_launches" />
            </div>
            {activity.length === 0 ? (
              <div style={{
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8,
                padding: "14px 12px", fontSize: 11, color: "var(--muted-2)", fontFamily: MONO,
              }}>
                ── no launches yet. build your first community above.
              </div>
            ) : (
              <div style={{
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden",
              }}>
                {activity.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      borderBottom: i < activity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      fontFamily: MONO,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: CHAIN_COLOR[a.chain] ?? "#9945ff" }} />
                    <span style={{ flex: 1, fontSize: 11, color: "var(--muted-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.ca}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.9)", flexShrink: 0, width: 60 }}>
                      {a.chain.toLowerCase()}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.9)", flexShrink: 0, minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {timeAgo(a.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer line */}
          <div style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: 10, fontSize: 10, color: "var(--muted-2)", letterSpacing: "0.08em" }}>
            ── candle-tg / mtproto / build_v1
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// Scope wrapper: supplies the design tokens + keyframes the inner component
// references via CSS vars, so the ported markup renders standalone (outside the
// original Candle Elite site that defined these globally).
export default function CandleTgTool() {
  return (
    <div
      className="candle-tg-scope"
      style={{
        // CandleTG terminal palette (kept intact so the tool reads as authored).
        ['--accent' as string]: '#32fe9f',
        ['--muted' as string]: 'rgba(255,255,255,0.55)',
        ['--muted-2' as string]: 'rgba(255,255,255,0.35)',
        ['--tier-low' as string]: '#fe3232',
        ['--font-mono' as string]:
          "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
      }}
    >
      <style>{`
        @keyframes cePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @keyframes ceGlowShift {
          0%, 100% { transform: translate(0, 0); opacity: 0.9; }
          50% { transform: translate(-14px, 10px); opacity: 0.6; }
        }
      `}</style>
      <ToolCardInner />
    </div>
  );
}
