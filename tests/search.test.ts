import { SearchService } from '../src/modules/search/service';
import { productQuery } from '../src/modules/catalog/schemas';
const data = { items: [], total: 1, page: 1, limit: 20 };
const query = productQuery.parse({ q: 'headphones for running' });
test('uses the optional semantic provider when available', async () => {
  const list = jest.fn().mockResolvedValue(data);
  const search = jest.fn().mockResolvedValue(data);
  const result = await new SearchService({ list }, { search }).search(query);
  expect(result.meta.mode).toBe('semantic');
  expect(list).not.toHaveBeenCalled();
});
test('model failures and empty semantic results fall back to text', async () => {
  for (const search of [
    jest.fn().mockRejectedValue(new Error('model unavailable')),
    jest.fn().mockResolvedValue({ ...data, total: 0 }),
  ]) {
    const list = jest.fn().mockResolvedValue(data);
    expect(
      (await new SearchService({ list }, { search }).search(query)).meta.mode,
    ).toBe('text');
    expect(list).toHaveBeenCalledWith(query);
  }
});
test('explicit price ordering uses catalog search', async () => {
  const list = jest.fn().mockResolvedValue(data);
  const search = jest.fn();
  expect(
    (
      await new SearchService({ list }, { search }).search({
        ...query,
        sort: 'price_asc',
      })
    ).meta.mode,
  ).toBe('text');
  expect(search).not.toHaveBeenCalled();
});
