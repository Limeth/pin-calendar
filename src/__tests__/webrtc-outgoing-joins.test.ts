import { afterEach, describe, expect, it } from 'vitest';
import { changeSubtree } from 'automerge-diy-vue-hooks';
import * as auth from '@/auth';
import { signalling } from './fakes/peerjs';
import {
  CALENDAR_ID,
  OTHER_CALENDAR_ID,
  createInvite,
  isConnected,
  isSameKey,
  pairedKeys,
  sleep,
  started,
  stopStartedDevices,
  until,
  type Device,
  peerId,
} from './helpers';

afterEach(stopStartedDevices);

describe('joining a calendar this device already has', () => {
  async function requestJoin(joining: Device, inviter: Device, calendarId = CALENDAR_ID) {
    const invite = await createInvite(
      inviter,
      inviter.docLocal.value.localPeer.peerJsPeerId,
      calendarId,
    );
    joining.docEphemeral.value.outgoingJoins[changeSubtree]((joins) => {
      joins[invite.secret.thumbprint] = { invite: invite.args, status: 'requested' };
    });
    // Performed by the adapter, which watches the requests.
    await until(
      () =>
        !['requested', 'joining'].includes(
          joining.docEphemeral.value.outgoingJoins[invite.secret.thumbprint]!.status,
        ),
      12_000,
    );
    return { invite, join: joining.docEphemeral.value.outgoingJoins[invite.secret.thumbprint]! };
  }

  it('re-pairs a device that forgot the inviter', { timeout: 20_000 }, async () => {
    const [oldKey] = await pairedKeys();
    const inviter = started(peerId('inviter-a'), {
      [peerId('phone-a')]: { deviceName: 'Phone', authKeyId: oldKey },
    });
    const phone = started(peerId('phone-a'));
    await sleep(50);

    const { join } = await requestJoin(phone, inviter);

    expect(join.status).toBe('joined');
    const inviterEntry = inviter.docLocal.value.remotePeers[peerId('phone-a')]!;
    expect(inviterEntry.authKeyId).not.toBe(oldKey);
    expect(inviterEntry.deviceName).toBe('Phone');
    expect(await auth.loadAuthKey(oldKey)).toBeUndefined();
    expect(
      await isSameKey(
        phone.docLocal.value.remotePeers[peerId('inviter-a')]!.authKeyId,
        inviterEntry.authKeyId,
      ),
    ).toBe(true);
    expect(
      await until(
        () => isConnected(phone, peerId('inviter-a')) && isConnected(inviter, peerId('phone-a')),
      ),
    ).toBe(true);
  });

  it('re-pairs with an inviter that forgot the device', { timeout: 20_000 }, async () => {
    const [, oldKey] = await pairedKeys();
    const inviter = started(peerId('inviter-b'));
    const phone = started(peerId('phone-b'), {
      [peerId('inviter-b')]: { deviceName: 'Laptop', authKeyId: oldKey },
    });
    await sleep(50);

    const { join } = await requestJoin(phone, inviter);

    expect(join.status).toBe('joined');
    const phoneEntry = phone.docLocal.value.remotePeers[peerId('inviter-b')]!;
    expect(phoneEntry.authKeyId).not.toBe(oldKey);
    expect(phoneEntry.deviceName).toBe('Laptop');
    expect(await auth.loadAuthKey(oldKey)).toBeUndefined();
    expect(
      await until(
        () => isConnected(phone, peerId('inviter-b')) && isConnected(inviter, peerId('phone-b')),
      ),
    ).toBe(true);
  });

  it('is performed once reconnected to the signalling server', { timeout: 20_000 }, async () => {
    const inviter = started(peerId('inviter-e'));
    const phone = started(peerId('phone-e'));
    await sleep(50);
    signalling.reachable = false;
    phone.peer().loseSignalling();
    const invite = await createInvite(inviter, peerId('inviter-e'));

    phone.docEphemeral.value.outgoingJoins[changeSubtree]((joins) => {
      joins[invite.secret.thumbprint] = { invite: invite.args, status: 'requested' };
    });
    await sleep(500);
    expect(phone.docEphemeral.value.outgoingJoins[invite.secret.thumbprint]?.status).toBe(
      'requested',
    );

    signalling.reachable = true;

    expect(
      await until(
        () => phone.docEphemeral.value.outgoingJoins[invite.secret.thumbprint]?.status === 'joined',
        8_000,
      ),
    ).toBe(true);
    expect(
      await until(
        () => isConnected(phone, peerId('inviter-e')) && isConnected(inviter, peerId('phone-e')),
      ),
    ).toBe(true);
  });

  it('fails for a different copy of the calendar', { timeout: 20_000 }, async () => {
    const inviter = started(peerId('inviter-c'));
    const phone = started(peerId('phone-c'), {}, { documentIdShared: 'other-shared-document' });
    await sleep(50);

    const { invite, join } = await requestJoin(phone, inviter);
    await sleep(100);

    expect(join.status).toBe('failed');
    expect(join.error).toBe(
      'The shared calendar is a different copy of the calendar than the one on the joining device.',
    );
    expect(inviter.docLocal.value.remotePeers[peerId('phone-c')]).toBeUndefined();
    expect(inviter.docEphemeral.value.invites[invite.secret.thumbprint]?.usedBy).toBeUndefined();
  });

  it('fails without contacting the inviter for another calendar', { timeout: 20_000 }, async () => {
    const inviter = started(peerId('inviter-d'));
    const phone = started(peerId('phone-d'));
    await sleep(50);

    const { join } = await requestJoin(phone, inviter, OTHER_CALENDAR_ID);

    expect(join).toMatchObject({
      status: 'failed',
      error: 'The invite link is for a different calendar.',
    });
  });
});
