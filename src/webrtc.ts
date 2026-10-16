import {
  NetworkAdapter,
  type Repo,
  type DocumentId,
  type Message,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';
import { type DataConnection, Peer } from 'peerjs';
import { watch, type Ref, type WatchStopHandle } from 'vue';
import { type CalendarId, type LocalDocument } from './documents/local';
import type { HashArgsAddPeer } from './hash';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { EphemeralDocument } from './documents/ephemeral';
import { handleJoinRequest, joinCalendarVia, type JoinRequestPacket } from './invite';
import * as auth from './auth';
import { asyncOnceOpen, closeConnection } from './util/peerjs';
import { setRemotePeerKey } from './peers';
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

// Connections are attempted on events after which they may succeed, see `retryConnections`. A
// failed attempt is retried after a delay, which doubles with every failure, up to a maximum.
const CONNECTION_ATTEMPT_TIMEOUT_MS = 15_000;
const RETRY_INITIAL_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;

// The delay before a retry, randomized, so that peers that failed at the same time do not retry at
// the same time again.
function retryDelay(delayMs: number): number {
  return delayMs * (0.75 + Math.random() * 0.5);
}

// A retry after a delay, which doubles with every failure.
type Retry = {
  delayMs: number;
  timer?: ReturnType<typeof setTimeout>;
};

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
  // Stops the watchers of this adapter, see `disconnect`. Without stopping them, they would keep
  // running, and keep this adapter in memory, after the WebRTC host moves to another tab.
  stopWatchers: WatchStopHandle[] = [];
  // Whether `disconnect` was called, after which no connections are attempted anymore.
  stopped = false;
  // Whether the setup done once connected to the signalling server for the first time is done, see
  // the `open` event in `createPeer`.
  started = false;
  // Connections to remote peers that are being attempted, see `connectToRemotePeer`.
  pendingConnections: { [peerJsPeerId: string]: DataConnection } = {};
  // Retries of failed connections to remote peers, see `scheduleConnectionRetry`.
  connectionRetries: { [peerJsPeerId: string]: Retry } = {};
  // Retries of failed reconnections to the signalling server, see `reconnectToSignallingServer`.
  signallingRetry: Retry = { delayMs: RETRY_INITIAL_DELAY_MS };
  readonly onOnline = () => this.retryConnections();
  readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') this.retryConnections();
  };

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
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    console.log(
      `WebRtcNetworkAdapter::connect(peerId = ${peerId}, peerMetadata = ${peerMetadata})`,
    );

    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    // Events after which connections that failed may succeed: the device is back online, or the
    // user returns to the tab, e.g. after the device woke up from sleep.
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.createPeer();
  }

  // Create the PeerJS peer, which registers this device's peer ID with the signalling server. Also
  // used to replace a peer that PeerJS destroyed, see `reconnectToSignallingServer`.
  createPeer() {
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

    // Connecting to remote peers requires the signalling server, so reconnect to it once it is lost.
    // Deferred, because PeerJS also emits this event while destroying the peer, before marking it
    // as destroyed. Reconnecting at that point would open a connection to the server that the peer
    // then abandons, but which, if it registers, keeps the peer ID registered, so that it could not
    // be used again, e.g. if the ID was released in the meantime.
    this.peer.on('disconnected', () => queueMicrotask(() => this.reconnectToSignallingServer()));

    // The peer was destroyed, see `reconnectToSignallingServer`.
    this.peer.on('close', () => this.reconnectToSignallingServer());

    this.peer.on('open', async (id) => {
      // Invoked when a connection to the signaling server is established.
      this.peerJsPeerId = id;
      clearTimeout(this.signallingRetry.timer);
      this.signallingRetry = { delayMs: RETRY_INITIAL_DELAY_MS };
      this.connectToRemotePeers();

      // Reconnected to the signalling server, see `reconnectToSignallingServer`.
      if (this.started) return;

      this.started = true;

      // When an invite link is used for the first time, the automerge
      // document update that adds the inviter to remotePeers may arrive
      // AFTER peer.on('open') has already fired. Without this watcher we
      // would never initiate the outbound connection, the adapter would
      // finish "ready" with zero peers, and the shared document would
      // remain unavailable forever.
      const stopWatchingRemotePeers = watch(
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

          // Disconnect from peers that were forgotten, possibly in another tab. This adapter holds
          // the connections of all tabs, so it is the one that has to close them.
          for (const peerJsPeerId of oldKeys)
            if (!newKeys.includes(peerJsPeerId)) this.disconnectFromRemotePeer(peerJsPeerId);
        },
        { deep: true },
      );

      // Joins requested by the join dialog, possibly in another tab.
      const stopWatchingOutgoingJoins = watch(
        () => this.options.docEphemeral.value.outgoingJoins,
        () => this.performOutgoingJoins(),
        { deep: true, immediate: true },
      );

      this.stopWatchers.push(stopWatchingRemotePeers, stopWatchingOutgoingJoins);

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

  connectToRemotePeers() {
    for (const remotePeerPeerJsPeerId of Object.keys(this.options.docLocal.value.remotePeers))
      this.connectToRemotePeer(remotePeerPeerJsPeerId);
  }

  // Attempt to connect to a remote peer, unless already connected, or an attempt is in progress. If
  // the attempt fails, it is retried, see `scheduleConnectionRetry`.
  connectToRemotePeer(remotePeerPeerJsPeerId: string) {
    // Without the signalling server, connections are attempted once it is reconnected to.
    if (this.stopped || !this.peer?.open) return;
    if (this.connections[remotePeerPeerJsPeerId] !== undefined) return;
    if (this.pendingConnections[remotePeerPeerJsPeerId] !== undefined) return;

    // Attempting now replaces a scheduled retry, while keeping its delay for the next failure.
    const retry = this.connectionRetries[remotePeerPeerJsPeerId];

    if (retry !== undefined) {
      clearTimeout(retry.timer);
      delete retry.timer;
    }

    const dataConnection = this.peer.connect(remotePeerPeerJsPeerId);

    this.pendingConnections[remotePeerPeerJsPeerId] = dataConnection;
    this.attemptConnection(dataConnection).then((error) => {
      if (this.pendingConnections[remotePeerPeerJsPeerId] === dataConnection)
        delete this.pendingConnections[remotePeerPeerJsPeerId];

      // On success, the connection was added by `onConnectionOpened`.
      if (error === undefined) return;

      console.error(`Connecting to peer ${remotePeerPeerJsPeerId} failed: ${error.message}`);
      closeConnection(dataConnection);
      this.scheduleConnectionRetry(remotePeerPeerJsPeerId);
    });
  }

  // Open the connection and authenticate it, within a time limit. When the remote peer is not
  // reachable, PeerJS does not report it on the connection, so this is how such attempts end.
  async attemptConnection(dataConnection: DataConnection): Promise<ErrorPacket | undefined> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        (async () => {
          await asyncOnceOpen(dataConnection);
          return await this.authenticateOutboundConnection(dataConnection);
        })().catch(toErrorPacket),
        new Promise<ErrorPacket>((resolve) => {
          timeout = setTimeout(
            () => resolve({ kind: 'error', message: 'Connecting timed out.' }),
            CONNECTION_ATTEMPT_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Retry connecting to a remote peer after a failed attempt, with a delay that doubles with every
  // failure, until connected (by either peer), the peer is forgotten, or this adapter is stopped.
  // The remote peer may be offline, or may have forgotten this device, but this cannot be told
  // apart from a temporary failure, so retrying continues, at least every `RETRY_MAX_DELAY_MS`.
  scheduleConnectionRetry(remotePeerPeerJsPeerId: string) {
    if (this.stopped) return;
    if (!Object.hasOwn(this.options.docLocal.value.remotePeers, remotePeerPeerJsPeerId)) return;
    if (this.connections[remotePeerPeerJsPeerId] !== undefined) return;

    const retry = (this.connectionRetries[remotePeerPeerJsPeerId] ??= {
      delayMs: RETRY_INITIAL_DELAY_MS,
    });

    if (retry.timer !== undefined) return;

    retry.timer = setTimeout(() => {
      delete retry.timer;
      this.connectToRemotePeer(remotePeerPeerJsPeerId);
    }, retryDelay(retry.delayMs));
    retry.delayMs = Math.min(retry.delayMs * 2, RETRY_MAX_DELAY_MS);
  }

  cancelConnectionRetry(remotePeerPeerJsPeerId: string) {
    clearTimeout(this.connectionRetries[remotePeerPeerJsPeerId]?.timer);
    delete this.connectionRetries[remotePeerPeerJsPeerId];
  }

  // Reconnect to the signalling server after the connection to it was lost. If it is still lost
  // after a delay, which doubles with every failure, try again.
  reconnectToSignallingServer() {
    if (this.stopped || this.peer === undefined) return;
    if (this.signallingRetry.timer !== undefined) return;

    if (this.peer.destroyed) {
      // PeerJS destroys a peer whose first registration with the server fails, rather than
      // disconnecting it, e.g. when its ID is still registered by the peer of the previous WebRTC
      // host tab. A destroyed peer cannot reconnect, so it is replaced. Its connections were
      // closed, and are attempted again once the new peer is registered, see the `open` event.
      console.log('Replacing the destroyed peer.');
      this.createPeer();
    } else if (this.peer.disconnected) {
      // PeerJS only reconnects a disconnected peer; otherwise, it is still connecting.
      console.log('Reconnecting to the signalling server.');
      this.peer.reconnect();
    }

    this.signallingRetry.timer = setTimeout(() => {
      delete this.signallingRetry.timer;
      if (!this.peer?.open) this.reconnectToSignallingServer();
    }, retryDelay(this.signallingRetry.delayMs));
    this.signallingRetry.delayMs = Math.min(this.signallingRetry.delayMs * 2, RETRY_MAX_DELAY_MS);
  }

  // Retry all connections immediately, after an event after which they may succeed, rather than
  // waiting for the delays of their retries.
  retryConnections() {
    if (this.stopped || this.peer === undefined) return;

    for (const remotePeerPeerJsPeerId of Object.keys(this.connectionRetries))
      this.cancelConnectionRetry(remotePeerPeerJsPeerId);

    if (this.peer.open) {
      this.connectToRemotePeers();
    } else {
      clearTimeout(this.signallingRetry.timer);
      this.signallingRetry = { delayMs: RETRY_INITIAL_DELAY_MS };
      // Connects to the remote peers once reconnected, see the `open` event.
      this.reconnectToSignallingServer();
    }
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

    // The inviter is still known, if only the inviter forgot this device.
    const replaced = await setRemotePeerKey(
      this.options.docLocal,
      invite.peerJsPeerId,
      result.authKeyId,
    );

    // New peers are connected to by the watcher of `remotePeers`, but known peers are not.
    if (replaced) this.connectToRemotePeer(invite.peerJsPeerId);
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

  // Close all connections to a peer, e.g. after it was forgotten.
  disconnectFromRemotePeer(peerJsPeerId: string) {
    this.cancelConnectionRetry(peerJsPeerId);

    // Iterate over a copy, as `removeConnection` modifies the array.
    for (const connectedPeer of (this.connections[peerJsPeerId] ?? []).slice()) {
      console.log(`Disconnecting from forgotten peer ${peerJsPeerId}.`);
      this.removeConnection(connectedPeer);
      closeConnection(connectedPeer.dataConnection);
    }
  }

  onConnectionOpened(connectedPeer: ConnectedPeer) {
    console.assert(connectedPeer.dataConnection.open);
    console.log('Connection established: ', connectedPeer);

    // The peer may have been forgotten while the handshake was in progress, after its key was
    // looked up, in which case `disconnectFromRemotePeer` did not see this connection yet.
    if (
      !Object.hasOwn(this.options.docLocal.value.remotePeers, connectedPeer.dataConnection.peer)
    ) {
      console.log(`Dropping a connection to forgotten peer ${connectedPeer.dataConnection.peer}.`);
      closeConnection(connectedPeer.dataConnection);
      return;
    }

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
      // Connections closed on purpose are removed before they are closed, see `removeConnection`.
      // Otherwise, the connection was lost, e.g. due to a network failure, so reconnect.
      if (this.removeConnection(connectedPeer))
        this.connectToRemotePeer(connectedPeer.dataConnection.peer);
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
    // Connected, whether by this peer or by the remote peer.
    this.cancelConnectionRetry(peerJsPeerId);

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

    for (const spareConnection of spareConnections) {
      const { dataConnection } = spareConnection;
      console.log(
        `Closing spare connection ${dataConnection.connectionId} to ${dataConnection.peer}.`,
      );
      this.removeConnection(spareConnection);
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

  // Stop using a connection: when it closes, or as soon as it is decided to close it, because
  // `send` would otherwise keep using it until it closes, and the remote peer discards whatever it
  // receives after the close marker of `closeConnection`. Messages received on it are still
  // processed. Returns whether the connection was removed, as it may already have been.
  removeConnection(peer: ConnectedPeer): boolean {
    const peerJsPeerId = peer.dataConnection.peer;
    const connections = this.connections[peerJsPeerId] ?? [];
    const index = connections.indexOf(peer);

    if (index === -1) return false;

    // Only this connection is removed, the peer may still have others, see `connections`.
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

    return true;
  }

  disconnect(): void {
    console.log('WebRtcNetworkAdapter::disconnect()');

    // Set first, so that closing the connections below does not cause reconnecting.
    this.stopped = true;

    for (const stopWatcher of this.stopWatchers) stopWatcher();
    this.stopWatchers = [];

    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    for (const remotePeerPeerJsPeerId of Object.keys(this.connectionRetries))
      this.cancelConnectionRetry(remotePeerPeerJsPeerId);

    clearTimeout(this.signallingRetry.timer);
    // Closed by destroying the peer below.
    this.pendingConnections = {};

    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      for (const peerJsPeerId of Object.keys(connectedPeers)) delete connectedPeers[peerJsPeerId];
    });

    // Closing a connection removes it from `connections` (see `removeConnection`), so iterate over
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
