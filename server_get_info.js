const WebSocket = require('faye-websocket');
const crypto = require('crypto'); // For hashing jackpots array
require('./mongdb_config').connectDB(); //Assumes mongo_config.js handles MongoDB connection
const InfoModel = require('./model/information_model');
const xml2js = require('xml2js');

const endpoint = "ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=SQL2017-1";
const softwareVersion = '1.0.5';
const BATCH_SIZE_LIMIT = 13; // Save exactly 12 updates per batch

// Cache for jackpot names and batching updates
const jackpotNameCache = new Map();
let jackpotUpdatesBatch = [];
let lastSaveTime = null; // Track timestamp of last successful save
let isConnecting = false;
let reconnectTimer;
const reconnectDelay = 3.75 * 60 * 1000; // 3mins

// XML parser
const parser = new xml2js.Parser();

// Utility function to format date as dd/mm
function formatDateDDMM(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

// Utility function to format duration in seconds
function formatDuration(start, end) {
  const durationMs = end - start;
  return (durationMs / 1000).toFixed(3); // Seconds with 3 decimal places
}

// Utility function to format time difference in seconds
function formatTimeDiff(current, last) {
  if (!last) return 'N/A'; // No previous save
  const diffMs = current - last;
  return `${Math.round(diffMs / 1000)}s`; // Round to nearest second
}

// Utility function to compute hash of jackpots array
function computeJackpotsHash(jackpots) {
  // Sort by jackpotId to ensure consistent order
  const sortedJackpots = [...jackpots].sort((a, b) => a.jackpotId.localeCompare(b.jackpotId));
  // Create string of jackpotId and value pairs
  const hashString = sortedJackpots.map(jp => `${jp.jackpotId}:${jp.value}`).join('|');
  return crypto.createHash('sha256').update(hashString).digest('hex');
}

async function saveBatch() {
  if (jackpotUpdatesBatch.length === 0) {
    console.log('No updates to save');
    return;
  }

  console.log(`Preparing to save batch of size: ${jackpotUpdatesBatch.length}`);
  const startTime = new Date();
  const batchHash = computeJackpotsHash(jackpotUpdatesBatch);

  try {
    // Check for existing document with identical jackpots array
    const existingDoc = await InfoModel.findOne({
      jackpotsHash: batchHash,
      jackpots: {
        $size: BATCH_SIZE_LIMIT,
        $all: jackpotUpdatesBatch.map(jp => ({
          $elemMatch: {
            jackpotId: jp.jackpotId,
            value: jp.value,
          },
        })),
      },
    });

    if (existingDoc) {
      console.log(`Skipped saving duplicate batch with hash: ${batchHash}`);
      jackpotUpdatesBatch = []; // Clear batch to prevent accumulation
      return;
    }

    // Save new document
    await InfoModel.create({
      jackpots: jackpotUpdatesBatch,
      jackpotsHash: batchHash,
    });
    const endTime = new Date();
    const durationSeconds = formatDuration(startTime, endTime);
    const dateStr = formatDateDDMM(startTime);
    const timeDiff = formatTimeDiff(startTime, lastSaveTime);
    console.log(`Saved ${jackpotUpdatesBatch.length} jackpot updates to MongoDB on ${dateStr} in ${durationSeconds} seconds ${timeDiff} diff from last saved`);
    lastSaveTime = startTime; // Update last save time
    jackpotUpdatesBatch = []; // Clear batch after saving
  } catch (error) {
    console.error('Error saving jackpot updates to MongoDB:', {
      message: error.message,
      stack: error.stack,
      batchSize: jackpotUpdatesBatch.length,
    });
  }
}

function processJackpotUpdate(jp) {
  if (jp.$.Id === '47') {
    return; // Skip jackpotId: '47'
  }
  if (jp.$.Name) {
    jackpotNameCache.set(jp.$.Id, jp.$.Name);
  }
  const jackpotUpdate = {
    jackpotId: jp.$.Id,
    jackpotName: jackpotNameCache.get(jp.$.Id) || 'Unknown',
    value: parseFloat(jp.$.Value) || 0,
  };

  // Check for duplicate jackpotId in the current batch
  const existingIndex = jackpotUpdatesBatch.findIndex(
    (update) => update.jackpotId === jackpotUpdate.jackpotId
  );
  if (existingIndex !== -1) {
    console.log(`Duplicate jackpotId ${jackpotUpdate.jackpotId} found in batch, replacing with new value: ${jackpotUpdate.value}`);
    jackpotUpdatesBatch[existingIndex] = jackpotUpdate; // Replace existing update
  } else {
    jackpotUpdatesBatch.push(jackpotUpdate);
    console.log('Added to batch:', jackpotUpdate);
  }

  if (jackpotUpdatesBatch.length >= BATCH_SIZE_LIMIT) {
    saveBatch(); // Synchronous call to avoid race conditions
  }
}

function readXML(msg) {
  parser.parseString(msg, (err, result) => {
    try {
      if (err) {
        console.error('Error parsing XML:', err.message);
        return;
      }
      if (result.InformationBroadcast && result.InformationBroadcast.JackpotList && result.InformationBroadcast.JackpotList[0].Jackpot) {
        const jps = result.InformationBroadcast.JackpotList[0].Jackpot;
        jps.forEach((jp) => {
          processJackpotUpdate(jp);
        });
      } else {
        console.log('Unknown XML message structure:', result);
      }
    } catch (error) {
      console.error('Error processing XML message:', error.message);
    }
  });
}

function connect() {
  if (isConnecting) return;
  isConnecting = true;

  console.log(`Connecting to server: ${endpoint}`);
  const client = new WebSocket.Client(endpoint);

  client.on('open', () => {
    console.log(`---SERVER INFO CONNECTED SERVER => ${endpoint}`);
    isConnecting = false;
    clearTimeout(reconnectTimer);
  });

  client.on('message', (message) => {
    readXML(message.data);
  });

  client.on('error', (error) => {
    console.log(`Error connecting to ${endpoint}: ${error.message}`);
    isConnecting = false;
    scheduleReconnect();
  });

  client.on('close', (event) => {
    console.log(`Connection closed to ${endpoint}, code: ${event.code}`);
    isConnecting = false;
    if (event.code === 1006) {
      scheduleReconnect();
    }
  });
}

function scheduleReconnect() {
  console.log(`Reconnecting to ${endpoint} in ${reconnectDelay / 1000} seconds`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);
}

async function startServer() {
  try {
    console.log('Playtech Transmitter Version:', softwareVersion);
    connect();
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServer();
