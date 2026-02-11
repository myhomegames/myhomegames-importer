// Common MyHomeGames Server API utilities

import https from 'https';
import http from 'http';
import { URL } from 'url';
import FormData from 'form-data';
import fs from 'fs';

/**
 * Get full game details from MyHomeGames server
 * @param {number} gameId - IGDB game ID
 * @param {string} serverUrl - MyHomeGames server URL (e.g., http://localhost:3000)
 * @param {string} apiToken - API token for authentication
 * @param {string} twitchClientId - Twitch Client ID (for IGDB)
 * @param {string} twitchClientSecret - Twitch Client Secret (for IGDB)
 * @returns {Promise<Object|null>} - Full game object or null if not found
 */
export async function getGameDetailsFromServer(gameId, serverUrl, apiToken, twitchClientId, twitchClientSecret) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(`${serverUrl}/igdb/game/${gameId}`);
      url.searchParams.set('clientId', twitchClientId);
      url.searchParams.set('clientSecret', twitchClientSecret);

      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'X-Auth-Token': apiToken,
          'Content-Type': 'application/json',
        },
      };
      
      // Accept self-signed certificates for HTTPS (for development)
      if (isHttps) {
        options.rejectUnauthorized = false;
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              const error = JSON.parse(data);
              reject(new Error(`Server error: ${error.error || res.statusMessage}`));
              return;
            }

            const gameData = JSON.parse(data);
            resolve(gameData);
          } catch (e) {
            reject(new Error(`Failed to parse server response: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.end();
    } catch (e) {
      reject(new Error(`Invalid server URL: ${e.message}`));
    }
  });
}

/**
 * Get existing game IDs from server (for filtering IGDB search results)
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token for authentication
 * @returns {Promise<Set<number>>} - Set of existing IGDB game IDs
 */
export async function getExistingGameIds(serverUrl, apiToken) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(`${serverUrl}/games/ids`);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'X-Auth-Token': apiToken,
          'Content-Type': 'application/json',
        },
      };
      if (isHttps) {
        options.rejectUnauthorized = false;
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              const err = JSON.parse(data || '{}');
              reject(new Error(err.error || `HTTP ${res.statusCode}`));
              return;
            }
            const json = JSON.parse(data);
            const ids = Array.isArray(json.ids) ? json.ids : [];
            resolve(new Set(ids.map((id) => Number(id)).filter((n) => !Number.isNaN(n))));
          } catch (e) {
            reject(new Error(`Failed to parse server response: ${e.message}`));
          }
        });
      });
      req.on('error', (err) => reject(new Error(`Request failed: ${err.message}`)));
      req.end();
    } catch (e) {
      reject(new Error(`Invalid server URL: ${e.message}`));
    }
  });
}

/**
 * Search game on MyHomeGames server (which searches IGDB)
 * Uses full release date when provided so the server can return the closest match first.
 * @param {string} title - Game title to search
 * @param {string} serverUrl - MyHomeGames server URL (e.g., http://localhost:3000)
 * @param {string} apiToken - API token for authentication
 * @param {string} twitchClientId - Twitch Client ID (for IGDB)
 * @param {string} twitchClientSecret - Twitch Client Secret (for IGDB)
 * @param {number|string|null} releaseDate - Optional full release date: Unix timestamp (seconds) or "YYYY-MM-DD", used to sort by closest match
 * @returns {Promise<Array<Object>>} - Array of game objects with id and name (and releaseDateFull when from server), sorted by closest date first if releaseDate was passed
 */
export async function searchGameOnServer(title, serverUrl, apiToken, twitchClientId, twitchClientSecret, releaseDate = null) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(`${serverUrl}/igdb/search`);
      url.searchParams.set('q', title);
      url.searchParams.set('clientId', twitchClientId);
      url.searchParams.set('clientSecret', twitchClientSecret);
      if (releaseDate !== null && releaseDate !== undefined && releaseDate !== '') {
        const ts = typeof releaseDate === 'number' ? releaseDate : parseInt(String(releaseDate), 10);
        if (!Number.isNaN(ts)) {
          url.searchParams.set('releaseDate', String(ts < 10000000000 ? ts : Math.floor(ts / 1000)));
        } else if (typeof releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate.trim())) {
          url.searchParams.set('releaseDate', releaseDate.trim());
        }
      }

      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'X-Auth-Token': apiToken,
          'Content-Type': 'application/json',
        },
      };
      
      // Accept self-signed certificates for HTTPS (for development)
      if (isHttps) {
        options.rejectUnauthorized = false;
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              const error = JSON.parse(data);
              reject(new Error(`Server error: ${error.error || res.statusMessage}`));
              return;
            }

            const response = JSON.parse(data);
            if (response.games && response.games.length > 0) {
              // Return all games in format expected by importer (id and name)
              resolve(response.games.map(game => ({
                id: game.id,
                name: game.name,
              })));
            } else {
              resolve([]);
            }
          } catch (e) {
            reject(new Error(`Failed to parse server response: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      req.end();
    } catch (e) {
      reject(new Error(`Invalid server URL: ${e.message}`));
    }
  });
}

/**
 * Make HTTP request (JSON body)
 * @param {string} method - HTTP method (GET, POST, PUT, etc.)
 * @param {string} urlString - Full URL
 * @param {string} apiToken - API token for authentication
 * @param {Object} body - JSON body (optional)
 * @returns {Promise<Object>} - Response body as JSON
 */
function makeHttpRequest(method, urlString, apiToken, body = null) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'X-Auth-Token': apiToken,
          'Content-Type': 'application/json',
        },
      };
      
      // Accept self-signed certificates for HTTPS (for development)
      if (isHttps) {
        options.rejectUnauthorized = false;
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const error = data ? JSON.parse(data) : { error: res.statusMessage };
              reject(new Error(`Server error (${res.statusCode}): ${error.error || res.statusMessage}`));
              return;
            }

            const responseData = data ? JSON.parse(data) : {};
            resolve(responseData);
          } catch (e) {
            reject(new Error(`Failed to parse server response: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    } catch (e) {
      reject(new Error(`Invalid server URL: ${e.message}`));
    }
  });
}

/**
 * Make HTTP request with multipart/form-data (for file uploads)
 * @param {string} method - HTTP method (POST, PUT, etc.)
 * @param {string} urlString - Full URL
 * @param {string} apiToken - API token for authentication
 * @param {Object} formDataFields - Object with form fields (e.g., { file: fs.createReadStream(...), label: '...' })
 * @returns {Promise<Object>} - Response body as JSON
 */
function makeMultipartRequest(method, urlString, apiToken, formDataFields) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const form = new FormData();
      for (const [key, value] of Object.entries(formDataFields)) {
        form.append(key, value);
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'X-Auth-Token': apiToken,
          ...form.getHeaders(),
        },
      };
      
      // Accept self-signed certificates for HTTPS (for development)
      if (isHttps) {
        options.rejectUnauthorized = false;
      }

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const error = data ? JSON.parse(data) : { error: res.statusMessage };
              reject(new Error(`Server error (${res.statusCode}): ${error.error || res.statusMessage}`));
              return;
            }

            const responseData = data ? JSON.parse(data) : {};
            resolve(responseData);
          } catch (e) {
            reject(new Error(`Failed to parse server response: ${e.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Request failed: ${err.message}`));
      });

      form.pipe(req);
    } catch (e) {
      reject(new Error(`Invalid server URL: ${e.message}`));
    }
  });
}

/**
 * Create game via API
 * @param {Object} gameData - Game data for POST /games/add-from-igdb
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Object>} - Created game data
 */
export async function createGameViaAPI(gameData, serverUrl, apiToken) {
  const url = `${serverUrl}/games/add-from-igdb`;
  return makeHttpRequest('POST', url, apiToken, gameData);
}

/**
 * Upload executable file via API
 * @param {number} gameId - Game ID
 * @param {string} filePath - Path to executable file
 * @param {string} label - Executable label (optional)
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Object>} - Response data
 */
export async function uploadExecutableViaAPI(gameId, filePath, label, serverUrl, apiToken) {
  const url = `${serverUrl}/games/${gameId}/upload-executable`;
  const formDataFields = {
    file: fs.createReadStream(filePath),
  };
  if (label) {
    formDataFields.label = label;
  }
  return makeMultipartRequest('POST', url, apiToken, formDataFields);
}

/**
 * Upload cover image via API
 * @param {number} gameId - Game ID
 * @param {string} filePath - Path to cover image file
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Object>} - Response data
 */
export async function uploadCoverViaAPI(gameId, filePath, serverUrl, apiToken) {
  const url = `${serverUrl}/games/${gameId}/upload-cover`;
  const formDataFields = {
    file: fs.createReadStream(filePath),
  };
  return makeMultipartRequest('POST', url, apiToken, formDataFields);
}

/**
 * Upload background image via API
 * @param {number} gameId - Game ID
 * @param {string} filePath - Path to background image file
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Object>} - Response data
 */
export async function uploadBackgroundViaAPI(gameId, filePath, serverUrl, apiToken) {
  const url = `${serverUrl}/games/${gameId}/upload-background`;
  const formDataFields = {
    file: fs.createReadStream(filePath),
  };
  return makeMultipartRequest('POST', url, apiToken, formDataFields);
}

/**
 * Create collection via API
 * @param {string} title - Collection title
 * @param {string} summary - Collection summary (optional)
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Object>} - Created collection data with ID
 */
export async function createCollectionViaAPI(title, summary, serverUrl, apiToken) {
  const url = `${serverUrl}/collections`;
  return makeHttpRequest('POST', url, apiToken, { title, summary: summary || '' });
}

/**
 * Update collection games via API
 * @param {number} collectionId - Collection ID
 * @param {Array<number>} gameIds - Array of game IDs
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Object>} - Response data
 */
export async function updateCollectionGamesViaAPI(collectionId, gameIds, serverUrl, apiToken) {
  const url = `${serverUrl}/collections/${collectionId}/games/order`;
  return makeHttpRequest('PUT', url, apiToken, { gameIds });
}

/**
 * Get all collections via API
 * @param {string} serverUrl - MyHomeGames server URL
 * @param {string} apiToken - API token
 * @returns {Promise<Array<Object>>} - Array of collections
 */
export async function getCollectionsViaAPI(serverUrl, apiToken) {
  const url = `${serverUrl}/collections`;
  const response = await makeHttpRequest('GET', url, apiToken);
  return response.collections || [];
}
