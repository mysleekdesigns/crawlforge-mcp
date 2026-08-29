/**
 * JSON-LD parsing and schema.org type filtering.
 *
 * Pure: no fetching. Callers pass a loaded cheerio document (parse) or already
 * parsed blocks (filter).
 */

/**
 * schema.org descendants that a filter on the parent type must also match.
 *
 * Real pages publish the specific subtype and almost never the parent, so an
 * exact-string @type match returns nothing on exactly the pages callers ask
 * about: ticketmaster.com/discover/concerts emits MusicEvent (never Event),
 * apple.com/shop/buy-mac/macbook-air emits AggregateOffer and BreadcrumbList
 * (never Offer or ItemList). Each list is the transitive descendant set of the
 * key in schema.org v30. Types outside this table are matched exactly.
 */
export const JSON_LD_SUBTYPES = {
  ItemList: ['BreadcrumbList', 'HowToSection', 'HowToStep', 'OfferCatalog'],
  Product: [
    'DietarySupplement', 'Drug', 'IndividualProduct', 'ProductCollection',
    'ProductGroup', 'ProductModel', 'SomeProducts', 'Vehicle', 'BusOrCoach',
    'Car', 'Motorcycle', 'MotorizedBicycle'
  ],
  Offer: ['AggregateOffer', 'OfferForLease', 'OfferForPurchase'],
  Event: [
    'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance',
    'DanceEvent', 'DeliveryEvent', 'EducationEvent', 'EventSeries',
    'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent',
    'MusicEvent', 'PublicationEvent', 'BroadcastEvent', 'OnDemandEvent',
    'SaleEvent', 'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent',
    'VisualArtsEvent'
  ],
  JobPosting: [],
  RealEstateListing: []
};

// Lowercased filter name → set of lowercased @type values it accepts.
const MATCH_SETS = new Map(
  Object.entries(JSON_LD_SUBTYPES).map(([parent, subtypes]) => [
    parent.toLowerCase(),
    new Set([parent, ...subtypes].map((t) => t.toLowerCase()))
  ])
);

/**
 * Some publishers write @type as a full IRI ("https://schema.org/Product").
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeType(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/^https?:\/\/schema\.org\//, '').trim().toLowerCase() || null;
}

/**
 * Parse all JSON-LD blocks from the document. A malformed block is skipped so
 * one bad block does not lose the good ones.
 * @param {import('cheerio').CheerioAPI} $
 * @returns {Array}
 */
export function parseJsonLd($) {
  const results = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (raw) results.push(JSON.parse(raw));
    } catch {
      // Skip invalid blocks
    }
  });
  return results;
}

/**
 * Collect the JSON-LD nodes matching the requested schema.org types.
 *
 * Nodes are found at any depth, so @graph wrappers, top-level arrays and types
 * nested inside another node (an Offer inside an Event) are all reachable.
 * @type itself may be a string or an array of strings.
 *
 * @param {Array} blocks - parsed JSON-LD blocks, as returned by parseJsonLd
 * @param {string[]} types - schema.org type names to keep
 * @returns {{ items: Array, counts: Record<string, number> }} matching nodes in
 *   document order, and how many matched per requested type
 */
export function filterJsonLdByType(blocks, types) {
  const wanted = types.map((requested) => ({
    requested,
    match: MATCH_SETS.get(requested.toLowerCase()) || new Set([requested.toLowerCase()])
  }));
  const counts = Object.fromEntries(types.map((t) => [t, 0]));
  const items = [];

  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const raw = node['@type'];
    const nodeTypes = (Array.isArray(raw) ? raw : [raw]).map(normalizeType).filter(Boolean);
    if (nodeTypes.length) {
      let matched = false;
      for (const { requested, match } of wanted) {
        if (nodeTypes.some((t) => match.has(t))) {
          counts[requested] += 1;
          matched = true;
        }
      }
      if (matched) items.push(node);
    }

    // Descend even into a matched node: its children may match another
    // requested type (Ticketmaster nests each Offer inside its MusicEvent).
    for (const value of Object.values(node)) visit(value);
  };

  blocks.forEach(visit);
  return { items, counts };
}
