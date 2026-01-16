// Common file utilities

import fs from 'fs';
import path from 'path';

/**
 * Ensure directory exists
 */
export function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copy file from source to destination
 */
export function copyFile(sourcePath, destPath) {
  try {
    if (!fs.existsSync(sourcePath)) {
      console.warn(`  Warning: Source file does not exist: ${sourcePath}`);
      return false;
    }
    
    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    ensureDirectoryExists(destDir);
    
    fs.copyFileSync(sourcePath, destPath);
    return true;
  } catch (error) {
    console.error(`  Error copying file ${sourcePath} to ${destPath}:`, error.message);
    return false;
  }
}

/**
 * Write JSON file
 */
export function writeJsonFile(filePath, data) {
  ensureDirectoryExists(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
