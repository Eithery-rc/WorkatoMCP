// Element marker record, as stored in IndexedDB and read by chrome_read_page

export type UrlMatchType = 'exact' | 'prefix' | 'host';

export interface ElementMarker {
  id: string;
  // Original URL where the marker was created
  url: string;
  // Normalized pieces to support matching
  origin: string; // scheme + host + port
  host: string; // hostname
  path: string; // pathname part only
  matchType: UrlMatchType; // default: 'prefix'

  name: string; // Human-friendly name, e.g., "Login Button"
  selector: string; // Selector string
  selectorType?: 'css' | 'xpath'; // Default: css
  listMode?: boolean; // Whether this marker was created in list mode (allows multiple matches)
  action?: 'click' | 'fill' | 'custom'; // Intended action hint (optional)

  createdAt: number;
  updatedAt: number;
}
