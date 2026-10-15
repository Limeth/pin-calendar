import {
  NetworkAdapter,
  type Repo,
  type DocumentId,
  type Message,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';
import { type DataConnection, Peer } from 'peerjs';
import { watch, type Ref } from 'vue';
import { type CalendarId, type LocalDocument } from './documents/local';
import type { HashArgsAddPeer } from './hash';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { EphemeralDocument } from './documents/ephemeral';
import { handleJoinRequest, joinCalendarVia, type JoinRequestPacket } from './invite';
import * as auth from './auth';
import { closeConnection } from './util/peerjs';
import {
  exchange,
  initiateHandshake,
  respondToHandshake,
  sendError,
  toErrorPacket,
  type ErrorPacket,
  type HandshakeAuthBase,
  type HandshakeRequestBase,
} from './handshake';

export type WebRtcNetworkAdapterOptions = {
  calendarId: CalendarId;
  docEphemeral: Ref<Rop<EphemeralDocument>>;
  docLocal: Ref<Rop<LocalDocument>>;
  attemptToWaitForDocumentAvailability:
    | undefined
    | {
        timeoutMilliseconds: number;
        documentId: DocumentId;
        repo: Repo;
      };
};

// Information about a peer, exchanged once the peer is authenticated.
export type PeerInfo = {
  automergePeerId: string;
  automergePeerMetadata: PeerMetadata;
};

export type ConnectedPeer = {
  dataConnection: DataConnection;
  peerInfo: PeerInfo;
};

type Packet = {
  message: Message;
};

// A connection between paired peers uses the handshake from `handshake.ts`, with the key derived
// during the invitation.

// 1. Sent from initiator to responder.
export type ConnectRequestPacket = HandshakeRequestBase & {
  kind: 'connect-request';
};

// 2. Sent from responder to initiator: `HandshakeResponsePacket`.

// 3. Sent from initiator to responder, if the `HandshakeResponsePacket::signature` was correct.
type ConnectAuthPacket = HandshakeAuthBase & {
  kind: 'connect-auth';
  peerInfo: PeerInfo;
};

// 4. Sent from responder to initiator, if the `ConnectAuthPacket::signature` was correct.
type ConnectAcceptPacket = {
  kind: 'connect-accept';
  peerInfo: PeerInfo;
};

// The first packet sent over a new connection.
export type HandshakeRequestPacket = ConnectRequestPacket | JoinRequestPacket;

// Compares by UTF-16 code units, unlike `localeCompare`, which depends on the user's locale and
// could order the same strings differently on different devices.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Close the connection if the handshake fails.
function closeOnFailure(
  dataConnection: DataConnection,
  description: string,
  result: Promise<ErrorPacket | undefined>,
) {
  result
    .then((error) => {
      if (error === undefined) return;
      console.error(`${description} with peer ${dataConnection.peer} failed: ${error.message}`);
      closeConnection(dataConnection);
    })
    .catch((error) => {
      console.error(`${description} with peer ${dataConnection.peer} failed:`, error);
      closeConnection(dataConnection);
    });
}

// How long to wait for the inviter to accept a join requested via `EphemeralDocument::outgoingJoins`.
const OUTGOING_JOIN_TIMEOUT_MS = 10_000;

export const SYMBOL_IS_WEBRTC_NETWORK_ADAPTER = Symbol.for('WebRtcNetworkAdapter');

export class WebRtcNetworkAdapter extends NetworkAdapter {
  readonly [SYMBOL_IS_WEBRTC_NETWORK_ADAPTER] = SYMBOL_IS_WEBRTC_NETWORK_ADAPTER;
  readonly options: WebRtcNetworkAdapterOptions;
  ready: boolean;
  readyPromise: Promise<void>;
  readyResolver: () => void;
  peer: Peer | undefined;
  peerJsPeerId: string | undefined;
  // The open, authenticated connections to each peer, oldest first. A peer can have more than one
  // connection for a while: when both peers connect to each other at the same time, or when a peer
  // reconnects (e.g. after reloading) before its previous connection is detected as closed. Which
  // one is dead cannot be told until it closes, so each connection is tracked until it does.
  connections: {
    [peerJsPeerId: string]: ConnectedPeer[];
  };
  /// Incremented every time this peer is disconnected.
  sessionCounter: number;

  constructor(options: WebRtcNetworkAdapterOptions) {
    super();
    this.options = options;
    this.ready = false;
    let readyResolver;
    this.readyPromise = new Promise<void>((resolve) => {
      readyResolver = resolve;
    });
    this.readyResolver = readyResolver!;
    this.connections = {};
    this.sessionCounter = 0;

    // Disconnect from peers that are removed by the user.
    // TODO: Doesn't work. Currently, we just reload the page.
    // watch(toRef(this.options.docLocal.value.remotePeers), (valueNew, valueOld) => {
    //   const removedPeers = Object.keys(valueOld).filter((peerJsPeerId) => !(peerJsPeerId in valueNew));
    //   console.log("RemotePeers changed:");
    //   console.log(valueNew);
    //   console.log(valueOld);
    //   console.log(removedPeers)

    //   for (const removedPeer of removedPeers) {
    //     const dataConnection = this.dataConnections[removedPeer];

    //     if (dataConnection !== undefined) {
    //       console.log(`Disconnecting from removed peer: ${removedPeer}`);
    //       dataConnection.close();
    //     }
    //   }
    // }, { deep: true });
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    console.log(
      `WebRtcNetworkAdapter::connect(peerId = ${peerId}, peerMetadata = ${peerMetadata})`,
    );

    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    this.peer = new Peer(this.options.docLocal.value.localPeer.peerJsPeerId, {
      debug: 3,
      secure: true,
    });

    this.peer.on('error', (error) => {
      if (error.type === 'peer-unavailable' || error.type === 'unavailable-id') {
        console.log(error.message);
        return;
      }

      console.error('Unhandled peer error: ', error);
    });

    this.peer.on('open', async (id) => {
      // Invoked when a connection to the signaling server is established.
      this.peerJsPeerId = id;

      for (const remotePeerPeerJsPeerId of Object.keys(this.options.docLocal.value.remotePeers))
        this.connectToRemotePeer(remotePeerPeerJsPeerId);

      // When an invite link is used for the first time, the automerge
      // document update that adds the inviter to remotePeers may arrive
      // AFTER peer.on('open') has already fired. Without this watcher we
      // would never initiate the outbound connection, the adapter would
      // finish "ready" with zero peers, and the shared document would
      // remain unavailable forever.
      watch(
        () => this.options.docLocal.value.remotePeers,
        (newPeers, oldPeers) => {
          if (!this.peer) return;

          const newKeys = Object.keys(newPeers);
          const oldKeys = oldPeers ? Object.keys(oldPeers) : [];

          for (const peerJsPeerId of newKeys) {
            if (!oldKeys.includes(peerJsPeerId)) {
              this.connectToRemotePeer(peerJsPeerId);
            }
          }
        },
        { deep: true },
      );

      // Joins requested by the join dialog, possibly in another tab.
      watch(
        () => this.options.docEphemeral.value.outgoingJoins,
        () => this.performOutgoingJoins(),
        { deep: true, immediate: true },
      );

      // If the shared document isn't available locally we must NOT call
      // setReady() immediately just because remotePeers happens to be empty
      // at this instant (e.g. Vue hasn't flushed the doc sync yet). We need
      // to give the watcher above and checkDocumentAvailability a chance to
      // bring a peer online before declaring the adapter prepared.
      if (this.options.attemptToWaitForDocumentAvailability !== undefined) {
        (async () => {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              this.options.attemptToWaitForDocumentAvailability?.timeoutMilliseconds,
            ),
          );
          if (!this.ready) {
            console.warn(
              'Waiting for document availability timed out! Readying up despite the document not being available.',
            );
            this.setReady();
          }
        })();

        // This runs asynchronously, we don't wait for it to finish.
        this.checkDocumentAvailability();
      } else {
        this.setReady();
      }
    });

    this.peer.on('connection', (dataConnection) => {
      this.onInboundConnectionRequested(dataConnection);
    });
  }

  connectToRemotePeer(remotePeerPeerJsPeerId: string) {
    // Guard against double-connecting if this peer was already handled
    // by a previous 'open' event or a reactive watcher callback.
    if (this.connections[remotePeerPeerJsPeerId] !== undefined) return;

    const dataConnection = this.peer!.connect(remotePeerPeerJsPeerId);

    dataConnection.once('open', () => {
      closeOnFailure(
        dataConnection,
        'Connection handshake',
        this.authenticateOutboundConnection(dataConnection),
      );
    });
  }

  // Perform the requested joins of this calendar, which this device already has, see
  // `EphemeralDocument::outgoingJoins`. They are performed from this adapter's peer, because the
  // device must join with its existing peer ID in the calendar: other devices know it by that ID,
  // and the signalling server only lets one peer use an ID at a time.
  performOutgoingJoins() {
    if (!this.peer?.open) return;

    for (const [secretThumbprint, outgoingJoin] of Object.entries(
      this.options.docEphemeral.value.outgoingJoins,
    )) {
      if (outgoingJoin.status !== 'requested') continue;

      // Marked before yielding, so that the request is not performed twice.
      outgoingJoin[changeSubtree]((outgoingJoin) => {
        outgoingJoin.status = 'joining';
      });

      this.performOutgoingJoin({ ...outgoingJoin.invite })
        .catch(toErrorPacket)
        .then((error) => {
          if (error !== undefined)
            console.error(`Joining the calendar again failed: ${error.message}`);

          const outgoingJoins = this.options.docEphemeral.value.outgoingJoins;

          // The request may have been withdrawn in the meantime, e.g. when the join dialog timed out.
          if (!Object.hasOwn(outgoingJoins, secretThumbprint)) return;

          outgoingJoins[secretThumbprint][changeSubtree]((outgoingJoin) => {
            if (error === undefined) {
              outgoingJoin.status = 'joined';
            } else {
              outgoingJoin.status = 'failed';
              outgoingJoin.error = error.message;
            }
          });
        });
    }
  }

  async performOutgoingJoin(invite: HashArgsAddPeer): Promise<ErrorPacket | undefined> {
    const secret = await auth.parseInviteSecret(invite.secret);

    // The join dialog only requests joins for the calendar of the invite, see `auth.calendarIdTag`.
    if ((await auth.calendarIdTag(secret, this.options.calendarId)) !== invite.calendarIdTag)
      return { kind: 'error', message: 'The invite link is for a different calendar.' };

    const result = await joinCalendarVia(this.peer!, invite, {
      timeoutMs: OUTGOING_JOIN_TIMEOUT_MS,
      sharedDocumentId: this.options.docLocal.value.documentIdShared,
    });

    if (result.kind === 'error') return result;

    const inviterPeerJsPeerId = invite.peerJsPeerId;
    const remotePeers = this.options.docLocal.value.remotePeers;
    // The inviter is still known, if only the inviter forgot this device. The values are read
    // before the entry is overwritten below.
    const previousRemotePeer = Object.hasOwn(remotePeers, inviterPeerJsPeerId)
      ? { ...remotePeers[inviterPeerJsPeerId] }
      : undefined;

    remotePeers[changeSubtree]((remotePeers) => {
      remotePeers[inviterPeerJsPeerId] = {
        deviceName: previousRemotePeer?.deviceName ?? '', // TODO
        authKeyId: result.authKeyId,
      };
    });

    if (previousRemotePeer !== undefined) {
      await auth.deleteAuthKey(previousRemotePeer.authKeyId);
      // New peers are connected to by the watcher of `remotePeers`, but known peers are not.
      this.connectToRemotePeer(inviterPeerJsPeerId);
    }
  }

  getAutomergePeerId(peerJsPeerId: string): PeerId | undefined {
    return this.options.docEphemeral.value.connectedPeers[peerJsPeerId]?.automergePeerId as
      | PeerId
      | undefined;
  }

  getLocalPeerInfo(): PeerInfo {
    return {
      automergePeerId: this.peerId!,
      automergePeerMetadata: this.peerMetadata ?? {},
    };
  }

  // Authenticate a connection opened by this peer, as the initiator of the handshake.
  async authenticateOutboundConnection(
    dataConnection: DataConnection,
  ): Promise<ErrorPacket | undefined> {
    // Looked up only now, rather than when connecting: document entries are snapshots, which are
    // replaced on every change, and the peer's key may have been replaced since, e.g. by joining
    // again, or the peer may have been forgotten.
    const remotePeers = this.options.docLocal.value.remotePeers;
    const authKey = Object.hasOwn(remotePeers, dataConnection.peer)
      ? await auth.loadAuthKey(remotePeers[dataConnection.peer].authKeyId)
      : undefined;

    if (authKey === undefined)
      return { kind: 'error', message: 'No authentication key found for this peer.' };

    const connectRequest: ConnectRequestPacket = {
      kind: 'connect-request',
      challenge: auth.generateChallenge(),
    };
    const handshake = await initiateHandshake(dataConnection, authKey, connectRequest);

    if (handshake.kind === 'error') return handshake;

    const connectAuth: ConnectAuthPacket = {
      kind: 'connect-auth',
      signature: handshake.signature,
      peerInfo: this.getLocalPeerInfo(),
    };
    const connectAccept = await exchange<ConnectAcceptPacket>(dataConnection, connectAuth);

    if (connectAccept.kind === 'error') return connectAccept;

    this.onConnectionOpened({
      dataConnection,
      peerInfo: connectAccept.peerInfo,
    });
  }

  // Authenticate a connection opened by a remote peer, as the responder of the handshake.
  async authenticateInboundConnection(
    dataConnection: DataConnection,
    connectRequest: ConnectRequestPacket,
  ): Promise<ErrorPacket | undefined> {
    const remotePeers = this.options.docLocal.value.remotePeers;
    // `hasOwn`, because the remote peer chooses its own PeerJS peer ID, which could otherwise match
    // an inherited property, such as `constructor`.
    const authKey = Object.hasOwn(remotePeers, dataConnection.peer)
      ? await auth.loadAuthKey(remotePeers[dataConnection.peer].authKeyId)
      : undefined;

    if (authKey === undefined) return await sendError(dataConnection, 'Unauthorized peer.');

    const connectAuth = await respondToHandshake<ConnectAuthPacket>(
      dataConnection,
      authKey,
      connectRequest,
    );

    if (connectAuth.kind === 'error') return connectAuth;

    const connectAccept: ConnectAcceptPacket = {
      kind: 'connect-accept',
      peerInfo: this.getLocalPeerInfo(),
    };

    // Send this packet before the connection is opened, so that it arrives before any Automerge
    // messages.
    await dataConnection.send(connectAccept);

    this.onConnectionOpened({
      dataConnection,
      peerInfo: connectAuth.peerInfo,
    });
  }

  onInboundConnectionRequested(dataConnection: DataConnection) {
    dataConnection.once('open', () => {
      dataConnection.once('data', (message) => {
        const requestPacket = message as HandshakeRequestPacket; // TODO: Schema validation

        if (requestPacket.kind === 'connect-request') {
          closeOnFailure(
            dataConnection,
            'Connection handshake',
            this.authenticateInboundConnection(dataConnection, requestPacket),
          );
        } else if (requestPacket.kind === 'join-request') {
          closeOnFailure(
            dataConnection,
            'Join request',
            handleJoinRequest(dataConnection, requestPacket, this.options),
          );
        } else {
          // TODO: Send error
          closeConnection(dataConnection);
        }
      });
    });
  }

  onConnectionOpened(connectedPeer: ConnectedPeer) {
    console.assert(connectedPeer.dataConnection.open);
    console.log('Connection established: ', connectedPeer);

    // const automergePeerId = this.getAutomergePeerId(dataConnection.peer)

    // if (automergePeerId === undefined) {
    //   dataConnection.close();
    //   console.warn("Rejected unknown peer: ", dataConnection.peer);
    //   return;
    // }

    connectedPeer.dataConnection.on('data', (data) => {
      this.onIncomingMessage(connectedPeer, data);
    });

    connectedPeer.dataConnection.on('close', () => {
      this.onPeerDisconnected(connectedPeer);
    });

    connectedPeer.dataConnection.on('error', (error) => {
      console.error(`Data connection error: ${error}`);
    });

    const peerJsPeerId = connectedPeer.dataConnection.peer;
    const connections = (this.connections[peerJsPeerId] ??= []);
    // Another connection to the same Automerge peer, e.g. when both peers connected to each other.
    const automergePeerAlreadyConnected = connections.some(
      (connection) =>
        connection.peerInfo.automergePeerId === connectedPeer.peerInfo.automergePeerId,
    );

    console.log(`Adding opened peer peerJsPeerId: ${peerJsPeerId}`);
    connections.push(connectedPeer);
    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      connectedPeers[peerJsPeerId] = connectedPeer.peerInfo;
    });

    if (!automergePeerAlreadyConnected)
      this.emit('peer-candidate', {
        peerId: connectedPeer.peerInfo.automergePeerId as PeerId,
        peerMetadata: connectedPeer.peerInfo.automergePeerMetadata,
      });
    else this.closeSpareConnections(connections, connectedPeer.peerInfo.automergePeerId);
  }

  // Close all but one of the connections to an Automerge peer. They all lead to the same session of
  // the remote peer (a peer gets a new Automerge peer ID when it reloads), so the others are
  // redundant, e.g. when both peers connected to each other at the same time.
  // Both peers must close the same connections, or they could end up closing all of them. So both
  // keep the connection with the smallest connection ID, which is the same on both ends: PeerJS
  // sends it to the remote peer when opening the connection.
  closeSpareConnections(connections: ConnectedPeer[], automergePeerId: string) {
    const spareConnections = connections
      .filter((connection) => connection.peerInfo.automergePeerId === automergePeerId)
      .toSorted((a, b) =>
        compareStrings(a.dataConnection.connectionId, b.dataConnection.connectionId),
      )
      .slice(1);

    for (const { dataConnection } of spareConnections) {
      console.log(
        `Closing spare connection ${dataConnection.connectionId} to ${dataConnection.peer}.`,
      );
      // Removed from `connections` once closed, see `onPeerDisconnected`.
      closeConnection(dataConnection);
    }
  }

  setReady() {
    if (!this.ready) {
      console.log('WebRTC Network Adapter set to ready.');
      this.ready = true;
      this.readyResolver();
    }
  }

  onIncomingMessage(peer: ConnectedPeer, data: unknown) {
    // TODO: Validate incoming message using a schema?
    const packet = data as Packet;

    // For some reason, the data field is parsed as an `ArrayBuffer` despite being sent as a `Uint8Array`. We fix that here.
    packet.message = {
      ...packet.message,
      data: packet.message.data !== undefined ? new Uint8Array(packet.message.data) : undefined,
    };

    console.log(`Received packet from peer ${peer.dataConnection.peer}: `, packet.message);
    this.emit('message', packet.message);

    // This runs asynchronously, we don't wait for it to finish.
    this.checkDocumentAvailability();
  }

  async checkDocumentAvailability(): Promise<boolean> {
    if (!this.ready && this.options.attemptToWaitForDocumentAvailability) {
      console.debug(
        `Attempting to check the availability of document ${this.options.attemptToWaitForDocumentAvailability.documentId}`,
      );

      try {
        // Note that this can be aborted via an AbortSignal passed as a property to the options argument.
        await this.options.attemptToWaitForDocumentAvailability.repo.find(
          this.options.attemptToWaitForDocumentAvailability.documentId,
        );
        console.log(
          `Successfully looked up document ${this.options.attemptToWaitForDocumentAvailability.documentId} while waiting for its availability.`,
        );
        this.setReady();
      } catch {
        console.log(
          `Failed to look up document ${this.options.attemptToWaitForDocumentAvailability.documentId} while waiting for its availability.`,
        );
        return false;
      }
    }

    this.setReady();
    return true;
  }

  onPeerDisconnected(peer: ConnectedPeer) {
    const peerJsPeerId = peer.dataConnection.peer;
    const connections = this.connections[peerJsPeerId] ?? [];
    const index = connections.indexOf(peer);

    if (index === -1) return;

    // Only this connection is closed, the peer may still have others, see `connections`.
    connections.splice(index, 1);

    const newestConnection = connections.at(-1);

    if (newestConnection === undefined) delete this.connections[peerJsPeerId];

    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      if (newestConnection === undefined) delete connectedPeers[peerJsPeerId];
      else connectedPeers[peerJsPeerId] = newestConnection.peerInfo;
    });

    const automergePeerStillConnected = connections.some(
      (connection) => connection.peerInfo.automergePeerId === peer.peerInfo.automergePeerId,
    );

    if (!automergePeerStillConnected)
      this.emit('peer-disconnected', {
        peerId: peer.peerInfo.automergePeerId as PeerId,
      });
  }

  disconnect(): void {
    console.log('WebRtcNetworkAdapter::disconnect()');

    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      for (const peerJsPeerId of Object.keys(connectedPeers)) delete connectedPeers[peerJsPeerId];
    });

    // Closing a connection removes it from `connections` (see `onPeerDisconnected`), so iterate over
    // a copy.
    for (const connectedPeer of Object.values(this.connections).flat()) {
      // An exception to closing connections via `closeConnection`: the peer is destroyed right
      // below, which would cut off a graceful close anyway, and it cannot wait, because the next
      // adapter may need the same peer ID immediately.
      // eslint-disable-next-line no-restricted-syntax
      connectedPeer.dataConnection.close();
    }

    this.connections = {};

    console.assert(Object.keys(this.options.docEphemeral.value.connectedPeers).length === 0);
    this.sessionCounter++;
    // PeerJS keeps the ID registered on the signalling server until destroy()
    // is called. If we don't clean it up, a later WebRtcNetworkAdapter that
    // tries to use the same peerJsPeerId will get an 'unavailable-id' error.
    this.peer?.destroy();
    this.peer = undefined;
  }

  send(message: Message): void {
    console.log(`WebRtcNetworkAdapter::send(message = ${JSON.stringify(message)})`);

    for (const [peerJsPeerId, connections] of Object.entries(this.connections)) {
      // The newest connection is the most likely to be alive, see `connections`. Incoming messages
      // are received on all of them.
      const dataConnection = connections.at(-1)?.dataConnection;

      if (dataConnection === undefined) continue;

      const packet: Packet = {
        message,
      };
      console.log(`Attempting to send packet to peer ${peerJsPeerId}: `, packet);
      dataConnection.send(packet);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}
