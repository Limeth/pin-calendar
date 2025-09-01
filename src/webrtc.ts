import {
  NetworkAdapter,
  type Message,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';
import { type DataConnection, Peer } from 'peerjs';
import { type Ref } from 'vue';
import { LocalDocumentAddPeer, type LocalDocument } from './documents/local';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import type { ConnectedPeers } from './documents/ephemeral';

export type WebRtcNetworkAdapterOptions = {
  docLocal: Ref<Rop<LocalDocument>>;
  connectedPeers: Ref<Rop<ConnectedPeers>>;
  attemptToWaitForAnyPeerDurationMilliseconds: undefined | number;
};

export type ConnectedPeer = {
  dataConnection: DataConnection;
  connectMetadata: ConnectMetadata;
};

type Packet = {
  message: Message;
};

export type ConnectMetadata = {
  automergePeerId: string;
  automergePeerMetadata: PeerMetadata;
};

type ConnectResponsePacket = {
  metadata: ConnectMetadata;
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
      if (error.type === 'peer-unavailable') {
        console.log(error.message);
        return;
      }

      console.error('Unhandled peer error: ', error);
    });

    this.peer.on('open', async (id) => {
      // Invoked when a connection to the signaling server is established.
      this.peerJsPeerId = id;

      // TODO
      for (const remotePeerPeerJsPeerId of Object.keys(this.options.docLocal.value.remotePeers)) {
        const connectMetadata: ConnectMetadata = {
          automergePeerId: peerId,
          automergePeerMetadata: peerMetadata ?? {},
        };
        const dataConection = this.peer!.connect(remotePeerPeerJsPeerId, {
          metadata: connectMetadata,
        });

        dataConection.once('open', () => {
          this.onOutboundConnectionOpened(dataConection);
        });
      }

      if (
        Object.keys(this.options.docLocal.value.remotePeers).length > 0 &&
        this.options.attemptToWaitForAnyPeerDurationMilliseconds !== undefined
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.options.attemptToWaitForAnyPeerDurationMilliseconds),
        );
        this.setReady();
      } else {
        this.setReady();
      }
    });

    this.peer.on('connection', (dataConnection) => {
      this.onInboundConnectionRequested(dataConnection);
    });
  }

  getAutomergePeerId(peerJsPeerId: string): PeerId | undefined {
    return this.options.connectedPeers.value[peerJsPeerId]?.automergePeerId as PeerId | undefined;
  }

  onOutboundConnectionOpened(dataConnection: DataConnection) {
    dataConnection.once('data', (data) => {
      const packet = data as ConnectResponsePacket; // TODO: Validation?
      console.log('Received ConnectResponsePacket: ', packet);
      this.onConnectionOpened({
        dataConnection,
        connectMetadata: packet.metadata,
      });
    });
  }

  onInboundConnectionRequested(dataConnection: DataConnection) {
    const connectResponsePacket: ConnectResponsePacket = {
      metadata: {
        automergePeerId: this.peerId!,
        automergePeerMetadata: this.peerMetadata!,
      },
    };
    dataConnection.once('open', () => {
      console.log('Sending ConnectResponsePacket: ', connectResponsePacket);
      dataConnection.send(connectResponsePacket);
      this.onConnectionOpened({
        dataConnection,
        connectMetadata: dataConnection.metadata as ConnectMetadata, // TODO: Validation?
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

    console.log(`Adding opened peer peerJsPeerId:${connectedPeer.dataConnection.peer}`);
    LocalDocumentAddPeer(this.options.docLocal.value, {
      peerJsPeerId: connectedPeer.dataConnection.peer,
      deviceName: '', // TODO
    });
    this.options.connectedPeers.value[changeSubtree]((connectedPeers) => {
      connectedPeers[connectedPeer.dataConnection.peer] = connectedPeer.connectMetadata;
    });
    this.dataConnections[connectedPeer.dataConnection.peer] = connectedPeer.dataConnection;
    this.emit('peer-candidate', {
      peerId: connectedPeer.connectMetadata.automergePeerId as PeerId,
      peerMetadata: connectedPeer.connectMetadata.automergePeerMetadata,
    });
    this.setReady();
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
  }

  onPeerDisconnected(peer: ConnectedPeer) {
    this.options.connectedPeers.value[changeSubtree]((connectedPeers) => {
      delete connectedPeers[peer.dataConnection.peer];
    });
    delete this.dataConnections[peer.dataConnection.peer];
    this.emit('peer-disconnected', {
      peerId: peer.connectMetadata.automergePeerId as PeerId,
    });
  }

  disconnect(): void {
    console.log('WebRtcNetworkAdapter::disconnect()');

    this.options.connectedPeers.value[changeSubtree]((connectedPeers) => {
      for (const peerJsPeerId of Object.keys(connectedPeers)) delete connectedPeers[peerJsPeerId];
    });

    for (const [peerJsPeerId, dataConnection] of Object.entries(this.dataConnections)) {
      dataConnection.close();
      delete this.dataConnections[peerJsPeerId];
    }

    console.assert(Object.keys(this.options.connectedPeers.value).length === 0);
    console.assert(Object.keys(this.dataConnections).length === 0);
    this.sessionCounter++;
  }

  send(message: Message): void {
    console.log(`WebRtcNetworkAdapter::send(message = ${message})`);

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
