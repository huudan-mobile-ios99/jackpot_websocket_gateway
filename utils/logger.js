/**
 * utils/logger.js
 * Simple async file logger for Jackpot & HotSeat hits
 * Auto-creates ./logs folder and writes nicely formatted entries
 */

const fs = require('fs').promises;
const path = require('path');

// Ensure logs directory exists
async function ensureLogDirectory() {
  const logDir = path.join(__dirname, '..', 'logs');
  try {
    await fs.mkdir(logDir, { recursive: true });
  } catch (err) {
    console.error('Could not create logs directory:', err.message);
  }
}

// Main logger function – call this every time you successfully save a hit
async function logHitToFile(hitData) {
  // Example hitData:
  // {
  //   type: 'Jackpot' | 'HotSeat',
  //   jackpotId: string,
  //   jackpotName: string,
  //   value: number,
  //   machineNumber: string
  // }

  const timestamp = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const amountFormatted = Number(hitData.value).toLocaleString('vi-VN');

  const logMessage = `[${timestamp}] SUCCESS | ${hitData.type.padEnd(8)} | ID: ${String(hitData.jackpotId).padEnd(6)} | Name: ${String(hitData.jackpotName).padEnd(30).substring(0, 30)} | Amount: ${amountFormatted.padStart(15)}  | Machine: ${hitData.machineNumber}\n`;

  const logFilePath = path.join(__dirname, '..', 'logs', 'hits.log');

  try {
    await fs.appendFile(logFilePath, logMessage);
    // Also print to console so you can see it in real time
    console.log(logMessage.trim());
  } catch (err) {
    console.error('Failed to write to hits.log:', err.message);
  }
}

module.exports = {
  ensureLogDirectory,
  logHitToFile,
};
