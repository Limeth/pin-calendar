import type { ConnectRequestPacket } from '@/webrtc';
import type { CalendarId, PeerJsPeerId } from './local';

export type ConnectedPeers = {
  [peerJsPeerId: PeerJsPeerId]: ConnectRequestPacket;
};

export type InviteSecret = string;

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: PeerJsPeerId]: ConnectRequestPacket;
  };
  invites: {
    [secret: InviteSecret]: {
      usedBy?: PeerJsPeerId;
    };
  };
};
