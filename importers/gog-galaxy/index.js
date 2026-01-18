// GOG Galaxy Importer
// Reads data from GOG Galaxy SQLite database and imports games and collections

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { searchGameOnServer, getGameDetailsFromServer, createGameViaAPI, uploadExecutableViaAPI, uploadCoverViaAPI, uploadBackgroundViaAPI, createCollectionViaAPI, updateCollectionGamesViaAPI, getCollectionsViaAPI } from '../common/igdb.js';

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
  // Search game on MyHomeGames server
  console.log(`  Searching on MyHomeGames server...`);
  const igdbGame = await searchGameOnServer(gameTitle, serverUrl, apiToken, twitchClientId, twitchClientSecret);
  
  if (!igdbGame) {
    console.warn(`  Warning: Game not found, skipping: ${gameTitle}`);
    return null;
  }
  
  const gameId = igdbGame.id;
  console.log(`  Found: ${igdbGame.name} (ID: ${gameId})`);
  
  // Get full game details from IGDB
  console.log(`  Fetching full game details...`);
  let fullGameData = null;
  try {
    fullGameData = await getGameDetailsFromServer(gameId, serverUrl, apiToken, twitchClientId, twitchClientSecret);
  } catch (error) {
    console.warn(`  Warning: Failed to fetch full game details: ${error.message}`);
  }
  
  // Prepare game data for API
  const releaseDate = fullGameData?.releaseDate || null;
  const gameData = {
    igdbId: gameId,
    name: fullGameData?.name || igdbGame.name,
    summary: fullGameData?.summary || '',
    cover: fullGameData?.cover || null,
    background: fullGameData?.background || null,
    releaseDate: releaseDate,
    genres: fullGameData?.genres || null,
    criticRating: fullGameData?.criticRating !== null && fullGameData?.criticRating !== undefined ? fullGameData.criticRating : null,
    userRating: fullGameData?.userRating !== null && fullGameData?.userRating !== undefined ? fullGameData.userRating : null,
    themes: fullGameData?.themes || null,
    platforms: fullGameData?.platforms || null,
    gameModes: fullGameData?.gameModes || null,
    playerPerspectives: fullGameData?.playerPerspectives || null,
    websites: fullGameData?.websites || null,
    ageRatings: fullGameData?.ageRatings || null,
    developers: fullGameData?.developers || null,
    publishers: fullGameData?.publishers || null,
    franchise: fullGameData?.franchise || null,
    collection: fullGameData?.collection || null,
    screenshots: fullGameData?.screenshots || null,
    videos: fullGameData?.videos || null,
    gameEngines: fullGameData?.gameEngines || null,
    keywords: fullGameData?.keywords || null,
    alternativeNames: fullGameData?.alternativeNames || null,
    similarGames: fullGameData?.similarGames || null,
  };
  
  // Create game via API
  console.log(`  Creating game via API...`);
  try {
    await createGameViaAPI(gameData, serverUrl, apiToken);
    console.log(`  Created game via API`);
  } catch (error) {
    // If game already exists (409), that's fine, continue
    if (error.message.includes('409') || error.message.includes('already exists')) {
      console.log(`  Game already exists, skipping creation`);
    } else {
      throw error;
    }
  }
  
  // Upload executables via API
  let executableCount = 0;
  for (const exec of executables) {
    if (!exec.path || !fs.existsSync(exec.path)) continue;
    
    // Clean label: remove .sh or .bat extension if present
    let label = exec.label || 'script';
    if (label.endsWith('.bat')) {
      label = label.slice(0, -4); // Remove last 4 characters (.bat)
    } else if (label.endsWith('.sh')) {
      label = label.slice(0, -3); // Remove last 3 characters (.sh)
    }
    
    try {
      await uploadExecutableViaAPI(gameId, exec.path, label, serverUrl, apiToken);
      console.log(`  Uploaded executable: ${path.basename(exec.path)} (label: ${label})`);
      executableCount++;
    } catch (error) {
      console.warn(`  Warning: Failed to upload executable ${exec.path}: ${error.message}`);
    }
  }
  
  console.log(`  Uploaded ${executableCount} executable(s)`);
  
  // Upload images from GOG Galaxy via API
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
        try {
          await uploadCoverViaAPI(gameId, coverPath, serverUrl, apiToken);
          console.log(`  Uploaded cover: ${path.basename(coverPath)}`);
        } catch (error) {
          console.warn(`  Warning: Failed to upload cover: ${error.message}`);
        }
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
        try {
          await uploadBackgroundViaAPI(gameId, bgPath, serverUrl, apiToken);
          console.log(`  Uploaded background: ${path.basename(bgPath)}`);
        } catch (error) {
          console.warn(`  Warning: Failed to upload background: ${error.message}`);
        }
        break;
      }
    }
  }
  
  return gameId;
}

/**
 * Import collections (tags) via API
 * Note: This function uses gameReleaseKeyMap to map releaseKey to IGDB game IDs.
 */
async function importCollections(metadataPath, gameReleaseKeyMap, tagsData, gamesByReleaseKey, serverUrl, apiToken) {
  console.log('\n=== Importing Collections ===');
  
  // Get existing collections via API
  const existingCollections = new Set();
  try {
    const collections = await getCollectionsViaAPI(serverUrl, apiToken);
    for (const collection of collections) {
      if (collection.title) {
        existingCollections.add(collection.title.toLowerCase());
      }
    }
  } catch (error) {
    console.warn(`  Warning: Failed to get existing collections: ${error.message}`);
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
    
    // Map releaseKeys to game IDs using gameReleaseKeyMap (games imported in this session)
    const gameIds = [];
    let missingGameCount = 0;
    
    for (const releaseKey of releaseKeys) {
      // Try to get from gameReleaseKeyMap first (for games imported in this session)
      const gameId = gameReleaseKeyMap.get(releaseKey);
      if (gameId) {
        gameIds.push(typeof gameId === 'number' ? gameId : parseInt(gameId, 10));
      } else {
        // If not found in gameReleaseKeyMap, try to find by title in filesystem as fallback
        // (for games imported in previous sessions)
        const gameData = gamesByReleaseKey.get(releaseKey);
        if (gameData && gameData.title) {
          // Try to find game ID by reading from filesystem (fallback for games not imported in this session)
          const gamesDir = path.join(metadataPath, 'content', 'games');
          if (fs.existsSync(gamesDir)) {
            let found = false;
            const normalizedTitle = gameData.title.toLowerCase().trim();
            const gameDirs = fs.readdirSync(gamesDir, { withFileTypes: true });
            for (const gameDir of gameDirs) {
              if (gameDir.isDirectory()) {
                const gameMetadataPath = path.join(gamesDir, gameDir.name, 'metadata.json');
                if (fs.existsSync(gameMetadataPath)) {
                  try {
                    const gameMetadata = JSON.parse(fs.readFileSync(gameMetadataPath, 'utf-8'));
                    if (gameMetadata.title && gameMetadata.title.toLowerCase().trim() === normalizedTitle) {
                      const fsGameId = parseInt(gameDir.name, 10);
                      if (!isNaN(fsGameId)) {
                        gameIds.push(fsGameId);
                        found = true;
                        break;
                      }
                    }
                  } catch (e) {
                    // Ignore invalid JSON
                  }
                }
              }
            }
            if (!found) {
              missingGameCount++;
            }
          } else {
            missingGameCount++;
          }
        } else {
          missingGameCount++;
        }
      }
    }
    
    if (missingGameCount > 0) {
      console.log(`    Note: ${missingGameCount} game(s) from this collection were not found (skipped)`);
    }
    
    // Create collection via API
    try {
      const response = await createCollectionViaAPI(tag, '', serverUrl, apiToken);
      const collectionId = response.collection?.id;
      
      if (collectionId && gameIds.length > 0) {
        // Update collection games via API
        await updateCollectionGamesViaAPI(collectionId, gameIds, serverUrl, apiToken);
      }
      
      console.log(`  Created collection: ${tag} (ID: ${collectionId}, ${gameIds.length} games)`);
      importedCount++;
    } catch (error) {
      // If collection already exists (409), that's fine, skip it
      if (error.message.includes('409') || error.message.includes('already exists')) {
        console.log(`  Skipping existing collection: ${tag}`);
      } else {
        console.warn(`  Warning: Failed to create collection ${tag}: ${error.message}`);
      }
    }
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
    search,
    gamesOnly = false,
    collectionsOnly = false,
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
    // Import games (unless collections-only mode)
    if (!collectionsOnly) {
      // Get all games from GamePieces
      // GamePieces.value is a JSON object containing the title
      // PlayTasks links releaseKey to playTaskId
      // PlayTaskLaunchParameters contains executablePath linked via playTaskId
      console.log('\n=== Querying Games ===');
    if (search) {
      console.log(`Filtering by search term: "${search}"\n`);
    }
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
        ${search ? `AND json_extract(gp.value, '$.title') LIKE '%' || ? || '%'` : ''}
      ORDER BY title
      ${limit ? `LIMIT ${limit}` : ''}
    `);
    
    const games = search ? gamesQuery.all(search) : gamesQuery.all();
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
    
    // Filter out duplicates before processing to get accurate count
    const gamesToProcess = [];
    for (const [releaseKey, gameData] of gamesByReleaseKey) {
      const normalizedTitle = gameData.title.toLowerCase().trim();
      if (!processedTitles.has(normalizedTitle)) {
        processedTitles.add(normalizedTitle);
        gamesToProcess.push([releaseKey, gameData]);
      }
    }
    
    const totalGames = gamesToProcess.length;
    processedTitles.clear(); // Reset for actual processing
    
    // Import each game (processing all executables together)
    console.log(`=== Importing Games (${totalGames} games) ===`);
    let successCount = 0;
    let skipCount = 0;
    let currentIndex = 0;
    
    for (const [releaseKey, gameData] of gamesToProcess) {
      currentIndex++;
      
      // Normalize title for duplicate detection (lowercase, trim)
      const normalizedTitle = gameData.title.toLowerCase().trim();
      
      // Skip if this title was already processed
      if (processedTitles.has(normalizedTitle)) {
        console.log(`  [${currentIndex}/${totalGames}] Skipping duplicate title: ${gameData.title} (releaseKey: ${releaseKey})`);
        continue;
      }
      
      processedTitles.add(normalizedTitle);
      
      console.log(`[${currentIndex}/${totalGames}] Processing game: ${gameData.title}`);
      
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
        console.error(`  [${currentIndex}/${totalGames}] Error importing ${gameData.title}:`, error.message);
        skipCount++;
      }
    }
    
      console.log(`\n=== Import Summary ===`);
      console.log(`Successfully imported: ${successCount}`);
      console.log(`Skipped: ${skipCount}`);
      
      // Import collections (unless games-only mode)
      if (!gamesOnly) {
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
        if ((gameReleaseKeyMap.size > 0 || gamesByReleaseKey.size > 0) && tagsData.length > 0) {
          await importCollections(metadataPath, gameReleaseKeyMap, tagsData, gamesByReleaseKey, serverUrl, apiToken);
        }
      } else {
        console.log('\n=== Skipping Collections (--games-only mode) ===');
      }
    } else {
      console.log('\n=== Skipping Games (--collections-only mode) ===');
      
      // Import only collections - need to get game data for mapping
      // First, get all games from GamePieces to build gamesByReleaseKey map
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
      `);
      
      const games = gamesQuery.all();
      
      // Group games by releaseKey to get titles
      const gamesByReleaseKey = new Map();
      for (const game of games) {
        if (!game.releaseKey) continue;
        
        if (!gamesByReleaseKey.has(game.releaseKey)) {
          gamesByReleaseKey.set(game.releaseKey, {
            title: game.title,
            executables: [],
            executableSet: new Set()
          });
        }
        
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
      
      // Clean up executableSet
      for (const gameData of gamesByReleaseKey.values()) {
        delete gameData.executableSet;
      }
      
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
      if (gamesByReleaseKey.size > 0 && tagsData.length > 0) {
        await importCollections(metadataPath, new Map(), tagsData, gamesByReleaseKey, serverUrl, apiToken);
      }
    }
    
  } finally {
    db.close();
  }
  
  console.log('\n=== Import Complete ===');
}
