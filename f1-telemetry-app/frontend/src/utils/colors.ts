/**
 * Parse a hex color string into R, G, B components (0-255).
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6 && cleaned.length !== 3) return null;

  let full = cleaned;
  if (cleaned.length === 3) {
    full = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
  }

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

/**
 * Convert RGB components to a hex string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Compute perceived luminance of a color (0 = black, 1 = white).
 * Uses relative luminance formula per WCAG 2.x.
 */
function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;

  const srgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * Darken a hex color by a factor (0-1, where 1 = fully black).
 */
export function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

/**
 * Lighten a hex color by a factor (0-1, where 1 = fully white).
 */
export function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount
  );
}

/**
 * Normalize a hex color string to always include a '#' and be uppercase.
 */
export function normalizeHex(hex: string): string {
  if (!hex) return hex;
  let cleaned = hex.trim();
  if (!cleaned.startsWith('#')) cleaned = '#' + cleaned;
  if (cleaned === '#') return '';
  return cleaned.toUpperCase();
}

/**
 * Adjust a team color for readability on the current theme.
 *
 * - In DARK mode: colors are used as-is (they're designed for dark backgrounds).
 *   Very dark colors (luminance < 0.05) are lightened so they remain visible.
 * - In LIGHT mode: very light colors (luminance > 0.7) are darkened significantly
 *   so they don't wash out on white backgrounds.
 */
export function adjustColorForTheme(hexColor: string, theme: 'dark' | 'light'): string {
  const normalized = normalizeHex(hexColor);
  if (!normalized) return hexColor;

  const luminance = getLuminance(normalized);

  if (theme === 'dark') {
    // Lighten very dark colors (e.g., near-black team colors)
    if (luminance < 0.05) {
      return lighten(normalized, 0.4);
    }
    return normalized;
  } else {
    // Light mode: darken very bright / light colors
    if (luminance > 0.7) {
      return darken(normalized, 0.45);
    }
    if (luminance > 0.5) {
      return darken(normalized, 0.25);
    }
    return normalized;
  }
}

/**
 * Return '#000000' or '#FFFFFF' depending on which gives better contrast
 * against the given background color.
 */
export function getContrastColor(hex: string): string {
  const luminance = getLuminance(hex);
  // WCAG recommends using white text when luminance < 0.179
  return luminance > 0.179 ? '#000000' : '#FFFFFF';
}

/**
 * Convert a hex color to rgba string.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(128, 128, 128, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Blend two hex colors together at a given ratio (0 = fully color1, 1 = fully color2).
 */
export function blendColors(hex1: string, hex2: string, ratio: number): string {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return hex1;
  return rgbToHex(
    rgb1.r + (rgb2.r - rgb1.r) * ratio,
    rgb1.g + (rgb2.g - rgb1.g) * ratio,
    rgb1.b + (rgb2.b - rgb1.b) * ratio
  );
}

/**
 * Offset a team color to differentiate teammates.
 */
export function offsetTeamColor(hex: string, index: number, _theme: 'dark' | 'light'): string {
  if (index === 0 || !hex) return hex;

  const lum = getLuminance(hex);

  // If the color is very bright (like Mercedes #27F4D2), darkening it makes the second car much more distinct.
  // If the color is dark (like Ferrari #DC0000), lightening it makes it stand out.
  // This logic works well for both light and dark themes because it guarantees contrast.
  if (lum > 0.4) {
    return darken(hex, 0.6 * index);
  } else {
    return lighten(hex, 0.6 * index);
  }
}
