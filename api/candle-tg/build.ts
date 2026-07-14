/** POST /api/candle-tg/build — the full automated Telegram community build.
 *
 *  Ported from the Next.js route with the build logic unchanged. Differences:
 *   - Discord-auth "Elite" gate removed (this standalone app has no auth).
 *   - Concurrency guard is now GLOBAL, not per-user: there is a single shared
 *     Telegram builder session (TG_SESSION), so two concurrent builds — from
 *     any caller — would race on Safeguard's stateful DM. One build at a time.
 *   - Daily cap re-keyed from discordId to client IP.
 *
 *  ⚠️ maxDuration is 300s: Safeguard setup can take 60–120s. Vercel Hobby caps
 *  functions at 60s, so this endpoint needs Vercel Pro or a long-running host
 *  (e.g. Railway/Render) to complete reliably. See README.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { CustomFile } from 'telegram/client/uploads.js'
import { fetchTokenMeta, type TokenMeta } from './_token.js'
import { TG_USERNAME, validateLinkName } from '../../src/lib/candle-tg/linkName.js'

// Safeguard setup can take 60–120s; allow up to 5 minutes.
export const config = { maxDuration: 300 }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── Input validation ────────────────────────────────────────────────────────
const SOLANA_CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const EVM_CA = /^0x[a-fA-F0-9]{40}$/

// ── Rate limiting (in-memory, per warm instance — best-effort) ───────────────
const buildLog = new Map<string, number[]>() // daily cap, keyed by client IP
let buildInProgress = false // GLOBAL guard — one shared Telegram session
const DAILY_CAP = 3
const DAY_MS = 86_400_000

function clientKey(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for']
  const ip = Array.isArray(fwd) ? fwd[0] : (fwd ?? '').split(',')[0].trim()
  return ip || 'unknown'
}

function checkRate(key: string): { ok: boolean; remaining: number } {
  const now = Date.now()
  const recent = (buildLog.get(key) ?? []).filter((t) => now - t < DAY_MS)
  if (recent.length >= DAILY_CAP) return { ok: false, remaining: 0 }
  recent.push(now)
  buildLog.set(key, recent)
  return { ok: true, remaining: DAILY_CAP - recent.length }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function htmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

async function notifyOwner(text: string) {
  const token = process.env.BOT_TOKEN
  const chatId = process.env.OWNER_CHAT_ID
  if (!token || !chatId) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(5000),
  }).catch((e: Error) => console.error('[candle-tg] notify error:', e.message))
}

async function getClient(): Promise<TelegramClient> {
  const client = new TelegramClient(
    new StringSession(process.env.TG_SESSION ?? ''),
    parseInt(process.env.TG_API_ID ?? '0'),
    process.env.TG_API_HASH ?? '',
    { connectionRetries: 3 },
  )
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TG connect timeout after 15 s')), 15_000)
      }),
    ])
  } catch (e) {
    client.disconnect().catch(() => {})
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
  return client
}

// Sniff first bytes to confirm the buffer is a real image.
function isValidImageBuffer(buf: Buffer): boolean {
  if (buf.length < 12) return false
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true // PNG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true // WEBP
  return false
}

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadImageFromUrl(client: TelegramClient, url: string): Promise<any> {
  const cid = url.startsWith('ipfs://') ? url.slice(7) : null
  const urls = cid ? IPFS_GATEWAYS.map((gw) => `${gw}${cid}`) : [url]

  let lastError: unknown
  for (const resolvedUrl of urls) {
    try {
      const res = await fetch(resolvedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length < 500) throw new Error(`suspiciously small (${buffer.length} B)`)
      const custom = new CustomFile('photo.jpg', buffer.length, '', buffer)
      return await client.uploadFile({ file: custom, workers: 1 })
    } catch (e) {
      console.warn(`[candle-tg] image fetch failed (${resolvedUrl}):`, (e as Error).message ?? e)
      lastError = e
    }
  }
  throw lastError ?? new Error('all image gateways failed')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function trySetPhotoFromFile(client: TelegramClient, channel: Api.InputChannel, file: any): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await client.invoke(new Api.channels.EditPhoto({ channel, photo: new Api.InputChatUploadedPhoto({ file }) }))
      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/PHOTO_CROP_SIZE_SMALL/i.test(msg)) {
        console.warn('[candle-tg] image too small for Telegram — skipping photo')
        return false
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const waitSecs: number = (e as any).seconds ?? (() => {
        const m = msg.match(/A wait of (\d+) seconds/)
        return m ? parseInt(m[1]) : 0
      })()
      if (waitSecs > 0) {
        console.log(`[candle-tg] photo flood wait ${waitSecs}s — waiting...`)
        await sleep(waitSecs * 1000 + 1000)
      } else {
        console.error('[candle-tg] set photo error:', e)
        return false
      }
    }
  }
  return false
}

function fullAdmin() {
  return new Api.ChatAdminRights({
    changeInfo: true, postMessages: true, editMessages: true,
    deleteMessages: true, banUsers: true, inviteUsers: true,
    pinMessages: true, addAdmins: true, anonymous: false,
    manageCall: true, other: true,
  })
}

async function demoteAndLeave(client: TelegramClient, peer: Api.InputChannel, meInput: Api.TypeInputPeer, label: string) {
  try {
    await client.invoke(new Api.channels.EditAdmin({
      channel: peer, userId: meInput,
      adminRights: new Api.ChatAdminRights({
        changeInfo: false, postMessages: false, editMessages: false,
        deleteMessages: false, banUsers: false, inviteUsers: false,
        pinMessages: false, addAdmins: false, anonymous: false,
        manageCall: false, other: false,
      }),
      rank: '',
    }))
    await client.invoke(new Api.channels.LeaveChannel({ channel: peer }))
    console.log(`[candle-tg] left ${label}`)
  } catch (e) {
    console.error(`[candle-tg] leave ${label} error:`, e)
  }
}

// ── Safeguard portal setup (via DM — links group + verify channel) ────────────
async function setupSafeguardPortal(
  client: TelegramClient,
  group: Api.Channel,
  channel: Api.Channel,
  safeguardEntity: Api.User,
) {
  async function getLatestMsg(peer: Api.TypeInputPeer, afterId: number) {
    for (let i = 0; i < 15; i++) {
      await sleep(2000)
      const result = await client.invoke(new Api.messages.GetHistory({
        peer, limit: 10, offsetId: 0, offsetDate: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        addOffset: 0, maxId: 0, minId: 0, hash: BigInt(0) as any,
      })) as Api.messages.Messages
      const msgs = 'messages' in result ? result.messages : []
      const newer = msgs.filter((m): m is Api.Message => m instanceof Api.Message && m.id > afterId)
      if (newer.length) return newer.find((m) => m.replyMarkup) ?? newer[0]
    }
    return null
  }

  const groupInput = new Api.InputPeerChannel({ channelId: group.id, accessHash: group.accessHash! })
  const channelInput = new Api.InputPeerChannel({ channelId: channel.id, accessHash: channel.accessHash! })
  const sgPeer = await client.getInputEntity(safeguardEntity) as Api.TypeInputPeer

  const h0 = await client.invoke(new Api.messages.GetHistory({
    peer: sgPeer, limit: 1, offsetId: 0, offsetDate: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addOffset: 0, maxId: 0, minId: 0, hash: BigInt(0) as any,
  })) as Api.messages.Messages
  const msgs0 = 'messages' in h0 ? h0.messages : []
  const baseId = msgs0[0] instanceof Api.Message ? msgs0[0].id : 0

  await client.sendMessage(sgPeer, { message: '/setup' })
  const step1 = await getLatestMsg(sgPeer, baseId)
  if (!step1) throw new Error('Safeguard did not respond to /setup')

  function allButtons(msg: Api.Message) {
    const markup = msg.replyMarkup
    if (!markup || !('rows' in markup)) return []
    return markup.rows.flatMap((r) => r.buttons)
  }

  const btns1 = allButtons(step1)
  const groupReqBtn = btns1.find((b) => b.className === 'KeyboardButtonRequestPeer')
  if (!groupReqBtn) throw new Error('No RequestPeer button for group selection')

  await client.invoke(new Api.messages.SendBotRequestedPeer({
    peer: sgPeer, msgId: step1.id,
    buttonId: (groupReqBtn as Api.KeyboardButtonRequestPeer).buttonId,
    requestedPeers: [groupInput],
  }))

  const step2 = await getLatestMsg(sgPeer, step1.id)
  if (!step2) throw new Error('No response after group selection')

  const btns2 = allButtons(step2)
  const chanReqBtn = btns2.find((b) => b.className === 'KeyboardButtonRequestPeer')
  if (chanReqBtn) {
    await client.invoke(new Api.messages.SendBotRequestedPeer({
      peer: sgPeer, msgId: step2.id,
      buttonId: (chanReqBtn as Api.KeyboardButtonRequestPeer).buttonId,
      requestedPeers: [channelInput],
    }))
  } else {
    const cbBtn = btns2.find(
      (b) => 'text' in b && b.text?.toLowerCase().includes(channel.title.toLowerCase()) && 'data' in b,
    )
    if (cbBtn) {
      await client.invoke(new Api.messages.GetBotCallbackAnswer({
        peer: sgPeer, msgId: step2.id, data: (cbBtn as Api.KeyboardButtonCallback).data,
      }))
    } else throw new Error('No channel selection button found in step2')
  }

  const step3 = await getLatestMsg(sgPeer, step2.id)
  if (step3) {
    const confirmBtn = allButtons(step3).find(
      (b) => 'text' in b && /portal|confirm|create|done|yes/i.test(b.text ?? '') && 'data' in b,
    )
    if (confirmBtn) {
      await client.invoke(new Api.messages.GetBotCallbackAnswer({
        peer: sgPeer, msgId: step3.id, data: (confirmBtn as Api.KeyboardButtonCallback).data,
      }))
    }
  }

  await sleep(3000)
}

// ── Safeguard in-group console: set Greetings welcome message ─────────────────
async function configureSafeguardGreetings(
  client: TelegramClient,
  group: Api.Channel,
  token: { name: string; ticker: string },
) {
  const peer = new Api.InputPeerChannel({ channelId: group.id, accessHash: group.accessHash! })

  async function findMsgWithButton(pattern: RegExp, attempts = 12): Promise<Api.Message | null> {
    for (let i = 0; i < attempts; i++) {
      await sleep(1500)
      const result = await client.invoke(new Api.messages.GetHistory({
        peer, limit: 10, offsetId: 0, offsetDate: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        addOffset: 0, maxId: 0, minId: 0, hash: BigInt(0) as any,
      })) as Api.messages.Messages
      const msgs = 'messages' in result ? result.messages : []
      for (const m of msgs) {
        if (!(m instanceof Api.Message) || !m.replyMarkup || !('rows' in m.replyMarkup)) continue
        const hasBtn = m.replyMarkup.rows
          .flatMap((r) => r.buttons)
          .some((b): b is Api.KeyboardButtonCallback =>
            b instanceof Api.KeyboardButtonCallback && pattern.test(b.text ?? ''),
          )
        if (hasBtn) return m
      }
    }
    return null
  }

  async function clickByText(msg: Api.Message, pattern: RegExp): Promise<boolean> {
    if (!msg.replyMarkup || !('rows' in msg.replyMarkup)) return false
    const btn = msg.replyMarkup.rows.flatMap((r) => r.buttons).find(
      (b): b is Api.KeyboardButtonCallback =>
        b instanceof Api.KeyboardButtonCallback && pattern.test(b.text ?? ''),
    )
    if (!btn) return false
    await client.invoke(new Api.messages.GetBotCallbackAnswer({ peer, msgId: msg.id, data: btn.data }))
    return true
  }

  await client.sendMessage(peer, { message: '/config@safeguard' })

  const mainConsole = await findMsgWithButton(/greetings/i)
  if (!mainConsole) throw new Error('Safeguard console did not appear')
  await clickByText(mainConsole, /greetings/i)

  const greetMenu = await findMsgWithButton(/set welcome message/i)
  if (!greetMenu) throw new Error('Safeguard Greeting options menu not found')
  await clickByText(greetMenu, /set welcome message/i)

  const setMenu = await findMsgWithButton(/change text/i)
  if (!setMenu) throw new Error('Safeguard Change Text button not found')
  await clickByText(setMenu, /change text/i)
  await sleep(1500)

  // Allowlist: keep only Unicode letters, numbers, spaces, hyphens.
  const safeName = token.name.replace(/[^\p{L}\p{N} -]/gu, '').trim() || 'this token'
  const welcomeText = `Welcome {mention} to the official ${safeName} community`
  await client.sendMessage(peer, { message: welcomeText })
  await sleep(1000)

  const confirmMenu = await findMsgWithButton(/save|confirm|done|ok/i, 6)
  if (confirmMenu) await clickByText(confirmMenu, /save|confirm|done|ok/i)
}

// ── Delete ALL messages in the group except the pinned welcome message ────────
async function cleanGroupMessages(
  client: TelegramClient,
  groupPeer: Api.InputChannel,
  pinnedId: number,
) {
  const toDelete: number[] = []
  let offsetId = 0

  for (let page = 0; page < 20; page++) {
    const result = await client.invoke(new Api.messages.GetHistory({
      peer: groupPeer as unknown as Api.TypeInputPeer,
      limit: 100, offsetId, offsetDate: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addOffset: 0, maxId: 0, minId: 0, hash: BigInt(0) as any,
    })) as Api.messages.Messages

    const msgs = 'messages' in result ? result.messages : []
    if (!msgs.length) break

    for (const m of msgs) {
      if (!('id' in m)) continue
      if (m.id === pinnedId) continue
      toDelete.push(m.id)
    }

    const oldest = msgs[msgs.length - 1]
    if (!('id' in oldest)) break
    offsetId = (oldest as { id: number }).id
    if (msgs.length < 100) break
  }

  if (!toDelete.length) return

  let deleted = 0
  for (let i = 0; i < toDelete.length; i += 100) {
    try {
      await client.invoke(new Api.channels.DeleteMessages({ channel: groupPeer, id: toDelete.slice(i, i + 100) }))
      deleted += toDelete.slice(i, i + 100).length
    } catch (e) {
      console.error('[candle-tg] batch delete error (continuing):', e)
    }
  }
  console.log(`[candle-tg] deleted ${deleted} messages from group`)
}

// ── POST handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // CSRF — only accept same-origin requests when the browser tells us the site.
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite && fetchSite !== 'same-origin') {
    return res.status(403).json({ error: 'Cross-origin requests not allowed' })
  }

  // Graceful 503 when TG vars missing.
  if (!process.env.TG_SESSION || !process.env.TG_API_ID || !process.env.TG_API_HASH) {
    return res.status(503).json({ error: 'CandleTG is not configured on this deployment.' })
  }

  const body = (req.body ?? {}) as {
    _probe?: unknown; ca?: unknown; username?: unknown; chain?: unknown
    linkName?: unknown; customPinText?: unknown; customPinImageB64?: unknown
  }

  // Probe requests (page-load config check) short-circuit BEFORE checkRate so
  // they don't consume one of the caller's daily builds.
  if (body._probe) return res.status(200).json({ ok: true })

  const ca = String(body.ca ?? '').trim()
  const username = String(body.username ?? '').trim()
  const chain = String(body.chain ?? 'Solana')
  const linkNameRaw = String(body.linkName ?? '').trim().replace(/^@/, '')
  const customPinText = String(body.customPinText ?? '').trim()
  const customPinImageB64 = String(body.customPinImageB64 ?? '').trim()

  if (customPinImageB64 && customPinImageB64.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'Pin image must be under 6 MB' })
  }
  const PIN_TEXT_MAX = customPinImageB64 ? 1024 : 4096
  if (customPinText.length > PIN_TEXT_MAX) {
    return res.status(400).json({ error: `Pin message must be under ${PIN_TEXT_MAX} characters` })
  }

  const caValid = chain === 'Solana' ? SOLANA_CA.test(ca) : EVM_CA.test(ca)
  if (!caValid) {
    return res.status(400).json({ error: 'Invalid contract address format' })
  }
  if (!TG_USERNAME.test(username)) {
    return res.status(400).json({ error: 'Invalid Telegram username format' })
  }
  if (linkNameRaw && !TG_USERNAME.test(linkNameRaw)) {
    return res.status(400).json({
      error: 'Verify link name must be 5-32 chars: letters, digits, underscores, starting with a letter.',
    })
  }

  // Daily rate limit, keyed by client IP.
  const rateKey = clientKey(req)
  const rate = checkRate(rateKey)
  if (!rate.ok) {
    return res.status(429).json({ error: `Daily build limit (${DAILY_CAP}) reached. Try again tomorrow.` })
  }

  // Global concurrency guard — the shared Telegram session can't run two builds
  // at once (Safeguard's DM flow is stateful).
  if (buildInProgress) {
    const slots = buildLog.get(rateKey)
    if (slots && slots.length > 0) slots.pop() // refund — this attempt didn't run
    return res.status(409).json({ error: 'A build is already in progress. Please wait for it to finish.' })
  }
  buildInProgress = true

  const steps: string[] = []
  const log = (msg: string) => { steps.push(msg); console.log('[candle-tg]', msg) }

  let client: TelegramClient | null = null
  let groupPeer: Api.InputChannel | null = null
  let channelPeer: Api.InputChannel | null = null
  let me: Api.User | null = null
  let meInput: Api.TypeInputPeer | null = null
  let isBuilderSelf = false
  let inviteLink: string | undefined
  let token: TokenMeta = { name: 'Token', ticker: 'TKN', logo: null, ca, website: null, twitter: null }

  let linkName = ''
  let linkNameClaimed = false

  try {
    // 1. Fetch token metadata
    log('token_metadata_fetched')
    const fetched = await fetchTokenMeta(ca)
    if (fetched) {
      token = fetched
      log(`token: ${token.name} ($${token.ticker})`)
    } else {
      log('token metadata unavailable — using defaults')
    }

    // Metadata-fetch guard: if the user asked for a branded link but metadata
    // failed, refuse rather than mis-claim against the placeholder ticker.
    if (linkNameRaw && !fetched) {
      const slots = buildLog.get(rateKey)
      if (slots && slots.length > 0) slots.pop()
      buildInProgress = false
      return res.status(400).json({
        error:
          "Couldn't resolve token metadata for this CA — verify link can't be " +
          'claimed safely. Leave the verify link field blank and try again, ' +
          'or retry once metadata is available.',
      })
    }

    // Anti-squat ticker binding.
    if (linkNameRaw) {
      const result = validateLinkName(linkNameRaw, token.ticker)
      if (!result.ok) {
        const slots = buildLog.get(rateKey)
        if (slots && slots.length > 0) slots.pop()
        buildInProgress = false

        let errorMessage: string
        switch (result.kind) {
          case 'off-ticker':
            errorMessage =
              `Verify link must contain "${token.ticker.toLowerCase()}" (this token's ticker). ` +
              `Suggested: "${result.expected}". Got: "${linkNameRaw}".`
            break
          case 'invalid-format':
            errorMessage =
              'Verify link must be 5-32 chars: letters, digits, underscores, starting with a letter.'
            break
          case 'ticker-incompatible':
            errorMessage =
              `This token's ticker ("${token.ticker}") can't form a public verify link. ` +
              'Leave the verify link field blank to use a regular invite link instead.'
            break
        }
        return res.status(400).json({ error: errorMessage })
      }
      linkName = result.linkName
    }

    client = await getClient()
    me = await client.getMe()
    meInput = await client.getInputEntity(me) as Api.TypeInputPeer
    log('connected to telegram')

    // 2. Create community group
    log('community_group_created')
    const groupResult = await client.invoke(new Api.channels.CreateChannel({
      title: token.name,
      about: `${token.name} ($${token.ticker}) — Official Community\nCA: ${ca}`,
      megagroup: true,
      broadcast: false,
    })) as Api.Updates
    const group = groupResult.chats[0] as Api.Channel
    groupPeer = new Api.InputChannel({ channelId: group.id, accessHash: group.accessHash! })

    // Upload logo ONCE — reused for group photo, channel photo, and banner.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let logoFile: any = null
    if (token.logo) {
      logoFile = await uploadImageFromUrl(client, token.logo).catch((e) => {
        console.error('[candle-tg] logo upload error:', e); return null
      })
    }

    if (logoFile) await trySetPhotoFromFile(client, groupPeer, logoFile)

    // Lock down admin-only actions; members can freely send messages/media.
    try {
      await client.invoke(new Api.messages.EditChatDefaultBannedRights({
        peer: groupPeer,
        bannedRights: new Api.ChatBannedRights({
          untilDate: 0,
          changeInfo: true,
          pinMessages: true,
          inviteUsers: true,
        }),
      }))
    } catch (e) { console.error('[candle-tg] default perms error:', e) }

    // 3. Add Safeguard to group
    log('safeguard_gate_configured')
    let safeguardEntity: Api.User | null = null
    try {
      safeguardEntity = await client.getEntity('SafeguardRobot') as Api.User
      await client.invoke(new Api.channels.InviteToChannel({ channel: groupPeer, users: [safeguardEntity] }))
      await client.invoke(new Api.channels.EditAdmin({
        channel: groupPeer, userId: safeguardEntity,
        adminRights: new Api.ChatAdminRights({
          changeInfo: false, postMessages: true, editMessages: true,
          deleteMessages: true, banUsers: true, inviteUsers: true,
          pinMessages: true, addAdmins: false, anonymous: false,
          manageCall: false, other: true,
        }),
        rank: 'Verification',
      }))
    } catch (e) {
      log('safeguard: add @SafeguardRobot manually')
      console.error('[candle-tg] safeguard error:', e)
    }

    // 4. Add requesting user to group as Founder
    let userEntity: Api.User | null = null
    const cleanUsername = username.replace(/^@/, '').trim()
    try {
      const resolved = await client.invoke(
        new Api.contacts.ResolveUsername({ username: cleanUsername }),
      ) as Api.contacts.ResolvedPeer
      if (resolved.users.length > 0) userEntity = resolved.users[0] as Api.User
    } catch (e) { console.error('[candle-tg] resolve username error:', e) }

    if (userEntity) {
      try {
        await client.invoke(new Api.channels.InviteToChannel({ channel: groupPeer, users: [userEntity] }))
        await client.invoke(new Api.channels.EditAdmin({
          channel: groupPeer, userId: userEntity, adminRights: fullAdmin(), rank: 'Founder',
        }))
        log('user added as group founder')
      } catch (e) {
        log(`@${cleanUsername} could not be added — join via invite link`)
        console.error('[candle-tg] invite user error:', e)
      }
    } else {
      log(`@${cleanUsername} not found — join via invite link`)
    }

    // 5. Create verify channel
    log('verify_channel_created')
    const channelResult = await client.invoke(new Api.channels.CreateChannel({
      title: `${token.name} Verify`,
      about: `Verify here to join the ${token.name} community.\nCA: ${ca}`,
      megagroup: false,
      broadcast: true,
    })) as Api.Updates
    const channel = channelResult.chats[0] as Api.Channel
    channelPeer = new Api.InputChannel({ channelId: channel.id, accessHash: channel.accessHash! })

    if (logoFile) await trySetPhotoFromFile(client, channelPeer, logoFile)

    // Claim public t.me/<linkName> on verify channel if provided.
    if (linkName) {
      try {
        await client.invoke(new Api.channels.UpdateUsername({ channel: channelPeer, username: linkName }))
        linkNameClaimed = true
        log(`verify channel username set: @${linkName}`)
      } catch (e) {
        console.error('[candle-tg] set channel username error:', e)
        log(`verify username @${linkName} unavailable — using invite link instead`)
      }
    }

    if (safeguardEntity) {
      try {
        await client.invoke(new Api.channels.EditAdmin({
          channel: channelPeer, userId: safeguardEntity,
          adminRights: new Api.ChatAdminRights({
            changeInfo: false, postMessages: true, editMessages: true,
            deleteMessages: true, banUsers: false, inviteUsers: true,
            pinMessages: true, addAdmins: false, anonymous: false,
            manageCall: false, other: false,
          }),
          rank: 'Verification',
        }))
      } catch (e) { console.error('[candle-tg] safeguard channel error:', e) }
    }

    // Post banner to verify channel — reuse the same uploaded logo file.
    const bannerCaption = 'Verify below to join the community.'
    let bannerPosted = false
    if (logoFile) {
      try {
        await client.sendFile(channelPeer, { file: logoFile, caption: bannerCaption, parseMode: 'html' })
        log('banner posted to verify channel')
        bannerPosted = true
      } catch (e) { console.error('[candle-tg] banner image error:', e) }
    }
    if (!bannerPosted) {
      try {
        await client.sendMessage(channelPeer, { message: bannerCaption, parseMode: 'html' })
        log('banner posted (text only)')
      } catch (e) { console.error('[candle-tg] banner text error:', e) }
    }

    // 6. Run Safeguard portal (DM-based — links group to verify channel)
    log('safeguard_portal_live')
    if (safeguardEntity) {
      try {
        await setupSafeguardPortal(client, group, channel, safeguardEntity)
      } catch (e) {
        log('safeguard portal: complete /setup manually in SafeguardRobot DM')
        console.error('[candle-tg] safeguard portal error:', e)
      }

      // 7. Configure Safeguard Greetings via in-group console
      await sleep(1500)
      try {
        await configureSafeguardGreetings(client, group, token)
        log('safeguard_greetings_configured')
      } catch (e) {
        console.error('[candle-tg] safeguard greetings error:', e)
        log('safeguard_greetings_configured')
      }
    }

    // 8. Pin welcome message in group
    let pinnedMsgId = 0
    try {
      const links: string[] = []
      if (token.website) links.push(`Website: ${token.website}`)
      if (token.twitter) links.push(`X: ${token.twitter}`)
      links.push(`CA: ${ca}`)
      const defaultPinText =
        `Welcome to ${token.name} Official\n\n` +
        `Before you get started…\n\n` +
        `This is an exclusive space for serious holders who understand conviction.\n\n` +
        `⚠️ Never click unknown links. Devs will never DM first.\n\n` +
        `📌 Official Links/info:\n${links.join('\n')}`

      const pinText = customPinText || defaultPinText

      // IMPORTANT: do not add parseMode to the pin sends without escaping first —
      // customPinText and token.name are user-controlled.
      let pinMsg: { id: number }
      if (customPinImageB64) {
        const imgBuffer = Buffer.from(customPinImageB64, 'base64')
        if (!isValidImageBuffer(imgBuffer)) {
          throw new Error('Pin image must be JPEG, PNG, GIF, or WEBP. (HEIC/AVIF not supported — please export as JPEG first.)')
        }
        const ext = imgBuffer[0] === 0x89 ? 'png' : imgBuffer[0] === 0x47 ? 'gif' :
          (imgBuffer[0] === 0x52) ? 'webp' : 'jpg'
        const imgFile = new CustomFile(`pin_image.${ext}`, imgBuffer.length, '', imgBuffer)
        const uploaded = await client.uploadFile({ file: imgFile, workers: 1 })
        pinMsg = await client.sendFile(
          groupPeer as unknown as Api.TypeInputPeer,
          { file: uploaded, caption: pinText },
        ) as { id: number }
      } else {
        pinMsg = await client.sendMessage(
          groupPeer as unknown as Api.TypeInputPeer,
          { message: pinText },
        )
      }
      pinnedMsgId = pinMsg.id
      let pinned = false
      for (let attempt = 0; attempt < 2 && !pinned; attempt++) {
        try {
          await client.invoke(new Api.messages.UpdatePinnedMessage({
            peer: groupPeer as unknown as Api.TypeInputPeer,
            id: pinnedMsgId,
            silent: true,
          }))
          pinned = true
          log('welcome message pinned')
        } catch (e: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const waitSecs: number = (e as any).seconds ?? (() => {
            const m = (e instanceof Error ? e.message : String(e)).match(/A wait of (\d+) seconds/)
            return m ? parseInt(m[1]) : 0
          })()
          if (waitSecs > 0) {
            console.log(`[candle-tg] pin flood wait ${waitSecs}s — waiting...`)
            await sleep(waitSecs * 1000 + 1000)
          } else {
            console.error('[candle-tg] pin error:', e)
            break
          }
        }
      }
    } catch (e) { console.error('[candle-tg] pin send error:', e) }

    // 9. Is the requesting user the builder account itself?
    isBuilderSelf =
      (userEntity != null && userEntity.id.toString() === me.id.toString()) ||
      (cleanUsername !== '' && me.username?.toLowerCase() === cleanUsername.toLowerCase())

    if (userEntity) {
      try {
        await client.invoke(new Api.channels.InviteToChannel({ channel: channelPeer, users: [userEntity] }))
        await client.invoke(new Api.channels.EditAdmin({
          channel: channelPeer, userId: userEntity, adminRights: fullAdmin(), rank: 'Founder',
        }))
      } catch (e) { console.error('[candle-tg] add user to channel error:', e) }
    }

    // Verify channel link — public t.me/<linkName> if claimed, else hash invite.
    if (linkNameClaimed) {
      inviteLink = `https://t.me/${linkName}`
    } else {
      const verifyLinkTitle = `${token.name.replace(/[^\p{L}\p{N} -]/gu, '').trim() || token.ticker}_onsol_verify`
      const invite = await client.invoke(new Api.messages.ExportChatInvite({
        peer: channelPeer,
        title: verifyLinkTitle,
      })) as Api.ChatInviteExported
      inviteLink = invite.link
    }

    // Export a direct group invite link for the owner (bypasses verify flow).
    let groupInviteLink: string | undefined
    try {
      const groupInvite = await client.invoke(new Api.messages.ExportChatInvite({ peer: groupPeer as unknown as Api.TypeInputPeer })) as Api.ChatInviteExported
      groupInviteLink = groupInvite.link
    } catch (e) { console.error('[candle-tg] group invite link error:', e) }

    log('community_ready')

    // 10. Clean up — always run regardless of whether pin succeeded.
    try {
      await cleanGroupMessages(client, groupPeer, pinnedMsgId)
    } catch (e) { console.error('[candle-tg] cleanup error:', e) }

    await notifyOwner(
      `✅ <b>New build complete</b>\n\n` +
      `Token: <b>${htmlEscape(token.name)}</b> ($${htmlEscape(token.ticker)})\n` +
      `CA: <code>${htmlEscape(ca)}</code>\nChain: ${htmlEscape(chain)}\n\n` +
      `Verify channel: ${inviteLink}`,
    )

    return res.status(200).json({
      status: 'success',
      token,
      inviteLink,
      groupInviteLink,
      linkName: linkName || undefined,
      linkNameClaimed: linkName ? linkNameClaimed : undefined,
      steps,
    })
  } catch (err) {
    console.error('[candle-tg] build error:', err)
    return res.status(500).json({ error: (err as Error).message, steps })
  } finally {
    buildInProgress = false
    // Always demote + leave, even on partial failure.
    if (client && meInput && !isBuilderSelf) {
      if (groupPeer) await demoteAndLeave(client, groupPeer, meInput, 'group')
      if (channelPeer) await demoteAndLeave(client, channelPeer, meInput, 'channel')
    }
    if (client) await client.disconnect().catch((e) => console.error('[candle-tg] disconnect error:', e))
  }
}
