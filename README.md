# MyHomeGames Importer

A modular tool for importing games and collections from various sources into MyHomeGames format.

## Available Importers

- **GOG Galaxy** - Import games and collections from GOG Galaxy

More importers coming soon!

## Requirements

- Node.js 18+
- MyHomeGames server running and accessible
- API token for MyHomeGames server authentication
- IGDB API credentials (Twitch Client ID and Secret) - required for game search via server

## Installation

```bash
npm install
```

## Usage

### CLI

```bash
# Show available importers and usage
node cli.js --help

# Import from GOG Galaxy
node cli.js gog-galaxy --metadata-path /path/to/metadata

# Or using npm script
npm start gog-galaxy --metadata-path /path/to/metadata
```

### Environment Variables

You can configure the importer using environment variables in three ways:

1. **Using a `.env` file** (recommended) - Create a `.env` file in the project root
2. **Command-line environment variables** - Set variables when running the command
3. **Command-line options** - Use `--option value` flags

**Priority order:** Command-line options > Environment variables > `.env` file > Defaults

Common variables (apply to all importers):

- `METADATA_PATH` - Path to MyHomeGames metadata directory (required)

GOG Galaxy specific variables:

- `SERVER_URL` - MyHomeGames server URL (default: `http://localhost:3000`)
- `API_TOKEN` - API token for server authentication (required)
- `GALAXY_DB_PATH` - Path to GOG Galaxy database (default: `~/Library/Application Support/GOG Galaxy/Storage/galaxy-2.0.db` on macOS)
- `GALAXY_IMAGES_PATH` - Path to GOG Galaxy images directory (default: `~/Library/Application Support/GOG Galaxy/Storage/GalaxyClient/Images` on macOS)
- `TWITCH_CLIENT_ID` - Twitch Client ID for IGDB API (required, passed to server)
- `TWITCH_CLIENT_SECRET` - Twitch Client Secret for IGDB API (required, passed to server)
- `LIMIT` - Limit number of games to import (optional, for testing)

#### Using .env File

The easiest way to configure the importer is to create a `.env` file in the project root:

```bash
# Copy the example file
cp .env.example .env

# Edit .env with your values
nano .env
```

Then simply run:

```bash
node cli.js gog-galaxy
```

The importer will automatically load variables from the `.env` file. See `.env.example` for a template.

### Examples

```bash
# Using .env file (recommended)
# Create .env file with your configuration, then:
node cli.js gog-galaxy

# GOG Galaxy importer with environment variables
METADATA_PATH=/path/to/metadata \
SERVER_URL=http://localhost:3000 \
API_TOKEN=xxx \
TWITCH_CLIENT_ID=xxx \
TWITCH_CLIENT_SECRET=xxx \
node cli.js gog-galaxy

# GOG Galaxy importer with command-line options
node cli.js gog-galaxy \
  --metadata-path /path/to/metadata \
  --server-url http://localhost:3000 \
  --api-token xxx \
  --galaxy-db-path /custom/path/galaxy-2.0.db \
  --galaxy-images-path /custom/path/Images \
  --twitch-client-id xxx \
  --twitch-client-secret xxx

# Limit import to first 10 games (for testing)
LIMIT=10 \
METADATA_PATH=/path/to/metadata \
SERVER_URL=http://localhost:3000 \
API_TOKEN=xxx \
TWITCH_CLIENT_ID=xxx \
TWITCH_CLIENT_SECRET=xxx \
node cli.js gog-galaxy

# Override .env values with command-line options
node cli.js gog-galaxy --limit 5 --metadata-path /custom/path
```

## Project Structure

```text
myhomegames-importer/
├── cli.js                      # Main CLI entry point
├── .env.example                # Example environment variables file
├── importers/
│   ├── common/                 # Shared utilities
│   │   ├── igdb.js            # MyHomeGames server API utilities (for game search)
│   │   └── files.js           # File operations utilities
│   └── gog-galaxy/            # GOG Galaxy importer
│       └── index.js
├── package.json
└── README.md
```

## GOG Galaxy Importer

### How it works

1. **Games Import:**
   - Queries `GamePieces` table and extracts game titles from the JSON `value` field (`json_extract(value, '$.title')`)
   - Links to `PlayTasks` table via `releaseKey` to get `playTaskId`
   - Links to `PlayTaskLaunchParameters` via `playTaskId` to get executable paths
   - For each game, searches via MyHomeGames server API (which searches IGDB) to get the correct game ID
   - Creates game directory in MyHomeGames format: `content/games/{igdb_id}/`
   - Copies executable script from `PlayTaskLaunchParameters.executablePath` to `script.sh` or `script.bat`
   - Copies images using `releaseKey` from GOG Galaxy images directory to `cover.webp` and `background.webp`

2. **Collections Import:**
   - Queries `UserReleaseTags` table for tags
   - Creates collections in MyHomeGames format: `content/collections/{numeric_id}/metadata.json`
   - Maps GOG Galaxy tags to MyHomeGames collections
   - Links games to collections based on tags

### Database Schema

The GOG Galaxy importer queries the following database tables:

- `GamePieces`: Contains game information with `value` field as JSON (extracts `title` from JSON) and `releaseKey`
- `PlayTasks`: Links `gameReleaseKey` to `id` (playTaskId)
- `PlayTaskLaunchParameters`: Contains executable paths (`executablePath`) linked via `playTaskId` (references `PlayTasks.id`)
- `UserReleaseTags`: Contains user-defined tags/collections

### Notes

- The importer creates collections with numeric IDs (timestamps)
- Images are copied as-is (no conversion to WebP format, rename only)
- Games not found via server search are skipped
- The importer uses the MyHomeGames server API instead of calling IGDB directly

## Adding New Importers

To add a new importer:

1. Create a new directory under `importers/` (e.g., `importers/steam/`)
2. Create an `index.js` file that exports an async function accepting a `config` object
3. Add the importer to the `importers` object in `cli.js`

Example importer structure:

```javascript
// importers/steam/index.js
export async function importFromSteam(config) {
  const { metadataPath, ... } = config;
  // Implementation here
}
```

```javascript
// cli.js
import { importFromSteam } from './importers/steam/index.js';

const importers = {
  'gog-galaxy': { ... },
  'steam': {
    name: 'Steam',
    handler: importFromSteam,
    requiredEnv: [...],
    optionalEnv: [...],
  },
};
```
