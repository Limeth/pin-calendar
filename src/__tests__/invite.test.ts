import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import { joinCalendar, type JoinResult } from '@/invite';
import * as auth from '@/auth';
import { network } from './fakes/peerjs';
import {
  CALENDAR_ID,
  OTHER_CALENDAR_ID,
  createInvite,
  device,
  isSameKey,
  sleep,
  type Device,
  type Invite,
} from './helpers';

const UNUSABLE_INVITE_MESSAGE =
  "This invite link is invalid, has expired, or has already been used. You might want to request a new invite link from the calendar's owner.";

let inviter: Device;

afterEach(() => {
  inviter?.adapter.disconnect();
  vi.restoreAllMocks();
});

// The inviting device, with an invite, and a log of its errors.
async function inviting(calendarId = CALENDAR_ID): Promise<[Invite, string[]]> {
  inviter = device('inviter');
  await sleep(10);
  const invite = await createInvite(inviter, 'inviter', calendarId);
  const errors: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...data) => errors.push(data.join(' ')));
  return [invite, errors];
}

async function join(invite: Invite): Promise<JoinResult> {
  const result = await joinCalendar(invite.args, 3_000);
  // Let the inviter finish.
  await sleep(50);
  return result;
}

function invitee(invite: Invite) {
  return inviter.docEphemeral.value.invites[invite.secret.thumbprint];
}

function remotePeerIds(): string[] {
  return Object.keys(inviter.docLocal.value.remotePeers);
}

describe('joining a calendar', () => {
  it('pairs both devices with the same key', async () => {
    const [invite] = await inviting();

    const result = await join(invite);

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(result.calendarId).toBe(CALENDAR_ID);
    expect(result.sharedDocumentId).toBe('shared-document');
    expect(remotePeerIds()).toEqual([result.peerJsPeerId]);
    expect(
      await isSameKey(
        result.authKeyId,
        inviter.docLocal.value.remotePeers[result.peerJsPeerId]!.authKeyId,
      ),
    ).toBe(true);
  });

  it('reserves the invite while joining, and marks it joined afterwards', async () => {
    const [invite] = await inviting();
    let whileJoining: { usedBy?: string; joined?: boolean } | undefined;
    network.tamper = (packet) => {
      // The state of the invite when the inviter accepts the join.
      if ((packet as { kind?: string }).kind === 'join-accept')
        whileJoining = { ...invitee(invite) };
      return packet;
    };

    const result = await join(invite);

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    expect(whileJoining?.usedBy).toBe(result.peerJsPeerId);
    expect(whileJoining?.joined).toBeUndefined();
    expect(invitee(invite)?.usedBy).toBe(result.peerJsPeerId);
    expect(invitee(invite)?.joined).toBe(true);
  });

  it('does not pair the inviter if `join-confirm` is lost, and releases the invite', async () => {
    const [invite] = await inviting();
    network.tamper = (packet) =>
      (packet as { kind?: string }).kind === 'join-confirm' ? null : packet;

    await join(invite);

    expect(remotePeerIds()).toEqual([]);
    expect(invitee(invite)?.usedBy).toBeUndefined();
  });

  it('fails on a tampered signature, and releases the invite', async () => {
    const [invite] = await inviting();
    network.tamper = (packet) =>
      (packet as { kind?: string }).kind === 'join-auth'
        ? { ...(packet as object), signature: new Uint8Array(32) }
        : packet;

    const result = await join(invite);

    expect(result).toEqual({ kind: 'error', message: 'Invalid signature in handshake request.' });
    expect(remotePeerIds()).toEqual([]);
    expect(invitee(invite)?.usedBy).toBeUndefined();
  });

  it('fails if the inviter shares another calendar than the one of the link', async () => {
    const [invite] = await inviting(OTHER_CALENDAR_ID);

    const result = await join(invite);

    expect(result).toEqual({
      kind: 'error',
      message: 'The shared calendar does not match the calendar of the invite link.',
    });
    expect(remotePeerIds()).toEqual([]);
    expect(invitee(invite)?.usedBy).toBeUndefined();
  });

  it('can be retried with the same invite after a failure', async () => {
    const [invite] = await inviting();
    network.tamper = (packet) =>
      (packet as { kind?: string }).kind === 'join-confirm' ? null : packet;
    await join(invite);
    network.tamper = (packet) => packet;

    const result = await join(invite);

    expect(result.kind).toBe('success');
    expect(remotePeerIds()).toHaveLength(1);
  });

  it('fails if the invite is cancelled before the inviter accepts', async () => {
    const [invite] = await inviting();
    network.tamper = (packet) => {
      // Cancelling deletes the invite, see `closeAddDeviceDialog`.
      if ((packet as { kind?: string }).kind === 'join-auth')
        inviter.docEphemeral.value.invites[changeSubtree]((invites) => {
          delete invites[invite.secret.thumbprint];
        });
      return packet;
    };

    const result = await join(invite);

    expect(result).toEqual({ kind: 'error', message: UNUSABLE_INVITE_MESSAGE });
    expect(remotePeerIds()).toEqual([]);
  });
});

describe('unusable invites', () => {
  it('are rejected with the same reply, whether used or unknown', async () => {
    const [invite, errors] = await inviting();
    expect((await join(invite)).kind).toBe('success');

    const used = await join(invite);
    // An unknown thumbprint, which also names an inherited property.
    network.tamper = (packet) =>
      (packet as { kind?: string }).kind === 'join-request'
        ? { ...(packet as object), secretThumbprint: 'toString' }
        : packet;
    const unknown = await join(await createInvite(inviter, 'inviter'));

    expect(used).toEqual({ kind: 'error', message: UNUSABLE_INVITE_MESSAGE });
    expect(unknown).toEqual(used);
    // Only the inviter logs why.
    expect(errors.some((error) => error.includes('invite already used by peer'))).toBe(true);
    expect(errors.some((error) => error.includes('unknown or expired invite'))).toBe(true);
    expect(errors.some((error) => error.includes('TypeError'))).toBe(false);
  });

  it('are rejected for a secret of the wrong length', async () => {
    const [invite] = await inviting();

    const result = await join({ ...invite, args: { ...invite.args, secret: 'not base64!' } });

    expect(result.kind).toBe('error');
  });
});

describe('calendar ID tags in invite links', () => {
  it('are computed from the invite secret and the calendar ID', async () => {
    const [invite] = await inviting();

    expect(invite.args.calendarIdTag).toBe(await auth.calendarIdTag(invite.secret, CALENDAR_ID));
  });
});
