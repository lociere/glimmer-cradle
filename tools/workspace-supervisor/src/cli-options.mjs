import { SupervisorUsageError } from './errors.mjs';

export function parseCliOptions(args) {
  let mode;
  let repositoryRoot;
  let kernelOnly = false;
  let planOnly = false;
  let productId;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--mode') {
      mode = args[index + 1];
      if (!mode) throw new SupervisorUsageError('--mode 需要 development 或 production');
      index += 1;
    } else if (argument === '--repository-root') {
      repositoryRoot = args[index + 1];
      if (!repositoryRoot) throw new SupervisorUsageError('--repository-root 需要路径参数');
      index += 1;
    } else if (argument === '--kernel-only') {
      kernelOnly = true;
    } else if (argument === '--plan') {
      planOnly = true;
    } else if (argument.startsWith('-')) {
      throw new SupervisorUsageError(`未知参数: ${argument}`);
    } else if (productId) {
      throw new SupervisorUsageError(`只允许一个产品 ID: ${productId}, ${argument}`);
    } else {
      productId = argument;
    }
  }
  if (!['development', 'production'].includes(mode)) {
    throw new SupervisorUsageError('--mode 必须是 development 或 production');
  }
  return { mode, repositoryRoot, kernelOnly, planOnly, productId: productId ?? 'desktop' };
}
