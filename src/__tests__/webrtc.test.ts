import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataConnection as PeerJsDataConnection } from 'peerjs';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import type { Message, PeerId } from '@automerge/automerge-repo';
import { WebRtcNetworkAdapter, type ConnectRequestPacket } from '@/webrtc';
import { forgetRemotePeer } from '@/peers';
import * as auth from '@/auth';
import type { RemotePeer } from '@/documents/local';
import { Peer, connectionPair, signalling, type DataConnection } from './fakes/peerjs';
import {
  CALENDAR_ID,
  OTHER_CALENDAR_ID,
  createInvite,
  device,
  ephemeralDocument,
  isConnected,
  isSameKey,
  localDocument,
  pairedKeys,
  sleep,
  until,
  type Device,
} from './helpers';

const devices: Device[] = [];
const adapters: WebRtcNetworkAdapter[] = [];

afterEach(() => {
  for (const { adapter } of devices.splice(0)) adapter.disconnect();
  for (const adapter of adapters.splice(0)) adapter.disconnect();
  vi.restoreAllMocks();
});

function started(...args: Parameters<typeof device>): Device {
  const created = device(...args);
  devices.push(created);
  return created;
}

const peer = (authKeyId: string): RemotePeer => ({ deviceName: '', authKeyId });
const message = (n: number) => ({ type: 'sync', data: new Uint8Array([n]) }) as unknown as Message;

// An adapter that is not connected to the fake network, with the given known peers, to which
// connections are passed directly, see `open`.
function unconnectedAdapter(...peerJsPeerIds: string[]) {
  const docLocal = localDocument(
    'local',
    Object.fromEntries(peerJsPeerIds.map((id) => [id, peer(`key-${id}`)])),
  );
  const docEphemeral = ephemeralDocument();
  const adapter = new WebRtcNetworkAdapter({
    calendarId: CALENDAR_ID,
    docLocal,
    docEphemeral,
    attemptToWaitForDocumentAvailability: undefined,
  });
  const events: string[] = [];
  adapter.on('peer-candidate', (event) => events.push(`candidate ${event.peerId}`));
  adapter.on('peer-disconnected', (event) => events.push(`disconnected ${event.peerId}`));
  adapters.push(adapter);
  return { adapter, docEphemeral, events };
}

// An open, authenticated connection to the given peer, carrying the given Automerge peer, as
// after a handshake.
function open(
  adapter: WebRtcNetworkAdapter,
  peerJsPeerId: string,
  automergePeerId: string,
): DataConnection {
  const [local, remote] = connectionPair('local', peerJsPeerId);
  local.emit('open');
  remote.emit('open');
  adapter.onConnectionOpened({
    dataConnection: local as unknown as PeerJsDataConnection,
    peerInfo: { automergePeerId, automergePeerMetadata: {} },
  });
  return local;
}

function sentMessages(connection: DataConnection): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(connection, 'send');
}

describe('connection tracking', () => {
  it('handles a peer reconnecting before its old connection is detected as closed', async () => {
    const { adapter, docEphemeral, events } = unconnectedAdapter('C');
    const old = open(adapter, 'C', 'automerge-C-old');
    const fresh = open(adapter, 'C', 'automerge-C-new');
    const [oldSent, freshSent] = [sentMessages(old), sentMessages(fresh)];

    adapter.send(message(1));
    expect(freshSent).toHaveBeenCalledTimes(1);
    expect(oldSent).not.toHaveBeenCalled();
    expect(docEphemeral.value.connectedPeers.C?.automergePeerId).toBe('automerge-C-new');

    old.close();
    await sleep(20);

    expect(events).toEqual([
      'candidate automerge-C-old',
      'candidate automerge-C-new',
      'disconnected automerge-C-old',
    ]);
    expect(docEphemeral.value.connectedPeers.C?.automergePeerId).toBe('automerge-C-new');
    adapter.send(message(2));
    expect(freshSent).toHaveBeenCalledTimes(2);
  });

  it('drops a connection to a peer that is not known', () => {
    const { adapter, events } = unconnectedAdapter();
    const connection = open(adapter, 'unknown', 'automerge-unknown');

    expect(adapter.connections.unknown).toBeUndefined();
    expect(events).toEqual([]);
    expect(connection.open).toBe(true); // Closed gracefully, once the remote peer acknowledges.
  });

  it('disconnects from all peers when the adapter disconnects', async () => {
    const { adapter, docEphemeral, events } = unconnectedAdapter('C', 'D');
    open(adapter, 'C', 'automerge-C');
    open(adapter, 'D', 'automerge-D');

    adapter.disconnect();

    expect(events).toEqual([
      'candidate automerge-C',
      'candidate automerge-D',
      'disconnected automerge-C',
      'disconnected automerge-D',
    ]);
    await sleep(20);
    expect(Object.keys(docEphemeral.value.connectedPeers)).toEqual([]);
  });
});

describe('spare connections', () => {
  it('are closed on both devices, keeping the same connection', async () => {
    // Both devices connected to each other: each sees the two connections in another order.
    const [aToB1, bToA1] = connectionPair('A', 'B');
    const [aToB2, bToA2] = connectionPair('A', 'B');
    for (const connection of [aToB1, bToA1, aToB2, bToA2]) connection.emit('open');
    const a = unconnectedAdapter('B');
    const b = unconnectedAdapter('A');
    const asPeerJs = (connection: DataConnection) => connection as unknown as PeerJsDataConnection;
    const info = (automergePeerId: string) => ({ automergePeerId, automergePeerMetadata: {} });

    a.adapter.onConnectionOpened({
      dataConnection: asPeerJs(aToB2),
      peerInfo: info('automerge-B'),
    });
    a.adapter.onConnectionOpened({
      dataConnection: asPeerJs(aToB1),
      peerInfo: info('automerge-B'),
    });
    b.adapter.onConnectionOpened({
      dataConnection: asPeerJs(bToA1),
      peerInfo: info('automerge-A'),
    });
    b.adapter.onConnectionOpened({
      dataConnection: asPeerJs(bToA2),
      peerInfo: info('automerge-A'),
    });
    await sleep(50);

    // The one with the smaller connection ID is kept.
    expect(a.adapter.connections.B?.map((c) => c.dataConnection.connectionId)).toEqual([
      aToB1.connectionId,
    ]);
    expect(b.adapter.connections.A?.map((c) => c.dataConnection.connectionId)).toEqual([
      bToA1.connectionId,
    ]);
    expect(aToB1.open && bToA1.open).toBe(true);
    expect(aToB2.open || bToA2.open).toBe(false);
    // Automerge is told about the other device once, and never that it left.
    expect(a.events).toEqual(['candidate automerge-B']);
    expect(b.events).toEqual(['candidate automerge-A']);
  });

  it('are not used for sending while they close', () => {
    const { adapter, docEphemeral, events } = unconnectedAdapter('B');
    const kept = open(adapter, 'B', 'automerge-B');
    const keptSent = sentMessages(kept);
    // The spare, with a larger connection ID, is the newest connection.
    const spare = open(adapter, 'B', 'automerge-B');
    const spareSent = sentMessages(spare);

    for (let n = 0; n < 3; n++) adapter.send(message(n));

    expect(keptSent).toHaveBeenCalledTimes(3);
    // Only the close marker is sent over the spare.
    expect(
      spareSent.mock.calls.every(([packet]: unknown[]) => '__peerData' in (packet as object)),
    ).toBe(true);
    expect(events).toEqual(['candidate automerge-B']);
    expect(docEphemeral.value.connectedPeers.B?.automergePeerId).toBe('automerge-B');
  });
});

describe('forgetting a peer', () => {
  it('disconnects both devices, and the forgotten one cannot reconnect', async () => {
    const [laptopKey, phoneKey] = await pairedKeys();
    const laptop = started('laptop', { phone: peer(laptopKey) });
    const phone = started('phone', { laptop: peer(phoneKey) });
    expect(await until(() => isConnected(laptop, 'phone') && isConnected(phone, 'laptop'))).toBe(
      true,
    );

    await forgetRemotePeer(laptop.docLocal, 'phone');

    expect(await until(() => !isConnected(laptop, 'phone') && !isConnected(phone, 'laptop'))).toBe(
      true,
    );
    expect(laptop.docEphemeral.value.connectedPeers.phone).toBeUndefined();

    phone.adapter.connectToRemotePeer('laptop');
    await sleep(500);
    expect(isConnected(laptop, 'phone') || isConnected(phone, 'laptop')).toBe(false);
  });

  it('drops a connection whose handshake completes afterwards', () => {
    const { adapter, events } = unconnectedAdapter();
    const late = open(adapter, 'forgotten', 'automerge-forgotten');

    expect(adapter.connections.forgotten).toBeUndefined();
    expect(events).toEqual([]);
    expect(late.open).toBe(true);
  });
});

describe('watchers', () => {
  it('are stopped when the adapter disconnects', async () => {
    const docLocal = localDocument('laptop');
    const docEphemeral = ephemeralDocument();
    const calls: number[] = [];
    const start = async (index: number) => {
      const adapter = new WebRtcNetworkAdapter({
        calendarId: CALENDAR_ID,
        docLocal,
        docEphemeral,
        attemptToWaitForDocumentAvailability: undefined,
      });
      vi.spyOn(adapter, 'performOutgoingJoins').mockImplementation(() => {
        calls.push(index);
      });
      adapter.connect('automerge-laptop' as PeerId, {});
      await until(() => adapter.peer?.open === true);
      return adapter;
    };

    for (let index = 0; index < 3; index++) (await start(index)).disconnect();
    const current = await start(3);
    adapters.push(current);
    await sleep(50);
    calls.length = 0;

    docEphemeral.value.outgoingJoins[changeSubtree]((joins) => {
      joins.x = {
        invite: { action: 'addPeer', secret: '', peerJsPeerId: '', calendarIdTag: '' },
        status: 'joined',
      };
    });
    await sleep(50);

    expect(calls).toEqual([3]);
  });
});

describe('reconnecting', () => {
  it('reconnects immediately after a connection drops', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started('a1', { b1: peer(keyA) });
    const b = started('b1', { a1: peer(keyB) }, { passive: true });
    expect(await until(() => isConnected(a, 'b1') && isConnected(b, 'a1'))).toBe(true);

    // A network failure closes both ends, without either adapter deciding to.
    a.adapter.connections.b1![0]!.dataConnection.close();
    expect(await until(() => !isConnected(a, 'b1'))).toBe(true);

    expect(await until(() => isConnected(a, 'b1') && isConnected(b, 'a1'), 1_500)).toBe(true);
  });

  it('retries a failed attempt until the other device is online', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started('a2', { b2: peer(keyA) });
    await sleep(300);
    expect(a.peer().connectCalls).toEqual(['b2']);

    const b = started('b2', { a2: peer(keyB) }, { passive: true });

    expect(await until(() => isConnected(a, 'b2') && isConnected(b, 'a2'), 6_000)).toBe(true);
  });

  it('reconnects to the signalling server, then to the peers', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const a = started('a3', { b3: peer(keyA) });
    const b = started('b3', { a3: peer(keyB) }, { passive: true });
    expect(await until(() => isConnected(a, 'b3'))).toBe(true);

    signalling.reachable = false;
    a.peer().loseSignalling();
    a.adapter.connections.b3![0]!.dataConnection.close();
    await sleep(500);
    expect(isConnected(a, 'b3') || a.peer().open).toBe(false);

    signalling.reachable = true;

    expect(await until(() => a.peer().open, 6_000)).toBe(true);
    expect(await until(() => isConnected(a, 'b3') && isConnected(b, 'a3'), 3_000)).toBe(true);
  });

  it('retries immediately when the device is back online', { timeout: 20_000 }, async () => {
    const [keyA] = await pairedKeys();
    const a = started('a4', { b4: peer(keyA) });
    await sleep(3_000);
    const attempts = a.peer().connectCalls.length;

    window.dispatchEvent(new Event('online'));
    await sleep(100);

    expect(a.peer().connectCalls.length).toBe(attempts + 1);
  });

  it('stops retrying forgotten peers, and when stopped', { timeout: 20_000 }, async () => {
    const [keyA] = await pairedKeys();
    const forgetting = started('a5', { b5: peer(keyA) });
    const stopping = device('a6', { b6: peer(keyA) });
    await sleep(300);

    await forgetRemotePeer(forgetting.docLocal, 'b5');
    stopping.adapter.disconnect();
    const attempts = forgetting.peer().connectCalls.length;
    await sleep(5_000);

    expect(forgetting.peer().connectCalls.length).toBe(attempts);
    expect(Object.keys(stopping.adapter.connectionRetries)).toEqual([]);
  });
});

describe('a peer whose ID is still taken', () => {
  // A peer holding the ID, like the peer of the previous WebRTC host tab, which is released later.
  async function holdId(peerJsPeerId: string): Promise<Peer> {
    const holder = new Peer(peerJsPeerId);
    await until(() => holder.open);
    return holder;
  }

  it('is replaced once the ID is released', { timeout: 20_000 }, async () => {
    const [keyA, keyB] = await pairedKeys();
    const holder = await holdId('a7');
    const a = started('a7', { b7: peer(keyA) });
    const b = started('b7', { a7: peer(keyB) }, { passive: true });
    const first = a.peer();
    expect(await until(() => first.destroyed)).toBe(true);

    holder.destroy();

    expect(await until(() => a.peer().open, 6_000)).toBe(true);
    expect(a.peer()).not.toBe(first);
    expect(await until(() => isConnected(a, 'b7') && isConnected(b, 'a7'), 3_000)).toBe(true);
  });

  it('does not keep the ID registered while being destroyed', async () => {
    const holder = await holdId('a10');
    const a = started('a10');
    // The ID is released right as the peer is rejected, before it is destroyed.
    a.peer().once('error', () => holder.destroy());

    expect(await until(() => a.peer().open, 1_000)).toBe(true);
  });

  it('is replaced immediately when the device is back online', async () => {
    const holder = await holdId('a8');
    const a = started('a8');
    const first = a.peer();
    expect(await until(() => first.destroyed)).toBe(true);
    await sleep(100);

    holder.destroy();
    window.dispatchEvent(new Event('online'));

    expect(await until(() => a.peer().open, 500)).toBe(true);
  });

  it('is not replaced once the adapter is stopped', async () => {
    const holder = await holdId('a9');
    const stopping = device('a9');
    const first = stopping.peer();
    expect(await until(() => first.destroyed)).toBe(true);

    stopping.adapter.disconnect();
    holder.destroy();
    await sleep(3_000);

    expect(stopping.adapter.peer).toBeUndefined();
    // The ID is free for the next adapter.
    const next = new Peer('a9');
    expect(await until(() => next.open)).toBe(true);
    next.destroy();
  });
});

describe('joining a calendar this device already has', () => {
  async function requestJoin(joining: Device, inviter: Device, calendarId = CALENDAR_ID) {
    const invite = await createInvite(
      inviter,
      inviter.docLocal.value.localPeer.peerJsPeerId,
      calendarId,
    );
    joining.docEphemeral.value.outgoingJoins[changeSubtree]((joins) => {
      joins[invite.secret.thumbprint] = { invite: invite.args, status: 'requested' };
    });
    // Performed by the adapter, which watches the requests.
    await until(
      () =>
        !['requested', 'joining'].includes(
          joining.docEphemeral.value.outgoingJoins[invite.secret.thumbprint]!.status,
        ),
      12_000,
    );
    return { invite, join: joining.docEphemeral.value.outgoingJoins[invite.secret.thumbprint]! };
  }

  it('re-pairs a device that forgot the inviter', { timeout: 20_000 }, async () => {
    const [oldKey] = await pairedKeys();
    const inviter = started('inviter-a', { 'phone-a': { deviceName: 'Phone', authKeyId: oldKey } });
    const phone = started('phone-a');
    await sleep(50);

    const { join } = await requestJoin(phone, inviter);

    expect(join.status).toBe('joined');
    const inviterEntry = inviter.docLocal.value.remotePeers['phone-a']!;
    expect(inviterEntry.authKeyId).not.toBe(oldKey);
    expect(inviterEntry.deviceName).toBe('Phone');
    expect(await auth.loadAuthKey(oldKey)).toBeUndefined();
    expect(
      await isSameKey(
        phone.docLocal.value.remotePeers['inviter-a']!.authKeyId,
        inviterEntry.authKeyId,
      ),
    ).toBe(true);
    expect(
      await until(() => isConnected(phone, 'inviter-a') && isConnected(inviter, 'phone-a')),
    ).toBe(true);
  });

  it('re-pairs with an inviter that forgot the device', { timeout: 20_000 }, async () => {
    const [, oldKey] = await pairedKeys();
    const inviter = started('inviter-b');
    const phone = started('phone-b', { 'inviter-b': { deviceName: 'Laptop', authKeyId: oldKey } });
    await sleep(50);

    const { join } = await requestJoin(phone, inviter);

    expect(join.status).toBe('joined');
    const phoneEntry = phone.docLocal.value.remotePeers['inviter-b']!;
    expect(phoneEntry.authKeyId).not.toBe(oldKey);
    expect(phoneEntry.deviceName).toBe('Laptop');
    expect(await auth.loadAuthKey(oldKey)).toBeUndefined();
    expect(
      await until(() => isConnected(phone, 'inviter-b') && isConnected(inviter, 'phone-b')),
    ).toBe(true);
  });

  it('fails for a different copy of the calendar', { timeout: 20_000 }, async () => {
    const inviter = started('inviter-c');
    const phone = started('phone-c', {}, { documentIdShared: 'other-shared-document' });
    await sleep(50);

    const { invite, join } = await requestJoin(phone, inviter);
    await sleep(100);

    expect(join.status).toBe('failed');
    expect(join.error).toBe(
      'The shared calendar is a different copy of the calendar than the one on the joining device.',
    );
    expect(inviter.docLocal.value.remotePeers['phone-c']).toBeUndefined();
    expect(inviter.docEphemeral.value.invites[invite.secret.thumbprint]?.usedBy).toBeUndefined();
  });

  it('fails without contacting the inviter for another calendar', { timeout: 20_000 }, async () => {
    const inviter = started('inviter-d');
    const phone = started('phone-d');
    await sleep(50);

    const { join } = await requestJoin(phone, inviter, OTHER_CALENDAR_ID);

    expect(join).toMatchObject({
      status: 'failed',
      error: 'The invite link is for a different calendar.',
    });
  });
});

describe('peer IDs', () => {
  it('that name inherited properties are rejected as unauthorized', async () => {
    const { adapter } = unconnectedAdapter();
    const [connection] = connectionPair('local', 'constructor');
    connection.emit('open');
    const sent = sentMessages(connection);

    const result = await adapter.authenticateInboundConnection(
      connection as unknown as PeerJsDataConnection,
      { kind: 'connect-request', challenge: auth.generateChallenge() } as ConnectRequestPacket,
    );

    expect(result).toEqual({ kind: 'error', message: 'Unauthorized peer.' });
    expect(sent).toHaveBeenCalledWith({ kind: 'error', message: 'Unauthorized peer.' });
  });
});
