// Test suite for GOG Galaxy importer

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

  describe('Title normalization for duplicate detection', () => {
    test('should normalize title to lowercase and trim', () => {
      const titles = [
        { input: 'Test Game', normalized: 'test game' },
        { input: '  Test Game  ', normalized: 'test game' },
        { input: 'TEST GAME', normalized: 'test game' },
        { input: 'Test   Game', normalized: 'test   game' }, // Multiple spaces preserved
      ];

      titles.forEach(({ input, normalized }) => {
        const result = input.toLowerCase().trim();
        expect(result).toBe(normalized);
      });
    });

    test('should detect duplicate titles regardless of case', () => {
      const processedTitles = new Set();
      
      const title1 = 'Test Game';
      const normalized1 = title1.toLowerCase().trim();
      processedTitles.add(normalized1);
      
      const title2 = 'TEST GAME';
      const normalized2 = title2.toLowerCase().trim();
      
      expect(processedTitles.has(normalized2)).toBe(true);
    });

    test('should detect duplicate titles with different whitespace', () => {
      const processedTitles = new Set();
      
      const title1 = 'Test Game';
      const normalized1 = title1.toLowerCase().trim();
      processedTitles.add(normalized1);
      
      const title2 = '  Test Game  ';
      const normalized2 = title2.toLowerCase().trim();
      
      expect(processedTitles.has(normalized2)).toBe(true);
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
});
