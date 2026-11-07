# Nandhana — public Pinterest downloader prototype

Nandhana is now a fixed-response Malayalam/English WhatsApp **Pinterest downloader**, not
an AI chatbot. No AI provider, model, API key, inference, persona prompt, or conversation
history remains in the current source. The repository URL/name stays unchanged.

**Starts idle. This change was not deployed or live-tested with WhatsApp by the assistant.**

## Koyeb **Free Web Service**: read this first

The protected web screen is ready for a **later owner deployment**; no deployment or
new live pairing was performed for this change. It is for supervised linking, not a
promise of a reliable free always-on WhatsApp bot.

- Free provides **512 MB RAM, 0.1 vCPU, 2 GB SSD**, one free instance/organization;
  Web Services only, Frankfurt or Washington DC. It sleeps after **1 hour without
  incoming traffic**; sleep cannot be disabled/customized. WhatsApp is offline while
  the service sleeps. An outbound WhatsApp socket is not documented as inbound traffic.
- Internet requests to `/healthz` are ordinary inbound HTTP under Koyeb's general idle
  rules and may affect inactivity/wake the service. Internal health checks are not a
  documented keepalive mechanism. **No UptimeRobot/24×7 uptime guarantee** is made here.
- Free instances **cannot use persistent Volumes**. Local `/data/auth` is ephemeral:
  reschedule/redeploy may lose the linked session; Koyeb says local data can disappear
  at any moment, including automatic upgrades at least weekly. Re-pairing may be needed.
- Changing environment settings (including later enabling the downloader) can redeploy
  and lose auth on Free. **File mode does not guarantee durable sessions or survival of the transition to
  downloader mode.** The optional encrypted Postgres adapter below can retain auth
  externally when configured; hosting uptime and database quotas still need review.
  No paid tier, external secret upload, or additional resource has been selected.
- Single replica/process only. Free's low CPU/memory and cold starts have not been load
  tested with this app; Koyeb itself says Free is not for production.

### Beginner deployment steps (you perform these; nothing deployed by this change)

1. Connect this GitHub repository in Koyeb, choose **Web Service → Free** and
   Dockerfile build. Select **`feat/nandhana-chatbot`** while PR #1 is unmerged: `main`
   is only the bootstrap. Do not accidentally select a paid instance.
2. Expose HTTP port **8000**, route `/`, health check **HTTP `/healthz`**. The container
   listens on `0.0.0.0` and honors `PORT` (default 8000). Use the generated HTTPS domain.
3. Set `PORT=8000`,
   `PUBLIC_ORIGIN=https://YOUR-SERVICE.koyeb.app` (exact origin, no path),
   `WEB_OWNER_USERNAME` (letters/digits/underscore/hyphen), and **secret**
   `WEB_OWNER_PASSWORD` in Koyeb's secret settings. Add secret `DATABASE_URL` and
   `AUTH_ENCRYPTION_KEY` as described below; leave `SESSION_ID` blank for first pairing. Choose your own unique random
   password, at least 24 characters, 3 character classes and 10 distinct characters;
   32+ is recommended. No password/token is supplied in this repository.
   If the generated domain is only known after creation, set the origin then redeploy;
   missing/invalid owner settings intentionally refuse startup. Never place credentials
   in the domain, query string, Git, screenshots or deployment logs.
4. Open **`https://YOUR-SERVICE.koyeb.app/owner`**, sign in using browser Basic Auth,
   select QR or Phone code, and explicitly press **Start one pairing attempt**.
   Phone-code mode accepts your number only in this protected HTTPS form, digits with
   country code (no `+`). It is not logged or saved in a separate phone input file.
   After deploying an update, reopen a fresh `/owner` page before submitting; do not
   refresh/resubmit an old `/owner/start` POST (its CSRF session may be stale).
   On your phone use WhatsApp → Linked devices → Link a device (scan QR), or
   **Link with phone number instead** (enter the privately displayed code).
5. Watch authenticated status: `paired` requires actual socket-open and saved identity.
   Each attempt is at most 180 seconds/six QR emissions; a single documented post-scan
   restart is allowed. No network-error retries. Failures need a separate explicit
   owner action, not a session reset; existing keys are never deleted automatically.
6. After durable `paired` success, copy the displayed nonsecret ID. Optionally press
   **Send my session ID to my linked number**: this separate authenticated confirmation
   makes one bounded auth-only reconnection and sends just that ID to the socket's own
   verified WhatsApp account. No arbitrary recipient or message input is accepted.
   Save the ID in Koyeb as `SESSION_ID`, keeping the same database and encryption key.
   An ID is only a selector, not a login token or replacement for either secret.
7. **Pairing/restarts never activate the downloader.** Configure `ALLOWED_CHATS`, then
   press **Start downloader** in `/owner` after every deployment/restart. Allowlisted
   senders must still `/start` to consent. **Stop downloader** releases its socket
   before another pairing/notice action. Do not run another bot/CLI process alongside it.

### Web privacy and operational boundaries

- `npm run web` (Docker default) serves generic public `/` and `/healthz`; neither
  exposes session/bot connection state. HTTP health only means the web server responds,
  **not** that WhatsApp is linked. No WhatsApp socket starts at web startup; Postgres schema readiness is checked first.
- Every `/owner` route, private QR PNG and generic owner status requires authentication.
  QR/code stay in memory, delivered only to the owner with `no-store`; no public file
  server, `.pairing`/auth-directory browsing, query-string secrets or request logging.
  UI polls every 3 seconds while active and clears material on terminal states; a
  nonce-authorized browser timer clears it by the deadline even if the server disappears.
  Never scan/use stale material or screenshots; close the owner tab after linking.
- Explicit POST actions require exact `Origin`, canonical Host, session-bound CSRF token,
  Secure/HttpOnly/SameSite=Strict cookie and bounded input. No GET starts a pairing attempt.
  Strong required Basic credentials use timing-safe hashed comparison. CSP, anti-frame,
  HSTS applies; owner HTML uses `Referrer-Policy: same-origin` so normal form POSTs
  retain their Origin. Other responses keep `no-referrer`. Koyeb's HTTPS proxy must be the only public entry:
  `X-Forwarded-Proto` is trusted solely for that proxy hop; never expose the plain Node
  port directly or allow untrusted clients to spoof proxy headers.
- Authentication failures and owner traffic are bounded/rate-limited by direct peer,
  ignoring spoofable forwarded IPs. A shared proxy can cause owner lockout for 10 minutes
  after 5 failures/300 requests; this conservative guard is not a WAF or DDoS solution.
  Browser Basic credentials can remain cached until the browser closes. Do not use a
  shared browser profile. Rotate owner credentials through deployment secrets if exposed.
- Web linking reuses the auth-only lifecycle: no chat/inbox/history/send handlers.
  New auth files are owner-only; multi-file Baileys auth is still a prototype store.
  Shared `.session.lock` prevents CLI/web/downloader overlap on the same directory.
  SIGTERM releases it; after a hard crash a stale lock intentionally refuses startup.
  Only after verifying **all** session users are stopped may the operator remove that
  lock file (never auth keys). Multiple replicas, rolling overlap, symlinked auth paths
  or concurrent filesystem modification are unsupported. Persistent-volume ownership
  would need to permit the container's non-root `node` user; Free has no volume support.
- Docker's explicit allowlist copies only package manifests/source, not `.env`, auth,
  `.pairing`, Git, tests or private files. `npm ci --ignore-scripts` uses locked packages;
  the public libsignal Git dependency is fetched over HTTPS without Git credentials.
  Docker build/Koyeb proxy/live pairing were not integration-tested here.

Official Koyeb sources (checked for this change):
[Free instances](https://www.koyeb.com/docs/reference/instances),
[idle/sleep rules](https://www.koyeb.com/docs/run-and-scale/scale-to-zero),
[ephemeral local storage](https://www.koyeb.com/docs/reference/storage),
[Volumes](https://www.koyeb.com/docs/reference/volumes),
[PORT/routes](https://www.koyeb.com/docs/build-and-deploy/exposing-your-service),
[health checks](https://www.koyeb.com/docs/run-and-scale/health-checks),
[Git deployment](https://www.koyeb.com/docs/build-and-deploy/deploy-with-git).

## Optional encrypted Postgres auth storage (Neon / Lakebase Postgres)

**Code is ready; no production database was connected, provisioned or migrated here.**
You supply your own secrets in Koyeb. A configured `DATABASE_URL` automatically selects
Postgres; otherwise file storage is used. Remove any old `AUTH_STORE=file` override
when using the database. No provider CLI or extra authentication product
is needed. Existing file sessions are never imported or deleted automatically.

### Owner setup (one database URL)

1. **Rotate any database password previously pasted into chat** before configuring it.
2. Supply secret **`DATABASE_URL`**, preferably your provider's direct Postgres URL,
   and secret **`AUTH_ENCRYPTION_KEY`** (64 hex characters / 32 random bytes).
   The same URL is used for schema setup and runtime. A transaction pooler is accepted
   if it supports the SQL/DDL, but a second URL is never required. TLS certificate
   verification cannot be disabled. Keep the encryption key unchanged across deployments
   and back it up separately; changing it cannot decrypt old sessions.
3. Keep `PUBLIC_ORIGIN`, `WEB_OWNER_USERNAME`, secret `WEB_OWNER_PASSWORD`, `PORT=8000`.
   `SESSION_ID` is **blank for new pairing**. Explicit owner pairing generates a random
   UUID and reveals it only after credentials are saved and the connection verified.
   Configure that displayed ID as `SESSION_ID` to select it on later deployments.
   Existing IDs (1–64 letters/digits/underscore/hyphen) remain compatible. Unknown IDs
   fail closed instead of creating/replacing a session. The ID alone grants no access.
4. `npm start` / Docker applies the additive, transactional, version-checked schema
   before serving HTTP. It touches only the three `nandhana_auth_*` tables; no drops,
   credential import or breaking data migration. Its transaction-scoped migration lock
   prevents overlapping DDL; runtime still uses row leases/fencing. The database role
   must have schema/table setup permissions. `npm run db:migrate` remains optional and
   uses the same URL. Database/schema failure refuses startup rather than falling back.
5. Pair at `/owner`; optionally confirm the self-notification, save `SESSION_ID`, then
   configure `ALLOWED_CHATS` and explicitly press **Start downloader**. One replica only.
   Existing sessions reconnect only on an owner action, never automatically on restart.

Generate the encryption key privately on your own computer without printing it:

```sh
node -e 'const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");const dir=path.join(os.homedir(),".config","nandhana");fs.mkdirSync(dir,{recursive:true,mode:0o700});const fd=fs.openSync(path.join(dir,"auth-encryption-key.txt"),"wx",0o600);fs.writeFileSync(fd,crypto.randomBytes(32).toString("hex"));fs.closeSync(fd)'
```

Privately transfer the file contents to deployment secrets. Never commit/share it.

### Session-ID notification boundaries

The post-pairing confirmation sends **only** `Nandhana session ID: <nonsecret ID>` to the
verified socket's own account, with no chat/history listeners or arbitrary-recipient API.
An encrypted, fenced database reservation permits **at most one attempt per session**,
including across restarts/concurrent clicks. `sent` means the library send resolved,
not a read receipt. Disconnect/timeout during a send is `unknown`; it is never retried
because delivery may already have occurred. Copy the displayed ID if notification fails,
is unavailable, or its outcome is uncertain. File mode does not support this notification.
No deployment, live message, pairing request or provider connection was performed here.

### Security, limits and migration boundaries

- AES-256-GCM records have a random 96-bit IV, authentication tag, version 1 and AAD
  bound to application/session/category/key ID. Credentials **and every Signal key
  category** are encrypted. BufferJSON restores binary data; app-state sync keys are
  reconstructed with the pinned Baileys protobuf helper. SQL is parameterized.
- Runtime uses `pg` with max **2 connections**, 5-second connect/query/statement bounds,
  idle eviction and TLS certificate verification enabled. It does not set
  `rejectUnauthorized:false` or offer a production insecure-TLS switch. The driver's
  URL `sslmode` is validated/removed before the explicit verifying TLS configuration
  is applied. Custom TLS-file/host overrides are rejected. Use a provider certificate
  trusted by Node; a custom CA requires separately reviewed trust configuration.
- A 30-second database row lease, 5-second heartbeat, monotonic local deadline and
  increasing fencing token coordinate CLI, web pairing and downloader across containers.
  Transactions lock/check ownership before reads/writes and commit; stale owners cannot
  overwrite a new owner's state or release its lease. Failure/expiry stops the socket
  and blocks further operations. Send callbacks recheck ownership; messages already in
  flight cannot be recalled or atomically fenced by an external WhatsApp server.
- This uses transaction-scoped row locks, **not session advisory locks**, so runtime
  queries support Neon's transaction pooler. Keep one replica: a lease is not a
  multi-replica bot design. After crash, wait up to 30 seconds for lease expiry. Batch
  operations cap at 1,000 keys and encrypted plaintext records at 1 MiB.
- Postgres startup connects only for schema setup, then releases the pool. No WhatsApp
  connection or session lease opens until an owner action. `/healthz` is web liveness,
  not continuing database/WhatsApp readiness. No retries or auto-reconnect on failure.
- Existing auth directories/keys are preserved untouched; there is **no automatic file
  import or deletion**. This change does not migrate an existing local linked identity.
  For a new database session, explicitly pair again and review old devices on your phone.
  A trustworthy file importer is deferred (Baileys filenames encode IDs lossily).
- Database persistence removes dependence on Koyeb's ephemeral auth files only when
  opted in/configured. It does not prevent Koyeb sleeping or keep WhatsApp online. Neon
  Free compute/egress quotas still apply; lease heartbeats during active sockets keep
  database compute active and can exhaust the free allowance. No free uptime SLA is promised.
- Backups should include encrypted records and a separately secured key. GCM detects
  ciphertext/record swaps, not malicious whole-database deletion or historical rollback.
  Database credentials and deployment secrets must remain private; table metadata/lease
  IDs are not encrypted. Never expose these tables through a browser-facing Data API.

### What was tested

`npm test` includes crypto/config, existing downloader/web/security regressions, and
isolated **PGlite (PostgreSQL in WASM)** tests using the real `pg` wire-protocol driver.
`npm run e2e` runs those database integration tests separately: process A writes synthetic
creds/Signal keys, process B restores bytes/protobuf data; contenders, fencing, rollback,
corruption, missing creds, wrong keys, lease renewal/loss and deletion are checked.
Tests never consume your database URL, auth files or phone/account identities.
The test-only loopback transport has no TLS; production has no such switch. PGlite's
single-connection multiplexer is **not** proof of native multi-client locking, Neon pooler
behavior, TLS handshakes, Koyeb deployment, or live WhatsApp integration. Native Postgres
server installation was unavailable (OS repository HTTP 500/signature errors); it was
not retried/bypassed. Live/native verification remains a separate owner step.

Official references: [Neon connections](https://neon.com/docs/connect/connect-from-any-app),
[pooling](https://neon.com/docs/connect/connection-pooling),
[node-postgres TLS](https://node-postgres.com/features/ssl),
[PGlite socket testing limits](https://pglite.dev/docs/pglite-socket).

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
npm run bot
```

Direct `npm run bot` prints `Downloader idle` and exits before importing the
WhatsApp library, creating auth state, requesting Pinterest, or sending anything.
Package installation contacts registry/Git hosts; tests/syntax checks are offline.

## Future activation — manual and owner-approved only

1. Review terms, download rights, privacy, host/network access and the limitations below.
2. Complete the **supervised QR or phone-code pairing workflow** described below. The main bot
   still refuses unregistered-session startup. Keep registered credentials in ignored `./auth` with owner-only permissions;
   custom `AUTH_DIR` must be outside this project. Never share session files or OTPs.
3. Set local `.env`: `ALLOWED_CHATS` to exact direct-chat JIDs (`digits@s.whatsapp.net`
   or `digits@lid`). Empty permits nobody; activation requires at least one. No contacts
   are discovered and number/LID forms are not aliased automatically.
4. Start the web service and explicitly press **Start downloader** in `/owner`.
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
  newsletters, incoming media and old history are ignored. No arbitrary unsolicited-send API; the only owner notice is the separately confirmed session ID.

## Modules

- `src/config.js`: disabled default, allowlist and validated limits.
- `src/copy.js`: fixed friendly Malayalam/English responses named Nandhana.
- `src/network.js`: URL policy, IP checks, DNS pinning, bounded redirects/deadlines.
- `src/pinterest.js`: schema/OG parser, capped HTML/media consumption, signatures/cleanup.
- `src/handler.js`: opt-in, commands, serialization/rate/resource limits, attachment flow.
- `src/main.js`: lazy Baileys adapter, restricted local auth, fresh events, shutdown.
- `src/web-*.js`: strict web config, protected owner HTTP UI, in-memory auth-only lifecycle.
- `src/auth-lock.js`: exclusive auth-directory ownership across CLI/web/downloader.

## Verification — distinguish fixtures from live access

Verified with Node 22.23.4: **offline tests passed (see current npm test output)**, syntax checks passed for
**all JavaScript files**, clean locked installation with scripts disabled succeeded,
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
SLA, malware scanner or native-Postgres production validation.

## Owner-supervised QR linking (auth only)

This local file-backend workflow is separate from the downloader. For new Postgres
sessions use the web owner screen above. With the owner present and explicitly approving
local file linking, run:

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

No inbox, chat, history, download or user-message send handlers are installed in pairing. Initial
queries, history requests, own-event emission and online presence are disabled, and all
chat JIDs are ignored. WhatsApp may still deliver auth-required protocol/notifications
internally; this app does not inspect, display, store or act on chat content. Auth uses
ignored `auth/`, owner-only directory permissions and umask 077 for session files.
The multi-file auth helper remains a prototype utility, not a production backend.

No downloader process is started by pairing. Linking does not
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

Pairing honors the same `AUTH_DIR` setting as the bot. A fresh owner-authorized session
can use a newly created private directory outside the repository while retaining old
session directories unchanged. Store this path only in ignored local `.env`, and
never run multiple attempts concurrently. Changing session
paths does not revoke an old linked device; review Linked devices on the phone separately.

## Optional phone-number linking code (prepare only until owner supplies number)

Documented method: https://baileys.wiki/authentication/pairing-code . Pinned Baileys
6.7.24 exposes `socket.requestPairingCode(phoneNumber)`. It must be invoked after the
first QR readiness event, not immediately at socket construction. Code mode suppresses
QR rendering and makes **at most one code request**, without error retries.

The owner must supply their WhatsApp number through the supervised private input flow.
Never put a real phone number in a command argument, source, test, terminal output, PR,
or chat. The approved input mechanism is `.pairing/phone.txt`: a regular non-symlink,
single-link, owner-owned file with permissions **0600**, at most 32 bytes, containing
country code + number as 8–15 digits without `+`, spaces or punctuation. This ignored
private file must be populated only through the authorized private input mechanism.
Do not run the command until the owner has supplied the number; a missing/invalid file
results in generic `phone_input_required` **before any WhatsApp connection**.

```sh
npm run pair -- --owner-approved --phone-code
```

No phone value is present in that command. The returned private 8-character code is
shown **only** on the same private refreshing `.pairing/index.html` screen, never in
status JSON, stdout/stderr, chat or a public URL. Parent/assistant must not read/screenshot
that page into context. Owner selects WhatsApp → Linked devices → Link a device →
Link with phone number instead, then enters the private displayed code. Do not share it.
A code request can trigger a WhatsApp linking notification; it is an authentication
operation, not permission to send chat messages. This option has only offline mock tests
until the owner explicitly provides their phone and a live request is authorized.

The phone-input file remains private locally; securely remove it after linking via the
owner-approved cleanup workflow. Do not delete session directories. All auth-only guards,
180-second deadline, one post-scan restart and bot-disabled behavior still apply.
