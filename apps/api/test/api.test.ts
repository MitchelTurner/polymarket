import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { seed } from '../prisma/seed';
import { createApp } from '../src/main';

test('historical API, seed idempotency and fail-closed admin authentication', async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL must point to a PostgreSQL test database');
  const schema = `api_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.toString();
  delete process.env.ADMIN_TOKEN;
  const migration = spawnSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    env: process.env, encoding: 'utf8',
  });
  const prisma = new PrismaClient();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
    const read = async (path: string, token?: string) => {
      const response = await fetch(base + path, token ? { headers: { authorization: ['Bearer', token].join(' ') } } : {});
      return { status: response.status, body: await response.json() as any };
    };

    assert.deepEqual((await read('/years')).body, { years: [] });
    assert.deepEqual((await read('/years/2024/categories/people/results')).body,
      { year: 2024, category: null, results: [] });
    assert.equal((await read('/years/2024/categories')).body.categories.length, 0);
    assert.equal((await read('/years/2024x/categories')).status, 400);
    assert.equal((await read('/years/2024/categories/UPPER/results')).status, 400);
    assert.equal((await read('/admin/status', 'a'.repeat(32))).status, 401);
    process.env.ADMIN_TOKEN = 'short';
    assert.equal((await read('/admin/status', 'short')).status, 401);
    process.env.ADMIN_TOKEN = 'a'.repeat(32);
    assert.equal((await read('/admin/status')).status, 401);
    assert.equal((await read('/admin/status', 'b'.repeat(32))).status, 401);
    assert.deepEqual(await read('/admin/status', 'a'.repeat(32)), { status: 200, body: { status: 'ok' } });

    await seed(prisma);
    const person = await prisma.person.create({ data: { name: 'Stale test result' } });
    await prisma.yisResult.create({ data: { year: 2022, scope: 'GLOBAL', list: 'people', personId: person.id, rank: 11 } });
    await seed(prisma);
    assert.deepEqual((await read('/years')).body, { years: [2025, 2024, 2023, 2022, 2021, 2018, 2014] });
    assert.deepEqual((await read('/years/2022/categories')).body,
      { year: 2022, categories: [{ slug: 'people', name: 'People', complete: true }] });
    const results = (await read('/years/2022/categories/people/results')).body;
    assert.equal(results.results.length, 10);
    assert.deepEqual(results.results[0], {
      rank: 1, query: 'Johnny Depp', sourceUrl: null,
    });
    assert.deepEqual(results.results.map((entry: { rank: number }) => entry.rank),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(await prisma.yisResult.count(), 70);
    assert.equal(await prisma.person.count({ where: { name: 'Andrew Tate' } }), 1);
    const namesByYear: Record<number, string> = {
      2014: 'Jennifer Lawrence|Kim Kardashian|Julie Gayet|Tracy Morgan|Renee Zellweger|Jared Leto|Lorde|Matthew McConaughey|Amal Alamuddin|Donald Sterling',
      2018: 'Meghan Markle|Demi Lovato|Sylvester Stallone|Logan Paul|Khloé Kardashian|Jair Bolsonaro|Brett Kavanaugh|Hailey Baldwin|Stormy Daniels|Cardi B',
      2021: 'Alec Baldwin|Kyle Rittenhouse|Christian Eriksen|Tiger Woods|Simone Biles|Joe Biden|Emma Raducanu|Derek Chauvin|Henry Ruggs III|Pete Davidson',
      2022: 'Johnny Depp|Will Smith|Amber Heard|Vladimir Putin|Chris Rock|Novak Djokovic|Anna Sorokin (Delvey)|Andrew Tate|Rishi Sunak|Simon Leviev',
      2023: 'Damar Hamlin|Jeremy Renner|Andrew Tate|Kylian Mbappé|Travis Kelce|Jenna Ortega|Lil Tay|Danny Masterson|David Beckham|Pedro Pascal',
      2024: 'Donald Trump|Catherine Princess of Wales|Kamala Harris|Imane Khelif|Joe Biden|Mike Tyson|JD Vance|Lamine Yamal|Simone Biles|Diddy',
      2025: 'd4vd|Kendrick Lamar|Jimmy Kimmel|Tyler Robinson|Pope Leo XIV|Shedeur Sanders|Bianca Censori|Zohran Mamdani|Greta Thunberg|Sanae Takaichi',
    };
    for (const [year, names] of Object.entries(namesByYear)) {
      const body = (await read(`/years/${year}/categories/people/results`)).body;
      assert.deepEqual(body.results.map((entry: { query: string }) => entry.query), names.split('|'));
      assert.deepEqual(body.results.map((entry: { rank: number }) => entry.rank),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  } finally {
    await app?.close();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
    delete process.env.ADMIN_TOKEN;
    delete process.env.DATABASE_URL;
  }
});
