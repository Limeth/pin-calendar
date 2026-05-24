import {
  NetworkAdapter,
  Repo,
  type DocumentId,
  type Message,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';
import { type DataConnection, Peer } from 'peerjs';
import { watch, type Ref } from 'vue';
import { type CalendarId, type LocalDocument, type RemotePeer } from './documents/local';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { EphemeralDocument } from './documents/ephemeral';
import { handleJoinRequest, type JoinRequestPacket } from './invite';
import * as auth from './auth';
import {
  exchange,
  initiateHandshake,
  respondToHandshake,
  sendError,
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
      dataConnection.close();
    })
    .catch((error) => {
      console.error(`${description} with peer ${dataConnection.peer} failed:`, error);
      dataConnection.close();
    });
}

export const SYMBOL_IS_WEBRTC_NETWORK_ADAPTER = Symbol.for('WebRtcNetworkAdapter');

export class WebRtcNetworkAdapter extends NetworkAdapter {
  readonly [SYMBOL_IS_WEBRTC_NETWORK_ADAPTER] = SYMBOL_IS_WEBRTC_NETWORK_ADAPTER;
  readonly options: WebRtcNetworkAdapterOptions;
  ready: boolean;
  readyPromise: Promise<void>;
  readyResolver: () => void;
  peer: Peer | undefined;
  peerJsPeerId: string | undefined;
  dataConnections: {
    [peerJsPeerId: string]: DataConnection;
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
    this.dataConnections = {};
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

      const connectToRemotePeer = (remotePeerPeerJsPeerId: string, remotePeer: RemotePeer) => {
        // Guard against double-connecting if this peer was already handled
        // by a previous 'open' event or a reactive watcher callback.
        if (this.dataConnections[remotePeerPeerJsPeerId]) return;

        const dataConnection = this.peer!.connect(remotePeerPeerJsPeerId);

        dataConnection.once('open', () => {
          closeOnFailure(
            dataConnection,
            'Connection handshake',
            this.authenticateOutboundConnection(dataConnection, remotePeer),
          );
        });
      };

      for (const [remotePeerPeerJsPeerId, remotePeer] of Object.entries(
        this.options.docLocal.value.remotePeers,
      )) {
        connectToRemotePeer(remotePeerPeerJsPeerId, remotePeer);
      }

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
              connectToRemotePeer(peerJsPeerId, newPeers[peerJsPeerId]);
            }
          }
        },
        { deep: true },
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
    remotePeer: RemotePeer,
  ): Promise<ErrorPacket | undefined> {
    const authKey = await auth.loadAuthKey(remotePeer.authKeyId);

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
    const remotePeer = this.options.docLocal.value.remotePeers[dataConnection.peer];
    const authKey =
      remotePeer === undefined ? undefined : await auth.loadAuthKey(remotePeer.authKeyId);

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
          dataConnection.close();
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

    console.log(`Adding opened peer peerJsPeerId: ${connectedPeer.dataConnection.peer}`);
    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      connectedPeers[connectedPeer.dataConnection.peer] = connectedPeer.peerInfo;
    });
    this.dataConnections[connectedPeer.dataConnection.peer] = connectedPeer.dataConnection;
    this.emit('peer-candidate', {
      peerId: connectedPeer.peerInfo.automergePeerId as PeerId,
      peerMetadata: connectedPeer.peerInfo.automergePeerMetadata,
    });
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
    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      delete connectedPeers[peer.dataConnection.peer];
    });
    delete this.dataConnections[peer.dataConnection.peer];
    this.emit('peer-disconnected', {
      peerId: peer.peerInfo.automergePeerId as PeerId,
    });
  }

  disconnect(): void {
    console.log('WebRtcNetworkAdapter::disconnect()');

    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      for (const peerJsPeerId of Object.keys(connectedPeers)) delete connectedPeers[peerJsPeerId];
    });

    for (const [peerJsPeerId, dataConnection] of Object.entries(this.dataConnections)) {
      dataConnection.close();
      delete this.dataConnections[peerJsPeerId];
    }

    console.assert(Object.keys(this.options.docEphemeral.value.connectedPeers).length === 0);
    console.assert(Object.keys(this.dataConnections).length === 0);
    this.sessionCounter++;
    // PeerJS keeps the ID registered on the signalling server until destroy()
    // is called. If we don't clean it up, a later WebRtcNetworkAdapter that
    // tries to use the same peerJsPeerId will get an 'unavailable-id' error.
    this.peer?.destroy();
    this.peer = undefined;
  }

  send(message: Message): void {
    console.log(`WebRtcNetworkAdapter::send(message = ${JSON.stringify(message)})`);

    for (const [peerJsPeerId, dataConnection] of Object.entries(this.dataConnections)) {
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
