import type { ConnectMetadata } from '@/webrtc';

export type ConnectedPeers = {
  [peerJsPeerId: string]: ConnectMetadata;
};

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: string]: ConnectMetadata;
  };
};
