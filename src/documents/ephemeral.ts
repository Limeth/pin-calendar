import type { PeerInfo } from '@/webrtc';
import type { HashArgsAddPeer } from '@/hash';
import type { PeerJsPeerId } from './local';

export type ConnectedPeers = {
  [peerJsPeerId: PeerJsPeerId]: PeerInfo;
};

// A request to join a calendar this device already has, see `EphemeralDocument::outgoingJoins`.
export type OutgoingJoin = {
  // The arguments of the invite link, including the invite secret.
  invite: HashArgsAddPeer;
  status: 'requested' | 'joining' | 'joined' | 'failed';
  // Why joining failed, if it did.
  error?: string;
};

export type EphemeralDocument = {
  connectedPeers: {
    [peerJsPeerId: PeerJsPeerId]: PeerInfo;
  };
  // Invite secrets, which can only be used once to add a new device.
  invites: {
    [secretThumbprint: string]: {
      secretString: string;
      // The peer that is joining, or has joined, using this invite.
      usedBy?: PeerJsPeerId;
    };
  };
  // Requests to join this calendar, which this device already has, e.g. after it forgot the
  // inviter. They are made by the join dialog, and performed by the WebRTC network adapter, which
  // may run in another tab, see `WebRtcNetworkAdapter.performOutgoingJoins`. They are kept in the
  // ephemeral document, because they contain invite secrets, which must not be persisted.
  outgoingJoins: {
    [secretThumbprint: string]: OutgoingJoin;
  };
};
