import { describe, expect, it } from 'vitest';
import * as auth from '@/auth';
import { CALENDAR_ID, OTHER_CALENDAR_ID, isSameKey, testTranscript } from './helpers';

function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

describe('invite secrets', () => {
  it('are 32 random bytes', async () => {
    const secret = await auth.generateInviteSecret();

    expect(Uint8Array.fromBase64(secret.string)).toHaveLength(32);
    expect((await auth.generateInviteSecret()).string).not.toBe(secret.string);
  });

  it('are parsed back with the same thumbprint and a non-exportable key', async () => {
    const secret = await auth.generateInviteSecret();
    const parsed = await auth.parseInviteSecret(secret.string);

    expect(parsed.thumbprint).toBe(secret.thumbprint);
    expect(parsed.hmacKey.extractable).toBe(false);
    expect(secret.hmacKey.extractable).toBe(false);
  });

  it('have thumbprints that differ per secret and do not reveal it', async () => {
    const [a, b] = [await auth.generateInviteSecret(), await auth.generateInviteSecret()];

    expect(a.thumbprint).not.toBe(b.thumbprint);
    expect(a.thumbprint).not.toContain(a.string.slice(0, 10));
  });

  it('reject secrets of the wrong length', async () => {
    const secret = await auth.generateInviteSecret();

    await expect(auth.parseInviteSecret(secret.string.slice(0, 40))).rejects.toThrow();
    // The format before secrets were shortened to 32 bytes.
    await expect(auth.parseInviteSecret(new Uint8Array(64).toBase64())).rejects.toThrow();
  });
});

describe('calendar ID tags', () => {
  it('identify a calendar for a given invite, without revealing its ID', async () => {
    const secret = await auth.generateInviteSecret();
    const tag = await auth.calendarIdTag(secret, CALENDAR_ID);

    expect(await auth.calendarIdTag(secret, CALENDAR_ID)).toBe(tag);
    expect(await auth.calendarIdTag(secret, OTHER_CALENDAR_ID)).not.toBe(tag);
    expect(tag).not.toContain(CALENDAR_ID);
  });

  it('differ per invite, so that they do not link invites together', async () => {
    const [a, b] = [await auth.generateInviteSecret(), await auth.generateInviteSecret()];

    expect(await auth.calendarIdTag(a, CALENDAR_ID)).not.toBe(
      await auth.calendarIdTag(b, CALENDAR_ID),
    );
  });

  it('differ from the thumbprint, which is signed with the same key', async () => {
    const secret = await auth.generateInviteSecret();

    expect(await auth.calendarIdTag(secret, CALENDAR_ID)).not.toBe(secret.thumbprint);
  });
});

describe('handshake signatures', () => {
  it('are verified with the same key, role and transcript', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();

    for (const role of ['initiator', 'responder'] as const) {
      const signature = await auth.signHandshake(key, role, transcript);
      expect(await auth.verifyHandshake(key, role, transcript, signature)).toBe(true);
    }
  });

  it('accept challenges received as an `ArrayBuffer`', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();
    const signature = await auth.signHandshake(key, 'initiator', transcript);
    const asArrayBuffers = {
      ...transcript,
      challengeInitiator: (transcript.challengeInitiator as Uint8Array).slice().buffer,
      challengeResponder: (transcript.challengeResponder as Uint8Array).slice().buffer,
    };

    expect(await auth.verifyHandshake(key, 'initiator', asArrayBuffers, signature)).toBe(true);
  });

  it('cannot be reflected back as the other role', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();
    const signature = await auth.signHandshake(key, 'responder', transcript);

    expect(await auth.verifyHandshake(key, 'initiator', transcript, signature)).toBe(false);
  });

  it('are bound to both challenges, in order', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();
    const signature = await auth.signHandshake(key, 'responder', transcript);
    const swapped = {
      ...transcript,
      challengeInitiator: transcript.challengeResponder,
      challengeResponder: transcript.challengeInitiator,
    };

    expect(await auth.verifyHandshake(key, 'responder', swapped, signature)).toBe(false);
  });

  it('are bound to the DTLS fingerprints of both ends', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();
    const signature = await auth.signHandshake(key, 'initiator', transcript);
    const relayed = { ...transcript, fingerprintsResponder: 'sha-256 CC' };

    expect(await auth.verifyHandshake(key, 'initiator', relayed, signature)).toBe(false);
  });

  it('are rejected with another key', async () => {
    const transcript = testTranscript();
    const signature = await auth.signHandshake(await hmacKey(), 'initiator', transcript);

    expect(await auth.verifyHandshake(await hmacKey(), 'initiator', transcript, signature)).toBe(
      false,
    );
  });

  it('reject challenges of the wrong length', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();
    const signature = await auth.signHandshake(key, 'initiator', transcript);
    const short = {
      ...transcript,
      challengeInitiator: (transcript.challengeInitiator as Uint8Array).slice(1),
    };

    expect(await auth.verifyHandshake(key, 'initiator', short, signature)).toBe(false);
  });

  it('are an HMAC of the documented JSON', async () => {
    const key = await hmacKey();
    const transcript = testTranscript();
    const json = JSON.stringify({
      purpose: 'pin-calendar-handshake',
      role: 'initiator',
      challengeInitiator: (transcript.challengeInitiator as Uint8Array).toBase64(),
      challengeResponder: (transcript.challengeResponder as Uint8Array).toBase64(),
      fingerprintsInitiator: transcript.fingerprintsInitiator,
      fingerprintsResponder: transcript.fingerprintsResponder,
    });
    const expected = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(json)),
    );

    expect((await auth.signHandshake(key, 'initiator', transcript)).toBase64()).toBe(
      expected.toBase64(),
    );
  });
});

describe('authentication keys', () => {
  it('are the same on both peers, and non-exportable 256-bit HMAC keys', async () => {
    const [a, b] = [await auth.generateEcdhKeyPair(), await auth.generateEcdhKeyPair()];
    const keyIdA = await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw);
    const keyIdB = await auth.establishAuthenticationKey(b.privateKey, a.publicKeyRaw);
    const key = (await auth.loadAuthKey(keyIdA))!;

    expect(keyIdA).not.toBe(keyIdB);
    expect(await isSameKey(keyIdA, keyIdB)).toBe(true);
    expect(key.extractable).toBe(false);
    expect((key.algorithm as HmacKeyAlgorithm).length).toBe(256);
  });

  it('differ for another key pair', async () => {
    const [a, b, c] = [
      await auth.generateEcdhKeyPair(),
      await auth.generateEcdhKeyPair(),
      await auth.generateEcdhKeyPair(),
    ];

    expect(
      await isSameKey(
        await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw),
        await auth.establishAuthenticationKey(c.privateKey, b.publicKeyRaw),
      ),
    ).toBe(false);
  });

  it('are derived with HKDF, rather than being the raw ECDH secret', async () => {
    const [a, b] = [await auth.generateEcdhKeyPair(), await auth.generateEcdhKeyPair()];
    const keyId = await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw);
    const key = (await auth.loadAuthKey(keyId))!;
    const publicKey = await crypto.subtle.importKey(
      'raw',
      b.publicKeyRaw,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const secret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: publicKey },
      a.privateKey,
      256,
    );
    const hkdf = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    const expected = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode('pin-calendar-auth-key'),
      },
      hkdf,
      256,
    );
    const sign = async (raw: ArrayBuffer) =>
      new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
            'sign',
          ]),
          new Uint8Array([1]),
        ),
      ).toBase64();
    const actual = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new Uint8Array([1])),
    ).toBase64();

    expect(actual).toBe(await sign(expected));
    expect(actual).not.toBe(await sign(secret));
  });

  it('can be deleted', async () => {
    const [a, b] = [await auth.generateEcdhKeyPair(), await auth.generateEcdhKeyPair()];
    const kept = await auth.establishAuthenticationKey(a.privateKey, b.publicKeyRaw);
    const deleted = await auth.establishAuthenticationKey(b.privateKey, a.publicKeyRaw);

    await auth.deleteAuthKey(deleted);

    expect(await auth.loadAuthKey(deleted)).toBeUndefined();
    expect(await auth.loadAuthKey(kept)).toBeDefined();
  });
});
