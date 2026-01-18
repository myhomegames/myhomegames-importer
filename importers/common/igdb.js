// Common MyHomeGames Server API utilities

import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Search game on MyHomeGames server (which searches IGDB)
 * @param {string} title - Game title to search
 * @param {string} serverUrl - MyHomeGames server URL (e.g., http://localhost:3000)
 * @param {string} apiToken - API token for authentication
 * @param {string} twitchClientId - Twitch Client ID (for IGDB)
 * @param {string} twitchClientSecret - Twitch Client Secret (for IGDB)
 * @returns {Promise<Object|null>} - Game object with id and name, or null if not found
 */
export async function searchGameOnServer(title, serverUrl, apiToken, twitchClientId, twitchClientSecret) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(`${serverUrl}/igdb/search`);
      url.searchParams.set('q', title);
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
              // Return first game in format expected by importer (id and name)
              resolve({
                id: response.games[0].id,
                name: response.games[0].name,
              });
            } else {
              resolve(null);
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
