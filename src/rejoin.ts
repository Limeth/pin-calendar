import { watch } from 'vue';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import type { App } from './app';
import * as auth from './auth';
import type { ErrorPacket } from './handshake';
import type { HashArgsAddPeer } from './hash';

// Whether this device is paired with the inviter of a calendar it already has.
// - 'own-invite': the invite was created by this device.
// - 'paired': this device and the inviter know each other, so there is nothing to join.
// - 'forgotten-inviter': this device does not have the inviter among its peers, e.g. because it
//   forgot it, so the inviter was not contacted.
// - 'unconnected-inviter': this device has the inviter among its peers, but could not connect to
//   it, e.g. because the inviter forgot this device, or their keys differ. As with any of its
//   peers, this device tried to connect to it, so the inviter received its IP address.
// In both of the latter cases, they can only be paired again by joining, see `joinExistingCalendar`.
export type InviterPairing = 'own-invite' | 'paired' | 'forgotten-inviter' | 'unconnected-inviter';

// Find out whether this device is paired with the inviter, see `InviterPairing`.
export async function checkInviterPairing(
  app: App,
  invite: HashArgsAddPeer,
  timeoutMs: number,
): Promise<InviterPairing> {
  const local = app.docLocal.data.value;

  if (invite.peerJsPeerId === local.localPeer.peerJsPeerId) return 'own-invite';
  if (!Object.hasOwn(local.remotePeers, invite.peerJsPeerId)) return 'forgotten-inviter';

  // The inviter cannot be asked whether it knows this device, but connecting to it answers that: a
  // connection is only established if both devices know each other, with the same key. The inviter
  // is online, because it only keeps the invite while its invite dialog is open, so if they are
  // paired, the WebRTC network adapter connects to it soon.
  // `Object.keys`, because Vue does not track `Object.hasOwn`, so watching it would never trigger.
  const connected = () =>
    Object.keys(app.docEphemeral.data.value.connectedPeers).includes(invite.peerJsPeerId);

  if (connected()) return 'paired';

  return await new Promise<InviterPairing>((resolve) => {
    const stopWatching = watch(connected, (connected) => {
      if (!connected) return;

      clearTimeout(timeout);
      stopWatching();
      resolve('paired');
    });
    const timeout = setTimeout(() => {
      stopWatching();
      resolve('unconnected-inviter');
    }, timeoutMs);
  });
}

// Join a calendar this device already has, e.g. after it forgot the inviter, or the inviter forgot
// it. Unlike `joinCalendar`, which joins as a new device, the join is performed by the calendar's
// WebRTC network adapter, which may run in another tab, see `EphemeralDocument::outgoingJoins`.
export async function joinExistingCalendar(
  app: App,
  invite: HashArgsAddPeer,
  timeoutMs: number,
): Promise<ErrorPacket | undefined> {
  const { thumbprint } = await auth.parseInviteSecret(invite.secret);
  const outgoingJoins = () => app.docEphemeral.data.value.outgoingJoins;

  outgoingJoins()[changeSubtree]((outgoingJoins) => {
    outgoingJoins[thumbprint] = {
      invite: { ...invite },
      status: 'requested',
    };
  });

  try {
    return await new Promise<ErrorPacket | undefined>((resolve) => {
      const stopWatching = watch(
        () => outgoingJoins()[thumbprint]?.status,
        (status) => {
          if (status !== 'joined' && status !== 'failed') return;

          clearTimeout(timeout);
          stopWatching();
          resolve(
            status === 'joined'
              ? undefined
              : {
                  kind: 'error',
                  message: outgoingJoins()[thumbprint]?.error ?? 'Joining the calendar failed.',
                },
          );
        },
      );
      // Longer than the adapter's own timeout, because the adapter may first need to be started.
      const timeout = setTimeout(() => {
        stopWatching();
        resolve({ kind: 'error', message: 'Joining the calendar timed out.' });
      }, timeoutMs);
    });
  } finally {
    // The request contains the invite secret, so it is removed as soon as it is no longer needed.
    outgoingJoins()[changeSubtree]((outgoingJoins) => {
      delete outgoingJoins[thumbprint];
    });
  }
}
