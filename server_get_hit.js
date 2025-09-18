const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const WebSocket = require('ws');
const xml2js = require('xml2js');
const fs = require('fs').promises; // For file-based persistence
const parser = new xml2js.Parser();
const mongoose = require('mongoose');
const crypto = require('crypto');


const { connectDB } = require('./mongdb_config');
const { initializeCleanup } = require('./server_cleanup');


async function initializeServer() {
  app = express();
  server = http.createServer(app);
  io = socketIO(server);
  app.use(express.static('public'));
  server.listen(PORT, () => {
    console.log(`Server running on port: ${PORT}`);
  });
  await connectDB();
  // Pass the mongoose instance to cleanup.js
  // initializeCleanup(mongoose);
}

// Load models after connection
const InfoModel = require('./model/information_model');
const HitModel = require('./model/hit_model');


const endpoints = [
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=cuong-it',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=CUONGIT',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=daisy',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=crm-laptophp',
  "ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=HUONG-ACC",
  "ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=IpadMainPit",
  "ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Jay-3",
];

let app;
let server;
let io;
let currentEndpointIndex = 0;
let isConnecting = false;
let client;
let connectionTimeout;
const softwareVersion = '1.0.0';
const PORT = process.env.PORT || 8000;
const CONNECT_TIMEOUT=0.7757*  60 * 1000; // 20 seconds
const RECONNECT_DELAY=1.25* 60 * 1000; // 20 seconds
const ENDPOINT_STATE_FILE = './current_endpoint.json'; // File to store current endpoint index

// Load last successful endpoint index from file
async function loadLastEndpointIndex() {
  try {
    const data = await fs.readFile(ENDPOINT_STATE_FILE, 'utf8');
    const state = JSON.parse(data);
    currentEndpointIndex = state.currentEndpointIndex || 0;
    console.log(`Loaded last successful endpoint index: ${currentEndpointIndex} (${endpoints[currentEndpointIndex]})`);
  } catch (error) {
    console.log('No previous endpoint state found, starting with index 0');
    currentEndpointIndex = 0;
  }
}

// Save current endpoint index to file
async function saveCurrentEndpointIndex() {
  try {
    await fs.writeFile(ENDPOINT_STATE_FILE, JSON.stringify({ currentEndpointIndex }));
    console.log(`Saved current endpoint index: ${currentEndpointIndex}`);
  } catch (error) {
    console.error('Error saving endpoint index:', error.message);
  }
}



async function connect() {
  if (isConnecting) {
    console.log('Connection attempt already in progress, skipping...');
    return;
  }
  isConnecting = true;

  const endpoint = endpoints[currentEndpointIndex];
  console.log(`Attempting connection to ${endpoint}`);

  // Close any existing WebSocket client
  if (client) {
    client.terminate();
  }

  client = new WebSocket(endpoint);

  // Set a 20-second timeout for the connection attempt
  connectionTimeout = setTimeout(async () => {
    if (client.readyState !== WebSocket.OPEN) {
      console.log(`Connection to ${endpoint} timed out after 20 seconds`);
      client.terminate();
      isConnecting = false;
      await connectToNextEndpoint();
    }
  }, CONNECT_TIMEOUT);

  client.on('open', () => {
    console.log(`CONNECTED SERVER => ${endpoint}`);
    isConnecting = false;
    clearTimeout(connectionTimeout);
    saveCurrentEndpointIndex(); // Save the successful endpoint index
  });

  client.on('message', (message) => {
    readXML(message);
  });

  client.on('error', async (error) => {
    console.log(`Error connecting to ${endpoint}: ${error.message}`);
    isConnecting = false;
    clearTimeout(connectionTimeout);
    setTimeout(async () => {
      await connectToNextEndpoint();
    }, RECONNECT_DELAY); // Wait 20 seconds before trying next endpoint
  });

  client.on('close', async (event) => {
    console.log(`Connection closed to ${endpoint}, code: ${event.code || 'undefined'}`);
    isConnecting = false;
    clearTimeout(connectionTimeout);
    setTimeout(async () => {
      await connectToNextEndpoint();
    }, RECONNECT_DELAY); // Wait 20 seconds before trying next endpoint
  });
}

async function connectToNextEndpoint() {
  currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
  console.log(`Switching to next endpoint: ${endpoints[currentEndpointIndex]}`);
  await connect();
}

function readXML(msg) {
  parser.parseString(msg, async (err, result) => {
    if (err) {
      console.error('Error parsing XML:', err);
      return;
    }
    try {
      if ('JackpotHit' in result) {
        console.log('New Jackpot hit...');
        const newhit = result.JackpotHit;
        const jackpotData = {
                  type: 'Jackpot',
                  jackpotId: newhit.Jackpot[0].$.Id,
                  jackpotName: newhit.Jackpot[0].$.Name,
                  value: parseFloat(newhit.Hit[0].Amount[0]),
                  machineNumber: newhit.Hit[0].Machine[0].$.MachineNumber,
         };
          // Check for duplicate
          try {
          const existingHit = await HitModel.findOne({
            machineNumber: jackpotData.machineNumber,
            value: jackpotData.value,
          });
          if (existingHit) {
            console.log(`Duplicate Jackpot hit found, skipping save: ID=${jackpotData.jackpotId}, Name=${jackpotData.jackpotName}, Amount=${jackpotData.value}, Machine=${jackpotData.machineNumber}`);
            return;
          }
          await HitModel.create(jackpotData);
          console.log(`Saved new Jackpot hit: ID=${jackpotData.jackpotId}`);
        } catch (error) {
          if (error.code === 11000) {
            console.log(`Duplicate Jackpot hit detected, skipping save: ID=${jackpotData.jackpotId}, Name=${jackpotData.jackpotName}, Amount=${jackpotData.value}, Machine=${jackpotData.machineNumber}`);
            return;
          }
          throw error;
        }
      }

      if ('InformationBroadcast' in result) {
        // console.log('Processing InformationBroadcast...');
        // const jps = result.InformationBroadcast.JackpotList[0].Jackpot;
        // const jackpotUpdates = jps.map(jp => ({
        //     jackpotId: jp.$.Id,
        //     jackpotName: jp.$.Name,
        //     value: parseFloat(jp.$.Value),
        // }));
        // // Fetch the top 10 recent InformationBroadcast records
        // const recentBroadcasts = await InfoModel
        //     .find()
        //     .sort({ timestamp: -1 })
        //     .limit(10)
        //     .lean();
        // // Flatten the jackpots from recent broadcasts for deduplication check
        // const recentJackpots = recentBroadcasts.flatMap(broadcast => broadcast.jackpots);
        // // ✅ Add jackpot IDs that should bypass duplicate checking
        // const bypassDuplicateCheckIds = ['40','43','47',];
        // // Filter out duplicate jackpot updates
        // const uniqueJackpotUpdates = jackpotUpdates.filter(update => {
        //     if (bypassDuplicateCheckIds.includes(update.jackpotId)) {
        //     console.log(`Bypassing duplicate check for jackpotId ${update.jackpotId}`);
        //     return true; // Always include
        //     }
        //     const isDuplicate = recentJackpots.some(jackpot =>
        //     jackpot.jackpotId === update.jackpotId && jackpot.value === update.value
        //     );
        //     if (isDuplicate) {
        //     console.log(`Duplicate jackpot update found, skipping: ID=${update.jackpotId}, Name=${update.jackpotName}, Value=${update.value}`);
        //     }
        //     return !isDuplicate; // Only include if not duplicate
        // });
        // // Save only if there are unique jackpot updates
        // if (uniqueJackpotUpdates.length > 0) {
        //     await InfoModel.create({
        //     jackpots: uniqueJackpotUpdates,
        //     messageId: crypto.randomUUID(), // Node.js >=14.17.0
        //     });
        //     console.log(`Saved InformationBroadcast with ${uniqueJackpotUpdates.length} unique jackpot updates`);
        // } else {
        //     console.log('No unique jackpot updates to save');
        // }
        }
      if ('HotSeatHit' in result) {
        console.log('New Hotseat hit...');
        // console.log('New hotseat hit:', JSON.stringify(result, null, 2));
        const hotSeat = result.HotSeatHit.HotSeat && Array.isArray(result.HotSeatHit.HotSeat) && result.HotSeatHit.HotSeat[0];
        const hit = result.HotSeatHit.Hit && Array.isArray(result.HotSeatHit.Hit) && result.HotSeatHit.Hit[0];
        if (!hotSeat || !hit) {
          console.error('Invalid HotSeatHit structure: missing HotSeat or Hit');
          return;
        }
        const id = hotSeat.Id && Array.isArray(hotSeat.Id) && hotSeat.Id[0];
        const promotionName = hotSeat.PromotionName && Array.isArray(hotSeat.PromotionName) && hotSeat.PromotionName[0];
        const machineNumber = hit.Machine && Array.isArray(hit.Machine) && hit.Machine[0] && hit.Machine[0].$.MachineNumber;
        const amountRaw = hit.Amount && Array.isArray(hit.Amount) && hit.Amount[0];
        if (!id || !promotionName || !machineNumber) {
          console.error(`Invalid HotSeatHit data: id=${id}, promotionName=${promotionName}, machineNumber=${machineNumber}`);
          return;
        }
        let amount = 0; // Default to 0
        if (
          amountRaw == null ||
          amountRaw === '' ||
          (Array.isArray(amountRaw) && amountRaw.length === 0) ||
          (typeof amountRaw === 'object' && !Array.isArray(amountRaw) && Object.keys(amountRaw).length === 0)
        ) {
          console.warn(`Invalid or missing amount for HotSeatHit, defaulting to 0: ${JSON.stringify(amountRaw)}`);
        } else {
          amount = parseFloat(amountRaw);
          if (isNaN(amount)) {
            console.warn(`Invalid amount for HotSeatHit, defaulting to 0: ${JSON.stringify(amountRaw)}`);
            amount = 0;
          }
        }
        console.log(`[${promotionName}] save HotSeat Hit with amount: ${amount}`);
        const hotSeatData = {
                 type: 'HotSeat',
                 jackpotId: id,
                 jackpotName: promotionName,
                 value: amount,
                 machineNumber: machineNumber,
        };
        // Check for duplicate
        try {
          const existingHotSeatHit = await HitModel.findOne({
            machineNumber: hotSeatData.machineNumber,
            value: hotSeatData.value,
          });
          if (existingHotSeatHit) {
            console.log(`Duplicate HotSeat hit found, skipping save: ID=${hotSeatData.jackpotId}, Name=${hotSeatData.jackpotName}, Amount=${hotSeatData.value}, Machine=${hotSeatData.machineNumber}`);
            return;
          }
          await HitModel.create(hotSeatData);
          console.log(`Saved new HotSeat hit: ID=${hotSeatData.jackpotId}`);
        } catch (error) {
          if (error.code === 11000) {
            console.log(`Duplicate HotSeat hit detected, skipping save: ID=${hotSeatData.jackpotId}, Name=${hotSeatData.jackpotName}, Amount=${hotSeatData.value}, Machine=${hotSeatData.machineNumber}`);
            return;
          }
          throw error;
        }
      }
    } catch (error) {
      console.error('Error processing XML message:',error);
    }
  });
}

async function startServerAndPublishData() {
  try {
    console.log('JP Desktop HIT Server:', softwareVersion);
    await loadLastEndpointIndex(); // Load last successful endpoint
    initializeServer();
    await connect();
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServerAndPublishData();









