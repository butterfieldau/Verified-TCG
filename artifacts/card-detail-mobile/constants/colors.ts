/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#0a0a0a',
    tint: '#2f95dc',

    // Core surfaces
    background: '#090a0c',
    foreground: '#f7f7f8',

    // Cards / elevated surfaces
    card: '#14161a',
    cardForeground: '#f7f7f8',

    // Primary action color (buttons, links, active states)
    primary: '#e22536',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#20232a',
    secondaryForeground: '#f7f7f8',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#20232a',
    mutedForeground: '#9299a4',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#35161d',
    accentForeground: '#ff8d99',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#2b2f38',
    input: '#2b2f38',
    surfaceStrong: '#111317',
    textSecondary: '#d7dbe3',
    borderAccent: '#59232d',
  },
  dark: {
    text: '#f7f7f8',
    tint: '#e22536',
    background: '#090a0c',
    foreground: '#f7f7f8',
    card: '#14161a',
    cardForeground: '#f7f7f8',
    primary: '#e22536',
    primaryForeground: '#ffffff',
    secondary: '#20232a',
    secondaryForeground: '#f7f7f8',
    muted: '#20232a',
    mutedForeground: '#9299a4',
    accent: '#35161d',
    accentForeground: '#ff8d99',
    destructive: '#f04458',
    destructiveForeground: '#ffffff',
    border: '#2b2f38',
    input: '#2b2f38',
    surfaceStrong: '#111317',
    textSecondary: '#d7dbe3',
    borderAccent: '#59232d',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
