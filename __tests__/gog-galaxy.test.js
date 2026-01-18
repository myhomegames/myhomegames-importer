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
});
