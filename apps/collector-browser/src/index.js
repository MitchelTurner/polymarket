import { createCollector } from './collector.js';
import { createServer } from './server.js';

const portText = process.env.PORT || '3002';
if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}
const collector = createCollector();
const server = createServer({ token: process.env.COLLECTOR_TOKEN, collector });
server.listen(Number(portText), '127.0.0.1', () => {
  console.log(`Collector listening on 127.0.0.1:${portText}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await collector.close();
      process.exit(0);
    });
  });
}
