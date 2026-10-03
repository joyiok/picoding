import { writeFile } from 'node:fs/promises';
import { sourceVersion } from '../server/version.js';
await writeFile('dist/version.json', JSON.stringify(await sourceVersion()) + '\n');
