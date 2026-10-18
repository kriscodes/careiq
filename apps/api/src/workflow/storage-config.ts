import { access, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const applicationRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const insideApplication = (directory: string) => { const path = relative(applicationRoot, directory); return !path || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)); };
export class PrivateStorageConfigurationError extends Error {
    readonly code = 'PRIVATE_STORAGE_CONFIGURATION_REQUIRED';
    constructor() { super('Private document storage requires an owner-only directory outside the application checkout.'); }
}
/** Production has no development-directory fallback. The operator provisions the volume. */
export function privateStorageRoot(environment: NodeJS.ProcessEnv = process.env): string {
    const configured = environment.CAREIQ_PRIVATE_STORAGE_DIR;
    if (environment.NODE_ENV === 'production' && (!configured || !isAbsolute(configured) || insideApplication(resolve(configured)) || resolve(configured) === resolve('/'))) throw new PrivateStorageConfigurationError();
    return resolve(configured || resolve(process.cwd(), '.local-review/private-documents'));
}
/** Read-only preflight; never chmod, create a directory, or claim volume durability. */
export async function verifyPrivateStorageDirectory(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
    const directory = privateStorageRoot(environment);
    try {
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700 || (process.getuid && metadata.uid !== process.getuid())) throw new PrivateStorageConfigurationError();
        if (environment.NODE_ENV === 'production' && insideApplication(await realpath(directory))) throw new PrivateStorageConfigurationError();
        await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch { throw new PrivateStorageConfigurationError(); }
    return directory;
}
