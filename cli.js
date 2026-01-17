#!/usr/bin/env node
// MyHomeGames Importer CLI
// Main entry point for all importers

import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { importFromGOGGalaxy } from './importers/gog-galaxy/index.js';

// Load .env file if it exists
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Available importers
const importers = {
  'gog-galaxy': {
    name: 'GOG Galaxy',
    handler: importFromGOGGalaxy,
    requiredEnv: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'],
    optionalEnv: ['GALAXY_DB_PATH', 'GALAXY_IMAGES_PATH', 'LIMIT'],
  },
};

function printUsage() {
  console.log('MyHomeGames Importer');
  console.log('');
  console.log('Usage: node cli.js <importer> [options]');
  console.log('');
  console.log('Available importers:');
  for (const [key, importer] of Object.entries(importers)) {
    console.log(`  ${key} - ${importer.name}`);
  }
  console.log('');
  console.log('Examples:');
  console.log('  node cli.js gog-galaxy --metadata-path /path/to/metadata');
  console.log('  METADATA_PATH=/path/to/metadata TWITCH_CLIENT_ID=xxx TWITCH_CLIENT_SECRET=xxx node cli.js gog-galaxy');
  console.log('');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        options[key] = value;
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }
  
  const importerName = args[0];
  const importer = importers[importerName];
  
  if (!importer) {
    console.error(`Error: Unknown importer: ${importerName}`);
    console.error('');
    printUsage();
    process.exit(1);
  }
  
  // Parse options
  const options = parseArgs();
  
  // Get configuration from environment variables and options
  const config = {};
  
  // Common configuration
  config.metadataPath = process.env.METADATA_PATH || options.metadata_path || process.argv[3];
  
  if (!config.metadataPath) {
    console.error('Error: METADATA_PATH environment variable, --metadata-path option, or path argument is required');
    console.error('');
    printUsage();
    process.exit(1);
  }
  
  // Importer-specific configuration
  if (importerName === 'gog-galaxy') {
    const homeDir = os.homedir();
    
    config.galaxyDbPath = process.env.GALAXY_DB_PATH || options.galaxy_db_path || path.join(
      homeDir,
      'Library/Application Support/GOG Galaxy/Storage/galaxy-2.0.db'
    );
    
    config.galaxyImagesPath = process.env.GALAXY_IMAGES_PATH || options.galaxy_images_path || path.join(
      homeDir,
      'Library/Application Support/GOG Galaxy/Storage/GalaxyClient/Images'
    );
    
    config.twitchClientId = process.env.TWITCH_CLIENT_ID || options.twitch_client_id;
    config.twitchClientSecret = process.env.TWITCH_CLIENT_SECRET || options.twitch_client_secret;
    
    config.limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : (options.limit ? parseInt(options.limit, 10) : null);
    
    // Check required environment variables
    if (!config.twitchClientId || !config.twitchClientSecret) {
      console.error('Error: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables are required for GOG Galaxy importer');
      process.exit(1);
    }
  }
  
  // Run the importer
  try {
    await importer.handler(config);
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
