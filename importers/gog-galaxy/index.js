// GOG Galaxy Importer
// Reads data from GOG Galaxy SQLite database and imports games and collections

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { searchGameOnIGDB } from '../common/igdb.js';
import { ensureDirectoryExists, copyFile, writeJsonFile } from '../common/files.js';

/**
 * Import a single game
 */
async function importGame(gameTitle, releaseKey, executablePath, metadataPath, galaxyImagesPath, twitchClientId, twitchClientSecret) {
  console.log(`\nProcessing game: ${gameTitle}`);
  
  // Search game on IGDB
  console.log(`  Searching on IGDB...`);
  const igdbGame = await searchGameOnIGDB(gameTitle, twitchClientId, twitchClientSecret);
  
  if (!igdbGame) {
    console.warn(`  Warning: Game not found on IGDB, skipping: ${gameTitle}`);
    return null;
  }
  
  const gameId = igdbGame.id;
  console.log(`  Found on IGDB: ${igdbGame.name} (ID: ${gameId})`);
  
  // Create game directory
  const gameDir = path.join(metadataPath, 'content', 'games', String(gameId));
  ensureDirectoryExists(gameDir);
  
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
  writeJsonFile(gameMetadataPath, gameMetadata);
  console.log(`  Created metadata.json`);
  
  // Copy executable script if available
  if (executablePath) {
    // Determine script extension based on original file
    const ext = path.extname(executablePath).toLowerCase();
    const scriptName = ext === '.bat' ? 'script.bat' : 'script.sh';
    const scriptPath = path.join(gameDir, scriptName);
    
    if (copyFile(executablePath, scriptPath)) {
      // Make script executable (Unix-like systems, only for .sh)
      if (scriptName === 'script.sh') {
        try {
          fs.chmodSync(scriptPath, 0o755);
        } catch (e) {
          // Ignore chmod errors on Windows
        }
      }
      console.log(`  Copied script: ${scriptName}`);
    }
  }
  
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
  
  if (!twitchClientId || !twitchClientSecret) {
    throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are required');
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
      SELECT 
        gp.releaseKey,
        json_extract(gp.value, '$.title') as title,
        ptlp.executablePath
      FROM GamePieces gp
      LEFT JOIN PlayTasks pt ON gp.releaseKey = pt.gameReleaseKey
      LEFT JOIN PlayTaskLaunchParameters ptlp ON pt.id = ptlp.playTaskId
      WHERE gp.value IS NOT NULL 
        AND gp.value != ''
        AND gp.releaseKey IS NOT NULL
        AND json_extract(gp.value, '$.title') IS NOT NULL
        AND json_extract(gp.value, '$.title') != ''
      GROUP BY gp.releaseKey, ptlp.executablePath
      ORDER BY title
      ${limit ? `LIMIT ${limit}` : ''}
    `);
    
    const games = gamesQuery.all();
    console.log(`Found ${games.length} games to import\n`);
    
    // Map to track releaseKey -> gameId mapping
    const gameReleaseKeyMap = new Map();
    
    // Import each game
    console.log('=== Importing Games ===');
    let successCount = 0;
    let skipCount = 0;
    
    for (const game of games) {
      try {
        const gameId = await importGame(
          game.title,
          game.releaseKey,
          game.executablePath,
          metadataPath,
          galaxyImagesPath,
          twitchClientId,
          twitchClientSecret
        );
        
        if (gameId) {
          successCount++;
          if (game.releaseKey) {
            gameReleaseKeyMap.set(game.releaseKey, gameId);
          }
        } else {
          skipCount++;
        }
        
        // Small delay to avoid rate limiting on IGDB
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`  Error importing ${game.title}:`, error.message);
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
