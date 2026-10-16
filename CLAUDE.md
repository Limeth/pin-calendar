# pin-calendar

A local-first calendar, synchronized between a user's devices over WebRTC (PeerJS), using
Automerge documents. Devices are paired via invite links.

## Commands

- `npm run check`: type-check, lint, formatting check and build.
- `npm run test`: unit tests (Vitest). Not part of `check`; CI runs both, see below.
- `npm run format`: format with Prettier.
- `npm run dev`: dev server; the app is served under `/pin-calendar/`. `.claude/launch.json` starts
  a separate one on port 5180 for Claude's browser preview, as 5173 is usually already in use.

## Documents are snapshots

`automerge-diy-vue-hooks` replaces the whole proxy tree on every change, so an entry read earlier
(e.g. `docLocal.value.remotePeers[id]`) keeps its old values. Read entries fresh from the `Ref`
after any change or `await`, copy values before overwriting an entry, and do not pass entries along
to be read later (e.g. a peer's key is looked up when a handshake needs it, not when connecting).

## Vue reactivity and remote-controlled keys

- Vue does not track `Object.hasOwn`. In watchers and computed values, use `in` or `Object.keys`.
- Outside reactivity, use `Object.hasOwn` for keys chosen by a remote peer (invite thumbprints,
  PeerJS peer IDs): `in` also matches inherited properties, such as `toString`.

## Protocol and security (`auth.ts`, `handshake.ts`, `invite.ts`, `webrtc.ts`)

- Joining (invite) and connecting (paired peers) use the same mutual challenge-response handshake,
  see `HandshakeSignedData`. Signatures cover the signer's role, both challenges, and the DTLS
  fingerprints of both ends (channel binding against a signalling server in the middle).
- Every HMAC-signed value has its own `purpose` label (domain separation). Add a new one for any
  new kind of signed data, as the invite secret signs several kinds.
- The invite secret only travels in the invite link. Links identify the calendar by a calendar ID
  tag, never by its ID, see `auth.calendarIdTag`.
- Authentication key IDs are local to a device (IndexedDB keys); they are never sent.
- Unusable invites always get the same reply, so that it does not reveal whether an invite was
  used. Only the inviter logs the reason.
- A join is committed by the inviter only after the invitee's `join-confirm`; the invite is only
  reserved until then, see `JoinConfirmPacket`.
- Any change to packets or signed data requires all devices to be updated. There are no released
  versions yet, so no migrations of stored data or protocol versions are needed so far.
- `Uint8Array.prototype.toBase64`/`fromBase64` are used without a fallback, deliberately.

## Tabs and the shared worker

- The shared worker (`workers/sharedRepo.ts`) runs the WebRTC network adapter in one tab per
  calendar, and moves it to another tab when that tab stops responding. Other tabs reach the
  adapter through the ephemeral document, e.g. `outgoingJoins`.
- The local document is the source of truth for a calendar's peers. The invitation in local storage
  is only applied when the local document is created.
- The calendar list in local storage is synced between tabs via `storage` events.

## PeerJS behaviour relied upon

- Close connections via `closeConnection` (`util/peerjs.ts`, enforced by lint): a plain `close()`
  discards packets still in flight. Exception: `WebRtcNetworkAdapter.disconnect`.
- A plain `close()` emits `close` on the local end synchronously.
- Both ends of a connection share its `connectionId` (used to close spare connections).
- Connections to unreachable peers never end by themselves, hence the connection attempt timeout.
- `peer.reconnect()` only works on a disconnected, non-destroyed peer.

## Tests (`src/__tests__/`)

- Vitest, with real Automerge documents (`helpers.ts`), `happy-dom` and `fake-indexeddb`. Only
  PeerJS is faked (`fakes/peerjs.ts`), as WebRTC and the signalling server are not available, and
  tests need to cause network failures. Keep the fake's behaviour faithful to PeerJS.
- The shared worker and Vue components are not covered; check them in a browser.
- CI (`.github/workflows/check.yml`) runs only on pushes to `master` and `deploy`.

## Conventions

- Dependencies are pinned to exact versions.
- Commit messages have a short title and a brief description.
- Commit messages do not contain a `Co-Authored-By` field mentioning the specific AI model used.
