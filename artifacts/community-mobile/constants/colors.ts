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
    card: '#17191d',
    cardForeground: '#f7f7f8',

    // Primary action color (buttons, links, active states)
    primary: '#e3213a',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#22252b',
    secondaryForeground: '#f7f7f8',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#22252b',
    mutedForeground: '#9297a1',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#32151b',
    accentForeground: '#ff6c7e',

    // Destructive actions (delete, error states)
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#2d3139',
    input: '#2d3139',
    surfaceStrong: '#121417',
    textSecondary: '#d8dae0',
    borderAccent: '#57212b',
    avatarRose: '#733342',
    avatarBlue: '#294c5f',
    avatarSlate: '#3b4652',
  },
  dark: {
    text: '#f7f7f8',
    tint: '#e3213a',
    background: '#090a0c',
    foreground: '#f7f7f8',
    card: '#17191d',
    cardForeground: '#f7f7f8',
    primary: '#e3213a',
    primaryForeground: '#ffffff',
    secondary: '#22252b',
    secondaryForeground: '#f7f7f8',
    muted: '#22252b',
    mutedForeground: '#9297a1',
    accent: '#32151b',
    accentForeground: '#ff6c7e',
    destructive: '#f04458',
    destructiveForeground: '#ffffff',
    border: '#2d3139',
    input: '#2d3139',
    surfaceStrong: '#121417',
    textSecondary: '#d8dae0',
    borderAccent: '#57212b',
    avatarRose: '#733342',
    avatarBlue: '#294c5f',
    avatarSlate: '#3b4652',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
