import * as uuid from 'uuid';

const LOCAL_STORAGE_KEY_SECRET_KEY: string = "secret_key";
const SECRET_KEY_BYTES: number = 32;
const SECRET_KEY_ALGORITHM: AlgorithmIdentifier = { name: 'HKDF' };
const SECRET_KEY_EXTRACTABLE: boolean = true;
const SECRET_KEY_USAGES: [KeyUsage] = ['deriveBits'];
const SECRET_KEY_EXPORT_FORMAT = 'jwk';
const ID_BYTES = 32;

export type Id = string;

export type IdUsage = {
    usage: 'roomPassword',
} | {
    usage: 'pinCatalogRoom',
} | {
    usage: 'pinCalendarRoom',
};

export type Account = {
    readonly secretKeyData: Uint8Array,
    roomPassword?: Id,
    pinCatalogRoom?: Id,
    pinCalendarRoom?: Id,
};

async function AccountNew(): Promise<Account> {
    return {
        secretKeyData: crypto.getRandomValues(new Uint8Array(SECRET_KEY_BYTES)),
    }
}

async function AccountGetSecretKey(account: Account): Promise<CryptoKey> {
    return await crypto.subtle.importKey('raw', account.secretKeyData, SECRET_KEY_ALGORITHM, SECRET_KEY_EXTRACTABLE, SECRET_KEY_USAGES);
}

async function AccountLoad(): Promise<undefined | Account> {
    const secretKeyDataString = localStorage.getItem(LOCAL_STORAGE_KEY_SECRET_KEY);

    if (secretKeyDataString !== null)
        return {
            secretKeyData: fromHexString(secretKeyDataString),
        };
}

async function AccountSave(account: Account) {
    const secretKeyDataString = toHexString(account.secretKeyData);
    localStorage.setItem(LOCAL_STORAGE_KEY_SECRET_KEY, secretKeyDataString);
}

export async function AccountLoadOrNew(): Promise<Account> {
    let account = await AccountLoad();

    if (account !== undefined)
        return account;

    account = await AccountNew();

    await AccountSave(account);

    return account;
}

async function AccountDeriveId(account: Account, usage: IdUsage, label: string): Promise<Id> {
    const hkdfParams = {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: Uint8Array.of(),
        info: new TextEncoder().encode(JSON.stringify(usage)),
    };
    const secretKey = await AccountGetSecretKey(account);
    const bits = await crypto.subtle.deriveBits(hkdfParams, secretKey, ID_BYTES * 8);
    const hexString = toHexString(new Uint8Array(bits));
    return `${label}:${hexString}`;
}

async function AccountGetId(key: Exclude<keyof Account, 'secretKeyData'>, account: Account): Promise<Id> {
    if (account[key] === undefined)
        account[key] = await AccountDeriveId(account, { usage: key }, key);

    return account[key];
}

export async function AccountGetRoomPassword(account: Account): Promise<Id> {
    return AccountGetId('roomPassword', account);
}

export async function AccountGetPinCatalogRoom(account: Account): Promise<Id> {
    return AccountGetId('pinCatalogRoom', account);
}

export async function AccountGetPinCalendarRoom(account: Account): Promise<Id> {
    return AccountGetId('pinCalendarRoom', account);
}

function fromHexString(hexString: string): Uint8Array {
    const match = hexString.match(/.{1,2}/g!);
    if (match !== null)
        return Uint8Array.from(match.map((byte) => parseInt(byte, 16)));
    else
        return new Uint8Array();
}

function toHexString(bytes: Uint8Array): string {
    return bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
}
