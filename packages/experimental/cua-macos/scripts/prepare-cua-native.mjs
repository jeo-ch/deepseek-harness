/** Build the CUA macOS native helper bundle before packing, on darwin hosts only. */
import { execSync } from 'node:child_process'

if (process.platform === 'darwin') {
  execSync('pnpm run build:native', { stdio: 'inherit' })
}
