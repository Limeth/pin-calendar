import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '@/app';
import { checkInviterPairing } from '@/rejoin';
import type { HashArgsAddPeer } from '@/hash';
import { device, pairedKeys, type Device } from './helpers';

const devices: Device[] = [];

afterEach(() => {
  for (const { adapter } of devices.splice(0)) adapter.disconnect();
});

function started(...args: Parameters<typeof device>): Device {
  const created = device(...args);
  devices.push(created);
  return created;
}

// The parts of the app of a device used by `checkInviterPairing`.
function app(of: Device): App {
  return {
    docLocal: { data: of.docLocal },
    docEphemeral: { data: of.docEphemeral },
  } as unknown as App;
}

function inviteFrom(peerJsPeerId: string): HashArgsAddPeer {
  return { action: 'addPeer', secret: '', peerJsPeerId, calendarIdTag: '' };
}

async function timed<T>(promise: Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const result = await promise;
  return [result, Date.now() - start];
}

describe('checking the pairing with the inviter', () => {
  it('recognizes an invite created by this device', async () => {
    const laptop = started('laptop-1');

    expect(await checkInviterPairing(app(laptop), inviteFrom('laptop-1'), 1_500)).toBe(
      'own-invite',
    );
  });

  it('does not wait when the inviter is not a peer of this device', async () => {
    const phone = started('phone-2');

    const [pairing, ms] = await timed(
      checkInviterPairing(app(phone), inviteFrom('inviter-2'), 1_500),
    );

    expect(pairing).toBe('forgotten-inviter');
    expect(ms).toBeLessThan(100);
  });

  it('finds the devices paired once they connect', async () => {
    const [inviterKey, phoneKey] = await pairedKeys();
    started('inviter-3', { 'phone-3': { deviceName: '', authKeyId: inviterKey } });
    const phone = started('phone-3', { 'inviter-3': { deviceName: '', authKeyId: phoneKey } });

    const [pairing, ms] = await timed(
      checkInviterPairing(app(phone), inviteFrom('inviter-3'), 1_500),
    );

    expect(pairing).toBe('paired');
    expect(ms).toBeLessThan(1_500);
  });

  it('finds them unconnected when the inviter forgot this device', async () => {
    const [, phoneKey] = await pairedKeys();
    started('inviter-4');
    const phone = started('phone-4', { 'inviter-4': { deviceName: '', authKeyId: phoneKey } });

    const [pairing, ms] = await timed(
      checkInviterPairing(app(phone), inviteFrom('inviter-4'), 1_500),
    );

    expect(pairing).toBe('unconnected-inviter');
    expect(ms).toBeGreaterThanOrEqual(1_400);
  });
});
