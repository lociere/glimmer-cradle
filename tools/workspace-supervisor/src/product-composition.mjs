import fs from 'node:fs';
import path from 'node:path';
import { SupervisorInputError } from './errors.mjs';

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new SupervisorInputError(`${label} 无法读取: ${error.message}`);
  }
}

export function loadProductComposition(repositoryRoot, productId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(productId)) {
    throw new SupervisorInputError(`无效产品 ID: ${productId}`);
  }
  const productRoot = path.join(repositoryRoot, 'products', productId);
  const productManifestPath = path.join(productRoot, 'product.json');
  const packageManifestPath = path.join(productRoot, 'package.json');
  const productManifest = readJson(productManifestPath, `products/${productId}/product.json`);
  const packageManifest = readJson(packageManifestPath, `products/${productId}/package.json`);

  if (productManifest.schema_version !== 1 || productManifest.id !== productId) {
    throw new SupervisorInputError(`products/${productId}/product.json 的 id/schema_version 无效`);
  }
  if (typeof packageManifest.name !== 'string' || !packageManifest.name.startsWith('@glimmer-cradle/')) {
    throw new SupervisorInputError(`products/${productId}/package.json 缺少稳定 workspace package name`);
  }
  for (const script of ['product:dev', 'product:start']) {
    if (!packageManifest.scripts?.[script]) {
      throw new SupervisorInputError(`products/${productId}/package.json 缺少 ${script} owner 入口`);
    }
  }

  return {
    id: productId,
    packageName: packageManifest.name,
    productManifestPath,
    prepareScript: packageManifest.scripts?.['product:prepare'] ? 'product:prepare' : undefined,
    developmentScript: 'product:dev',
    productionScript: 'product:start',
  };
}
