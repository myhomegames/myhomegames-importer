// Common IGDB API utilities

import https from 'https';

let igdbAccessToken = null;
let igdbTokenExpiry = 0;

/**
 * Get IGDB access token
 */
export async function getIGDBAccessToken(twitchClientId, twitchClientSecret) {
  if (igdbAccessToken && Date.now() < igdbTokenExpiry) {
    return igdbAccessToken;
  }

  return new Promise((resolve, reject) => {
    const postData = `client_id=${twitchClientId}&client_secret=${twitchClientSecret}&grant_type=client_credentials`;

    const options = {
      hostname: 'id.twitch.tv',
      path: '/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            igdbAccessToken = json.access_token;
            igdbTokenExpiry = Date.now() + json.expires_in * 1000 - 60000; // Refresh 1 min before expiry
            resolve(igdbAccessToken);
          } else {
            reject(new Error('Failed to get IGDB access token'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Search game on IGDB by title
 */
export async function searchGameOnIGDB(title, twitchClientId, twitchClientSecret) {
  const accessToken = await getIGDBAccessToken(twitchClientId, twitchClientSecret);
  
  return new Promise((resolve, reject) => {
    const postData = `search "${title}"; fields id,name; limit 1;`;

    const options = {
      hostname: 'api.igdb.com',
      path: '/v4/games',
      method: 'POST',
      headers: {
        'Client-ID': twitchClientId,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const games = JSON.parse(data);
          if (games && games.length > 0) {
            resolve(games[0]);
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
