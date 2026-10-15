import type { Ref } from 'vue';
import { changeSubtree, type Rop } from 'automerge-diy-vue-hooks';
import * as auth from './auth';
import type { LocalDocument, PeerJsPeerId } from './documents/local';

// Managing the remote peers of a calendar, together with their authentication keys.

// Set the authentication key of a remote peer, adding the peer if it is not known yet, e.g. after
// it joined. The key of a known peer is replaced, e.g. after one of the peers forgot the other and
// it joined again, in which case its previous key is deleted. Returns whether a known peer's key
// was replaced.
export async function setRemotePeerKey(
  docLocal: Ref<Rop<LocalDocument>>,
  peerJsPeerId: PeerJsPeerId,
  authKeyId: string,
): Promise<boolean> {
  const remotePeers = docLocal.value.remotePeers;
  // Read before the entry is overwritten below.
  const previousRemotePeer = Object.hasOwn(remotePeers, peerJsPeerId)
    ? { ...remotePeers[peerJsPeerId] }
    : undefined;

  remotePeers[changeSubtree]((remotePeers) => {
    remotePeers[peerJsPeerId] = {
      deviceName: previousRemotePeer?.deviceName ?? '', // TODO
      authKeyId,
    };
  });

  if (previousRemotePeer === undefined) return false;

  // A key left behind is harmless, so failing to delete it does not fail setting the new one.
  await auth
    .deleteAuthKey(previousRemotePeer.authKeyId)
    .catch((error) => console.error('Failed to delete a replaced authentication key:', error));
  return true;
}

// Forget a remote peer: remove it, and delete its authentication key. The WebRTC network adapter
// then disconnects from it, see `WebRtcNetworkAdapter.disconnectFromRemotePeer`.
export async function forgetRemotePeer(
  docLocal: Ref<Rop<LocalDocument>>,
  peerJsPeerId: PeerJsPeerId,
) {
  const remotePeers = docLocal.value.remotePeers;

  if (!Object.hasOwn(remotePeers, peerJsPeerId)) return;

  const authKeyId = remotePeers[peerJsPeerId].authKeyId;

  // Remove the peer first, so that its key can no longer be used to connect.
  remotePeers[changeSubtree]((remotePeers) => {
    delete remotePeers[peerJsPeerId];
  });

  await auth.deleteAuthKey(authKeyId);
}
