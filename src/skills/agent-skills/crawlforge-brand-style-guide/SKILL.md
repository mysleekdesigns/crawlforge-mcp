---
name: crawlforge-brand-style-guide
description: "Builds a brand style guide or a design-token file from a live website with the branding format of CrawlForge's scrape tool. Use when the user wants a company's brand colours, fonts, logo, button styles or design tokens, asks to extract a website's style, design system or brand kit, wants a style guide made from a URL, wants to match a site's look, or wants tokens for Figma, Tokens Studio or Style Dictionary (W3C DTCG JSON). One scrape call returns colour roles, the primary and secondary buttons and type read from the rendered page, the logo and favicons, font families and grouped CSS tokens, each value labelled with where it came from."
metadata:
  version: 6.25.0
  source: crawlforge-mcp-server
---

# CrawlForge Brand Style Guide

Turn a website into a style guide or a design-token file. CrawlForge collects
the brand data in one `scrape` call; you write the guide from it.

## When to use

- "Make a style guide from stripe.com" / "build a brand kit for this site"
- "What colours and fonts does this company use?"
- "Grab this site's logo and button styles"
- "Match the look of this website"
- "Export this site's design tokens for Figma / Style Dictionary"

## The one call

```json
{
  "tool": "scrape",
  "params": {
    "url": "https://stripe.com",
    "formats": ["branding", "screenshot"],
    "brandingOptions": { "dtcg": true }
  }
}
```

Cost: 2 credits. `branding` and `screenshot` share one browser render. Add
`"metadata"` if you need the site name and description too. Leave out `dtcg`
unless the user wants a token file: it can double the size of the result.

If the result is `truncated: true`, do not scrape again. Read the parts with
`read_result` and a `json_path`, such as `content.branding.roles` or
`content.branding.dtcg`.

## What comes back in `content.branding`

| Key | What it holds |
|-----|---------------|
| `colorScheme` | `light` or `dark`, from the page background |
| `roles` | `background`, `text`, `heading`, `link`, `primary`, `onPrimary`: each `{ value, source, evidence }` |
| `components` | `buttonPrimary` and `buttonSecondary`: fill, label colour, border, radius, padding, font, size and weight |
| `typography` | `body`, `h1`, `h2`: family, stack, size, weight, line height, letter spacing, colour |
| `logo` | `inlineHeaderSvg` (the header logo as SVG), `favicons`, `ogImage`, image `candidates` |
| `fonts`, `fontFaces` | font families ranked by use, and their `@font-face` sources |
| `tokens` | the site's CSS custom properties, grouped: `colors.ramps`, `colors.semantic`, `typography`, `spacing`, `radius`, `shadow`, plus `stats` on what was dropped |
| `colors` | every colour found, ranked by frequency |
| `dtcg` | with `dtcg: true`, the tokens and roles as W3C Design Tokens (2025.10) JSON |
| `provenance` | what each `source` value means |

### Reading `source`

- `computed`: read from an element on the rendered page. The `evidence` says
  which, for example `button "Get started"`. Trust these first.
- `css-variable`, `css-var`, `declaration`, `theme-color`: found in the
  site's CSS or HTML.
- `inferred`: a guess from CSS variable names, used when no element showed
  the role. Say in the guide that the value is a guess, or confirm it on the
  screenshot first.

`sources.rendered` tells you whether the page was rendered. When it is
`false`, `warnings` says why, and `components` and `typography` are empty.

## Writing the guide

Use the screenshot to check the roles before you write. Then cover:

1. **Logo**: the header SVG on light and dark grounds, plus the favicon and
   share-image links.
2. **Colour roles**: one swatch per role, with its hex, its token name when a
   ramp step matches, and what it is used for.
3. **Palette**: the ramps from `tokens.colors.ramps`, in step order.
4. **Typography**: the families, the type scale from `tokens.typography`, and
   the body and heading styles from `typography`.
5. **Spacing and radius**, from `tokens.spacing` and `tokens.radius`.
6. **Buttons**: the primary and secondary buttons rebuilt from `components`.
7. **Sources**: label each value as read from the page, found in CSS, or
   inferred, so a reader can check it.

For a page or artifact, show the swatches and buttons visually. For a token
file, save `dtcg` as `tokens.json`.

## Limits to tell the user about

- The guide is unofficial when the site is not the user's own. Say so on the
  page, and point to the company's own brand resources for anything that will
  ship.
- Many brand fonts are licensed. The `@font-face` URL shows which font a site
  uses, not permission to use it, so render specimens in a fallback face.
- CSS holds no usage rules: no logo clear space, minimum sizes or do's and
  don'ts. Those live in brand documents.
- `dtcg` follows the DTCG 2025.10 format, where colours and dimensions are
  objects rather than strings. Support for 2025.10 varies by tool and version
  (Style Dictionary lists it as in progress for v5), so tell the user to check
  their tool before relying on the file.
- `buttonSecondary` is the outline button next to the primary. A site with no
  partner button returns none.
- A blocked site comes back with a warning: retry with `escalate: true`. A
  page that needed the stealth browser is not re-rendered for computed
  styles, so its roles are `inferred`.
