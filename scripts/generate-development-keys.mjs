import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve('runtime', 'keys');
const privateKeyPath = resolve(outputDirectory, 'identity-development-private.pem');
const jwksPath = resolve(outputDirectory, 'identity-development-public.jwks.json');
const keyId = 'identity-development-1';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicJwk = publicKey.export({ format: 'jwk' });

await mkdir(outputDirectory, { recursive: true });
await writeFile(privateKeyPath, privatePem, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
await writeFile(
  jwksPath,
  `${JSON.stringify({ keys: [{ ...publicJwk, kid: keyId, alg: 'RS256', use: 'sig' }] }, null, 2)}\n`,
  { encoding: 'utf8', flag: 'wx' },
);

process.stdout.write(
  [
    'Generated disposable development signing material outside source control.',
    `JWT_KEY_ID=${keyId}`,
    `JWT_PRIVATE_KEY_PATH=${privateKeyPath}`,
    `JWT_PUBLIC_JWKS_PATH=${jwksPath}`,
    'Delete these files and run the command again to rotate them.',
  ].join('\n'),
);
