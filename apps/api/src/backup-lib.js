import { gunzipSync, gzipSync } from 'node:zlib';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Backup file format (pure code, unit-tested): one line per document "collection<TAB>json", gzipped,
 * and optionally encrypted with AES-256-GCM using a passphrase (so a backup file is useless if it leaks).
 * `serialize`/`deserialize` are passed in (the scripts use MongoDB's EJSON, which keeps ObjectIds and dates exact).
 */
const MAGIC = Buffer.from('SHKB1');
export const isEncrypted = (buffer) => buffer.subarray(0, MAGIC.length).equals(MAGIC);

export function packBackup(collections, { serialize, passphrase = '' }) {
    const lines = [];
    for (const [name, docs] of Object.entries(collections))
        for (const doc of docs)
            lines.push(`${name}\t${serialize(doc)}`);
    const gz = gzipSync(Buffer.from(lines.join('\n'), 'utf8'));
    if (!passphrase)
        return gz;
    const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(passphrase, salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(gz), cipher.final()]);
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function unpackBackup(buffer, { deserialize, passphrase = '' }) {
    let gz = buffer;
    if (isEncrypted(buffer)) {
        if (!passphrase)
            throw new Error('This backup is encrypted. Set BACKUP_PASSPHRASE to the passphrase used when it was made.');
        const salt = buffer.subarray(5, 21), iv = buffer.subarray(21, 33), tag = buffer.subarray(33, 49), body = buffer.subarray(49);
        const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
        decipher.setAuthTag(tag);
        try {
            gz = Buffer.concat([decipher.update(body), decipher.final()]);
        }
        catch {
            throw new Error('Wrong passphrase, or the backup file is damaged.');
        }
    }
    const result = {};
    const text = gunzipSync(gz).toString('utf8');
    for (const line of text ? text.split('\n') : []) {
        const tab = line.indexOf('\t');
        (result[line.slice(0, tab)] ||= []).push(deserialize(line.slice(tab + 1)));
    }
    return result;
}
