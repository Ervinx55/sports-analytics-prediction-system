import {spawnSync} from 'node:child_process';

// Vercel: exit 0 cancels the build; exit 1 continues it.
// Preview requests must validate the full branch, even after a backend-only commit.
if (process.env.VERCEL_ENV === 'preview') {
  console.log('Build requested preview.');
  process.exit(1);
}
const diff = spawnSync('git', ['diff', '--quiet', 'HEAD^', 'HEAD', './']);
// Missing Git history or any other error must not silently cancel validation.
process.exit(diff.status === 0 ? 0 : 1);
