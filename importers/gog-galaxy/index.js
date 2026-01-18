// GOG Galaxy Importer
// Reads data from GOG Galaxy SQLite database and imports games and collections

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { searchGameOnServer } from '../common/igdb.js';
import { ensureDirectoryExists, copyFile, writeJsonFile } from '../common/files.js';

/**
 * Sanitize executable name for filesystem (same logic as server)
 */
function sanitizeExecutableName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Import a single game
 * @param {string} gameTitle - Game title
 * @param {string} releaseKey - GOG Galaxy release key
 * @param {Array<{path: string, label: string|null}>} executables - Array of executables with path and label
 * @param {string} metadataPath - Path to metadata directory
 * @param {string} galaxyImagesPath - Path to GOG Galaxy images
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @param {string} twitchClientId - Twitch Client ID
 * @param {string} twitchClientSecret - Twitch Client Secret
 */
async function importGame(gameTitle, releaseKey, executables, metadataPath, galaxyImagesPath, serverUrl, apiToken, twitchClientId, twitchClientSecret) {
  console.log(`\nProcessing game: ${gameTitle}`);
  
  // Search game on MyHomeGames server
  console.log(`  Searching on MyHomeGames server...`);
  const igdbGame = await searchGameOnServer(gameTitle, serverUrl, apiToken, twitchClientId, twitchClientSecret);
  
  if (!igdbGame) {
    console.warn(`  Warning: Game not found, skipping: ${gameTitle}`);
    return null;
  }
  
  const gameId = igdbGame.id;
  console.log(`  Found: ${igdbGame.name} (ID: ${gameId})`);
  
  // Create game directory
  const gameDir = path.join(metadataPath, 'content', 'games', String(gameId));
  ensureDirectoryExists(gameDir);
  
  // Process all executables
  const executableLabels = [];
  const usedFileNames = new Set(); // Track used filenames to avoid collisions
  
  for (const exec of executables) {
    if (!exec.path) continue;
    
    // Clean label: remove .sh or .bat extension if present
    let label = exec.label || 'script';
    if (label.endsWith('.sh') || label.endsWith('.bat')) {
      label = label.slice(0, -4); // Remove last 4 characters (.sh or .bat)
    }
    
    let executableName = sanitizeExecutableName(label);
    
    // Determine script extension based on original file
    const ext = path.extname(exec.path).toLowerCase();
    const scriptExtension = ext === '.bat' ? '.bat' : '.sh';
    
    // Handle filename collisions: if sanitized name already used, add a number
    let scriptName = `${executableName}${scriptExtension}`;
    let counter = 1;
    while (usedFileNames.has(scriptName)) {
      scriptName = `${executableName}_${counter}${scriptExtension}`;
      counter++;
    }
    usedFileNames.add(scriptName);
    
    const scriptPath = path.join(gameDir, scriptName);
    
    if (copyFile(exec.path, scriptPath)) {
      // Make script executable (Unix-like systems, only for .sh)
      if (scriptExtension === '.sh') {
        try {
          fs.chmodSync(scriptPath, 0o755);
        } catch (e) {
          // Ignore chmod errors on Windows
        }
      }
      console.log(`  Copied script: ${scriptName} (label: ${label})`);
      // Use the original label (not sanitized) in the metadata
      executableLabels.push(label);
    }
  }
  
  // Create metadata.json
  const gameMetadataPath = path.join(gameDir, 'metadata.json');
  const gameMetadata = {
    title: igdbGame.name,
    summary: '',
    year: null,
    month: null,
    day: null,
    stars: null,
    genre: null,
  };
  
  // Add executables array if we have executables
  if (executableLabels.length > 0) {
    gameMetadata.executables = executableLabels;
  }
  
  writeJsonFile(gameMetadataPath, gameMetadata);
  console.log(`  Created metadata.json with ${executableLabels.length} executable(s)`);
  
  // Copy images from GOG Galaxy
  if (releaseKey) {
    // Look for cover image
    const coverPatterns = [
      path.join(galaxyImagesPath, `${releaseKey}_cover.jpg`),
      path.join(galaxyImagesPath, `${releaseKey}_cover.png`),
      path.join(galaxyImagesPath, `${releaseKey}.jpg`),
      path.join(galaxyImagesPath, `${releaseKey}.png`),
    ];
    
    for (const coverPath of coverPatterns) {
      if (fs.existsSync(coverPath)) {
        const destCoverPath = path.join(gameDir, 'cover.webp');
        // Note: We copy as .webp, but the file might be .jpg or .png
        // You might want to convert it to webp using a library like sharp
        copyFile(coverPath, destCoverPath);
        console.log(`  Copied cover: ${path.basename(coverPath)}`);
        break;
      }
    }
    
    // Look for background image
    const backgroundPatterns = [
      path.join(galaxyImagesPath, `${releaseKey}_background.jpg`),
      path.join(galaxyImagesPath, `${releaseKey}_background.png`),
      path.join(galaxyImagesPath, `${releaseKey}_hero.jpg`),
      path.join(galaxyImagesPath, `${releaseKey}_hero.png`),
    ];
    
    for (const bgPath of backgroundPatterns) {
      if (fs.existsSync(bgPath)) {
        const destBgPath = path.join(gameDir, 'background.webp');
        copyFile(bgPath, destBgPath);
        console.log(`  Copied background: ${path.basename(bgPath)}`);
        break;
      }
    }
  }
  
  return gameId;
}

/**
 * Import collections (tags)
 */
function importCollections(metadataPath, gameReleaseKeyMap, tagsData) {
  console.log('\n=== Importing Collections ===');
  
  // Load existing collections to avoid duplicates
  const collectionsDir = path.join(metadataPath, 'content', 'collections');
  ensureDirectoryExists(collectionsDir);
  
  const existingCollections = new Set();
  if (fs.existsSync(collectionsDir)) {
    const dirs = fs.readdirSync(collectionsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const metadataPath = path.join(collectionsDir, dir.name, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
            if (metadata.title) {
              existingCollections.add(metadata.title.toLowerCase());
            }
          } catch (e) {
            // Ignore invalid JSON
          }
        }
      }
    }
  }
  
  // Group games by tag
  const tagGamesMap = new Map();
  for (const row of tagsData) {
    if (!tagGamesMap.has(row.tag)) {
      tagGamesMap.set(row.tag, []);
    }
    tagGamesMap.get(row.tag).push(row.releaseKey);
  }
  
  let importedCount = 0;
  for (const [tag, releaseKeys] of tagGamesMap) {
    // Check if collection already exists
    if (existingCollections.has(tag.toLowerCase())) {
      console.log(`  Skipping existing collection: ${tag}`);
      continue;
    }
    
    // Create collection with numeric ID (timestamp)
    const collectionId = Date.now() + importedCount;
    const collectionDir = path.join(collectionsDir, String(collectionId));
    ensureDirectoryExists(collectionDir);
    
    // Create metadata.json
    const collectionMetadataPath = path.join(collectionDir, 'metadata.json');
    const collectionMetadata = {
      title: tag,
      summary: '',
      games: [], // Will be populated with game IDs from releaseKeys
    };
    
    // Map releaseKeys to game IDs (convert to numbers as MyHomeGames uses numeric IDs)
    const gameIds = [];
    let missingGameCount = 0;
    for (const releaseKey of releaseKeys) {
      const gameId = gameReleaseKeyMap.get(releaseKey);
      if (gameId) {
        // MyHomeGames uses numeric IDs for games in collections
        gameIds.push(typeof gameId === 'number' ? gameId : parseInt(gameId, 10));
      } else {
        missingGameCount++;
        console.warn(`    Warning: No IGDB game ID found for releaseKey: ${releaseKey} (game may not have been imported)`);
      }
    }
    
    if (missingGameCount > 0) {
      console.log(`    Note: ${missingGameCount} game(s) from this collection were not imported (skipped)`);
    }
    
    collectionMetadata.games = gameIds;
    writeJsonFile(collectionMetadataPath, collectionMetadata);
    
    console.log(`  Created collection: ${tag} (ID: ${collectionId}, ${gameIds.length} games)`);
    importedCount++;
  }
  
  console.log(`\nImported ${importedCount} collections`);
}

/**
 * Main GOG Galaxy import function
 */
export async function importFromGOGGalaxy(config) {
  const {
    galaxyDbPath,
    galaxyImagesPath,
    metadataPath,
    serverUrl,
    apiToken,
    twitchClientId,
    twitchClientSecret,
    limit,
  } = config;

  console.log('=== GOG Galaxy Importer ===\n');
  console.log(`GOG Galaxy DB: ${galaxyDbPath}`);
  console.log(`GOG Galaxy Images: ${galaxyImagesPath}`);
  console.log(`MyHomeGames Metadata: ${metadataPath}\n`);
  
  // Validate paths
  if (!fs.existsSync(galaxyDbPath)) {
    throw new Error(`GOG Galaxy database not found: ${galaxyDbPath}`);
  }
  
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata path does not exist: ${metadataPath}`);
  }
  
  if (!serverUrl) {
    throw new Error('SERVER_URL is required (e.g., http://localhost:3000)');
  }
  
  if (!apiToken) {
    throw new Error('API_TOKEN is required for server authentication');
  }
  
  if (!twitchClientId || !twitchClientSecret) {
    throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required for IGDB search');
  }
  
  // Open GOG Galaxy database
  console.log('Opening GOG Galaxy database...');
  const db = new Database(galaxyDbPath, { readonly: true });
  
  try {
    // Get all games from GamePieces
    // GamePieces.value is a JSON object containing the title
    // PlayTasks links releaseKey to playTaskId
    // PlayTaskLaunchParameters contains executablePath linked via playTaskId
    console.log('\n=== Querying Games ===');
    const gamesQuery = db.prepare(`
      SELECT DISTINCT
        gp.releaseKey,
        json_extract(gp.value, '$.title') as title,
        ptlp.executablePath,
        ptlp.label
      FROM GamePieces gp
      LEFT JOIN LibraryReleases lr ON gp.releaseKey = lr.releaseKey
      LEFT JOIN PlayTasks pt ON gp.releaseKey = pt.gameReleaseKey
      LEFT JOIN PlayTaskLaunchParameters ptlp ON pt.id = ptlp.playTaskId
      WHERE gp.value IS NOT NULL 
        AND gp.value != ''
        AND gp.releaseKey IS NOT NULL
        AND lr.releaseKey IS NOT NULL
        AND json_extract(gp.value, '$.title') IS NOT NULL
        AND json_extract(gp.value, '$.title') != ''
      ORDER BY title
      ${limit ? `LIMIT ${limit}` : ''}
    `);
    
    const games = gamesQuery.all();
    console.log(`Found ${games.length} game entries to import\n`);
    
    // Group games by releaseKey to handle multiple executables per game
    // Note: It's normal to have the same releaseKey multiple times in query results
    // when a game has multiple executables - the grouping handles this correctly
    const gamesByReleaseKey = new Map();
    
    for (const game of games) {
      if (!game.releaseKey) continue;
      
      if (!gamesByReleaseKey.has(game.releaseKey)) {
        gamesByReleaseKey.set(game.releaseKey, {
          title: game.title,
          executables: [],
          executableSet: new Set() // Track unique executables to avoid duplicates
        });
      }
      
      // Add executable if it exists and not already added
      if (game.executablePath) {
        const executableKey = `${game.executablePath}|${game.label || ''}`;
        const gameData = gamesByReleaseKey.get(game.releaseKey);
        
        if (!gameData.executableSet.has(executableKey)) {
          gameData.executableSet.add(executableKey);
          gameData.executables.push({
            path: game.executablePath,
            label: game.label || null
          });
        }
      }
    }
    
    // Clean up executableSet (no longer needed after grouping)
    for (const gameData of gamesByReleaseKey.values()) {
      delete gameData.executableSet;
    }
    
    console.log(`Found ${gamesByReleaseKey.size} unique games (some may have multiple executables)\n`);
    
    // Map to track releaseKey -> gameId mapping
    const gameReleaseKeyMap = new Map();
    const processedTitles = new Set(); // Track processed titles (normalized) to avoid duplicates
    
    // Import each game (processing all executables together)
    console.log('=== Importing Games ===');
    let successCount = 0;
    let skipCount = 0;
    
    for (const [releaseKey, gameData] of gamesByReleaseKey) {
      // Normalize title for duplicate detection (lowercase, trim)
      const normalizedTitle = gameData.title.toLowerCase().trim();
      
      // Skip if this title was already processed
      if (processedTitles.has(normalizedTitle)) {
        console.log(`  Skipping duplicate title: ${gameData.title} (releaseKey: ${releaseKey})`);
        continue;
      }
      
      processedTitles.add(normalizedTitle);
      
      try {
        const gameId = await importGame(
          gameData.title,
          releaseKey,
          gameData.executables,
          metadataPath,
          galaxyImagesPath,
          serverUrl,
          apiToken,
          twitchClientId,
          twitchClientSecret
        );
        
        if (gameId) {
          successCount++;
          gameReleaseKeyMap.set(releaseKey, gameId);
        } else {
          skipCount++;
        }
      } catch (error) {
        console.error(`  Error importing ${gameData.title}:`, error.message);
        skipCount++;
      }
    }
    
    console.log(`\n=== Import Summary ===`);
    console.log(`Successfully imported: ${successCount}`);
    console.log(`Skipped: ${skipCount}`);
    
    // Get games for each tag
    const gamesByTagQuery = db.prepare(`
      SELECT DISTINCT urt.tag, urt.releaseKey
      FROM UserReleaseTags urt
      WHERE urt.tag IS NOT NULL AND urt.tag != ''
        AND urt.releaseKey IS NOT NULL
      ORDER BY urt.tag, urt.releaseKey
    `);
    const tagsData = gamesByTagQuery.all();
    
    // Import collections
    if (gameReleaseKeyMap.size > 0 && tagsData.length > 0) {
      importCollections(metadataPath, gameReleaseKeyMap, tagsData);
    }
    
  } finally {
    db.close();
  }
  
  console.log('\n=== Import Complete ===');
}
