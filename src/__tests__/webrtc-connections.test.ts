import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataConnection as PeerJsDataConnection } from 'peerjs';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import type { Message, PeerId } from '@automerge/automerge-repo';
import { WebRtcNetworkAdapter, type ConnectRequestPacket } from '@/webrtc';
import { forgetRemotePeer } from '@/peers';
import * as auth from '@/auth';
import { connectionPair, type DataConnection } from './fakes/peerjs';
import {
  CALENDAR_ID,
  ephemeralDocument,
  isConnected,
  localDocument,
  pairedKeys,
  remotePeer,
  sleep,
  started,
  stopStartedDevices,
  until,
} from './helpers';

// Adapters created by the tests themselves, rather than by `started`.
const adapters: WebRtcNetworkAdapter[] = [];

afterEach(() => {
  stopStartedDevices();
  for (const adapter of adapters.splice(0)) adapter.disconnect();
  vi.restoreAllMocks();
});

const message = (n: number) => ({ type: 'sync', data: new Uint8Array([n]) }) as unknown as Message;
// An adapter that is not connected to the fake network, with the given known peers, to which
// connections are passed directly, see `open`.
function unconnectedAdapter(...peerJsPeerIds: string[]) {
  const docLocal = localDocument(
    'local',
    Object.fromEntries(peerJsPeerIds.map((id) => [id, remotePeer(`key-${id}`)])),
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
    const laptop = started('laptop', { phone: remotePeer(laptopKey) });
    const phone = started('phone', { laptop: remotePeer(phoneKey) });
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
