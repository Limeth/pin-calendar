import type { PeerInfo } from '@/webrtc';
import type { PeerJsPeerId } from './local';

export type ConnectedPeers = {
  [peerJsPeerId: PeerJsPeerId]: PeerInfo;
};

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: PeerJsPeerId]: PeerInfo;
  };
  // Invite secrets, which can only be used once to add a new device.
  invites: {
    [secretThumbprint: string]: {
      secretString: string;
      usedBy?: PeerJsPeerId;
    };
  };
};
