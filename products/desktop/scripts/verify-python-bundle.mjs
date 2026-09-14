import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

if (!process.argv[2]) throw new Error('用法: verify-python-bundle.mjs <bundled-python-root>');
const root = path.resolve(process.argv[2]);
try {
  await access(path.join(root, 'pyvenv.cfg'));
  throw new Error('发布 Python 不得依赖构建机虚拟环境');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const probe = `import sys, pathlib, json, ssl, sqlite3
import grpc, google.protobuf, glimmer.cognition.v1.cognition_service_pb2
import glimmer_cradle.cognition, glimmer_cradle.audio
root = pathlib.Path(sys.argv[1]).resolve()
paths = [sys.prefix, sys.base_prefix, *sys.path]
assert all(pathlib.Path(p).resolve().is_relative_to(root) for p in paths if p), paths
print(json.dumps({'isolated': True, 'version': sys.version.split()[0]}))`;
await new Promise((resolve, reject) => {
  execFile(path.join(root, 'python.exe'), ['-I', '-c', probe, root], {
    cwd: root, windowsHide: true, timeout: 30000,
  }, (error, stdout) => {
    if (error) reject(error);
    else { process.stdout.write(stdout); resolve(); }
  });
});
