import { existsSync } from 'node:fs';
import path from 'node:path';

export function findPersonalServerPackageRoot(seed: string): string {
  let current = path.resolve(seed);
  while (true) {
    if (existsSync(path.join(current, 'products', 'personal-server', 'product.json'))) {
      return path.join(current, 'products', 'personal-server');
    }
    if (existsSync(path.join(current, 'product.json')) && existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(seed);
    current = parent;
  }
}
