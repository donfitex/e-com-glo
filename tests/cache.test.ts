import { CatalogCache, Redis } from '../src/infrastructure/cache';
test('cache uses requested TTL, reports hits/misses, and invalidates its generation', async () => {
  const values = new Map<string, string>();
  const get = jest.fn(async (key: string) => values.get(key) ?? null);
  const set = jest.fn(async (key: string, value: string) => {
    values.set(key, value);
    return 'OK';
  });
  const incr = jest.fn(async () => {
    values.set('catalog:version', '1');
    return 1;
  });
  const cache = new CatalogCache({ get, set, incr } as unknown as Redis);
  const loader = jest.fn(async () => ({ count: 1 }));
  await cache.remember('list', 3600, loader);
  await cache.remember('list', 3600, loader);
  expect(set).toHaveBeenCalledWith('catalog:null:list', expect.any(String), {
    EX: 3600,
  });
  expect(loader).toHaveBeenCalledTimes(1);
  expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1, loads: 1 });
  await cache.invalidate();
  await cache.remember('list', 3600, loader);
  expect(loader).toHaveBeenCalledTimes(2);
});
test('unavailable and stalled Redis reads fall back to the database within a deadline', async () => {
  for (const get of [
    async () => {
      throw new Error('unavailable');
    },
    () => new Promise<string | null>(() => {}),
  ]) {
    const cache = new CatalogCache({ get } as unknown as Redis, 10);
    expect(
      await cache.remember('key', 3600, async () => 'database-value'),
    ).toBe('database-value');
    expect(cache.getStats()).toMatchObject({ errors: 1, loads: 1 });
  }
});
