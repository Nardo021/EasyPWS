export { type AdapterRegistry, createAdapterRegistry } from "./registry.js";
export {
  OMKAR_LISTING_MAX_PAGES,
  OMKAR_LISTING_PAGE_SIZE,
  assessListingPage,
  classifyQuote,
  compareStoreQuotes,
} from "./evidence/contract.js";
export type {
  AvailabilityVerdict,
  CacheProvenance,
  CatalogueEnumeration,
  FreshnessVerdict,
  ListingPageAssessment,
  PromotionConfidence,
  PromotionKind,
  QuoteClassification,
  QuoteEvidenceInput,
  RetrievalState,
  SchemaVerdict,
  SourceAge,
  SourceTimestampState,
  StoreParameterVerdict,
  StorePriceVerdict,
  StoreQuoteComparison,
} from "./evidence/contract.js";
export { ColesAdapter } from "./coles/adapter.js";
export { WoolworthsAdapter } from "./woolworths/adapter.js";
export { GenericScraperAdapter } from "./generic/adapter.js";
