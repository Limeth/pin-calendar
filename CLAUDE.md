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

`automerge-diy-vue-hooks` replaces the proxies of changed subtrees on every change, so an entry read
earlier (e.g. `docLocal.value.remotePeers[id]`) keeps its old values. Read entries fresh from the
`Ref` after any change or `await`, copy values before overwriting an entry, and do not pass entries
along to be read later (e.g. a peer's key is looked up when a handshake needs it, not when
connecting). `changeSubtree` on an entry read earlier throws if the entry has since been moved,
replaced or deleted.

## Vue reactivity and remote-controlled keys

- Vue does not track `Object.hasOwn`. In watchers and computed values, use `in` or `Object.keys`.
- Outside reactivity, use `Object.hasOwn` for keys chosen by a remote peer (invite thumbprints,
  PeerJS peer IDs): `in` also matches inherited properties, such as `toString`.

## Data written by other devices and versions (`validation.ts`)

- Documents and local storage may hold anything, written by other devices, tabs or versions of the
  app. Their schemas define the types data is written with (`Static<typeof ...Schema>`), but data is
  read unchecked (`Unchecked`, `UncheckedRop`): values via getters that check them against the
  schema (`readProperty`, `readEntry`, `readEntryRop`), objects only after `isObject`, and arrays as
  a whole.
- The unit that is checked is one entity, e.g. a pin, a category, a day or a remote peer. An invalid
  one is ignored where it is read, e.g. left out of lists, and kept as it is.
- Invalid data is never corrected automatically. Only a user's action replaces it, e.g. renaming,
  clearing, joining again or forgetting a peer, or a migration to a new schema version.
- Functions that change data read the existing data via the getters, so that invalid data cannot
  make a change fail halfway.
- Check data that is saved back with `Value.Check` (`readValue`), not `Value.Parse`, which removes
  properties unknown to this version and converts values. Data that is not saved back as it was
  read, e.g. invite links and imported files, may be parsed.
- Every module defining a schema with a string format imports `formats.ts`.

## Schema versions (`versioned.ts`)

- Documents, local storage and exported files hold their data by schema version:
  `{ schemaVersion: { "<n>": ... } }`. This container is permanent, so that every version of the app
  recognizes it. `VersionedSchema` checks only the container; readers check the current version.
- Version keys are canonical integers. Any other key is ignored.
- Versions are never removed from synchronized storage (documents, and local storage, which tabs
  share), as other devices or tabs running older versions of the app may still use them.
- The current version is only created (`init`) when there are no versions at all. When there are
  only older versions (`outdated`), they are to be migrated from; see its TODO for the process that
  migrating a shared document requires.
- Data that is not saved back as it was read, e.g. imported files, is read via `parseCurrentVersion`.
- When data has a schema version newer than this version of the app, the app is outdated: it shows
  the data's current version, if there is one, read-only, so that it stays as other devices or tabs
  running this version left it, and asks the user to refresh the page (`NewerVersionAlert`).
- Every GUI control that changes a document is disabled while the document is read-only
  (`VersionedDocumentWrapper.readOnly`, see `hasNewerVersionRop`), and its handler returns early.
  The same applies to the calendar list (`LocalStorageDataIsReadOnly`), which is then never saved.
  Viewing, browsing and exporting stay possible. Add this to every new control that changes data.
- Writes outside the GUI, e.g. by the WebRTC code, are not blocked.

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

- The shared worker's entry (`workers/sharedRepo.ts`) sets `onconnect` before it imports the worker's
  code (`workers/sharedRepoMain.ts`) dynamically, as Chrome loses `connect` events dispatched while
  the Automerge WASM module loads. It must not import anything else.
- The shared worker runs the WebRTC network adapter in one tab per
  calendar, and moves it to another tab when that tab stops responding. Other tabs reach the
  adapter through the ephemeral document, e.g. `outgoingJoins`.
- The local document is the source of truth for a calendar's peers. The invitation in local storage
  is only applied when the local document is created.
- The calendar list in local storage is synced between tabs via `storage` events.

## Calendar names

- A calendar's name is in the shared document, so it is the same on all of its devices. Its alias is
  local to a device, in the local document.
- Each calendar's `cache` in local storage holds data derived from its documents, such as copies of
  its name and alias, so that they can be shown without loading the calendar, e.g. in the calendar
  list. Local storage is never the source of truth for a calendar's data. The cache is updated
  whenever the calendar is loaded (`LoadApp`), so it may be outdated.

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
- Test files run in parallel, the tests of a file one after another, and each file has its own
  fake network. Put tests that wait long (e.g. for timeouts) in a file of their own.
- PeerJS peer IDs are UUIDs, as the local document requires, derived from readable names via
  `peerId`.
- The shared worker's code runs in the tests (`SharedRepoWorker`, `sharedWorker.ts`): tabs are
  connected to it via `MessageChannel`s, with short polling intervals and their own IndexedDB
  database. Its entry (`workers/sharedRepo.ts`), `LoadApp` and Vue components are not covered;
  check them in a browser.
- CI (`.github/workflows/check.yml`) runs only on pushes to `master` and `deploy`.

## Conventions

- Dependencies are pinned to exact versions.
- Commit messages have a short title and a brief description.
- Commit messages do not contain a `Co-Authored-By` field mentioning the specific AI model used.
