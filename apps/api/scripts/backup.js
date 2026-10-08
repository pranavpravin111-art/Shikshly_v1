/**
 * Saves the whole database into ONE file (compressed, and encrypted if BACKUP_PASSPHRASE is set).
 *   npm run backup            -> apps/api/backups/shikshly-2026-10-07-0930.bak
 * Free MongoDB Atlas has no backups of its own, so run this weekly (the GitHub workflow in .github/workflows/backup.yml does it for you).
 * Made for small and medium schools: the whole database is read into memory (fine up to a few hundred MB).
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { packBackup } from '../src/backup-lib.js';

const { EJSON } = mongoose.mongo.BSON;
async function main() {
    if (!process.env.MONGO_URI)
        throw new Error('MONGO_URI is required (see apps/api/.env)');
    const passphrase = process.env.BACKUP_PASSPHRASE || '';
    if (process.env.CI && !passphrase)
        throw new Error('Refusing to make an unencrypted backup in CI. Set the BACKUP_PASSPHRASE secret.');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    const db = mongoose.connection.db, collections = {};
    for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
        if (name.startsWith('system.'))
            continue;
        collections[name] = await db.collection(name).find({}).toArray();
    }
    const file = packBackup(collections, { serialize: (doc) => EJSON.stringify(doc, { relaxed: false }), passphrase });
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const dir = new URL('../backups/', import.meta.url);
    await mkdir(dir, { recursive: true });
    const out = new URL(`shikshly-${stamp}.bak`, dir);
    await writeFile(out, file);
    const rows = Object.values(collections).reduce((n, docs) => n + docs.length, 0);
    console.log(`Backup saved: ${out.pathname}\n${Object.keys(collections).length} collections, ${rows} records, ${(file.length / 1024).toFixed(0)} KB${passphrase ? ', encrypted' : ' (NOT encrypted: set BACKUP_PASSPHRASE)'}`);
    await mongoose.disconnect();
}
main().catch(async (error) => { console.error(`\nBackup failed: ${error.message}\n`); await mongoose.disconnect().catch(() => undefined); process.exitCode = 1; });
