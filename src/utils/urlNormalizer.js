export function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Convert to lowercase
    urlObj.hostname = urlObj.hostname.toLowerCase();
    
    // Remove default ports
    if ((urlObj.protocol === 'http:' && urlObj.port === '80') ||
        (urlObj.protocol === 'https:' && urlObj.port === '443')) {
      urlObj.port = '';
    }
    
    // Remove trailing slash from pathname
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    
    // Sort query parameters for consistency
    if (urlObj.search) {
      const params = new URLSearchParams(urlObj.search);
      const sortedParams = new URLSearchParams();
      [...params.keys()].sort().forEach(key => {
        sortedParams.append(key, params.get(key));
      });
      urlObj.search = sortedParams.toString();
    }
    
    // Remove fragment
    urlObj.hash = '';
    
    return urlObj.toString();
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`);
  }
}

export function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isSameDomain(url1, url2) {
  try {
    const urlObj1 = new URL(url1);
    const urlObj2 = new URL(url2);
    return urlObj1.hostname === urlObj2.hostname;
  } catch {
    return false;
  }
}

export function isSubdomain(url, baseUrl) {
  try {
    const urlObj = new URL(url);
    const baseObj = new URL(baseUrl);
    
    const urlParts = urlObj.hostname.split('.');
    const baseParts = baseObj.hostname.split('.');
    
    if (urlParts.length < baseParts.length) {
      return false;
    }
    
    const urlDomain = urlParts.slice(-baseParts.length).join('.');
    const baseDomain = baseParts.join('.');
    
    return urlDomain === baseDomain;
  } catch {
    return false;
  }
}

export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

export function extractLinks(html, baseUrl) {
  const links = new Set();
  
  // Simple regex-based link extraction (faster than cheerio for this purpose)
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const absoluteUrl = new URL(href, baseUrl);
        links.add(absoluteUrl.toString());
      } catch {
        // Invalid URL, skip it
      }
    }
  }
  
  return Array.from(links);
}

export function getUrlDepth(url) {
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);
    return pathSegments.length;
  } catch {
    return 0;
  }
}

export function isFileUrl(url) {
  const fileExtensions = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.rar', '.tar', '.gz', '.7z',
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv',
    '.exe', '.dmg', '.pkg', '.deb', '.rpm'
  ];
  
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    return fileExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

export function removeQueryParameters(url) {
  try {
    const urlObj = new URL(url);
    urlObj.search = '';
    return urlObj.toString();
  } catch {
    return url;
  }
}

export function getBaseUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch {
    return null;
  }
}

export default {
  normalizeUrl,
  isValidUrl,
  isSameDomain,
  isSubdomain,
  extractDomain,
  extractLinks,
  getUrlDepth,
  isFileUrl,
  removeQueryParameters,
  getBaseUrl
};