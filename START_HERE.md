# Start here

This is a work-in-progress Wayline AI checkpoint. [README.md](README.md) contains setup, architecture, features, security boundaries and remaining work.

1. Install Node.js 24 or newer.
2. Run `npm ci` and `npm run build` from this directory.
3. Run `npm start`, then open `http://127.0.0.1:4174` (set `PORT` to change it).
4. Without local routing, trips use the included sample corridors, which are not real tickets or live schedules. For real Boston/MBTA trips, follow the pilot steps in [docs/CORE_LAUNCH.md](docs/CORE_LAUNCH.md) and start with `npm run pilot`.
5. Browse [docs/README.md](docs/README.md) for every guide and reference, and [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) for feature completeness.

Keep databases, credentials and `.env` out of Git. Original instructions are preserved in [docs/original/START_HERE.md](docs/original/START_HERE.md).
