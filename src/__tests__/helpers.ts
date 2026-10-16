import type { Ref } from 'vue';
import { Repo } from '@automerge/automerge-repo';
import { changeSubtree, makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import * as auth from '@/auth';
import { WebRtcNetworkAdapter } from '@/webrtc';
import type { LocalDocument, RemotePeer } from '@/documents/local';
import type { EphemeralDocument } from '@/documents/ephemeral';
import type { HashArgsAddPeer } from '@/hash';
import type { Peer } from './fakes/peerjs';

export const CALENDAR_ID = '01a14000-0000-7000-8000-000000000001';
export const OTHER_CALENDAR_ID = '01a14000-0000-7000-8000-000000000002';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wait until the condition holds, and return whether it did before the timeout.
export async function until(condition: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < timeoutMs; await sleep(25))
    if (condition()) return true;

  return condition();
}

// A real Automerge document, made reactive like in the app.
export function reactiveDocument<T>(initial: T): Ref<Rop<T>> {
  const repo = new Repo({ network: [] });
  return makeReactive(repo.create<T>(initial)) as unknown as Ref<Rop<T>>;
}

export function localDocument(
  peerJsPeerId: string,
  remotePeers: Record<string, RemotePeer> = {},
  documentIdShared = 'shared-document',
): Ref<Rop<LocalDocument>> {
  return reactiveDocument<LocalDocument>({
    localPeer: { deviceName: '', peerJsPeerId },
    remotePeers,
    documentIdShared,
  });
}

export function ephemeralDocument(): Ref<Rop<EphemeralDocument>> {
  return reactiveDocument<EphemeralDocument>({
    connectedPeers: {},
    invites: {},
    outgoingJoins: {},
  });
}

export type Device = {
  adapter: WebRtcNetworkAdapter;
  docLocal: Ref<Rop<LocalDocument>>;
  docEphemeral: Ref<Rop<EphemeralDocument>>;
  // The fake PeerJS peer of the adapter.
  peer: () => Peer;
};

// A device of the calendar, with a started WebRTC network adapter. A passive device does not
// connect to peers by itself, so that a test can check that the other device does.
export function device(
  peerJsPeerId: string,
  remotePeers: Record<string, RemotePeer> = {},
  options: { passive?: boolean; documentIdShared?: string } = {},
): Device {
  const docLocal = localDocument(peerJsPeerId, remotePeers, options.documentIdShared);
  const docEphemeral = ephemeralDocument();
  const adapter = new WebRtcNetworkAdapter({
    calendarId: CALENDAR_ID,
    docLocal,
    docEphemeral,
    attemptToWaitForDocumentAvailability: undefined,
  });
  adapter.on('peer-candidate', () => {});
  adapter.on('peer-disconnected', () => {});

  if (options.passive) adapter.connectToRemotePeer = () => {};

  adapter.connect(`automerge-${peerJsPeerId}` as never, {});
  return { adapter, docLocal, docEphemeral, peer: () => adapter.peer as unknown as Peer };
}

// The devices created by `started`, which `stopStartedDevices` stops.
const startedDevices: Device[] = [];

// A device, see `device`, which is stopped after the test, see `stopStartedDevices`.
export function started(...args: Parameters<typeof device>): Device {
  const created = device(...args);
  startedDevices.push(created);
  return created;
}

// Stop the devices created by `started`, to be called after each test that uses it.
export function stopStartedDevices() {
  for (const { adapter } of startedDevices.splice(0)) adapter.disconnect();
}

// A remote peer of a device, known by the given authentication key.
export function remotePeer(authKeyId: string): RemotePeer {
  return { deviceName: '', authKeyId };
}

export function isConnected(device: Device, peerJsPeerId: string): boolean {
  return device.adapter.connections[peerJsPeerId] !== undefined;
}

// Two authentication keys, of two peers paired with each other, as after joining.
export async function pairedKeys(): Promise<[string, string]> {
  const [a, b] = [await auth.generateEcdhKeyPair(), await auth.generateEcdhKeyPair()];
  return [
    await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw),
    await auth.establishAuthenticationKey(b.privateKey, a.publicKeyRaw),
  ];
}

// Whether two keys are the same, judged by a handshake signature.
export async function isSameKey(keyIdA: string, keyIdB: string): Promise<boolean> {
  const [keyA, keyB] = [await auth.loadAuthKey(keyIdA), await auth.loadAuthKey(keyIdB)];

  if (keyA === undefined || keyB === undefined) return false;

  const transcript = testTranscript();
  const signature = await auth.signHandshake(keyA, 'initiator', transcript);
  return await auth.verifyHandshake(keyB, 'initiator', transcript, signature);
}

export function testTranscript(): auth.HandshakeTranscript {
  return {
    challengeInitiator: auth.generateChallenge(),
    challengeResponder: auth.generateChallenge(),
    fingerprintsInitiator: 'sha-256 AA',
    fingerprintsResponder: 'sha-256 BB',
  };
}

export type Invite = {
  secret: auth.InviteSecret;
  args: HashArgsAddPeer;
};

// Create an invite on the inviting device, like the invite dialog does.
export async function createInvite(
  inviter: { docEphemeral: Ref<Rop<EphemeralDocument>> },
  inviterPeerJsPeerId: string,
  calendarId = CALENDAR_ID,
): Promise<Invite> {
  const secret = await auth.generateInviteSecret();

  inviter.docEphemeral.value.invites[changeSubtree]((invites) => {
    invites[secret.thumbprint] = { secretString: secret.string };
  });

  return {
    secret,
    args: {
      action: 'addPeer',
      secret: secret.string,
      peerJsPeerId: inviterPeerJsPeerId,
      calendarIdTag: await auth.calendarIdTag(secret, calendarId),
    },
  };
}
