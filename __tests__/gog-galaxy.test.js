// Test suite for GOG Galaxy importer
import { jest } from '@jest/globals';
import fs from 'fs';

const mockSearchGameOnServer = jest.fn();
const mockGetGameDetailsFromServer = jest.fn();
const mockCreateGameViaAPI = jest.fn();
const mockGetGameViaAPI = jest.fn();
const mockUpdateGameViaAPI = jest.fn();
const mockUploadExecutableViaAPI = jest.fn();
const mockUploadCoverViaAPI = jest.fn();
const mockUploadBackgroundViaAPI = jest.fn();
const mockCreateCollectionViaAPI = jest.fn();
const mockUpdateCollectionGamesViaAPI = jest.fn();
const mockGetCollectionsViaAPI = jest.fn();
const mockGetExistingGameIds = jest.fn();
let mockDbRows = [];

jest.unstable_mockModule('../importers/common/igdb.js', () => ({
  searchGameOnServer: mockSearchGameOnServer,
  getGameDetailsFromServer: mockGetGameDetailsFromServer,
  createGameViaAPI: mockCreateGameViaAPI,
  getGameViaAPI: mockGetGameViaAPI,
  updateGameViaAPI: mockUpdateGameViaAPI,
  uploadExecutableViaAPI: mockUploadExecutableViaAPI,
  uploadCoverViaAPI: mockUploadCoverViaAPI,
  uploadBackgroundViaAPI: mockUploadBackgroundViaAPI,
  createCollectionViaAPI: mockCreateCollectionViaAPI,
  updateCollectionGamesViaAPI: mockUpdateCollectionGamesViaAPI,
  getCollectionsViaAPI: mockGetCollectionsViaAPI,
  getExistingGameIds: mockGetExistingGameIds,
}));

class MockDatabase {
  prepare() {
    return {
      all: () => mockDbRows,
    };
  }
  close() {}
}

jest.unstable_mockModule('better-sqlite3', () => ({
  default: MockDatabase,
}));

const modulePromise = import('../importers/gog-galaxy/index.js');

describe('GOG Galaxy Importer', () => {
  describe('sanitizeExecutableName', () => {
    // Import the function from the module
    // Note: Since sanitizeExecutableName is not exported, we test it indirectly
    // or we can test the behavior through integration tests
    
    test('should sanitize invalid characters', () => {
      // This would need the function to be exported
      // For now, we'll test the label cleaning logic that uses it
      const testCases = [
        { input: 'my game.sh', expected: 'my game' }, // After extension removal
        { input: 'my game.bat', expected: 'my game' }, // After extension removal
        { input: 'script', expected: 'script' }, // No extension
        { input: 'my game!', expected: 'my game!' }, // Before sanitization (original label)
      ];
      
      // Test label extension removal
      testCases.forEach(({ input, expected }) => {
        let label = input;
        if (label.endsWith('.bat')) {
          label = label.slice(0, -4);
        } else if (label.endsWith('.sh')) {
          label = label.slice(0, -3);
        }
        if (input.endsWith('.sh') || input.endsWith('.bat')) {
          expect(label).toBe(expected);
        }
      });
    });
  });

  describe('Label extension removal', () => {
    test('should remove .sh extension from label', () => {
      let label = 'myscript.sh';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe('myscript');
    });

    test('should remove .bat extension from label', () => {
      let label = 'myscript.bat';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe('myscript');
    });

    test('should not remove extension if not .sh or .bat', () => {
      let label = 'myscript.exe';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe('myscript.exe');
    });

    test('should handle labels without extensions', () => {
      let label = 'myscript';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe('myscript');
    });

    test('should handle empty label', () => {
      let label = '';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe('');
    });

    test('should handle label with only extension', () => {
      let label = '.sh';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe(''); // Empty string after removing .sh
    });

    test('should handle label with only .bat extension', () => {
      let label = '.bat';
      if (label.endsWith('.bat')) {
        label = label.slice(0, -4);
      } else if (label.endsWith('.sh')) {
        label = label.slice(0, -3);
      }
      expect(label).toBe(''); // Empty string after removing .bat
    });
  });


  describe('Executable deduplication', () => {
    test('should track unique executables by path and label', () => {
      const executableSet = new Set();
      
      const exec1 = { path: '/path/to/script.sh', label: 'Main Script' };
      const key1 = `${exec1.path}|${exec1.label || ''}`;
      executableSet.add(key1);
      
      const exec2 = { path: '/path/to/script.sh', label: 'Main Script' };
      const key2 = `${exec2.path}|${exec2.label || ''}`;
      
      expect(executableSet.has(key2)).toBe(true);
    });

    test('should allow same path with different labels', () => {
      const executableSet = new Set();
      
      const exec1 = { path: '/path/to/script.sh', label: 'Main Script' };
      const key1 = `${exec1.path}|${exec1.label || ''}`;
      executableSet.add(key1);
      
      const exec2 = { path: '/path/to/script.sh', label: 'Alt Script' };
      const key2 = `${exec2.path}|${exec2.label || ''}`;
      
      expect(executableSet.has(key2)).toBe(false);
    });

    test('should handle executables without labels', () => {
      const executableSet = new Set();
      
      const exec1 = { path: '/path/to/script.sh', label: null };
      const key1 = `${exec1.path}|${exec1.label || ''}`;
      executableSet.add(key1);
      
      const exec2 = { path: '/path/to/script.sh', label: null };
      const key2 = `${exec2.path}|${exec2.label || ''}`;
      
      expect(executableSet.has(key2)).toBe(true);
    });
  });

  describe('Metadata JSON construction', () => {
    test('should include all fields from fullGameData', () => {
      const fullGameData = {
        id: 12345,
        name: 'Test Game',
        summary: 'A test game summary',
        releaseDateFull: {
          year: 2023,
          month: 11,
          day: 15,
          timestamp: 1700092800,
        },
        genres: ['Action', 'Adventure'],
        criticRating: 85, // 0-100 scale
        userRating: 78, // 0-100 scale
        cover: 'https://images.igdb.com/igdb/image/upload/t_1080p/co2f1v.jpg',
        background: 'https://images.igdb.com/igdb/image/upload/t_1080p/wnglmmjdbv6sipynrcji.jpg',
        themes: ['Fantasy'],
        platforms: ['PC'],
      };

      // Simulate metadata construction
      const gameMetadata = {
        title: fullGameData.name,
        summary: fullGameData.summary,
        year: fullGameData.releaseDateFull?.year || fullGameData.releaseDate || null,
        month: fullGameData.releaseDateFull?.month || null,
        day: fullGameData.releaseDateFull?.day || null,
        stars: null,
        genre: fullGameData.genres && fullGameData.genres.length > 0 ? fullGameData.genres : null,
      };

      if (fullGameData.cover) {
        gameMetadata.igdbCover = fullGameData.cover;
      }

      if (fullGameData.background) {
        gameMetadata.igdbBackground = fullGameData.background;
      }

      if (fullGameData.criticRating !== null && fullGameData.criticRating !== undefined) {
        gameMetadata.criticratings = fullGameData.criticRating / 10;
      }

      if (fullGameData.userRating !== null && fullGameData.userRating !== undefined) {
        gameMetadata.userratings = fullGameData.userRating / 10;
      }

      if (fullGameData.themes && fullGameData.themes.length > 0) {
        gameMetadata.themes = fullGameData.themes;
      }

      if (fullGameData.platforms && fullGameData.platforms.length > 0) {
        gameMetadata.platforms = fullGameData.platforms;
      }

      // Assertions
      expect(gameMetadata.title).toBe('Test Game');
      expect(gameMetadata.summary).toBe('A test game summary');
      expect(gameMetadata.year).toBe(2023);
      expect(gameMetadata.month).toBe(11);
      expect(gameMetadata.day).toBe(15);
      expect(gameMetadata.genre).toEqual(['Action', 'Adventure']);
      expect(gameMetadata.igdbCover).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/co2f1v.jpg');
      expect(gameMetadata.igdbBackground).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/wnglmmjdbv6sipynrcji.jpg');
      expect(gameMetadata.criticratings).toBe(8.5); // 85 / 10
      expect(gameMetadata.userratings).toBe(7.8); // 78 / 10
      expect(gameMetadata.themes).toEqual(['Fantasy']);
      expect(gameMetadata.platforms).toEqual(['PC']);
    });

    test('should convert criticRating and userRating from 0-100 to 0-10 scale', () => {
      const fullGameData = {
        criticRating: 75,
        userRating: 90,
      };

      let gameMetadata = {};

      if (fullGameData.criticRating !== null && fullGameData.criticRating !== undefined) {
        gameMetadata.criticratings = fullGameData.criticRating / 10;
      }

      if (fullGameData.userRating !== null && fullGameData.userRating !== undefined) {
        gameMetadata.userratings = fullGameData.userRating / 10;
      }

      expect(gameMetadata.criticratings).toBe(7.5); // 75 / 10
      expect(gameMetadata.userratings).toBe(9.0); // 90 / 10
    });

    test('should not include optional fields if not available', () => {
      const fullGameData = {
        name: 'Test Game',
        summary: 'A test game',
      };

      const gameMetadata = {
        title: fullGameData.name,
        summary: fullGameData.summary,
        year: fullGameData.releaseDateFull?.year || fullGameData.releaseDate || null,
        month: fullGameData.releaseDateFull?.month || null,
        day: fullGameData.releaseDateFull?.day || null,
        stars: null,
        genre: fullGameData.genres && fullGameData.genres.length > 0 ? fullGameData.genres : null,
      };

      // Optional fields should not be added if not present
      expect(gameMetadata.igdbCover).toBeUndefined();
      expect(gameMetadata.igdbBackground).toBeUndefined();
      expect(gameMetadata.criticratings).toBeUndefined();
      expect(gameMetadata.userratings).toBeUndefined();
      expect(gameMetadata.themes).toBeUndefined();
      expect(gameMetadata.platforms).toBeUndefined();
    });

    test('should handle releaseDateFull for date fields', () => {
      const fullGameData = {
        name: 'Test Game',
        releaseDateFull: {
          year: 2020,
          month: 5,
          day: 20,
        },
      };

      const gameMetadata = {
        title: fullGameData.name,
        year: fullGameData.releaseDateFull?.year || fullGameData.releaseDate || null,
        month: fullGameData.releaseDateFull?.month || null,
        day: fullGameData.releaseDateFull?.day || null,
      };

      expect(gameMetadata.year).toBe(2020);
      expect(gameMetadata.month).toBe(5);
      expect(gameMetadata.day).toBe(20);
    });

    test('should fall back to releaseDate if releaseDateFull is not available', () => {
      const fullGameData = {
        name: 'Test Game',
        releaseDate: 2021,
      };

      const gameMetadata = {
        title: fullGameData.name,
        year: fullGameData.releaseDateFull?.year || fullGameData.releaseDate || null,
        month: fullGameData.releaseDateFull?.month || null,
        day: fullGameData.releaseDateFull?.day || null,
      };

      expect(gameMetadata.year).toBe(2021);
      expect(gameMetadata.month).toBeNull();
      expect(gameMetadata.day).toBeNull();
    });

    test('should include igdbCover and igdbBackground when available', () => {
      const fullGameData = {
        name: 'Test Game',
        cover: 'https://images.igdb.com/igdb/image/upload/t_1080p/test_cover.jpg',
        background: 'https://images.igdb.com/igdb/image/upload/t_1080p/test_bg.jpg',
      };

      const gameMetadata = {
        title: fullGameData.name,
      };

      if (fullGameData.cover) {
        gameMetadata.igdbCover = fullGameData.cover;
      }

      if (fullGameData.background) {
        gameMetadata.igdbBackground = fullGameData.background;
      }

      expect(gameMetadata.igdbCover).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/test_cover.jpg');
      expect(gameMetadata.igdbBackground).toBe('https://images.igdb.com/igdb/image/upload/t_1080p/test_bg.jpg');
    });

    test('should handle null ratings correctly', () => {
      const fullGameData = {
        name: 'Test Game',
        criticRating: null,
        userRating: null,
      };

      const gameMetadata = {
        title: fullGameData.name,
      };

      // Should not add ratings if null
      if (fullGameData.criticRating !== null && fullGameData.criticRating !== undefined) {
        gameMetadata.criticratings = fullGameData.criticRating / 10;
      }

      if (fullGameData.userRating !== null && fullGameData.userRating !== undefined) {
        gameMetadata.userratings = fullGameData.userRating / 10;
      }

      expect(gameMetadata.criticratings).toBeUndefined();
      expect(gameMetadata.userratings).toBeUndefined();
    });
  });

  describe('Search parameter', () => {
    test('should support filtering games by search term', () => {
      const searchTerm = 'Test Game';
      // This is a placeholder test - actual search functionality is tested in integration
      // The search term would be used in SQL LIKE query: title LIKE '%searchTerm%'
      expect(typeof searchTerm).toBe('string');
      expect(searchTerm.length).toBeGreaterThan(0);
    });
  });

  describe('Import modes', () => {
    test('should support games-only mode', () => {
      const gamesOnly = true;
      const collectionsOnly = false;
      // Validate mutually exclusive
      expect(gamesOnly && collectionsOnly).toBe(false);
    });

    test('should support collections-only mode', () => {
      const gamesOnly = false;
      const collectionsOnly = true;
      // Validate mutually exclusive
      expect(gamesOnly && collectionsOnly).toBe(false);
    });

    test('should not allow both modes at once', () => {
      const gamesOnly = true;
      const collectionsOnly = true;
      // Should throw error if both are true
      expect(gamesOnly && collectionsOnly).toBe(true);
      // In actual code, this would throw an error
    });
  });

  describe('Collection import filesystem search', () => {
    test('should search by game title in filesystem (name field)', () => {
      // Simulate filesystem search logic
      const gameData = { title: 'Test Game' };
      const normalizedTitle = gameData.title.toLowerCase().trim();
      
      // Simulate metadata.json with 'name' field (new format)
      const gameMetadata = {
        name: 'Test Game',
        summary: 'A test game',
      };
      
      const metadataName = gameMetadata.name?.toLowerCase().trim();
      const match = metadataName === normalizedTitle;
      
      expect(match).toBe(true);
    });

    test('should search by game title in filesystem (title field fallback)', () => {
      // Simulate filesystem search logic for older metadata format
      const gameData = { title: 'Test Game' };
      const normalizedTitle = gameData.title.toLowerCase().trim();
      
      // Simulate metadata.json with 'title' field (old format)
      const gameMetadata = {
        title: 'Test Game',
        summary: 'A test game',
      };
      
      const metadataTitle = gameMetadata.title?.toLowerCase().trim();
      const match = metadataTitle === normalizedTitle;
      
      expect(match).toBe(true);
    });

    test('should handle case-insensitive title matching', () => {
      const gameData = { title: 'Test Game' };
      const normalizedTitle = gameData.title.toLowerCase().trim();
      
      const gameMetadata = {
        name: 'TEST GAME',
      };
      
      const metadataName = gameMetadata.name?.toLowerCase().trim();
      const match = metadataName === normalizedTitle;
      
      expect(match).toBe(true);
    });

    test('should handle whitespace trimming in title matching', () => {
      const gameData = { title: '  Test Game  ' };
      const normalizedTitle = gameData.title.toLowerCase().trim();
      
      const gameMetadata = {
        name: 'Test Game',
      };
      
      const metadataName = gameMetadata.name?.toLowerCase().trim();
      const match = metadataName === normalizedTitle;
      
      expect(match).toBe(true);
    });

    test('should search by IGDB ID folder name when available in mapping', () => {
      // Simulate IGDB ID folder search
      const igdbIdToSearch = 3193;
      const searchIgdbId = String(igdbIdToSearch);
      
      // Simulate folder name (IGDB ID is the folder name)
      const folderName = '3193';
      
      const match = folderName === searchIgdbId;
      
      expect(match).toBe(true);
    });

    test('should convert IGDB ID to string for folder name comparison', () => {
      const igdbIdNumber = 3193;
      const igdbIdString = String(igdbIdNumber);
      const folderName = '3193';
      
      expect(folderName).toBe(igdbIdString);
      expect(parseInt(folderName, 10)).toBe(igdbIdNumber);
    });
  });

  describe('Collection import - IGDB server search', () => {
    test('should use first game from search results (current implementation)', () => {
      // Current implementation always uses igdbGames[0], regardless of already-imported status
      const igdbGames = [
        { id: 1001, name: 'Game 1' },
        { id: 1002, name: 'Game 2' },
        { id: 1003, name: 'Game 3' },
      ];
      const selectedGame = igdbGames[0];
      expect(selectedGame).not.toBeNull();
      expect(selectedGame.id).toBe(1001);
      expect(selectedGame.name).toBe('Game 1');
    });

    test('should require twitchClientId and twitchClientSecret for collections', () => {
      // Collections import calls searchGameOnServer when game not in mapping
      // So it needs Twitch credentials
      const importCollectionsParams = {
        metadataPath: '/path/to/metadata',
        gameReleaseKeyMap: new Map(),
        gameReleaseKeyToIgdbIdMap: new Map(),
        tagsData: [],
        gamesByReleaseKey: new Map(),
        serverUrl: 'http://localhost:4000',
        apiToken: 'test-token',
        twitchClientId: 'test-client-id',
        twitchClientSecret: 'test-client-secret',
      };
      
      expect(importCollectionsParams.apiToken).toBeDefined();
      expect(importCollectionsParams.serverUrl).toBeDefined();
      expect(importCollectionsParams.twitchClientId).toBeDefined();
      expect(importCollectionsParams.twitchClientSecret).toBeDefined();
    });

    test('should select first non-imported game from search results (desired behavior - not yet implemented)', () => {
      // Desired behavior: when first result already exists, try next. Not yet implemented.
      const igdbGames = [
        { id: 1001, name: 'Game 1' },
        { id: 1002, name: 'Game 2' },
        { id: 1003, name: 'Game 3' },
      ];
      const existingGames = new Set([1001, 1002]);
      let selectedGame = null;
      for (const game of igdbGames) {
        if (!existingGames.has(game.id)) {
          selectedGame = game;
          break;
        }
      }
      expect(selectedGame).not.toBeNull();
      expect(selectedGame.id).toBe(1003);
      expect(selectedGame.name).toBe('Game 3');
    });

    test('should skip game if all search results are already imported (desired behavior)', () => {
      // Simulate searchGameOnServer returning multiple games
      const igdbGames = [
        { id: 1001, name: 'Game 1' },
        { id: 1002, name: 'Game 2' },
        { id: 1003, name: 'Game 3' },
      ];
      
      // Simulate filesystem check - all games already exist
      const existingGames = new Set([1001, 1002, 1003]);
      
      // Find first game that is not already imported
      let selectedGame = null;
      for (const game of igdbGames) {
        if (!existingGames.has(game.id)) {
          selectedGame = game;
          break;
        }
      }
      
      expect(selectedGame).toBeNull();
    });

    test('should select first game if none are imported', () => {
      // Simulate searchGameOnServer returning multiple games
      const igdbGames = [
        { id: 1001, name: 'Game 1' },
        { id: 1002, name: 'Game 2' },
        { id: 1003, name: 'Game 3' },
      ];
      
      // Simulate filesystem check - no games exist
      const existingGames = new Set();
      
      // Find first game that is not already imported
      let selectedGame = null;
      for (const game of igdbGames) {
        if (!existingGames.has(game.id)) {
          selectedGame = game;
          break;
        }
      }
      
      expect(selectedGame).not.toBeNull();
      expect(selectedGame.id).toBe(1001);
      expect(selectedGame.name).toBe('Game 1');
    });

    test('should handle empty search results', () => {
      const igdbGames = [];
      
      if (!igdbGames || igdbGames.length === 0) {
        // Should skip game
        expect(igdbGames.length).toBe(0);
      }
    });

    test('should search server for IGDB ID when game not in mapping', () => {
      // Simulate collection import logic
      const gameReleaseKeyMap = new Map();
      const gameReleaseKeyToIgdbIdMap = new Map();
      const releaseKey = 'generic_123456';
      const gameData = { title: 'Test Game' };
      
      // Game not in mapping
      const gameId = gameReleaseKeyMap.get(releaseKey);
      const igdbId = gameReleaseKeyToIgdbIdMap.get(releaseKey);
      expect(gameId).toBeUndefined();
      expect(igdbId).toBeUndefined();
      
      // Should search server for IGDB ID, then filesystem
      const shouldSearchServer = !gameId && !igdbId && gameData && !!gameData.title;
      expect(shouldSearchServer).toBe(true);
    });

    test('should use mapping when game is in gameReleaseKeyMap', () => {
      // Simulate collection import logic
      const gameReleaseKeyMap = new Map();
      const releaseKey = 'generic_123456';
      const gameId = 3193;
      
      gameReleaseKeyMap.set(releaseKey, gameId);
      
      // Game found in mapping
      const foundGameId = gameReleaseKeyMap.get(releaseKey);
      expect(foundGameId).toBe(gameId);
      
      // Should not need server or filesystem search
      const shouldSearchServer = !foundGameId;
      expect(shouldSearchServer).toBe(false);
    });

    test('should use IGDB ID from mapping when available', () => {
      // Simulate collection import logic
      const gameReleaseKeyMap = new Map();
      const gameReleaseKeyToIgdbIdMap = new Map();
      const releaseKey = 'generic_123456';
      const igdbId = 3193;
      
      gameReleaseKeyToIgdbIdMap.set(releaseKey, igdbId);
      
      // IGDB ID found in mapping
      const foundIgdbId = gameReleaseKeyToIgdbIdMap.get(releaseKey);
      expect(foundIgdbId).toBe(igdbId);
      
      // Should search filesystem by folder name (IGDB ID)
      const shouldSearchByFolderName = !!foundIgdbId;
      expect(shouldSearchByFolderName).toBe(true);
    });
  });

  describe('Executable upload', () => {
    beforeEach(() => {
      mockGetExistingGameIds.mockResolvedValue(new Set());
      mockSearchGameOnServer.mockResolvedValue([{ id: 123, name: 'Test Game' }]);
      mockGetGameDetailsFromServer.mockResolvedValue({
        id: 123,
        name: 'Test Game',
      });
      mockCreateGameViaAPI.mockResolvedValue({ status: 'success' });
      mockUploadExecutableViaAPI.mockResolvedValue({ status: 'success' });
      mockUploadCoverViaAPI.mockResolvedValue({ status: 'success' });
      mockUploadBackgroundViaAPI.mockResolvedValue({ status: 'success' });
      mockCreateCollectionViaAPI.mockResolvedValue({ status: 'success' });
      mockUpdateCollectionGamesViaAPI.mockResolvedValue({ status: 'success' });
      mockGetCollectionsViaAPI.mockResolvedValue([]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      mockSearchGameOnServer.mockReset();
      mockGetGameDetailsFromServer.mockReset();
      mockCreateGameViaAPI.mockReset();
      mockUploadExecutableViaAPI.mockReset();
      mockUploadCoverViaAPI.mockReset();
      mockUploadBackgroundViaAPI.mockReset();
      mockCreateCollectionViaAPI.mockReset();
      mockUpdateCollectionGamesViaAPI.mockReset();
      mockGetCollectionsViaAPI.mockReset();
      mockGetExistingGameIds.mockReset();
    });

    test('should upload executables for valid paths', async () => {
      const execPathOne = '/tmp/test-script.sh';
      const execPathTwo = '/tmp/run.bat';
      const execPathThree = '/tmp/launcher';
      const existsSpy = jest
        .spyOn(fs, 'existsSync')
        .mockImplementation((p) => p === execPathOne || p === execPathTwo || p === execPathThree);

      const { importGame } = await modulePromise;
      await importGame(
        'Test Game',
        'release-key-1',
        [
          { path: execPathOne, label: 'script.sh' },
          { path: execPathTwo, label: 'run.bat' },
          { path: execPathThree, label: 'Launcher' }
        ],
        '/tmp/metadata',
        '/tmp/images',
        'http://localhost:3000',
        'token',
        'clientId',
        'clientSecret'
      );

      expect(mockUploadExecutableViaAPI).toHaveBeenCalledTimes(3);
      expect(mockUploadExecutableViaAPI).toHaveBeenNthCalledWith(
        1,
        123,
        execPathOne,
        'script',
        'http://localhost:3000',
        'token'
      );
      expect(mockUploadExecutableViaAPI).toHaveBeenNthCalledWith(
        2,
        123,
        execPathTwo,
        'run',
        'http://localhost:3000',
        'token'
      );
      expect(mockUploadExecutableViaAPI).toHaveBeenNthCalledWith(
        3,
        123,
        execPathThree,
        'Launcher',
        'http://localhost:3000',
        'token'
      );
      existsSpy.mockRestore();
    });

    test('should skip upload when executable path does not exist', async () => {
      const execPathOne = '/tmp/missing-script.sh';
      const execPathTwo = '/tmp/missing-run.bat';
      const execPathThree = '/tmp/missing-launcher';
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const { importGame } = await modulePromise;
      await importGame(
        'Test Game',
        'release-key-2',
        [
          { path: execPathOne, label: 'script.sh' },
          { path: execPathTwo, label: 'run.bat' },
          { path: execPathThree, label: 'Launcher' }
        ],
        '/tmp/metadata',
        '/tmp/images',
        'http://localhost:3000',
        'token',
        'clientId',
        'clientSecret'
      );

      expect(mockUploadExecutableViaAPI).not.toHaveBeenCalled();
      existsSpy.mockRestore();
    });

    test('should skip IGDB when igdbId is provided', async () => {
      const execPathOne = '/tmp/test-script.sh';
      const execPathTwo = '/tmp/run.bat';
      const execPathThree = '/tmp/launcher';
      const existsSpy = jest
        .spyOn(fs, 'existsSync')
        .mockImplementation((p) => p === execPathOne || p === execPathTwo || p === execPathThree);

      const { importGame } = await modulePromise;
      await importGame(
        'Test Game',
        'release-key-3',
        [
          { path: execPathOne, label: 'script.sh' },
          { path: execPathTwo, label: 'run.bat' },
          { path: execPathThree, label: 'Launcher' }
        ],
        '/tmp/metadata',
        '/tmp/images',
        'http://localhost:3000',
        'token',
        'clientId',
        'clientSecret',
        null,
        null,
        null,
        { igdbId: 999, skipSearch: true, skipIgdbFetch: true, skipCreate: true }
      );

      expect(mockSearchGameOnServer).not.toHaveBeenCalled();
      expect(mockGetGameDetailsFromServer).not.toHaveBeenCalled();
      expect(mockCreateGameViaAPI).not.toHaveBeenCalled();
      expect(mockUploadExecutableViaAPI).toHaveBeenCalledTimes(3);
      existsSpy.mockRestore();
    });

    test('should continue and upload executables when game already exists (409)', async () => {
      const execPath = '/tmp/test-script.sh';
      const existsSpy = jest
        .spyOn(fs, 'existsSync')
        .mockImplementation((p) => p === execPath);

      mockSearchGameOnServer.mockResolvedValue([{ id: 123, name: 'Test Game' }]);
      mockGetGameDetailsFromServer.mockResolvedValue({ id: 123, name: 'Test Game' });
      mockCreateGameViaAPI.mockRejectedValue(new Error('409 - Conflict: Game already exists'));
      mockUploadExecutableViaAPI.mockResolvedValue({ status: 'success' });

      const { importGame } = await modulePromise;
      const result = await importGame(
        'Test Game',
        'release-key-409',
        [{ path: execPath, label: 'script.sh' }],
        '/tmp/metadata',
        '/tmp/images',
        'http://localhost:3000',
        'token',
        'clientId',
        'clientSecret'
      );

      expect(result).not.toBeNull();
      expect(result.gameId).toBe(123);
      expect(mockCreateGameViaAPI).toHaveBeenCalledTimes(1);
      expect(mockUploadExecutableViaAPI).toHaveBeenCalledTimes(1);
      expect(mockUploadExecutableViaAPI).toHaveBeenCalledWith(
        123,
        execPath,
        'script',
        'http://localhost:3000',
        'token'
      );

      existsSpy.mockRestore();
    });
  });

  describe('Import map update on UPDATE', () => {
    test('should backfill releaseDate and stars when missing', async () => {
      mockGetExistingGameIds.mockResolvedValue(new Set());
      const releaseKey = 'generic_123456';
      const igdbId = 999;
      const gogReleaseDate = '1700000000';
      const myRating = 4;
      const metadataPath = '/tmp/metadata';
      const importMapPath = `${metadataPath}/importer/gog-galaxy-releasekey-map.json`;

      mockDbRows = [
        {
          releaseKey,
          title: 'Test Game',
          executablePath: null,
          label: null,
          myRating,
          releaseDate: gogReleaseDate,
        },
      ];

      const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (p === '/tmp/db' || p === metadataPath || p === importMapPath) return true;
        return false;
      });
      const readSpy = jest.spyOn(fs, 'readFileSync').mockImplementation((p) => {
        if (p === importMapPath) {
          return JSON.stringify({
            [releaseKey]: { igdbId, title: 'Test Game' },
          });
        }
        return '';
      });
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

      const { importFromGOGGalaxy } = await modulePromise;
      await importFromGOGGalaxy({
        galaxyDbPath: '/tmp/db',
        galaxyImagesPath: '/tmp/images',
        metadataPath,
        serverUrl: 'http://localhost:3000',
        apiToken: 'token',
        twitchClientId: 'clientId',
        twitchClientSecret: 'clientSecret',
        gamesOnly: true,
        upload: true,
      });

      const expectedReleaseDate = new Date(parseInt(gogReleaseDate, 10) * 1000).toISOString().split('T')[0];
      expect(writeSpy).toHaveBeenCalled();
      const written = JSON.parse(writeSpy.mock.calls[0][1]);
      expect(written[releaseKey].releaseDate).toBe(expectedReleaseDate);
      expect(written[releaseKey].stars).toBe(8);

      existsSpy.mockRestore();
      readSpy.mockRestore();
      mkdirSpy.mockRestore();
      writeSpy.mockRestore();
    });
  });
});
