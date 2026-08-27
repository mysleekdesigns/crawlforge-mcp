# Web Bot Auth signing key — generation and rotation

The Ed25519 key that signs CrawlForge's outbound requests (RFC 9421, `web-bot-auth`
profile). The private half signs; the public half is published at
`https://crawlforge.dev/.well-known/http-message-signatures-directory` so a site owner
can verify a request really came from us.

Item 0.10 of `VERTICAL_COVERAGE_PLAN.md`.

## Where the key lives

| Half | Variable | Set on | Notes |
|---|---|---|---|
| Private | `CRAWLFORGE_SIGNING_KEY` | Render (MCP server) | PKCS#8 PEM, or base64 of that PEM. **Secret.** |
| Public | `WEB_BOT_AUTH_PUBLIC_KEYS` | Vercel (website) | SPKI PEM. Published as-is. |
| Directory URL | `WEB_BOT_AUTH_DIRECTORY` | Render (optional) | Advertised in the `Signature-Agent` header. |

**No key material belongs in the repository, in a `.env` file that is committed, or in a
log line.** `scripts/generate-signing-key.mjs` prints to stdout and writes nothing to
disk for exactly this reason.

## Generate

```bash
node scripts/generate-signing-key.mjs
```

It prints the key id, the private key (base64 PEM) and the public key (PEM). That output
is the only copy.

## Order of operations — publish before you sign

Always set the **public** key on the website first and confirm the directory serves it,
*then* set the private key on the MCP server.

Doing it the other way round means we sign with a key id no verifier can resolve. A
verifier that fetches the directory and does not find the key may cache that failure for
the directory's `max-age` (24h), so a few seconds of impatience can cost a day of
requests being treated as unsigned.

1. Set `WEB_BOT_AUTH_PUBLIC_KEYS` on Vercel; redeploy.
2. Confirm the key id appears:
   ```bash
   curl -s https://crawlforge.dev/.well-known/http-message-signatures-directory | jq '.keys[].kid'
   ```
3. Set `CRAWLFORGE_SIGNING_KEY` on Render; redeploy.
4. Confirm requests carry `Signature` and `Signature-Input` headers.
5. Record the date in the log at the bottom of this file.

## Rotate

Rotation is the same sequence with an overlap. Both keys are published at once so
in-flight signatures made with the old key still verify.

1. Generate a new pair.
2. Add the new **public** key alongside the existing one in `WEB_BOT_AUTH_PUBLIC_KEYS`;
   redeploy the website. Both key ids now resolve.
3. Wait out the directory cache — at least 24 hours (`max-age=86400`), longer if you
   want to be sure intermediaries have expired it.
4. Swap `CRAWLFORGE_SIGNING_KEY` to the new private key; redeploy the MCP server. New
   requests sign with the new key id.
5. After a further 24 hours, remove the old public key from the website and redeploy.
6. Log both dates below.

Rotate on a fixed schedule, and immediately on suspected compromise.

## If the key is compromised

The draft's guidance, and ours: stop using it immediately — do not wait for the graceful
overlap.

1. Unset `CRAWLFORGE_SIGNING_KEY` on Render and redeploy. Requests go out unsigned;
   nothing breaks, because signing is opt-in by construction.
2. Remove the compromised public key from `WEB_BOT_AUTH_PUBLIC_KEYS` and redeploy the
   website, so the directory stops vouching for it.
3. Generate a fresh pair and follow *Generate* above.
4. If the key was used to sign traffic we did not send, tell affected site owners. A
   signature is a claim of identity; someone else making it in our name is exactly the
   thing this mechanism exists to prevent.

Note the compromised key id here permanently — never reuse it.

## Why a key can only ever do one job

The architecture draft is explicit that reusing a signing key across purposes is harmful,
and that a key must not be tied to an individual person. This key represents CrawlForge
the service. If we ever run a second agent that needs its own identity, it gets its own
key and its own directory entry — not a share of this one.

## Log

| Date | Key id | Event |
|---|---|---|
| _(none yet)_ | | Key not generated — 0.10 is pending the owner running the script. |
