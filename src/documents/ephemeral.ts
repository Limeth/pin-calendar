import type { ConnectMetadata } from '@/webrtc';
import type { CalendarId, PeerJsPeerId } from './local';

export type ConnectedPeers = {
  [peerJsPeerId: PeerJsPeerId]: ConnectMetadata;
};

export type InviteSecret = string;

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: PeerJsPeerId]: ConnectMetadata;
  };
  invites: {
    [secret: InviteSecret]: {
      usedBy?: PeerJsPeerId;
    };
  };
};
