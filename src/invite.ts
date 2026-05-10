import * as uuid from 'uuid';
import Peer from 'peerjs';
import type { HashArgsAddPeer } from './hash';
import type { InviteSecret } from './documents/ephemeral';
import type { CalendarId, PeerJsPeerId } from './documents/local';

export type AccessRequest = {
  kind: 'request-access';
  secret: InviteSecret;
};

export type AccessResponseSuccess = {
  kind: 'success';
  calendarId: CalendarId;
  sharedDocumentId: string;
};

export type AccessResponseError = {
  kind: 'error';
  message: string;
};

export type AccessResponse = AccessResponseSuccess | AccessResponseError;

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
          const accessRequestPacket: AccessRequest = {
            kind: 'request-access',
            secret: this.hashArgs.secret,
          };

          // Runs asynchronously
          dataConnection.send(accessRequestPacket);
        });

        dataConnection.once('data', (data) => {
          const packet = data as AccessResponse; // TODO: Validation?
          console.log('Received InviteResponse: ', packet);
          this.peer!.destroy();

          if (packet.kind === 'success') {
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
