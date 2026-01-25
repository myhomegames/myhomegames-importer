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

const IMPORTER_DIRNAME = 'importer';
const IMPORT_MAP_FILENAME = 'gog-galaxy-releasekey-map.json';

function loadReleaseKeyMap(metadataPath) {
  const importDirPath = path.join(metadataPath, IMPORTER_DIRNAME);
  const importMapPath = path.join(importDirPath, IMPORT_MAP_FILENAME);
  if (!fs.existsSync(importMapPath)) {
    return { importMapPath, importMap: new Map(), existed: false };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(importMapPath, 'utf-8'));
    const importMap = new Map();
    if (raw && typeof raw === 'object') {
      for (const [releaseKey, entry] of Object.entries(raw)) {
        if (!releaseKey) continue;
        if (entry && typeof entry === 'object') {
          importMap.set(releaseKey, entry);
        } else {
          importMap.set(releaseKey, { igdbId: entry });
        }
      }
    }
    return { importMapPath, importMap, existed: true };
  } catch (error) {
    console.warn(`Warning: Failed to read import map at ${importMapPath}: ${error.message}`);
    return { importMapPath, importMap: new Map(), existed: true };
  }
}

function saveReleaseKeyMap(importMapPath, importMap) {
  const importDirPath = path.dirname(importMapPath);
  fs.mkdirSync(importDirPath, { recursive: true });
  const data = Object.fromEntries(importMap);
  fs.writeFileSync(importMapPath, JSON.stringify(data, null, 2));
}

function buildReleaseKeyIdMap(importMap) {
  const map = new Map();
  for (const [releaseKey, entry] of importMap) {
    if (entry && entry.igdbId) {
      map.set(releaseKey, entry.igdbId);
    } else if (entry) {
      map.set(releaseKey, entry);
    }
  }
  return map;
}

function formatReleaseDateForMap(releaseDate) {
  if (releaseDate === null || releaseDate === undefined) return null;

  const raw = typeof releaseDate === 'string' ? releaseDate.trim() : releaseDate;
  if (typeof raw === 'string' && raw.includes('-')) {
    return raw;
  }

  const numericValue = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (Number.isNaN(numericValue)) {
    return String(raw);
  }

  if (String(numericValue).length <= 4) {
    return String(numericValue);
  }

  return new Date(numericValue * 1000).toISOString().split('T')[0];
}

/**
 * Import a single game
 * @param {string|Array<string>} gameTitles - Game title(s) to try (can be array for multiple titles)
 * @param {string} releaseKey - GOG Galaxy release key
 * @param {Array<{path: string, label: string|null}>} executables - Array of executables with path and label
 * @param {string} metadataPath - Path to metadata directory
 * @param {string} galaxyImagesPath - Path to GOG Galaxy images
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @param {string} twitchClientId - Twitch Client ID
 * @param {string} twitchClientSecret - Twitch Client Secret
 * @param {number|null} myRating - My rating from GOG Galaxy (0-5 scale, will be converted to 0-10)
 * @param {number|null} releaseYear - Release year from GOG Galaxy (for filtering IGDB search)
 * @param {string|null} gogReleaseDate - Release date from GOG Galaxy (Unix timestamp as string, used as fallback if IGDB doesn't have it)
 */
async function importGame(gameTitles, releaseKey, executables, metadataPath, galaxyImagesPath, serverUrl, apiToken, twitchClientId, twitchClientSecret, myRating = null, releaseYear = null, gogReleaseDate = null, options = {}) {
  // Normalize gameTitles to array
  const titlesToTry = Array.isArray(gameTitles) ? gameTitles : [gameTitles];
  const primaryTitle = titlesToTry[0]; // Use first title for logging

  const { igdbId: overrideIgdbId, skipSearch = false } = options;
  let igdbGame = null;
  let gameId = null;

  if (overrideIgdbId) {
    gameId = Number(overrideIgdbId);
    if (Number.isNaN(gameId)) {
      gameId = overrideIgdbId;
    }
    console.log(`  Skipping IGDB name search (UPLOAD=true). Using IGDB ID: ${gameId}`);
    igdbGame = { id: gameId, name: primaryTitle };
  } else {
    if (skipSearch) {
      console.warn('  Warning: skipSearch enabled but no IGDB ID provided; falling back to name search.');
    }
    // Search game on MyHomeGames server, trying each title until one succeeds
    console.log(`  Searching on MyHomeGames server...`);
    let igdbGames = null;
    let usedTitle = null;

    for (const title of titlesToTry) {
      if (titlesToTry.length > 1) {
        console.log(`    Trying title: "${title}"`);
      }
      igdbGames = await searchGameOnServer(title, serverUrl, apiToken, twitchClientId, twitchClientSecret, releaseYear);

      if (igdbGames && igdbGames.length > 0) {
        usedTitle = title;
        if (titlesToTry.length > 1) {
          console.log(`    Found results with title: "${title}"`);
        }
        break;
      }
    }

    if (!igdbGames || igdbGames.length === 0) {
      const allTitles = titlesToTry.join('", "');
      console.warn(`  Warning: Game not found with any title, skipping: "${allTitles}"`);
      return null;
    }

    // Use first game from search results (no longer filtering by already imported)
    igdbGame = igdbGames[0];
    gameId = igdbGame.id;
    console.log(`  Found: ${igdbGame.name} (ID: ${gameId})`);
  }
  
  // Get full game details from IGDB
  console.log(`  Fetching full game details...`);
  let fullGameData = null;
  try {
    fullGameData = await getGameDetailsFromServer(gameId, serverUrl, apiToken, twitchClientId, twitchClientSecret);
  } catch (error) {
    console.warn(`  Warning: Failed to fetch full game details: ${error.message}`);
  }
  
  // Prepare game data for API
  // Use IGDB releaseDateFull timestamp if available, otherwise fallback to IGDB releaseDate (year), then GOG
  const igdbReleaseDateFull = fullGameData?.releaseDateFull?.timestamp || null;
  const igdbReleaseDate = fullGameData?.releaseDate || null;
  console.log(`  Release date (IGDB full timestamp): ${igdbReleaseDateFull !== null ? igdbReleaseDateFull : 'null'}`);
  if (igdbReleaseDateFull) {
    console.log(`  Release date (IGDB full ISO): ${new Date(igdbReleaseDateFull * 1000).toISOString().split('T')[0]}`);
  }
  console.log(`  Release date (GOG raw): ${gogReleaseDate !== null && gogReleaseDate !== undefined ? gogReleaseDate : 'null'}`);
  let releaseDate = igdbReleaseDateFull || igdbReleaseDate;
  if (!releaseDate && gogReleaseDate) {
    // Convert GOG Galaxy releaseDate (Unix timestamp as string) to ISO format
    try {
      const gogTimestamp = parseInt(gogReleaseDate, 10);
      if (!isNaN(gogTimestamp)) {
        // IGDB uses Unix timestamp in seconds, so we keep it as is
        releaseDate = gogTimestamp;
        console.log(`  Using GOG Galaxy release date as fallback: ${new Date(gogTimestamp * 1000).toISOString().split('T')[0]}`);
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }
  console.log(`  Release date (final for gameData): ${releaseDate !== null && releaseDate !== undefined ? releaseDate : 'null'}`);
  // Convert myRating from 0-5 scale to 0-10 scale (stars)
  const stars = myRating !== null && myRating !== undefined ? myRating * 2 : null;
  
  // Log stars when passing to server
  if (stars !== null) {
    console.log(`  Stars (myRating ${myRating} -> stars ${stars}): ${stars}`);
  } else if (myRating !== null && myRating !== undefined) {
    console.log(`  Stars: null (myRating was ${myRating})`);
  }
  
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
    stars: stars,
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
  
  // Return both gameId (folder name) and igdbId for collection mapping
  return {
    gameId: gameId,
    igdbId: gameId, // gameId is the IGDB ID used as folder name
    title: fullGameData?.name || igdbGame.name,
    releaseDate: formatReleaseDateForMap(releaseDate),
    stars: stars
  };
}

/**
 * Import collections (tags) via API
 * Note: This function uses gameReleaseKeyMap to map releaseKey to game IDs (folder names),
 * and gameReleaseKeyToIgdbIdMap to map releaseKey to IGDB IDs for filesystem lookup.
 * For games not in the map, it searches the server for IGDB ID, then searches filesystem.
 */
async function importCollections(metadataPath, gameReleaseKeyMap, gameReleaseKeyToIgdbIdMap, tagsData, gamesByReleaseKey, serverUrl, apiToken, twitchClientId, twitchClientSecret) {
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
  
  // Group games by tag with release date info
  const tagGamesMap = new Map();
  for (const row of tagsData) {
    if (!tagGamesMap.has(row.tag)) {
      tagGamesMap.set(row.tag, []);
    }
    tagGamesMap.get(row.tag).push({
      releaseKey: row.releaseKey,
      releaseDate: row.releaseDate || null
    });
  }
  
  // Cache for title -> IGDB ID lookups to avoid duplicate server calls
  const titleToIgdbIdCache = new Map();
  
  let importedCount = 0;
  for (const [tag, releaseKeysWithDate] of tagGamesMap) {
    // Check if collection already exists
    if (existingCollections.has(tag.toLowerCase())) {
      console.log(`  Skipping existing collection: ${tag}`);
      continue;
    }
    
    // Map releaseKeys to game IDs using gameReleaseKeyMap (games imported in this session)
    // Use the order from SQL query (ORDER BY urt.tag, releaseDate)
    const gameIdsWithDates = []; // Track gameId with release date for logging
    const gameIds = [];
    let missingGameCount = 0;
    const missingGames = []; // Track missing games with details
    
    for (const { releaseKey, releaseDate } of releaseKeysWithDate) {
      // Try to get from gameReleaseKeyMap first (for games imported in this session)
      const gameId = gameReleaseKeyMap.get(releaseKey);
      if (gameId) {
        const finalGameId = typeof gameId === 'number' ? gameId : parseInt(gameId, 10);
        gameIds.push(finalGameId);
        gameIdsWithDates.push({ gameId: finalGameId, releaseDate: releaseDate || null });
      } else {
        // If not found in gameReleaseKeyMap, try to find by IGDB ID in filesystem
        // First, try to get IGDB ID from the mapping (if available)
        let igdbIdToSearch = gameReleaseKeyToIgdbIdMap.get(releaseKey);
        const gameData = gamesByReleaseKey.get(releaseKey);
        const gameTitle = gameData?.title || 'Unknown';
        const titlesToTry = gameData?.titles || [gameTitle]; // Use all available titles
        
        // If no IGDB ID in mapping, try to find by searching the game titles on the server
        // to get the IGDB ID, then search filesystem by IGDB ID
        if (!igdbIdToSearch) {
          if (gameData && titlesToTry.length > 0) {
            // Try each title until we find an IGDB ID
            let foundIgdbId = null;
            let usedTitle = null;
            
            for (const title of titlesToTry) {
              // First, try to search the game on the server to get its IGDB ID
              // Use cache to avoid duplicate server calls
              foundIgdbId = titleToIgdbIdCache.get(title);
              if (!foundIgdbId) {
                try {
                  // Extract year from releaseDate if available
                  let releaseYear = null;
                  if (gameData.releaseYear) {
                    releaseYear = gameData.releaseYear;
                  } else if (releaseDate) {
                    try {
                      const releaseDateTimestamp = parseInt(releaseDate, 10);
                      if (!isNaN(releaseDateTimestamp)) {
                        const releaseDateObj = new Date(releaseDateTimestamp * 1000);
                        releaseYear = releaseDateObj.getFullYear();
                      }
                    } catch (e) {
                      // Ignore parsing errors
                    }
                  }
                  
                  const igdbGames = await searchGameOnServer(title, serverUrl, apiToken, twitchClientId, twitchClientSecret, releaseYear);
                  if (igdbGames && igdbGames.length > 0) {
                    // Use first game from search results
                    foundIgdbId = igdbGames[0].id;
                    titleToIgdbIdCache.set(title, foundIgdbId);
                    usedTitle = title;
                  }
                } catch (error) {
                  // If search fails, continue with next title
                  continue;
                }
              } else {
                usedTitle = title;
                break; // Found in cache, use it
              }
              
              if (foundIgdbId) {
                break; // Found IGDB ID, stop trying other titles
              }
            }
            
            // Try to find game ID by reading from filesystem
            const gamesDir = path.join(metadataPath, 'content', 'games');
            if (fs.existsSync(gamesDir)) {
              let found = false;
              
              // First, try to find by IGDB ID if we have it
              // The IGDB ID is the folder name itself, not a field in metadata.json
              if (foundIgdbId) {
                const searchIgdbId = String(foundIgdbId); // Convert to string for folder name comparison
                const gameDirPath = path.join(gamesDir, searchIgdbId);
                if (fs.existsSync(gameDirPath) && fs.statSync(gameDirPath).isDirectory()) {
                  // Verify the folder contains metadata.json
                  const gameMetadataPath = path.join(gameDirPath, 'metadata.json');
                  if (fs.existsSync(gameMetadataPath)) {
                    const fsGameId = parseInt(searchIgdbId, 10);
                    if (!isNaN(fsGameId)) {
                      gameIds.push(fsGameId);
                      gameIdsWithDates.push({ gameId: fsGameId, releaseDate: releaseDate || null });
                      found = true;
                    }
                  }
                }
              }
              
              // If not found by IGDB ID, try by name (case-insensitive, trimmed) for each title
              if (!found) {
                const gameDirs = fs.readdirSync(gamesDir, { withFileTypes: true });
                for (const title of titlesToTry) {
                  const normalizedTitle = title.toLowerCase().trim();
                  for (const gameDir of gameDirs) {
                    if (gameDir.isDirectory()) {
                      const gameMetadataPath = path.join(gamesDir, gameDir.name, 'metadata.json');
                      if (fs.existsSync(gameMetadataPath)) {
                        try {
                          const gameMetadata = JSON.parse(fs.readFileSync(gameMetadataPath, 'utf-8'));
                          // Try matching by name first (new format)
                          if (gameMetadata.name && gameMetadata.name.toLowerCase().trim() === normalizedTitle) {
                            const fsGameId = parseInt(gameDir.name, 10);
                            if (!isNaN(fsGameId)) {
                              gameIds.push(fsGameId);
                              gameIdsWithDates.push({ gameId: fsGameId, releaseDate: releaseDate || null });
                              found = true;
                              break;
                            }
                          } else if (gameMetadata.title && gameMetadata.title.toLowerCase().trim() === normalizedTitle) {
                            // Fallback to title matching for older metadata format
                            const fsGameId = parseInt(gameDir.name, 10);
                            if (!isNaN(fsGameId)) {
                              gameIds.push(fsGameId);
                              gameIdsWithDates.push({ gameId: fsGameId, releaseDate: releaseDate || null });
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
                  if (found) break; // Found with this title, stop trying other titles
                }
              }
              
              if (!found) {
                missingGameCount++;
                missingGames.push({
                  title: gameTitle,
                  releaseKey: releaseKey,
                  igdbId: foundIgdbId || null
                });
              }
            } else {
              missingGameCount++;
              missingGames.push({
                title: gameTitle,
                releaseKey: releaseKey,
                igdbId: null
              });
            }
          } else {
            missingGameCount++;
            missingGames.push({
              title: 'Unknown',
              releaseKey: releaseKey,
              igdbId: null
            });
          }
        } else {
          // We have an IGDB ID, search filesystem by folder name (IGDB ID is the folder name)
          const gamesDir = path.join(metadataPath, 'content', 'games');
          if (fs.existsSync(gamesDir)) {
            let found = false;
            const searchIgdbId = String(igdbIdToSearch); // Convert to string for folder name comparison
            const gameDirPath = path.join(gamesDir, searchIgdbId);
            if (fs.existsSync(gameDirPath) && fs.statSync(gameDirPath).isDirectory()) {
              // Verify the folder contains metadata.json
              const gameMetadataPath = path.join(gameDirPath, 'metadata.json');
              if (fs.existsSync(gameMetadataPath)) {
                const fsGameId = parseInt(searchIgdbId, 10);
                if (!isNaN(fsGameId)) {
                  gameIds.push(fsGameId);
                  gameIdsWithDates.push({ gameId: fsGameId, releaseDate: releaseDate || null });
                  found = true;
                }
              }
            }
            if (!found) {
              missingGameCount++;
              missingGames.push({
                title: gameTitle,
                releaseKey: releaseKey,
                igdbId: igdbIdToSearch
              });
            }
          } else {
            missingGameCount++;
            missingGames.push({
              title: gameTitle,
              releaseKey: releaseKey,
              igdbId: igdbIdToSearch
            });
          }
        }
      }
    }
    
    if (missingGameCount > 0) {
      console.log(`    Note: ${missingGameCount} game(s) from this collection were not found (skipped)`);
      // Log details of missing games
      for (const missing of missingGames) {
        console.log(`      - Title: "${missing.title}", ReleaseKey: ${missing.releaseKey}, IGDB ID: ${missing.igdbId || 'not found'}`);
      }
    }
    
    // Remove duplicate game IDs before creating collection
    // Also deduplicate gameIdsWithDates keeping first occurrence (to match uniqueGameIds order)
    const seenGameIds = new Set();
    const uniqueGameIds = [];
    const uniqueGameIdsWithDates = [];
    
    for (let i = 0; i < gameIds.length; i++) {
      const gameId = gameIds[i];
      if (!seenGameIds.has(gameId)) {
        seenGameIds.add(gameId);
        uniqueGameIds.push(gameId);
        uniqueGameIdsWithDates.push(gameIdsWithDates[i]);
      }
    }
    
    if (uniqueGameIds.length !== gameIds.length) {
      const duplicateCount = gameIds.length - uniqueGameIds.length;
      console.log(`    Note: Removed ${duplicateCount} duplicate game ID(s) from collection`);
    }
    
    // Log games with IGDB ID and release date
    if (uniqueGameIdsWithDates.length > 0) {
      console.log(`    Games in collection (${uniqueGameIdsWithDates.length}):`);
      for (const { gameId, releaseDate } of uniqueGameIdsWithDates) {
        const releaseDateStr = releaseDate ? new Date(parseInt(releaseDate, 10) * 1000).toISOString().split('T')[0] : 'N/A';
        console.log(`      - IGDB ID: ${gameId}, Release Date: ${releaseDateStr} (timestamp: ${releaseDate || 'null'})`);
      }
    }
    
    // Create collection via API
    try {
      const response = await createCollectionViaAPI(tag, '', serverUrl, apiToken);
      const collectionId = response.collection?.id;
      
      if (collectionId && uniqueGameIds.length > 0) {
        // Update collection games via API (with deduplicated IDs)
        await updateCollectionGamesViaAPI(collectionId, uniqueGameIds, serverUrl, apiToken);
      }
      
      console.log(`  Created collection: ${tag} (ID: ${collectionId}, ${uniqueGameIds.length} games)`);
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
    upload = false,
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

  const { importMapPath, importMap, existed: importMapExists } = loadReleaseKeyMap(metadataPath);
  if (importMapExists) {
    console.log(`Loaded ${importMap.size} imported games from: ${importMapPath}`);
  } else {
    console.log(`No existing import map found. Will create: ${importMapPath}`);
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
      SELECT 
        gp.releaseKey,
        json_extract(gp.value, '$.title') as title,
        ptlp.executablePath,
        ptlp.label,
        MAX(json_extract(gp102.value, '$.myRating')) as myRating,
        MAX(json_extract(gp82.value, '$.releaseDate')) as releaseDate
      FROM GamePieces gp
      LEFT JOIN LibraryReleases lr ON gp.releaseKey = lr.releaseKey
      LEFT JOIN PlayTasks pt ON gp.releaseKey = pt.gameReleaseKey
      LEFT JOIN PlayTaskLaunchParameters ptlp ON pt.id = ptlp.playTaskId
      LEFT JOIN GamePieces gp102 ON gp.releaseKey = gp102.releaseKey AND gp102.gamePieceTypeId = 102
      LEFT JOIN GamePieces gp82 ON gp.releaseKey = gp82.releaseKey AND gp82.gamePieceTypeId = 82
      WHERE gp.value IS NOT NULL 
        AND gp.value != ''
        AND gp.releaseKey IS NOT NULL
        AND lr.releaseKey IS NOT NULL
        AND json_extract(gp.value, '$.title') IS NOT NULL
        AND json_extract(gp.value, '$.title') != ''
        ${search ? `AND json_extract(gp.value, '$.title') LIKE '%' || ? || '%'` : ''}
      GROUP BY gp.releaseKey, json_extract(gp.value, '$.title'), ptlp.executablePath, ptlp.label
      ORDER BY releaseDate
      ${limit ? `LIMIT ${limit}` : ''}
    `);
    
    const games = search ? gamesQuery.all(search) : gamesQuery.all();
    console.log(`Found ${games.length} game entries to import\n`);
    
    // Group games by releaseKey to handle multiple executables per game
    // Note: It's normal to have the same releaseKey multiple times in query results
    // when a game has multiple executables - the grouping handles this correctly
    // Also collect all unique titles for each releaseKey to try multiple search terms
    const gamesByReleaseKey = new Map();
    
    for (const game of games) {
      if (!game.releaseKey) continue;
      
      if (!gamesByReleaseKey.has(game.releaseKey)) {
        // Extract year from releaseDate if available
        let releaseYear = null;
        if (game.releaseDate) {
          try {
            const releaseDateTimestamp = parseInt(game.releaseDate, 10);
            if (!isNaN(releaseDateTimestamp)) {
              const releaseDate = new Date(releaseDateTimestamp * 1000);
              releaseYear = releaseDate.getFullYear();
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
        
        gamesByReleaseKey.set(game.releaseKey, {
          titles: new Set([game.title]), // Track all unique titles for this releaseKey
          title: game.title, // Keep first title for display/logging
          executables: [],
          executableSet: new Set(), // Track unique executables to avoid duplicates
          myRating: game.myRating || null,
          releaseYear: releaseYear,
          releaseDate: game.releaseDate || null // Store releaseDate for fallback
        });
      } else {
        const gameData = gamesByReleaseKey.get(game.releaseKey);
        // Add title to set of unique titles
        if (game.title) {
          gameData.titles.add(game.title);
        }
        // If myRating is not set yet and this row has it, update it
        if (!gameData.myRating && game.myRating) {
          gameData.myRating = game.myRating;
        }
        // Update releaseYear if not set and this row has it
        if (!gameData.releaseYear && game.releaseDate) {
          try {
            const releaseDateTimestamp = parseInt(game.releaseDate, 10);
            if (!isNaN(releaseDateTimestamp)) {
              const releaseDate = new Date(releaseDateTimestamp * 1000);
              gameData.releaseYear = releaseDate.getFullYear();
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
        // Update releaseDate if not set and this row has it
        if (!gameData.releaseDate && game.releaseDate) {
          gameData.releaseDate = game.releaseDate;
        }
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
    // Convert titles Set to Array for easier use
    for (const gameData of gamesByReleaseKey.values()) {
      delete gameData.executableSet;
      gameData.titles = Array.from(gameData.titles);
    }
    
    console.log(`Found ${gamesByReleaseKey.size} unique games (some may have multiple executables)\n`);
    
    // Map to track releaseKey -> gameId mapping (gameId is the IGDB ID used as folder name)
    const gameReleaseKeyMap = new Map();
    // Map to track releaseKey -> igdbId mapping (for collections lookup)
    const gameReleaseKeyToIgdbIdMap = new Map();
    let importMapDirty = false;
    
    // Preload persisted mappings so collections can resolve older imports
    const persistedReleaseKeyIdMap = buildReleaseKeyIdMap(importMap);
    for (const [releaseKey, igdbId] of persistedReleaseKeyIdMap) {
      gameReleaseKeyMap.set(releaseKey, igdbId);
      gameReleaseKeyToIgdbIdMap.set(releaseKey, igdbId);
    }
    
    // Process all games (gamesByReleaseKey already groups by releaseKey, so each releaseKey appears only once)
    const totalGames = gamesByReleaseKey.size;
    
    // Import each game (processing all executables together)
    console.log(`=== Importing Games (${totalGames} games) ===`);
    let successCount = 0;
    let skipCount = 0;
    let currentIndex = 0;
    
    for (const [releaseKey, gameData] of gamesByReleaseKey) {
      currentIndex++;
      
      console.log(`[${currentIndex}/${totalGames}] Processing game: ${gameData.title}`);
      console.log(`  Release date (GOG from DB): ${gameData.releaseDate !== null && gameData.releaseDate !== undefined ? gameData.releaseDate : 'null'}`);

      const existingEntry = importMap.get(releaseKey);
      const existingIgdbId = existingEntry?.igdbId || existingEntry;
      const shouldForceUpload = upload && !!existingIgdbId;
      if (existingIgdbId && !shouldForceUpload) {
        console.log(`  Skipping already imported releaseKey: ${releaseKey} (IGDB ID: ${existingIgdbId})`);
        skipCount++;
        continue;
      }

      if (shouldForceUpload) {
        console.log(`  UPLOAD=true -> reimporting releaseKey: ${releaseKey} (IGDB ID: ${existingIgdbId})`);
      }
      
      try {
        const result = await importGame(
          gameData.titles, // Pass all titles to try
          releaseKey,
          gameData.executables,
          metadataPath,
          galaxyImagesPath,
          serverUrl,
          apiToken,
          twitchClientId,
          twitchClientSecret,
          gameData.myRating,
          gameData.releaseYear,
          gameData.releaseDate || null, // Pass GOG Galaxy releaseDate as fallback
          shouldForceUpload
            ? { igdbId: existingIgdbId, skipSearch: true }
            : undefined
        );
        
        if (result && result.gameId) {
          successCount++;
          gameReleaseKeyMap.set(releaseKey, result.gameId);
          // Also store the IGDB ID mapping
          if (result.igdbId) {
            gameReleaseKeyToIgdbIdMap.set(releaseKey, result.igdbId);
            importMap.set(releaseKey, {
              igdbId: result.igdbId,
              title: result.title || null,
              releaseDate: result.releaseDate || null,
              stars: result.stars !== undefined ? result.stars : null
            });
            importMapDirty = true;
          }
        } else {
          skipCount++;
        }
      } catch (error) {
        console.error(`  [${currentIndex}/${totalGames}] Error importing ${gameData.title}:`, error.message);
        skipCount++;
      }
    }

    if (importMapDirty) {
      try {
        saveReleaseKeyMap(importMapPath, importMap);
        console.log(`Saved import map: ${importMapPath}`);
      } catch (error) {
        console.warn(`Warning: Failed to save import map: ${error.message}`);
      }
    }
    
      console.log(`\n=== Import Summary ===`);
      console.log(`Successfully imported: ${successCount}`);
      console.log(`Skipped: ${skipCount}`);
      
      // Import collections (unless games-only mode)
      if (!gamesOnly) {
        // Get games for each tag with release date from GamePieces type 82
        // Priority to rows with releaseDate (non-null values)
        const gamesByTagQuery = db.prepare(`
          SELECT 
            urt.tag, 
            urt.releaseKey,
            MAX(json_extract(gp82.value, '$.releaseDate')) as releaseDate
          FROM UserReleaseTags urt
          LEFT JOIN GamePieces gp82 ON urt.releaseKey = gp82.releaseKey AND gp82.gamePieceTypeId = 82
          WHERE urt.tag IS NOT NULL AND urt.tag != ''
            AND urt.releaseKey IS NOT NULL
          GROUP BY urt.tag, urt.releaseKey
          ORDER BY urt.tag, releaseDate
        `);
        const tagsData = gamesByTagQuery.all();
        
      // Import collections
      if ((gameReleaseKeyMap.size > 0 || gamesByReleaseKey.size > 0) && tagsData.length > 0) {
        await importCollections(metadataPath, gameReleaseKeyMap, gameReleaseKeyToIgdbIdMap, tagsData, gamesByReleaseKey, serverUrl, apiToken, twitchClientId, twitchClientSecret);
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
          ptlp.label,
          MAX(json_extract(gp82.value, '$.releaseDate')) as releaseDate
        FROM GamePieces gp
        LEFT JOIN LibraryReleases lr ON gp.releaseKey = lr.releaseKey
        LEFT JOIN PlayTasks pt ON gp.releaseKey = pt.gameReleaseKey
        LEFT JOIN PlayTaskLaunchParameters ptlp ON pt.id = ptlp.playTaskId
        LEFT JOIN GamePieces gp82 ON gp.releaseKey = gp82.releaseKey AND gp82.gamePieceTypeId = 82
        WHERE gp.value IS NOT NULL 
          AND gp.value != ''
          AND gp.releaseKey IS NOT NULL
          AND lr.releaseKey IS NOT NULL
          AND json_extract(gp.value, '$.title') IS NOT NULL
          AND json_extract(gp.value, '$.title') != ''
        GROUP BY gp.releaseKey, json_extract(gp.value, '$.title'), ptlp.executablePath, ptlp.label
        ORDER BY releaseDate
      `);
      
      const games = gamesQuery.all();
      
      // Group games by releaseKey to get titles (collect all unique titles)
      const gamesByReleaseKey = new Map();
      for (const game of games) {
        if (!game.releaseKey) continue;
        
        if (!gamesByReleaseKey.has(game.releaseKey)) {
          // Extract year from releaseDate if available
          let releaseYear = null;
          if (game.releaseDate) {
            try {
              const releaseDateTimestamp = parseInt(game.releaseDate, 10);
              if (!isNaN(releaseDateTimestamp)) {
                const releaseDate = new Date(releaseDateTimestamp * 1000);
                releaseYear = releaseDate.getFullYear();
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
          
          gamesByReleaseKey.set(game.releaseKey, {
            titles: new Set([game.title]), // Track all unique titles for this releaseKey
            title: game.title, // Keep first title for display/logging
            executables: [],
            executableSet: new Set(),
            releaseYear: releaseYear,
            releaseDate: game.releaseDate || null // Store releaseDate for fallback
          });
        } else {
          const gameData = gamesByReleaseKey.get(game.releaseKey);
          // Add title to set of unique titles
          if (game.title) {
            gameData.titles.add(game.title);
          }
          // Update releaseYear if not set and this row has it
          if (!gameData.releaseYear && game.releaseDate) {
            try {
              const releaseDateTimestamp = parseInt(game.releaseDate, 10);
              if (!isNaN(releaseDateTimestamp)) {
                const releaseDate = new Date(releaseDateTimestamp * 1000);
                gameData.releaseYear = releaseDate.getFullYear();
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
          // Update releaseDate if not set and this row has it
          if (!gameData.releaseDate && game.releaseDate) {
            gameData.releaseDate = game.releaseDate;
          }
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
      
      // Clean up executableSet and convert titles Set to Array
      for (const gameData of gamesByReleaseKey.values()) {
        delete gameData.executableSet;
        gameData.titles = Array.from(gameData.titles);
      }
      
      // Get games for each tag with release date from GamePieces type 82
      // Priority to rows with releaseDate (non-null values)
      const gamesByTagQuery = db.prepare(`
        SELECT 
          urt.tag, 
          urt.releaseKey,
          MAX(json_extract(gp82.value, '$.releaseDate')) as releaseDate
        FROM UserReleaseTags urt
        LEFT JOIN GamePieces gp82 ON urt.releaseKey = gp82.releaseKey AND gp82.gamePieceTypeId = 82
        WHERE urt.tag IS NOT NULL AND urt.tag != ''
          AND urt.releaseKey IS NOT NULL
        GROUP BY urt.tag, urt.releaseKey
        ORDER BY urt.tag, releaseDate
      `);
      const tagsData = gamesByTagQuery.all();
      
      // Import collections
      if (gamesByReleaseKey.size > 0 && tagsData.length > 0) {
        const persistedReleaseKeyIdMap = buildReleaseKeyIdMap(importMap);
        await importCollections(
          metadataPath,
          new Map(persistedReleaseKeyIdMap),
          new Map(persistedReleaseKeyIdMap),
          tagsData,
          gamesByReleaseKey,
          serverUrl,
          apiToken,
          twitchClientId,
          twitchClientSecret
        );
      }
    }
    
  } finally {
    db.close();
  }
  
  console.log('\n=== Import Complete ===');
}

export { importGame };
