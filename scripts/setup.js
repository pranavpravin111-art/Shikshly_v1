// One-time setup: creates apps/api/.env and apps/web/.env with random secrets. Safe to re-run (never overwrites).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const secret = () => crypto.randomBytes(36).toString('hex');
function make(dir, transform) {
  const target = path.join(root, dir, '.env');
  if (fs.existsSync(target)) return console.log(`kept existing ${dir}/.env`);
  fs.writeFileSync(target, transform(fs.readFileSync(path.join(root, dir, '.env.example'), 'utf8')));
  console.log(`created ${dir}/.env`);
}
make('apps/api', t => t.replace(/JWT_SECRET=.*/, `JWT_SECRET=${secret()}`).replace(/PLATFORM_ADMIN_BOOTSTRAP_SECRET=.*/, `PLATFORM_ADMIN_BOOTSTRAP_SECRET=${secret()}`));
make('apps/web', t => t);
console.log('\nNext: npm run db:up   then   npm run seed:demo   then   npm run dev');
