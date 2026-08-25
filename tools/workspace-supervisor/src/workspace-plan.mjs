import path from 'node:path';
import { resolvePnpmInvocation } from './package-manager-invocation.mjs';
import { loadProductComposition } from './product-composition.mjs';

export function createWorkspacePlan({
  repositoryRoot,
  productId,
  mode,
  kernelOnly = false,
  platform = process.platform,
  execPath = process.execPath,
  existsSync,
}) {
  const composition = loadProductComposition(repositoryRoot, productId);
  const packageManager = resolvePnpmInvocation({
    platform,
    execPath,
    repositoryRoot,
    existsSync,
  });
  const command = (args) => ({
    command: packageManager.command,
    args: [...packageManager.prefix, ...args],
  });
  const preparation = mode === 'development' && composition.prepareScript
    ? command(['--filter', composition.packageName, 'run', composition.prepareScript])
    : undefined;
  const services = [
    {
      id: 'kernel',
      ...command(['--filter', '@glimmer-cradle/kernel', 'run', mode === 'production' ? 'start:built' : 'dev']),
    },
    ...kernelOnly ? [] : [{
      id: productId,
      ...command([
        '--filter', composition.packageName, 'run',
        mode === 'production' ? composition.productionScript : composition.developmentScript,
      ]),
    }],
  ];
  return {
    repositoryRoot,
    productId,
    mode,
    kernelOnly,
    preparation,
    services,
    environment: {
      GLIMMER_CRADLE_PRODUCT_MANIFEST: composition.productManifestPath,
      GLIMMER_CRADLE_EXTENSION_MODULE_ROOT: path.join(repositoryRoot, 'build', 'extension-host', 'modules'),
    },
  };
}
