// Generate build info file at build time
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const now = new Date();
const buildDate = now.toLocaleString(); // Local time string
const buildTimestamp = now.getTime();

// Read package.json to get version
const packageJsonPath = join(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

const content = `// Auto-generated build information
// DO NOT EDIT - This file is generated during the build process

export interface BuildInfo {
  version: string;
  buildDate: string;
  buildTimestamp: number;
}

export function getBuildInfo(): BuildInfo {
  return {
    version: '${version}',
    buildDate: '${buildDate}',
    buildTimestamp: ${buildTimestamp},
  };
}
`;

const outputPath = join(process.cwd(), 'src', 'utils', 'build-info.ts');
writeFileSync(outputPath, content, 'utf-8');

console.log(`Build info generated: v${version} at ${buildDate}`);
