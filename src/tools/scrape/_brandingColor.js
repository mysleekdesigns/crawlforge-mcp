/**
 * _brandingColor.js — CSS colour parsing for the branding format.
 *
 * parseColor turns hex, rgb(), hsl(), oklch(), oklab(), lab(), lch() and the
 * basic named colours into { r, g, b, a } (channels 0-255, alpha 0-1). The
 * wide-gamut forms matter because Tailwind v4 writes its palette in oklch and
 * its build (Lightning CSS) ships it as lab(). The helpers below it
 * compare colours: how saturated one is, how light, how far apart two are.
 */

const NAMED_COLORS = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', lime: '#00ff00',
  aqua: '#00ffff', fuchsia: '#ff00ff',
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toHex2(n) {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
}

// A channel or alpha argument: `none` is 0, a percentage scales to `full`.
function num(part, full = 1) {
  if (part === 'none') return 0;
  if (part.endsWith('%')) return (parseFloat(part) / 100) * full;
  return parseFloat(part);
}

function alphaOf(part) {
  if (part == null) return 1;
  const a = num(part);
  return Number.isNaN(a) ? 1 : clamp(a, 0, 1);
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = l - c / 2;
  let r = 0, g = 0, b = 0;
  const hh = ((h % 360) + 360) % 360;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + mm) * 255, (g + mm) * 255, (b + mm) * 255];
}

// Linear-light channels -> gamma-encoded sRGB 0-255, clipped to the gamut.
function encode(lin) {
  return lin.map((x) => {
    const v = clamp(x, 0, 1);
    return (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
  });
}

// CIE Lab (D50) -> XYZ D50 -> Bradford to D65 -> linear sRGB (CSS Color 4 matrices).
function labToRgb(L, a, b) {
  const e = 216 / 24389;
  const k = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * 0.3457 / 0.3585;
  const y = L > k * e ? fy ** 3 : L / k;
  const z = (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * (1 - 0.3457 - 0.3585) / 0.3585;
  const X = 0.9554734527042182 * x - 0.023098536874261423 * y + 0.0632593086610217 * z;
  const Y = -0.028369706963208136 * x + 1.0099954580058226 * y + 0.021041398966943008 * z;
  const Z = 0.012314001688319899 * x - 0.020507696433477912 * y + 1.3303659366080753 * z;
  return encode([
    3.2409699419045226 * X - 1.537383177570094 * Y - 0.4986107602930034 * Z,
    -0.9692436362808796 * X + 1.8759675015077202 * Y + 0.04155505740717559 * Z,
    0.05563007969699366 * X - 0.20397695888897652 * Y + 1.0569715142428786 * Z,
  ]);
}

// OKLab -> sRGB (Björn Ottosson's reference matrices), clipped to the gamut.
function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return encode([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]);
}

/**
 * Parse a CSS colour into { r, g, b, a }. Returns null for anything that is
 * not a literal colour (gradients, currentColor, var(), transparent).
 */
export function parseColor(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();

  const named = NAMED_COLORS[v];
  if (named) return parseColor(named);

  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  m = v.match(/^(rgba?|hsla?|oklch|oklab|lch|lab)\(([^()]+)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[,/\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const a = alphaOf(parts[3]);
  let rgb;
  switch (m[1]) {
    case 'rgb':
    case 'rgba':
      rgb = parts.slice(0, 3).map((p) => num(p, 255));
      break;
    case 'hsl':
    case 'hsla':
      rgb = hslToRgb(parseFloat(parts[0]), num(parts[1].endsWith('%') ? parts[1] : parts[1] + '%'), num(parts[2].endsWith('%') ? parts[2] : parts[2] + '%'));
      break;
    case 'oklch': {
      const L = num(parts[0]);
      const C = num(parts[1], 0.4);
      const H = (num(parts[2]) * Math.PI) / 180;
      rgb = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
      break;
    }
    case 'oklab':
      rgb = oklabToRgb(num(parts[0]), num(parts[1], 0.4), num(parts[2], 0.4));
      break;
    case 'lch': {
      const C = num(parts[1], 150);
      const H = (num(parts[2]) * Math.PI) / 180;
      rgb = labToRgb(num(parts[0], 100), C * Math.cos(H), C * Math.sin(H));
      break;
    }
    case 'lab':
      rgb = labToRgb(num(parts[0], 100), num(parts[1], 125), num(parts[2], 125));
      break;
  }
  if (rgb.some((x) => Number.isNaN(x))) return null;
  return { r: rgb[0], g: rgb[1], b: rgb[2], a };
}

/** '#rrggbb', alpha dropped. */
export function toHex({ r, g, b }) {
  return '#' + toHex2(r) + toHex2(g) + toHex2(b);
}

/** '#rrggbb', or '#rrggbbaa' when the colour is translucent. */
export function toHexAlpha(c) {
  return c.a < 1 ? toHex(c) + toHex2(c.a * 255) : toHex(c);
}

/** 0 for a grey, 1 for a fully saturated colour. */
export function chroma({ r, g, b }) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance({ r, g, b }) {
  const lin = (x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Euclidean distance in RGB, 0 to ~441. */
export function distance(x, y) {
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
}
