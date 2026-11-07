# Nandhana — WhatsApp AI chat prototype

An original, small Node.js app inspired by the *idea* of a linked-device WhatsApp bot.
No reference repository source is copied or executed. **Nandhana** is the configurable
default: a warm, playful feminine **AI persona, not a human**. General conversation,
not a business/order support agent. The prompt follows English, Malayalam, and Manglish;
actual fluency and safety depend on the model you select and need human evaluation.
Every model reply is visibly prefixed `Nandhana (AI):` (or your configured name).

## Safety and current state

**Disabled by default. No WhatsApp account has been linked and no live AI/WhatsApp
integration is verified.** No bulk/unsolicited-send interface, campaigns, groups,
status replies, media download, tools, browsing or deployment configuration is included.
The only send path replies to an incoming, allowlisted direct chat. A sender must use
`/start` before their conversation is passed to the AI provider. First contact explains
AI identity and data sharing. Restart or consent TTL expiry requires opt-in again.

Baileys is an **unofficial WhatsApp Web linked-device library**, not Meta's official
WhatsApp Business Cloud API. It is not affiliated with WhatsApp. Protocol changes can
break it, and use can violate WhatsApp terms or risk account restrictions. Review terms
and customer consent requirements; consider the official platform for business deployment.
Do not use this prototype with customers until reviewed and tested on an approved account.

## Prerequisites

- Node.js **22 or newer** (tests also initially exercised on Node 20.19.2; use supported Node 22+).
- npm and Git (Baileys' transitive `libsignal` dependency comes from GitHub).
- A provider supporting HTTPS **OpenAI-compatible `/chat/completions`**, system messages,
  `max_tokens`, and string `choices[0].message.content`. No model or provider is assumed.
- A separately provisioned, owner-approved registered Baileys linked-device session.
  **This build deliberately does not include a linking command**: it will not emit QR
  or pairing codes, and refuses startup with unregistered credentials. Owner-supervised
  linking must be implemented/reviewed as a separate step before the first live use.
  Never send session files, OTPs or tokens in chat or commit them.

## Offline setup (does not connect)

```sh
npm ci --ignore-scripts
cp .env.example .env
npm test
npm run check
npm start
```

The last command prints `Bot disabled` and exits while `BOT_ENABLED=false`; it does not
import the WhatsApp library, create auth files, call the provider or send anything.
Dependency installation contacts package/Git hosts; tests and syntax checks do not.
`--ignore-scripts` avoids dependency lifecycle scripts. Installation/import smoke checks
are not a substitute for a live linked-device test.

## Future activation — intentionally manual

Do not activate as part of a code review. After owner-approved session setup and privacy review:

1. Keep a registered session in ignored `./auth`, permissions restricted to its owner.
   Custom `AUTH_DIR` must be outside the project. Do not use a shared or public machine.
2. Configure `.env` locally using your provider's current documentation:
   - `AI_BASE_URL`: HTTPS API version root (often ending `/v1`), without credentials/query/fragment.
   - `AI_MODEL`: an actual available model identifier chosen by the owner; no default.
   - `AI_API_KEY`: that provider's key; no default. Never log or commit it.
   - `ALLOWED_CHATS`: exact direct-chat IDs, comma-separated (`digits@s.whatsapp.net`
     or `digits@lid`). Empty means nobody; activation requires at least one.
   - `BOT_NAME=Nandhana` is the default, configurable without changing source.
3. Only after authorization, set `BOT_ENABLED=true` and run `npm start`.
4. An allowlisted sender first reads the notice, then sends `/start` to consent.
   Test a small private conversation. Review Malayalam/Manglish quality and AI identity.

This app does not discover IDs, export contacts, message people proactively, or handle
credentials on your behalf. Both phone-number and LID forms are accepted but not aliased:
if WhatsApp changes the ID form, allowlisting/consent/history must be set for the new ID.
Do not claim this is deployed or ready to answer customer messages yet.

## Commands

- `/help`: bilingual help and AI identity, locally generated.
- `/start`: opt into sending subsequent chat content/context to the configured AI provider.
- `/reset`: clear this chat's local in-memory conversation; consent remains.
- `/stop`: opt out and clear local history. Processed even when rate-limited.

Commands are case-insensitive. They are not sent to the AI. `/stop` follows any already
queued message in the same chat; it cannot recall a request or reply already sent.
`/reset` and `/stop` do **not** delete WhatsApp or provider-side records.

## Architecture and bounds

- `src/config.js`: strict configuration, disabled default, required allowlist/provider on activation.
- `src/persona.js`: transparent Nandhana persona, language instructions, bilingual local copy.
- `src/handler.js`: dependency-injected handler; only plain direct text, per-chat promise
  serialization, deduplication, consent, commands, history/TTL, throttling and reply handling.
- `src/ai.js`: injected fetch adapter, HTTPS config, forbidden redirects, abortable timeout,
  64 KiB response cap and checked response shape. No retry that might duplicate billing.
- `src/main.js`: lazy Baileys adapter; registered-session-only startup, fresh notify events
  only, silent library logger, serialized auth saves and signal/disconnect shutdown.

Defaults: 2,000 input chars; 2,000 output Unicode codepoints (plus AI prefix); 6 prior
turns/chat; 100 chat records; 30-minute idle expiry; 6 accepted messages/minute/chat.
Hard caps: 10 queued messages/chat, 100 queued globally, 4 simultaneous AI requests,
2,000 dedupe IDs retained for at most five minutes. Excess traffic/capacity is silently
ignored to avoid reply storms. Opt-out acknowledgments are not rate-limited. Rate limits,
TTL and history settings are documented in `.env.example`; they are not a spending budget.
Memory is bounded and ephemeral; there is no conversation database. Delivery dedupe is
best-effort (bounded, in-memory), not exactly-once delivery. Received data must briefly
exist in memory even if rejected. AI providers may impose different token/context limits.

## Privacy, reliability and limitations

Chat text/recent context go only to the chosen AI endpoint after opt-in; no user IDs are
included in its request body. The provider may retain/process data under its own terms.
Inform users of the real provider and retention policy before activation; never promise
end-to-end confidentiality once messages are sent to an AI service. Do not solicit secrets.
Application logs contain fixed lifecycle/error event labels, not message bodies, IDs,
session data, provider bodies or tokens. Do not enable dependency debug logging.

Auth files are powerful credentials; `.gitignore`, restrictive permissions and local-only
storage are safeguards, not encryption. The Baileys multi-file auth helper is a prototype
utility, not a recommended production/high-concurrency session backend. One process only.
On disconnect, startup/session error or expired linking, manually inspect/restart; there
is no reconnect storm or automatic re-pairing. SIGINT/SIGTERM abort in-flight AI work,
suppress late replies, drain processing and close the socket without logging out.
No SLA, monitoring, spend cap, production consent ledger, content moderation service or
human escalation system is included. Prompt instructions cannot guarantee safe model
behavior; the visible AI prefix prevents an unlabeled model response but cannot guarantee
that every generated sentence follows identity/safety rules.

## Dependencies and verification

Pinned direct dependencies: `@whiskeysockets/baileys@6.7.24` (registry **legacy** tag at
inspection, chosen instead of 7.0 release candidate API), `pino@9.6.0`, with lockfile.
Transitive versions/Git commit are recorded in `package-lock.json`. Reassess the legacy
release and upstream guidance before any live connection. Package audit results are
point-in-time advisories, not a security guarantee.

References checked during implementation:
- https://registry.npmjs.org/@whiskeysockets%2fbaileys/6.7.24
- https://github.com/WhiskeySockets/Baileys (auth, events and WebSocket API)
- https://registry.npmjs.org/baileys/latest (upstream disclaimer and examples)
- https://github.com/adithyanlabs/wabot (inspiration only; no code reused)

Verified locally with Node 22.23.4: **31/31 offline tests passed**, syntax checks
passed for **7 JavaScript files**, locked install with scripts disabled succeeded, and
Baileys import/export smoke check passed without creating a socket. `npm audit` reported
**0 known vulnerabilities** for this lockfile at inspection (not a security guarantee).

`npm test` uses mock AI/send/fetch adapters; no real messaging or AI requests.
`npm run check` checks every source/test/check-script JavaScript file for syntax.
Offline tests cannot verify WhatsApp protocol compatibility, model availability,
real credentials, delivery, language quality, billing behavior or hosted reliability.
