// Report logger: writes importer logs to both console and a file in METADATA_PATH/importer

import fs from 'fs';
import path from 'path';

let reportStream = null;
let reportPath = null;

function timestamp() {
  return new Date().toISOString();
}

function writeToReport(level, ...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  if (reportStream && reportStream.writable) {
    reportStream.write(line);
  }
}

/**
 * Initialize the report logger. Creates METADATA_PATH/importer/import-report-YYYY-MM-DD-HHmmss.log
 * @param {string} metadataPath - Path to MyHomeGames metadata directory
 * @returns {string|null} Path to the report file, or null if initialization failed
 */
export function init(metadataPath) {
  if (reportStream) {
    try { reportStream.end(); } catch (_) { /* ignore */ }
    reportStream = null;
  }
  try {
    const importerDir = path.join(metadataPath, 'importer');
    fs.mkdirSync(importerDir, { recursive: true });
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const filename = `import-report-${dateStr}-${timeStr}.log`;
    reportPath = path.join(importerDir, filename);
    reportStream = fs.createWriteStream(reportPath, { flags: 'a' });
    reportStream.on('error', () => { reportStream = null; });
    reportStream.write(`[${timestamp()}] Import started\n`);
    return reportPath;
  } catch (_) {
    reportPath = null;
    reportStream = null;
    return null;
  }
}

/**
 * Log a message to console and report file
 */
export function log(...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  writeToReport('INFO', msg);
  console.log(...args);
}

/**
 * Log a warning to console and report file
 */
export function warn(...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  writeToReport('WARN', msg);
  console.warn(...args);
}

/**
 * Log an error to console and report file
 */
export function error(...args) {
  const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  writeToReport('ERROR', msg);
  console.error(...args);
}

/**
 * Close the report file
 */
export function close() {
  if (reportStream) {
    try {
      reportStream.write(`[${timestamp()}] Import finished\n`);
      reportStream.end();
    } catch (_) { /* ignore */ }
    reportStream = null;
  }
}

/**
 * Get the current report file path (null if not initialized)
 */
export function getReportPath() {
  return reportPath;
}
