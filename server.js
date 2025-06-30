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
//CONNECT MONGODB
require('./mongo_config').connectDB();
const InfoModel = require('./model/information_model'); // For InformationBroadcast Schema
const HitModel = require('./model/hit_model'); // For JackpotHit and HotSeatHit Schema

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
   // setInterval(checkAndEmitDefaultJackpotHit,6000); // Check every 10 seconds

  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

async function startPublisherServer() {
  const publisher = new zmq.Publisher();
  await publisher.bind("tcp://*:5550");
  console.log("Publisher bound to port 5550");
  return publisher;
}

function startWebSocketServer() {
  const wss = new WebSocket1.Server({ port: 8080, maxConnections: 100 });
  console.log("WebSocket Server on port: 8080");
  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket server (port 8080). Total clients:', wss.clients.size);
    // Send heartbeat every 30 seconds
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', (code, reason) => {
      console.log(`Client disconnected from WebSocket server (port 8080). Code: ${code}, Reason: ${reason}, Total clients: ${wss.clients.size}`);
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



// function that creates the "XML" to send to Cnario
function createxml(obj, type) {
  // type 0 is normal jp, type 1 is hotseat (else), type 2 is hit
  if (type == 0) {
    var str = '<MMC><Jackpot JackpotNumber = "' + obj.$.Id + '" JackpotName = "' + obj.$.Name + '"><Level Name = "Level 0" Number = "0" Amount = "' + obj.$.Value + '"/></Jackpot></MMC>';
    return str
  }
  if (type == 2) {
    var str='<MMC><Jackpot JackpotNumber = "' + obj.HotSeatHit.HotSeat[0].Id[0] + '" JackpotName = "' + obj.HotSeatHit.HotSeat[0].PromotionName[0] + '"><Level Name = "Level 0" Number = "0" Amount = "' + obj.HotSeatHit.Hit[0].Amount + '"><Hit Amount = "' + obj.HotSeatHit.Hit[0].Amount + '" Number = "' + obj.HotSeatHit.Hit[0].Machine[0].$.MachineNumber + '" Name = "Fever" Text = "Congratulations"/></Level></Jackpot></MMC>';
    return str
  } else {
    var str='<MMC><Jackpot JackpotNumber = "' + obj.Jackpot[0].$.Id + '" JackpotName = "' + obj.Jackpot[0].$.Name + '"><Level Name = "Level 0" Number = "0" Amount = "' + obj.Jackpot[0].$.Value + '"><Hit Amount = "' + obj.Hit[0].Amount[0] + '" Number = "' + obj.Hit[0].Machine[0].$.MachineNumber + '" Name = "Fever" Text = "Congratulations"/></Level></Jackpot></MMC>';
    return str
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
    // console.log("Parsed XML result:", JSON.stringify(result, null, 2)); // Log parsed XML
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
        // Broadcast jackpot hit to all Socket.IO clients
        console.log('emit Jackpot Hit for ANY PRICES');
        io.emit('jackpotHit', {
          id: newhit.Jackpot[0].$.Id,
          name: newhit.Jackpot[0].$.Name,
          amount: newhit.Hit[0].Amount[0],
          machineNumber: newhit.Hit[0].Machine[0].$.MachineNumber,
          timestamp: new Date().toISOString(),
        });
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
        // console.log("Jackpot list:", JSON.stringify(jps, null, 2)); // Log jackpot list
        jps.forEach(async jp => { // added async here to fix calls to async functions
          // console.log("wss in readxml: ",wss);
          // Publish data
          await publishData(publisher, jp, wss);
          // Save to MongoDB (InformationBroadcast collection)
          await InfoModel.create({
              jackpotId: jp.$.Id,
              jackpotName: jp.$.Name,
              value: parseFloat(jp.$.Value),
          });
        })
        if(logging){
          // log hotseats
        }
      }

      if ("HotSeatHit" in result) {
        console.log("New Hotseat hit...");
        // Broadcast hotseat hit to all Socket.IO clients
        console.log(`[${result.HotSeatHit.HotSeat[0].PromotionName[0]}] emit HotSeat Hit`);
        io.emit('jackpotHit', {
          id: result.HotSeatHit.HotSeat[0].Id[0],
          name: result.HotSeatHit.HotSeat[0].PromotionName[0],
          amount: result.HotSeatHit.Hit[0].Amount,
          machineNumber: result.HotSeatHit.Hit[0].Machine[0].$.MachineNumber,
          timestamp: new Date().toISOString()
        });
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
  socket.emit('initialConfig', {
    jackpots: nconf.get('jackpots'),
    hotseats: nconf.get('hotseats'),
  });

  socket.on('updateConfig', ({ listId, oldItemId, newItemId, name, address, port }) => {
    const items = nconf.get(listId);
    if (Array.isArray(items)) {
      const updatedItems = items.map((item) => {
        if (item.id === oldItemId) {
          return { id: newItemId, name, address, port };
        }
        return item;
      });
      nconf.set(listId, updatedItems);
      nconf.save();
      io.emit('updatedConfig', {
        jackpots: nconf.get('jackpots'),
        hotseats: nconf.get('hotseats'),
      });
    } else {
      console.error('Error: items is not an array.');
    }
  });

  socket.on('deleteConfig', ({ listId, itemId }, callback) => {
    const items = nconf.get(listId);
    if (Array.isArray(items)) {
      const updatedItems = items.filter((item) => item.id !== itemId);
      nconf.set(listId, updatedItems);
      nconf.save();
      io.emit('updatedConfig', {
        jackpots: nconf.get('jackpots'),
        hotseats: nconf.get('hotseats'),
      });
      callback({ success: true, message: 'Item deleted successfully.' });
    } else {
      console.log(`Error: Items is not an array for list ${listId}`);
      callback({ success: false, message: 'Error deleting item.' });
    }
  });

  socket.on('addConfig', ({ listId, id, name, address, port }) => {
    const items = nconf.get(listId);
    if (Array.isArray(items)) {
      items.push({ id, name, address, port });
      nconf.set(listId, items);
      nconf.save();
      io.emit('updatedConfig', {
        jackpots: nconf.get('jackpots'),
        hotseats: nconf.get('hotseats'),
      });
    }
  });
});


const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port: ${PORT}`);
});

startServerAndPublishData();


function checkAndEmitDefaultJackpotHit() {
  console.log('Emitting default jackpotHit');
  let availableIds = [0,1,2,3,34,80];
  let usedIds = [];
  // If all IDs have been used, reset availableIds
  if (availableIds.length === 0) {
    availableIds = usedIds;
    usedIds = [];
    console.log('Resetting ID pool:', availableIds);
  }
  // Randomly select an ID from availableIds
  const randomIndex = Math.floor(Math.random() * availableIds.length);
  const selectedId = availableIds[randomIndex];
  // Move selected ID to usedIds
  usedIds.push(selectedId);
  availableIds.splice(randomIndex, 1);
  console.log(`Selected ID: ${selectedId}, Remaining IDs: ${availableIds}`);
  io.emit('jackpotHit', {
    id: selectedId,
    name: "Frequent",
    amount: 300,
    machineNumber: "000",
    timestamp: new Date().toISOString()
  });
}
