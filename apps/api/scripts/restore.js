/**
 * Puts a backup back into the database.
 *   npm run restore -- --file backups/shikshly-2026-10-07-0930.bak              (dry run: only shows what is inside)
 *   npm run restore -- --file backups/....bak --confirm                         (writes the records; existing ones with the same id are replaced)
 *   npm run restore -- --file backups/....bak --confirm --drop                  (empties each collection first = exact copy of the backup)
 * Practise this once on a test database BEFORE you ever need it.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { unpackBackup } from '../src/backup-lib.js';

const { EJSON } = mongoose.mongo.BSON;
const args = process.argv.slice(2), flag = (n) => args.includes(`--${n}`), value = (n) => args[args.indexOf(`--${n}`) + 1];
async function main() {
    if (!flag('file'))
        throw new Error('Tell me which file: npm run restore -- --file backups/<name>.bak');
    if (!process.env.MONGO_URI)
        throw new Error('MONGO_URI is required (see apps/api/.env)');
    const data = unpackBackup(await readFile(value('file')), { deserialize: (text) => EJSON.parse(text, { relaxed: false }), passphrase: process.env.BACKUP_PASSPHRASE || '' });
    for (const [name, docs] of Object.entries(data))
        console.log(`  ${name}: ${docs.length} records`);
    if (!flag('confirm'))
        return console.log('\nDry run only. Add --confirm to write this into the database named in MONGO_URI.\n');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    for (const [name, docs] of Object.entries(data)) {
        const collection = mongoose.connection.db.collection(name);
        if (flag('drop'))
            await collection.deleteMany({});
        for (let i = 0; i < docs.length; i += 500)
            await collection.bulkWrite(docs.slice(i, i + 500).map(doc => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })));
    }
    console.log('\nRestore finished. Restart the API so it picks up the data.\n');
    await mongoose.disconnect();
}
main().catch(async (error) => { console.error(`\nRestore failed: ${error.message}\n`); await mongoose.disconnect().catch(() => undefined); process.exitCode = 1; });
