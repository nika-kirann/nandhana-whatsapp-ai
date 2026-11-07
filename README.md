# Nandhana — public Pinterest downloader prototype

Nandhana is now a fixed-response Malayalam/English WhatsApp **Pinterest downloader**, not
an AI chatbot. No AI provider, model, API key, inference, persona prompt, or conversation
history remains in the current source. The repository URL/name stays unchanged.

**Disabled by default. Not deployed, linked, or verified end-to-end with WhatsApp.**

## What it supports

After `/start`, send exactly one HTTPS public Pin URL:

- `https://www.pinterest.com/pin/<numeric-id>/` (also `pinterest.com`).
- `https://pin.it/<alphanumeric-code>` if up to three HTTP redirects stay on the permitted
  page hosts and end at a supported numeric Pin URL. Other redirect patterns are refused.
- One JPEG, PNG or WebP image from public JSON-LD image metadata (or explicitly marked
  image Open Graph metadata); or one direct MP4 from `VideoObject.contentUrl`/Open Graph.
- Media must be on exact hosts `i.pinimg.com` or `v1.pinimg.com`, match the file extension,
  allowed response MIME type and a basic file signature. No external-site embed following.
- Returns an image/video attachment with a fixed friendly caption, never scraped HTML/text.

**Not all Pins work.** Private/login-only/deleted/restricted Pins, boards, bulk downloads,
regional Pinterest domains, slug-style Pin paths, GIF/SVG, HLS/DASH playlists, carousels,
embedded external videos and ambiguous metadata are unsupported. The parser never
intentionally substitutes an image for an identified video; HLS/video signals with no
supported MP4 produce an error. Ambiguous image-only OG thumbnails are refused, and
conservative page-wide video hints may reject otherwise downloadable images. Metadata
cannot guarantee correct classification if Pinterest omits all media-type signals.
There is no promise of original/best resolution or universal Pinterest coverage.

## Approach and research

SearchPlugins and installed connector status revealed no applicable Pinterest public
media connector. No connector was installed. Implementation uses ordinary logged-out
public HTML and standard metadata only, not the private web resource API.

- `https://schema.org/VideoObject` documents `contentUrl` as actual media bytes.
- `https://ogp.me/` documents `og:video`, `og:image`, and canonical metadata.
- Open-source reference inspected for feasibility:
  `https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/pinterest.py`.
  Its resource API approach was **not adopted**; no source copied or program executed.
- A public logged-out Pin page exposed schema `VideoObject.contentUrl` directly.

No cookies, login, authenticated/undocumented resource API, page-code execution, proxies,
stealth browser, third-party downloader service, CAPTCHA solving, retry after blocks,
or access-control circumvention is implemented. Download only media you own or have
permission to save/reuse; public visibility does not grant copyright permission. Review
Pinterest/WhatsApp terms and your applicable laws before activation.

## Setup (offline tests; no WhatsApp activity)

Requirements: Node.js 22+ (`.nvmrc` pins tested 22.23.4), npm, Git for the transitive
Baileys `libsignal` Git dependency. No API credentials needed for Pinterest or AI.

```sh
npm ci --ignore-scripts
cp .env.example .env
npm test
npm run check
npm start
```

With `BOT_ENABLED=false`, startup prints `Bot disabled` and exits before importing the
WhatsApp library, creating auth state, requesting Pinterest, or sending anything.
Package installation contacts registry/Git hosts; tests/syntax checks are offline.

## Future activation — manual and owner-approved only

1. Review terms, download rights, privacy, host/network access and the limitations below.
2. Complete the **supervised QR-only pairing command** described below. The main bot
   still refuses unregistered-session startup. Keep registered credentials in ignored `./auth` with owner-only permissions;
   custom `AUTH_DIR` must be outside this project. Never share session files or OTPs.
3. Set local `.env`: `ALLOWED_CHATS` to exact direct-chat JIDs (`digits@s.whatsapp.net`
   or `digits@lid`). Empty permits nobody; activation requires at least one. No contacts
   are discovered and number/LID forms are not aliased automatically.
4. Only after explicit approval, set `BOT_ENABLED=true` and start a single process.
5. An allowlisted sender must `/start` to opt in, then send a permitted public Pin URL.

The WhatsApp adapter uses pinned **Baileys 6.7.24 (legacy), an unofficial linked-device
WhatsApp Web library**, not Meta Cloud API. Protocol breakage, WhatsApp terms and account
restrictions are risks. Production/business usage needs a separate platform review.

## Commands and data

- `/help`: fixed bilingual instructions.
- `/start`: consent to retrieve submitted URLs from Pinterest and upload media to WhatsApp.
- `/reset`: revoke consent; `/start` is required again. There is no chat history to clear.
- `/stop`: opt out, including when rate-limited; `/start` opts in again.

No AI calls or conversation database exist. Only consent/rate/deduplication/queue state
is held in memory. Restart or 30-minute idle expiry requires opt-in again. `/stop` is
serialized after earlier same-chat work; it cannot recall an already sent attachment.
Pinterest/CDN see the requested URL and host IP; WhatsApp receives the returned media.
No URLs, message bodies, phone/chat IDs, session data or raw network errors are logged
by the app. Fixed event labels only; library logging is silent. Third-party services
have their own retention policies; reset/stop do not delete their records.

## Network, resource and file safeguards

- HTTPS-only exact page/CDN host allowlists, URL credentials/fragment/nondefault-port
  rejection and validation **before every redirect**; at most 3 redirects per resource.
- DNS checks reject private/local/link-local/reserved/multicast and IPv4-mapped IPv6
  addresses. All returned DNS records must be public unicast. The checked IP is provided
  directly to the TLS socket (no second lookup/DNS-rebinding gap); TLS verifies hostname.
- No automatic retries. 403, 429, bad status, login redirects, CAPTCHA titles or unsafe
  redirects fail. A guard rejection is not permission to route around the guard.
- Default 20-second wall deadline **per resource** across its redirects (page and media
  are separate resources); aborted on shutdown. No compressed responses are accepted.
- HTML cap 2 MiB. Download cap **12 MiB** by default, configurable up to 40 MiB; streamed
  with backpressure to a random temporary directory, not into an unbounded memory buffer.
- MIME whitelist and basic magic-byte checks; no SVG, arbitrary file or executable output.
  These checks are not antivirus, a full decoder, or protection against every malformed file.
- File permissions 0600; temporary directory created privately. Cleanup runs after send,
  failed download/send, and orderly shutdown. SIGKILL/power loss can leave temporary files;
  operators must securely clean stale `nandhana-*` temp directories after a crash.
- Maximum 2 simultaneous downloads, 10 pending messages/chat, 100 globally; 100 consent
  records; 2,000 dedupe IDs for up to 5 minutes. Six accepted inputs/minute/chat by default.
  Excess traffic is silently ignored to avoid reply storms; stop acknowledgments bypass
  rate limits. Deduplication is bounded/in-memory, not exactly-once delivery.
- Only fresh direct text notify events; own messages, groups, status, broadcasts,
  newsletters, incoming media and old history are ignored. No unsolicited-send API.

## Modules

- `src/config.js`: disabled default, allowlist and validated limits.
- `src/copy.js`: fixed friendly Malayalam/English responses named Nandhana.
- `src/network.js`: URL policy, IP checks, DNS pinning, bounded redirects/deadlines.
- `src/pinterest.js`: schema/OG parser, capped HTML/media consumption, signatures/cleanup.
- `src/handler.js`: opt-in, commands, serialization/rate/resource limits, attachment flow.
- `src/main.js`: lazy Baileys adapter, restricted local auth, fresh events, shutdown.

## Verification — distinguish fixtures from live access

Verified with Node 22.23.4: **63/63 offline tests passed**, syntax checks passed for
**11 JavaScript files**, clean locked installation with scripts disabled succeeded,
and `npm audit` reported **0 known vulnerabilities** for the lockfile at inspection.
Audit results are not a security guarantee.

- Offline tests cover image/MP4 extraction, shortlink redirects, streamed media handling,
  cleanup, consent, attachment callbacks, limits, restricted pages and SSRF regressions.
- Mock media bytes prove transport/type handling, **not** real decoding or WhatsApp delivery.
- Public read-only smoke: `https://www.pinterest.com/pin/664281013778109217/` returned
  **HTTP 200, text/html, 1,379,953 bytes** without login via curl. This parser read that
  saved public page and correctly identified direct MP4 `VideoObject.contentUrl` metadata.
- A subsequent live attempt through this app's guarded transport failed immediately with
  **`Error: DNS rejected`**. It was not retried or bypassed. Thus no live media transfer
  succeeded; image download, video bytes, shortlink resolution and WhatsApp sending remain
  verified by fixtures only, not live end-to-end. Live environment DNS must satisfy policy.

During downloader implementation no WhatsApp account was linked, QR/pairing emitted,
outgoing WhatsApp message, AI request, deployment, CI or paid resource used. The separate
owner-approved auth-only pairing command below was added later; its current run status
is recorded only in the private status file, not inferred from these offline checks. This is a conservative **parser/downloader
prototype**, not a universal or production-tested downloader. There is no auto reconnect,
SLA, malware scanner or production multi-process session backend.

## Owner-supervised QR linking (auth only)

This is separate from the downloader. Keep `BOT_ENABLED=false` (the command refuses
`BOT_ENABLED=true`). With the owner present and explicitly approving linking, run:

```sh
npm run pair -- --owner-approved
```

It emits **nothing to the terminal**. QR material is only rendered into owner-private
`.pairing/qr.png`; view `file:///absolute/path/to/project/.pairing/index.html` on this
computer's private desktop. The page refreshes every two seconds for rotation/status.
Do not paste the QR string, attach screenshots, expose the files on a public server,
commit them, or share them. Open WhatsApp on your phone → Linked devices → Link a device
and scan the desktop QR. `.pairing/status.json` contains only generic lifecycle state,
PID and timestamp; it has no QR/account/session identifiers. Do not open `auth/` files.

The process is capped at 180 seconds and six QR emissions, with no network-failure
retries. Exactly one `restartRequired` post-scan reconnect is permitted by the documented
Baileys auth flow. State `paired` means a socket opened with registered credentials and
credential saves completed, after which the auth socket is closed without logout.
An existing QR session is verified with an auth-only socket, not discarded or re-paired.
Baileys 6.7 QR sessions are identified by an in-memory `creds.me` identity; its `registered`
flag is not a reliable QR-session guard. No identity values are displayed or logged. Do not start multiple pairing processes concurrently.
Generic failure/expiry clears the displayed QR; a new attempt needs owner approval.

No inbox, chat, history, download or user-message send handlers are installed. Initial
queries, history requests, own-event emission and online presence are disabled, and all
chat JIDs are ignored. WhatsApp may still deliver auth-required protocol/notifications
internally; this app does not inspect, display, store or act on chat content. Auth uses
ignored `auth/`, owner-only directory permissions and umask 077 for session files.
The multi-file auth helper remains a prototype utility, not a production backend.

`BOT_ENABLED` is not changed and no bot process is started by pairing. Linking does not
authorize outgoing messages or downloader activation. You can revoke the linked device
from the phone's Linked devices screen. A crash/SIGKILL can leave a stale QR image: never
scan if status is not current or its PID is no longer running.

Documented method: https://baileys.wiki/authentication/qr-code and
https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/connecting.md .
Public Grok Bot examples were researched, but no third-party hosted WhatsApp connector,
subscription or token-sharing service was installed or used.

### QR lifecycle regression fix

Initial owner-supervised attempts reported reason 515 and then `auth_not_registered`.
This was an application guard bug, not evidence of a network/site block: the pinned
Baileys QR-success implementation updates `creds.me`/account data but does not set the
`registered` flag. The socket itself chooses login using `creds.me`; 515 is its documented
post-scan restart request. The workflow now permits exactly one such restart with a linked
identity and verifies existing saved QR sessions without deleting or resetting auth data.
Only actual socket-open plus successful credential persistence produces `paired` status.
