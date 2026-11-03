import type { Ref } from 'vue';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import * as auth from './auth';
import {
  LocalDocumentGetRemotePeer,
  type LocalDocumentRop,
  type PeerJsPeerId,
} from './documents/local';
import { isObject } from './validation';

// Managing the remote peers of a calendar, together with their authentication keys.

// Set the authentication key of a remote peer, adding the peer if it is not known yet, e.g. after
// it joined. The key of a known peer is replaced, e.g. after one of the peers forgot the other and
// it joined again, in which case its previous key is deleted. Returns whether a known peer's key
// was replaced.
export async function setRemotePeerKey(
  docLocal: Ref<LocalDocumentRop>,
  peerJsPeerId: PeerJsPeerId,
  authKeyId: string,
): Promise<boolean> {
  // Copied before the entry is overwritten below. An invalid peer is replaced, and its key, which is
  // not known, is left behind.
  const remotePeer = LocalDocumentGetRemotePeer(docLocal.value, peerJsPeerId);
  const previousRemotePeer = remotePeer === undefined ? undefined : { ...remotePeer };

  docLocal.value[changeSubtree]((local) => {
    // Replaced if invalid, as none of its peers could be read anyway.
    if (!isObject(local.remotePeers)) local.remotePeers = {};

    local.remotePeers[peerJsPeerId] = {
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
// An invalid peer is removed, too, as it is removed on purpose.
export async function forgetRemotePeer(
  docLocal: Ref<LocalDocumentRop>,
  peerJsPeerId: PeerJsPeerId,
) {
  const remotePeers = docLocal.value.remotePeers;

  if (!isObject(remotePeers) || !Object.hasOwn(remotePeers, peerJsPeerId)) return;

  const authKeyId = LocalDocumentGetRemotePeer(docLocal.value, peerJsPeerId)?.authKeyId;

  // Remove the peer first, so that its key can no longer be used to connect.
  remotePeers[changeSubtree]((remotePeers) => {
    delete remotePeers[peerJsPeerId];
  });

  if (authKeyId !== undefined) await auth.deleteAuthKey(authKeyId);
}
