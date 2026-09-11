# Wayline coastal theme

Wayline now uses a cheerful coastal travel identity: deep teal navigation, sky-blue page backgrounds, apricot and sea-green accents, rounded cards, expressive Manrope headings, and a sunny illustrated train journey. It replaces the earlier neutral white product direction.

## Design and behavior

- A compact illustrated planning board contains the route-search form. The artwork is an original fictional coastal travel illustration, not a depiction of the selected route.
- Search inputs and route-comparison behavior remain intact, including travel preferences, airport and group tools, schedule source, real prices supplied by the existing API, and sample labels.
- Selected routes use an apricot header; all route cards maintain aligned times, costs, operators and transfer information.
- The map retains zoom, endpoint details, fullscreen, tilt, route framing and responsive resizing. Its connection remains labeled as indicative rather than track geometry.
- The theme extends to saved journeys, ticket records, settings, commute, journey updates, Transit Lab, offline screens, empty states, dialogs, assistant conversation and mobile navigation. The assistant continues using the existing service and journey context.
- Light and dark palettes use the same coastal identity, including the browser theme color on initial load. Focus indicators, text contrast, minimum body sizing, reduced-motion preferences and mobile composer visibility are retained.

Authentication, persistence, automatic recovery behavior, carrier integrations and offline packs are unchanged. Existing sample-versus-carrier distinctions remain in the product.

## Assets

- `public/images/coastal-adventure.png`: original generated editorial artwork for this redesign; fictional scenery, no logos or real route claims.
- Existing Washington photograph: https://unsplash.com/photos/united-states-capitol-building-on-a-sunny-day-4Tx6uWl9YJM
- Existing coastal rail photograph: https://www.pacificsurfliner.com/globalassets/start-page/homepage-teaser-miles.jpg
- DM Sans and Manrope: existing local WOFF2 fonts.

## Validation

Application build and type checks; existing navigation and translation checks; visual browser checks for the planner, assistant, wallet, light/dark mode and responsive layouts. The generated image loads locally. No production deployment is part of this redesign.
