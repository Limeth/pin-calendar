import * as uuid from 'uuid';
import Peer from 'peerjs';
import type { HashArgsAddPeer } from './hash';
import type { InviteSecret } from './documents/ephemeral';
import type { CalendarId, PeerJsPeerId } from './documents/local';
import { generateChallenge, type Challenge, type Signature } from './auth';

export type ErrorPacket = {
  kind: 'error';
  message: string;
};

// 1. Sent from invitee to inviter.
export type HandshakeRequest = {
  kind: 'handshake-request';
  challenge: Challenge;
};

// 2. Sent from inviter to invitee.
export type HandshakeResponseSuccess = {
  kind: 'handshake-response';
  challenge: Challenge;
  // The signature for `HandshakeRequest::challenge`.
  signature: Signature;
};

export type HandshakeResponse = HandshakeResponseSuccess | ErrorPacket;

// 3. Sent from invitee to inviter, if the `HandshakeResponse::signature` was correct.
export type AccessRequestSuccess = {
  kind: 'access-request';
  // The signature for `HandshakeResponse::challenge`.
  signature: Signature;
};

export type AccessRequest = AccessRequestSuccess | ErrorPacket;

// 4. Sent from inviter to invitee, if the `AccessRequest::signature` was correct.
export type AccessResponseSuccess = {
  kind: 'access-response';
  calendarId: CalendarId;
  sharedDocumentId: string;
};

export type AccessResponse = AccessResponseSuccess | ErrorPacket;

export type AccessRequestResultError = {
  kind: 'error';
  message: string;
};

export type AccessRequestResultSuccess = {
  kind: 'success';
  peerJsPeerId: PeerJsPeerId;
  response: AccessResponseSuccess;
};

export type AccessRequestResult = AccessRequestResultError | AccessRequestResultSuccess;

export class AccessRequester {
  hashArgs: HashArgsAddPeer;
  peer: undefined | Peer;
  challengeSent: undefined | Challenge;
  challengeReceived: undefined | Challenge;

  constructor(hashArgs: HashArgsAddPeer) {
    this.hashArgs = hashArgs;
  }

  async requestAccess(timeoutMs: number): Promise<AccessRequestResult> {
    return new Promise((resolve) => {
      this.peer = new Peer(uuid.v7(), {
        debug: 3,
        secure: true,
      });

      setTimeout(() => {
        this.peer!.destroy();
        resolve({
          kind: 'error',
          message: 'Access request timed out.',
        });
      }, timeoutMs);

      this.peer.on('error', (error) => {
        console.error('Peer error: ', error);
        this.peer!.destroy();
        resolve({
          kind: 'error',
          message: error.message,
        });
      });

      this.peer.on('open', async (id) => {
        console.log(`Peer is now accessible with Peer ID: ${id}`);

        const dataConnection = this.peer!.connect(this.hashArgs.peerJsPeerId);

        dataConnection.once('open', () => {
          this.challengeSent = generateChallenge();
          const accessRequestPacket: HandshakeRequest = {
            kind: 'handshake-request',
            // secret: this.hashArgs.secret,
            challenge: this.challengeSent,
          };

          // Runs asynchronously
          dataConnection.send(accessRequestPacket);
        });

        dataConnection.once('data', (data) => {
          const packet = data as AccessResponse; // TODO: Validation?
          console.log('Received InviteResponse: ', packet);
          this.peer!.destroy();

          if (packet.kind === 'access-response') {
            resolve({
              kind: 'success',
              peerJsPeerId: id,
              response: packet,
            });
          } else if (packet.kind === 'error') {
            resolve(packet);
          }
        });
      });
    });
  }
}
