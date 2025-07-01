var WebSocket = require('faye-websocket');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');
var xml2js = require('xml2js');
var parser = new xml2js.Parser();
const nconf = require('nconf');
nconf.file("config.json");
const zmq = require("zeromq");
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const WebSocket1 = require('ws');

// Initialize CleanUp
const { initializeCleanup } = require('./cleanup');
// Connect to MongoDB
require('./mongo_config').connectDB();
const InfoModel = require('./model/information_model'); // For InformationBroadcast Schema
const HitModel = require('./model/hit_model'); // For JackpotHit and HotSeatHit Schema
// Initialize cleanup job schedule for hours
initializeCleanup();
var logging = true;
const softwareVersion = '1.0.0';
// List of WebSocket endpoints in order
const endpoints = [
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=DB-SERVER',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=SUP-FLOOR',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=media',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=EXPAT',
];
let currentEndpointIndex = 0; // Start with first endpoint
let isConnecting = false; // Prevent multiple connection attempts
let reconnectTimer; // Timer for reconnection delay
const reconnectDelay = 5 * 60 * 1000; // 2 minutes in milliseconds
var hitsdb = [];
let publisher;
let wss;
let client; // Track the WebSocket client


function connect() {
  if (isConnecting) return; // Avoid multiple connection attempts
  isConnecting = true;

  const endpoint = endpoints[currentEndpointIndex];
  console.log(`Reconnecting...`);
  client = new WebSocket.Client(endpoint);

  client.on('open', function() {
    console.log(`++++CONNECTED => ${endpoint}`);
    isConnecting = false;
    clearTimeout(reconnectTimer); // Clear any pending reconnect
  });

  client.on('message', function(message) {
    readXML(message.data, publisher, wss);
  });

  client.on('error', function(error,code) {
    console.log(`Error connection `);
    isConnecting = false;
    scheduleNextEndpoint();
  });

  client.on('close', function(message) {
    console.log(`Connection closed to  ${message.reason}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });
}

function scheduleNextEndpoint() {
  // Move to the next endpoint
  currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
  console.log(`Scheduling switch to next endpoint:  in ${reconnectDelay / 1000} seconds`);

  // Schedule reconnection attempt after 2 minutes
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);
}

// Start server and publisher
async function startServerAndPublishData() {
  try {
    publisher = await startPublisherServer();
    wss = startWebSocketServer();
    connect(); // Start with first endpoint
  //  setInterval(checkAndEmitDefaultJackpotHit,6000); //Test | Check every 10 seconds

  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

async function startPublisherServer() {
  const publisher = new zmq.Publisher();
  await publisher.bind("tcp://*:5560");
  console.log("Publisher bound to port 5560");
  return publisher;
}

function startWebSocketServer() {
  const wss = new WebSocket1.Server({ port: 8080, maxConnections: 100 });
  console.log("WebSocket Server on port: 8080");
  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket server. Total clients:',wss.clients.id, wss.clients.keys, wss.clients.size);
    // Send heartbeat every 30 seconds
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', (code, reason) => {
      console.log(`Client disconnected from WebSocket server. Code: ${code}, Reason: ${reason}, Total clients: ${wss.clients.size}`);
    });
    ws.on('error', (error) => {
      console.error('WebSocket client error:', error);
    });
  });
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });
  // Heartbeat check every 30 seconds
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log('Terminating dead client');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  return wss;
}

const messageQueue = [];
let isSending = false;

async function sendNextMessage(publisher, wss) {
  if (messageQueue.length === 0 || isSending) return;
  isSending = true;
  const [topic, message] = messageQueue.shift();
  try {
    await publisher.send([topic, message]);
  } catch (error) {
    console.error("Error sending message:", error);
  }
  isSending = false;
  sendNextMessage(publisher, wss);
}

async function publishData(publisher, obj, wss) {
  if (!publisher) throw new Error("Publisher is not initialized.");
  const Id = obj.$.Id;
  const Value = obj.$.Value;
  const message = JSON.stringify({ Id, Value});
  console.log('Publishing data to WebSocket clients:', message); // Log data sent to Flutter
  messageQueue.push(["topic", message]);
  if (!isSending) sendNextMessage(publisher, wss);
  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket1.OPEN) {
        client.send(message);
      }
    });
  }
}

//function for looking up jackpots by id from the config file
function lookupConf(jackpots, id) {
  for (let i in jackpots) {
    if (String(jackpots[i].id) === String(id)) {
      return {
        ...jackpots[i],
        port: Number(jackpots[i].port) // Ensure port is a number
      };
    }
  }
  return undefined;
}

// function for reading the incomming messages and process the data accordingly
 function readXML(msg, publisher, wss)  {
  let hotseats = nconf.get("hotseats");
  let jackpots = nconf.get("jackpots");
  parser.parseString(msg, async function (err, result) {
    if (err) {
      console.error("Error parsing XML:", err);
      return;
    }
    try {
      if ("JackpotHit" in result) {
        console.log("New Jackpot hit...");
        const newhit = result.JackpotHit;
        const jpconf = lookupConf(jackpots, newhit.Jackpot[0].$.Id);
        if (!jpconf) {
          console.error(`Jackpot configuration not found for ID: ${newhit.Jackpot[0].$.Id}`);
          return;
        }
        console.log(`Jackpot hit details: ID=${newhit.Jackpot[0].$.Id}, Name=${newhit.Jackpot[0].$.Name}, Amount=${newhit.Hit[0].Amount[0]}, Machine: ${newhit.Hit[0].Machine[0].$.MachineNumber}- TimeStamp: ${new Date().toISOString()}`);
        // Save to MongoDB (Hits collection)
        await HitModel.create({
            type: 'Jackpot',
            jackpotId: newhit.Jackpot[0].$.Id,
            jackpotName: newhit.Jackpot[0].$.Name,
            value: parseFloat(newhit.Hit[0].Amount[0]),
            machineNumber: newhit.Hit[0].Machine[0].$.MachineNumber,
        });
        if(logging) {
          console.log('wrote hit to file: JackpotHit');
        }
      }

      if ("InformationBroadcast" in result) {
        console.log("Processing InformationBroadcast..."); // Log when processing InformationBroadcast
        const jps = result.InformationBroadcast.JackpotList[0].Jackpot;
        jps.forEach(async jp => { // added async here to fix calls to async functions
          // Publish data
          await publishData(publisher, jp, wss);
        })
        if(logging){
          // log hotseats
        }
        // Prepare array of jackpot updates
        const jackpotUpdates = jps.map(jp => ({
            jackpotId: jp.$.Id,
            jackpotName: jp.$.Name,
            value: parseFloat(jp.$.Value),
          }));
          // Save single record with all jackpot updates
          try {
            await InfoModel.create({
              jackpots: jackpotUpdates,
            });
            console.log(`Saved InformationBroadcast record with ${jackpotUpdates.length} jackpot updates`);
          } catch (error) {
            console.error('Error saving InformationBroadcast record:', error);
          }
      }

      if ("HotSeatHit" in result) {
        console.log("New Hotseat hit...");
        // Broadcast hotseat hit to all Socket.IO clients
        console.log(`[${result.HotSeatHit.HotSeat[0].PromotionName[0]}] save & emit HotSeat Hit`);
        // Save to MongoDB (Hits collection)
        await HitModel.create({
            type: 'HotSeat',
            jackpotId: result.HotSeatHit.HotSeat[0].Id[0],
            jackpotName: result.HotSeatHit.HotSeat[0].PromotionName[0],
            value: parseFloat(result.HotSeatHit.Hit[0].Amount),
            machineNumber: result.HotSeatHit.Hit[0].Machine[0].$.MachineNumber,
        });
        if(logging){
          console.log('wrote hotseat to file: HotSeatHit');// log hotseats
        }
      }
    } catch(error) {
        console.log("Error in xml message : " + error)
    }
  });
}


console.log("JP Desktop Version: ", softwareVersion);
app.use(express.static('public'));

io.on('connection', (socket) => {

});


const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port: ${PORT}`);
});

startServerAndPublishData();



