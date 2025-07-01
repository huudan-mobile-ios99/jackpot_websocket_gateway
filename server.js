const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const WebSocket = require('ws');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();
const { initializeCleanup } = require('./cleanup');
const { checkAndEmitDefaultJackpotHit } = require('./generate_test');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Connect to MongoDB
require('./mongo_config').connectDB();

// Load models after connection
const InfoModel = require('./model/information_model');
const HitModel = require('./model/hit_model');

// Initialize cleanup job
initializeCleanup();

const softwareVersion = '1.0.0';
const endpoints = [
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=DB-SERVER',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=SUP-FLOOR',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=media',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=EXPAT',
];
let currentEndpointIndex = 0;
let isConnecting = false;
let reconnectTimer;
const reconnectDelay = 3 * 60 * 1000; // 5 minutes

function connect() {
  if (isConnecting) return;
  isConnecting = true;

  const endpoint = endpoints[currentEndpointIndex];
  console.log(`Connecting to ${endpoint}`);
  const client = new WebSocket(endpoint);

  client.on('open', () => {
    console.log(`++++CONNECTED => ${endpoint}`);
    isConnecting = false;
    clearTimeout(reconnectTimer);
  });

  client.on('message', (message) => {
    readXML(message);
  });

  client.on('error', () => {
    console.log(`Error connecting to ${endpoint}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });

  client.on('close', (event) => {
    console.log(`Connection closed to ${endpoint}, code: ${event.code}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });
}

function scheduleNextEndpoint() {
  currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
  console.log(`Scheduling switch to next endpoint in ${reconnectDelay /100} seconds`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
}

function readXML(msg) {0
  parser.parseString(msg, async (err, result) => {
    if (err) {
      console.error('Error parsing XML:', err);
      return;
    }
    try {
      if ('JackpotHit' in result) {
        console.log('New Jackpot hit...');
        const newhit = result.JackpotHit;
        console.log(`Jackpot hit details: ID=${newhit.Jackpot[0].$.Id}, Name=${newhit.Jackpot[0].$.Name}, Amount=${newhit.Hit[0].Amount[0]}, Machine: ${newhit.Hit[0].Machine[0].$.MachineNumber}, Timestamp: ${new Date().toISOString()}`);
        await HitModel.create({
          type: 'Jackpot',
          jackpotId: newhit.Jackpot[0].$.Id,
          jackpotName: newhit.Jackpot[0].$.Name,
          value: parseFloat(newhit.Hit[0].Amount[0]),
          machineNumber: newhit.Hit[0].Machine[0].$.MachineNumber,
        });
      }

      if ('InformationBroadcast' in result) {
        console.log('Processing InformationBroadcast...');
        const jps = result.InformationBroadcast.JackpotList[0].Jackpot;
        const jackpotUpdates = jps.map(jp => ({
          jackpotId: jp.$.Id,
          jackpotName: jp.$.Name,
          value: parseFloat(jp.$.Value),
        }));
        try {
          await InfoModel.create({
            jackpots: jackpotUpdates,
          });
          console.log(`Saved InformationBroadcast record with ${jackpotUpdates.length} jackpot updates`);
        } catch (error) {
          console.error('Error saving InformationBroadcast record:', error);
        }
      }

      if ('HotSeatHit' in result) {
        console.log('New Hotseat hit...');
        console.log(`[${result.HotSeatHit.HotSeat[0].PromotionName[0]}] save HotSeat Hit`);
        await HitModel.create({
          type: 'HotSeat',
          jackpotId: result.HotSeatHit.HotSeat[0].Id[0],
          jackpotName: result.HotSeatHit.HotSeat[0].PromotionName[0],
          value: parseFloat(result.HotSeatHit.Hit[0].Amount),
          machineNumber: result.HotSeatHit.Hit[0].Machine[0].$.MachineNumber,
        });
      }
    } catch (error) {
      console.error('Error in XML message:', error);
    }
  });
}

// Start server and WebSocket client
async function startServerAndPublishData() {
  try {
    connect(); // Start with first endpoint
    // setInterval(() => checkAndEmitDefaultJackpotHit(io), 6000); // Test | Check every 6 seconds
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

console.log('JP Desktop Version:', softwareVersion);
app.use(express.static('public'));

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port: ${PORT}`);
});

startServerAndPublishData();
