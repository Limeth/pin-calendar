import {
  NetworkAdapter,
  type Message,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';
import { type DataConnection, Peer } from 'peerjs';
import { ref, type DeepReadonly, type Ref } from 'vue';
import { ClientSettingsAddPeer, type ClientSettings } from './client';

export type WebRtcNetworkAdapterOptions = {
  clientSettings: Ref<ClientSettings>;
};

export type ConnectedPeer = {
  dataConnection: DataConnection;
  connectMetadata: ConnectMetadata;
};

type Packet = {
  message: Message;
};

type ConnectMetadata = {
  automergePeerId: PeerId;
  automergePeerMetadata: PeerMetadata;
};

type ConnectResponsePacket = {
  metadata: ConnectMetadata;
};

export class WebRtcNetworkAdapter extends NetworkAdapter {
  readonly options: WebRtcNetworkAdapterOptions;
  ready: boolean;
  readyPromise: Promise<void>;
  readyResolver: () => void;
  peer: Peer | undefined;
  peerJsPeerId: string | undefined;
  connectedPeers: Ref<ConnectedPeer[]>;
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
    this.connectedPeers = ref([]);
    this.sessionCounter = 0;
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    this.peer = new Peer(this.options.clientSettings.value.localPeer.peerJsPeerId, {
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

    this.peer.on('open', (id) => {
      // Invoked when a connection to the signaling server is established.
      this.peerJsPeerId = id;

      // TODO
      for (const remotePeer of this.options.clientSettings.value.remotePeers) {
        const connectMetadata: ConnectMetadata = {
          automergePeerId: peerId,
          automergePeerMetadata: peerMetadata ?? {},
        };
        const dataConection = this.peer!.connect(remotePeer.peerJsPeerId, {
          metadata: connectMetadata,
        });

        dataConection.once('open', () => {
          this.onOutboundConnectionOpened(dataConection);
        });
      }
    });

    this.peer.on('connection', (dataConnection) => {
      this.onInboundConnectionRequested(dataConnection);
    });
  }

  getAutomergePeerId(peerJsPeerId: string): PeerId | undefined {
    return this.connectedPeers.value.find(
      (connectedPeer) => connectedPeer.dataConnection.peer === peerJsPeerId,
    )?.connectMetadata.automergePeerId;
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

    const firstConnection = this.connectedPeers.value.length === 0;

    console.log(`Adding opened peer peerJsPeerId:${connectedPeer.dataConnection.peer}`);
    ClientSettingsAddPeer(this.options.clientSettings.value, connectedPeer.dataConnection.peer);
    this.connectedPeers.value.push(connectedPeer);
    this.emit('peer-candidate', {
      peerId: connectedPeer.connectMetadata.automergePeerId,
      peerMetadata: connectedPeer.connectMetadata.automergePeerMetadata,
    });

    if (firstConnection) this.setReady();
  }

  setReady() {
    console.log('WebRTC Network Adapter set to ready.');
    this.ready = true;
    this.readyResolver();
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
    this.connectedPeers.value = this.connectedPeers.value.filter(
      (connectedPeer) => connectedPeer.dataConnection.peer !== peer.dataConnection.peer,
    );
    this.emit('peer-disconnected', {
      peerId: peer.connectMetadata.automergePeerId,
    });
  }

  disconnect(): void {
    for (const connectedPeer of this.connectedPeers.value) connectedPeer.dataConnection.close();

    console.assert(this.connectedPeers.value.length === 0);
    this.sessionCounter++;
  }

  send(message: Message): void {
    for (const connectedPeer of this.connectedPeers.value) {
      const packet: Packet = {
        message,
      };
      console.log(
        `Attempting to send packet to peer ${connectedPeer.dataConnection.peer}: `,
        packet,
      );
      connectedPeer.dataConnection.send(packet);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }
}
