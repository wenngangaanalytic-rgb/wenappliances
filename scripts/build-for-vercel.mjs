import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const adminProjectId = 'prj_nDn7WQbO262RTrrY3ISPUG3JIqq2';
const isAdminProject = process.env.VERCEL_PROJECT_ID === adminProjectId;
const buildMode = isAdminProject ? 'admin' : 'storefront';
const viteBin = resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

// Always build from a clean generated directory so a previous storefront
// build cannot leave stale assets in an admin deployment (or vice versa).
rmSync(join(projectRoot, 'dist'), { recursive: true, force: true });

execFileSync(process.execPath, [viteBin, 'build', '--mode', buildMode], {
  cwd: projectRoot,
  stdio: 'inherit'
});

// The admin project previously used both dist and dist/admin settings. Keep
// both locations populated so either existing Vercel setting serves the right
// application during the transition.
if (isAdminProject) {
  const rootOutput = join(projectRoot, 'dist');
  const adminOutput = join(rootOutput, 'admin');
  mkdirSync(rootOutput, { recursive: true });

  for (const entry of readdirSync(adminOutput)) {
    cpSync(join(adminOutput, entry), join(rootOutput, entry), { recursive: true, force: true });
  }
}
