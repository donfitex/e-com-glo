import { CatalogService } from '../catalog/service';
import { ProductQuery } from '../catalog/schemas';
export interface SemanticSearch {
  search(query: ProductQuery): ReturnType<CatalogService['list']>;
}
export class SearchService {
  constructor(
    private readonly catalog: Pick<CatalogService, 'list'>,
    private readonly semantic?: SemanticSearch,
  ) {}
  async search(query: ProductQuery) {
    // Explicit sort requests retain the catalog's deterministic price/name ordering.
    if (this.semantic && query.sort === 'newest') {
      try {
        const data = await this.semantic.search(query);
        if (data.total > 0) return { data, meta: { mode: 'semantic' } };
      } catch {
        /* discovery must survive model/index outages */
      }
    }
    return { data: await this.catalog.list(query), meta: { mode: 'text' } };
  }
}
