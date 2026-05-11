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
import {
  LocalDocumentAddPeer,
  type CalendarId,
  type LocalDocument,
  type RemotePeer,
} from './documents/local';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { EphemeralDocument } from './documents/ephemeral';
import type { AccessRequest, AccessResponseError, AccessResponseSuccess } from './invite';

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

export type ConnectedPeer = {
  dataConnection: DataConnection;
  connectRequestPacket: ConnectRequestPacket;
};

type Packet = {
  message: Message;
};

export type ConnectRequestPacket = {
  kind: 'connect';
  automergePeerId: string;
  automergePeerMetadata: PeerMetadata;
  secret: string;
};

export type RequestPacket = ConnectRequestPacket | AccessRequest;

type ConnectResponsePacket = {
  message: ConnectRequestPacket;
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
          this.onOutboundConnectionOpened(dataConnection, remotePeer);
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

  onOutboundConnectionOpened(dataConnection: DataConnection, remotePeer: RemotePeer) {
    dataConnection.once('data', (data) => {
      const packet = data as ConnectResponsePacket; // TODO: Validation?
      console.log('Received ConnectResponsePacket: ', packet);
      this.onConnectionOpened({
        dataConnection,
        connectRequestPacket: packet.message,
      });
    });

    const connectRequestPacket: ConnectRequestPacket = {
      kind: 'connect',
      automergePeerId: this.peerId!,
      automergePeerMetadata: this.peerMetadata ?? {},
      secret: remotePeer.sharedSecret,
    };

    dataConnection.send(connectRequestPacket);
  }

  onInboundConnectionRequested(dataConnection: DataConnection) {
    dataConnection.once('open', () => {
      dataConnection.once('data', (message) => {
        const requestPacket = message as RequestPacket; // TODO: Schema validation

        if (requestPacket.kind === 'connect') {
          // TODO: Implement cryptographically-secure peer authentication
          if (
            !(dataConnection.peer in this.options.docLocal.value.remotePeers) ||
            requestPacket.secret !==
              this.options.docLocal.value.remotePeers[dataConnection.peer].sharedSecret
          ) {
            console.error(
              `Denied a connection request from unauthorized peer: ${dataConnection.peer}`,
            );
            // TODO: Send error.
            dataConnection.close();
            return;
          }

          const connectResponsePacket: ConnectResponsePacket = {
            message: {
              kind: 'connect',
              automergePeerId: this.peerId!,
              automergePeerMetadata: this.peerMetadata!,
              secret: requestPacket.secret,
            },
          };
          console.log('Sending ConnectResponsePacket: ', connectResponsePacket);
          // Asynchronously send a response packet without awaiting.
          dataConnection.send(connectResponsePacket);

          this.onConnectionOpened({
            dataConnection,
            connectRequestPacket: requestPacket,
          });
        } else if (requestPacket.kind === 'request-access') {
          this.onRequestAccessReceived(dataConnection, requestPacket);
        } else {
          // TODO: Send error
          dataConnection.close();
        }
      });
    });
  }

  onRequestAccessReceived(dataConnection: DataConnection, accessRequest: AccessRequest) {
    function sendAndCloseAsynchronously(getMessage: () => undefined | unknown) {
      const doSend = async () => {
        console.assert(dataConnection.open);
        const message = getMessage();

        if (message !== undefined) {
          console.log('SENDING: ', message);
          await dataConnection.send(message);
        }

        dataConnection.close();
      };

      // dataConnection.on('close', () => console.warn('CLOSED'));
      // dataConnection.on('error', (e) => console.warn('ERROR', e));

      if (dataConnection.open) {
        doSend();
      } else {
        dataConnection.once('open', doSend);
      }
    }

    if (dataConnection.peer in this.options.docLocal.value.remotePeers) {
      console.info(
        `The known peer ${dataConnection.peer} is attempting to request access to the document.`,
      );

      if (this.options.docLocal.value.documentIdShared) {
        const message: AccessResponseSuccess = {
          kind: 'success',
          calendarId: this.options.calendarId,
          sharedDocumentId: this.options.docLocal.value.documentIdShared,
        };
        sendAndCloseAsynchronously(() => message);
      }
      return;
    }

    if (accessRequest.secret in this.options.docEphemeral.value.invites) {
      const invite = this.options.docEphemeral.value.invites[accessRequest.secret];
      if (invite.usedBy === undefined) {
        sendAndCloseAsynchronously(() => {
          if (invite.usedBy !== undefined) return;
          console.info(
            `Adding peer ${dataConnection.peer} to remote peers of document ${this.options.calendarId}.`,
          );
          invite[changeSubtree]((invite) => {
            invite.usedBy = dataConnection.peer;
          });
          this.options.docLocal.value.remotePeers[changeSubtree]((remotePeers) => {
            remotePeers[dataConnection.peer] = {
              deviceName: '', // TODO
              sharedSecret: accessRequest.secret,
            };
          });
          const message: AccessResponseSuccess = {
            kind: 'success',
            calendarId: this.options.calendarId,
            sharedDocumentId: this.options.docLocal.value.documentIdShared!,
          };
          return message;
        });
        return;
      }

      console.warn(
        `Peer ${dataConnection.peer} attempted to use an invite link that was already used.`,
      );
      const message: AccessResponseError = {
        kind: 'error',
        message:
          "This invite link cannot be used more than once. You might want to request a new invite link from the calendar's owner.",
      };
      sendAndCloseAsynchronously(() => message);
      return;
    }

    console.error(
      'Received an access request with an invalid secret: ',
      dataConnection,
      accessRequest,
    );
    dataConnection.close();
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
    LocalDocumentAddPeer(this.options.docLocal.value, {
      peerJsPeerId: connectedPeer.dataConnection.peer,
      deviceName: '', // TODO
      sharedSecret: connectedPeer.connectRequestPacket.secret,
    });
    this.options.docEphemeral.value.connectedPeers[changeSubtree]((connectedPeers) => {
      connectedPeers[connectedPeer.dataConnection.peer] = connectedPeer.connectRequestPacket;
    });
    this.dataConnections[connectedPeer.dataConnection.peer] = connectedPeer.dataConnection;
    this.emit('peer-candidate', {
      peerId: connectedPeer.connectRequestPacket.automergePeerId as PeerId,
      peerMetadata: connectedPeer.connectRequestPacket.automergePeerMetadata,
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
      peerId: peer.connectRequestPacket.automergePeerId as PeerId,
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
