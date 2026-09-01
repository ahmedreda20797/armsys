// ══════════════════════════════════════════════════════════════
//  Global Search — public barrel (Phase 6.1)
//
//  Client-safe exports only. The server service is imported
//  directly by the API route (`@/lib/search/search-service`) so the
//  browser bundle never pulls in the db layer.
// ══════════════════════════════════════════════════════════════

export type {
  SearchDomain,
  SearchResult,
  SearchResultGroup,
  SearchApiResponse,
} from './types';

export {
  SEARCH_DOMAINS,
  SEARCH_DOMAIN_ORDER,
  isSearchDomain,
  type SearchDomainDescriptor,
  type SearchNavStrategy,
  type SearchScopeKind,
} from './search-domains';

export { normalizeForSearch, splitQueryTerms, MIN_QUERY_LENGTH } from './search-normalize';

export { buildSearchNavigation, type SearchNavigationIntent } from './search-navigation';
