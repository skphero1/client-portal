// Runs the REAL GraphQL server (createGraphQLServer + real resolvers, repo,
// DataLoaders, auth) against the in-memory fake Prisma client seeded with the
// REAL seed data. No Postgres needed for this layer.
import http from 'node:http';
import { createGraphQLServer } from '@/graphql/server';
import { resetAndSeedDemoData } from '../prisma/seedData';
import { fakePrisma, tableCounts, callCounts } from './fakePrisma';

const yoga = createGraphQLServer({ prisma: fakePrisma as never });

async function main(): Promise<void> {
  await resetAndSeedDemoData(fakePrisma as never);
  console.log('seeded:', JSON.stringify(tableCounts()));

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/__counts' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(callCounts));
      return;
    }
    if (req.url === '/__reset-counts' && req.method === 'POST') {
      for (const k of Object.keys(callCounts)) delete callCounts[k];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    const body = await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
    const url = `http://127.0.0.1:4000${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });
    const response = await yoga.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end('harness error');
  }
});

server.listen(4000, () => {
  console.log('GraphQL listening on http://127.0.0.1:4000/api/graphql');
});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
