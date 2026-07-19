import process from 'node:process';
import { PersonalServerApp } from './server/bootstrap/personal-server-app';

const host = process.env.GLIMMER_CRADLE_SERVER_HOST?.trim() || '127.0.0.1';
const port = Number.parseInt(process.env.GLIMMER_CRADLE_SERVER_PORT || '3210', 10);
const token = process.env.GLIMMER_CRADLE_SERVER_TOKEN?.trim() || '';
const productManifestPath = process.env.GLIMMER_CRADLE_PRODUCT_MANIFEST?.trim();
const app = new PersonalServerApp({
  host,
  port,
  token,
  productManifestPath,
  cwd: process.cwd(),
});
void app.start().then(() => {
  console.log(`[personal-server] listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.stop());
}
