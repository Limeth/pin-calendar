// A fake of PeerJS, used in place of the real one in all tests, see `setup.ts`. WebRTC and the
// signalling server are not available in tests, and tests need to cause failures at will: dropped
// or tampered packets, a lost signalling connection, unreachable peers, or a relay in between.
//
// Peers find each other by ID, and packets are delivered asynchronously. Each end of a connection
// has its own DTLS fingerprint in its session descriptions, like in WebRTC.
import { EventEmitter } from 'node:events';

const registry = new Map<string, Peer>();

// Tests can replace `tamper` to modify packets; returning `null` drops the packet and closes the
// connection.
export const network = {
  tamper: (packet: unknown): unknown => packet,
};

// Whether the signalling server can be reached, see `Peer.loseSignalling`.
export const signalling = { reachable: true };

export function resetNetwork() {
  registry.clear();
  network.tamper = (packet) => packet;
  signalling.reachable = true;
}

type ClosePacket = { __peerData: { type: 'close' } };

function isClosePacket(packet: unknown): packet is ClosePacket {
  return (packet as ClosePacket | undefined)?.__peerData?.type === 'close';
}

export class DataConnection extends EventEmitter {
  peer: string;
  connectionId: string;
  open = false;
  other!: DataConnection;
  peerConnection?: {
    localDescription: { sdp: string };
    remoteDescription: { sdp: string };
  };

  constructor(peer: string, connectionId: string) {
    super();
    this.peer = peer;
    this.connectionId = connectionId;
    this.on('open', () => (this.open = true));
  }

  async send(packet: unknown) {
    if (!this.open) return;

    const delivered = network.tamper(structuredClone(packet));

    if (delivered === null) return this.close();

    setTimeout(() => {
      if (!this.other.open) return;
      // Like PeerJS, close when the close marker of `close({ flush: true })` arrives.
      if (isClosePacket(delivered)) return this.other.close();
      this.other.emit('data', delivered);
    });
  }

  // Like PeerJS: with `flush`, a close marker is sent after the queued packets; otherwise, the
  // connection is closed immediately, discarding packets that are still in flight.
  close(options?: { flush?: boolean }) {
    if (options?.flush) {
      void this.send({ __peerData: { type: 'close' } });
      return;
    }

    // Like PeerJS, this end emits `close` right away, while the remote end learns about it later.
    if (this.open) {
      this.open = false;
      this.emit('close');
    }

    const other = this.other;

    if (other.open) {
      other.open = false;
      setTimeout(() => other.emit('close'));
    }
  }
}

// A session description with the fingerprint of a DTLS certificate, repeated, as in a description
// with several media sections.
function sdp(fingerprint: string): string {
  return (
    `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n` +
    `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ${fingerprint}\r\n`
  );
}

function randomFingerprint(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

let connectionCount = 0;

// The two ends of a connection between two peers, each with its own certificate. Both ends share
// the connection ID, like in PeerJS.
export function connectionPair(peerA: string, peerB: string): [DataConnection, DataConnection] {
  const connectionId = `dc_${String(++connectionCount).padStart(6, '0')}`;
  const [fingerprintA, fingerprintB] = [randomFingerprint(), randomFingerprint()];
  const a = new DataConnection(peerB, connectionId);
  const b = new DataConnection(peerA, connectionId);
  a.other = b;
  b.other = a;
  a.peerConnection = {
    localDescription: { sdp: sdp(fingerprintA) },
    remoteDescription: { sdp: sdp(fingerprintB) },
  };
  b.peerConnection = {
    localDescription: { sdp: sdp(fingerprintB) },
    remoteDescription: { sdp: sdp(fingerprintA) },
  };
  return [a, b];
}

export class Peer extends EventEmitter {
  id: string;
  // Like PeerJS, `open` once registered with the signalling server.
  open = false;
  disconnected = false;
  destroyed = false;
  connections: DataConnection[] = [];
  // The IDs of the peers this peer attempted to connect to, in order.
  connectCalls: string[] = [];

  constructor(id: string) {
    super();
    this.id = id;
    this.register();
  }

  private register() {
    setTimeout(() => {
      if (this.destroyed) return;

      if (!signalling.reachable) {
        // Like PeerJS, a failed (re)connection to the server ends in `disconnected`.
        this.disconnected = true;
        this.emit('disconnected', this.id);
        return;
      }

      registry.set(this.id, this);
      this.open = true;
      this.emit('open', this.id);
    });
  }

  // Like PeerJS: the connection to the signalling server is lost; existing connections stay.
  loseSignalling() {
    registry.delete(this.id);
    this.open = false;
    this.disconnected = true;
    this.emit('disconnected', this.id);
  }

  reconnect() {
    if (!this.disconnected || this.destroyed) throw new Error('Cannot reconnect.');

    this.disconnected = false;
    this.register();
  }

  connect(remoteId: string): DataConnection {
    if (!this.open) throw new Error('Cannot connect without the signalling server.');

    this.connectCalls.push(remoteId);

    const [local, remote] = connectionPair(this.id, remoteId);
    this.connections.push(local);

    setTimeout(() => {
      const remotePeer = registry.get(remoteId);

      if (remotePeer === undefined) {
        this.emit(
          'error',
          Object.assign(new Error(`Could not connect to peer ${remoteId}`), {
            type: 'peer-unavailable',
          }),
        );
        // Faster than PeerJS, which never ends such a connection, so that tests need not wait for
        // the timeout of connection attempts.
        local.emit('close');
        return;
      }

      remotePeer.emit('connection', remote);
      setTimeout(() => {
        local.emit('open');
        remote.emit('open');
      });
    });

    return local;
  }

  destroy() {
    this.destroyed = true;
    this.open = false;
    for (const connection of this.connections) connection.close();
    registry.delete(this.id);
  }
}

export default Peer;
