"use strict";

const cluster = require('cluster');
const os = require('os');
const WebSocket = require('faye-websocket');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();
const nconf = require('nconf');
nconf.file("config.json");
const zmq = require("zeromq");
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const WebSocket1 = require('ws');

// CONNECT MONGODB
require('../mongo_config').connectDB();

const logging = true;
const softwareVersion = '1.0.0';
const endpoints = [
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=SUP-FLOOR',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=EXPAT',
];
let currentEndpointIndex = 0;
let isConnecting = false;
let reconnectTimer;
const reconnectDelay = 5 * 60 * 1000;
let publisher, wss, client;

// Shared HTTP server for all workers
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  console.log("JP Desktop Version:", softwareVersion);

  // Ensure server is only listened to once
  if (!server.listening) {
    server.listen(process.env.PORT || 8000, () => {
      console.log(`Master ${process.pid} HTTP/Socket.IO server running on port: ${process.env.PORT || 8000}`);
    });

    server.on('error', (error) => {
      console.error(`Master ${process.pid} HTTP server error:`, error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${process.env.PORT || 8000} is already in use. Please free the port or choose another.`);
        process.exit(1);
      }
    });
  }

  // Fork workers
  const numWorkers = Math.min(os.cpus().length, 4); // Limit to 4 workers for 10 connections
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died with code: ${code}, signal: ${signal}`);
    console.log('Starting a new worker');
    cluster.fork();
  });

  // Handle master process errors to prevent crashes
  process.on('uncaughtException', (error) => {
    console.error(`Master ${process.pid} uncaught exception:`, error);
  });
} else {
  console.log(`Worker ${process.pid} started`);
  console.log("JP Desktop Version:", softwareVersion);
  startWorkerServices();
}

// Worker-specific services (WebSocket, ZeroMQ)
async function startWorkerServices() {
  try {
    publisher = await startPublisherServer();
    wss = startWebSocketServer();
    connect();
  } catch (error) {
    console.error(`Worker ${process.pid} error starting services:`, error);
    // Do not exit worker; allow it to retry or continue
  }
}

async function startPublisherServer() {
  const publisher = new zmq.Publisher();
  const port = 5550 + cluster.worker.id;
  try {
    await publisher.bind(`tcp://*:${port}`);
    console.log(`Worker ${process.pid} publisher bound to port ${port}`);
    return publisher;
  } catch (error) {
    console.error(`Worker ${process.pid} failed to bind ZeroMQ on port ${port}:`, error);
    throw error;
  }
}

function startWebSocketServer() {
  const port = 8080 + cluster.worker.id;
  const wss = new WebSocket1.Server({ port: port, maxConnections: 100 });
  console.log(`Worker ${process.pid} WebSocket Server on port: ${port}`);
  wss.on('connection', (ws) => {
    console.log(`Worker ${process.pid} client connected to WebSocket server (port ${port}). Total clients:`, wss.clients.size);
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('close', (code, reason) => {
      console.log(`Worker ${process.pid} client disconnected from WebSocket server (port ${port}). Code: ${code}, Reason: ${reason}, Total clients: ${wss.clients.size}`);
    });
    ws.on('error', (error) => {
      console.error(`Worker ${process.pid} WebSocket client error:`, error);
    });
  });
  wss.on('error', (error) => {
    console.error(`Worker ${process.pid} WebSocket server error:`, error);
  });
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log(`Worker ${process.pid} terminating dead client`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  return wss;
}

function connect() {
  if (isConnecting) return;
  isConnecting = true;

  const endpoint = endpoints[currentEndpointIndex];
  console.log(`*local: Worker ${process.pid} attempting to connect to ${endpoint}`);
  client = new WebSocket.Client(endpoint);

  client.on('open', function () {
    console.log(`*local: Worker ${process.pid} connection established to ${endpoint}`);
    isConnecting = false;
    clearTimeout(reconnectTimer);
  });

  client.on('message', function (message) {
    console.log(`*local: Worker ${process.pid} received raw XML from ${endpoint}:`, message.data);
    readXML(message.data, publisher, wss);
  });

  client.on('error', function (error) {
    console.log(`*local: Worker ${process.pid} error connecting to ${endpoint}: ${error}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });

  client.on('close', function (message) {
    console.log(`*local: Worker ${process.pid} connection closed to ${endpoint}: ${message.code} ${message.reason}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });
}

function scheduleNextEndpoint() {
  currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
  console.log(`Worker ${process.pid} scheduling switch to next endpoint: ${endpoints[currentEndpointIndex]} in ${reconnectDelay / 1000} seconds`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, reconnectDelay);
}

const messageQueue = [];
let isSending = false;

async function sendNextMessage(publisher, wss) {
  if (messageQueue.length === 0 || isSending) return;
  isSending = true;
  const [topic, message] = messageQueue.shift();
  console.log(`Worker ${process.pid} sending to ZeroMQ:`, { topic, message });
  try {
    await publisher.send([topic, message]);
  } catch (error) {
    console.error(`Worker ${process.pid} error sending message to ZeroMQ:`, error);
  }
  isSending = false;
  sendNextMessage(publisher, wss);
}

async function publishData(publisher, obj, wss) {
  if (!publisher) throw new Error("Publisher is not initialized.");
  const Id = obj.$.Id;
  const Value = obj.$.Value;
  const message = JSON.stringify({ Id, Value });
  console.log(`Worker ${process.pid} publishing data to WebSocket clients:`, message);
  if (logging) {
    try {
      await JackpotValue.create({
        id: Id,
        name: lookupConf(nconf.get('jackpots'), Id)?.name || 'Unknown',
        value: parseFloat(Value),
      });
      console.log(`Worker ${process.pid} saved JackpotValue to MongoDB: ID=${Id}, Value=${Value}`);
    } catch (dbError) {
      console.error(`Worker ${process.pid} error saving JackpotValue to MongoDB:`, dbError);
    }
  }
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

function createxml(obj, type) {
  if (type == 0) {
    return `<MMC><Jackpot JackpotNumber="${obj.$.Id}" JackpotName="${obj.$.Name}"><Level Name="Level 0" Number="0" Amount="${obj.$.Value}"/></Jackpot></MMC>`;
  }
  if (type == 2) {
    return `<MMC><Jackpot JackpotNumber="${obj.HotSeatHit.HotSeat[0].Id[0]}" JackpotName="${obj.HotSeatHit.HotSeat[0].PromotionName[0]}"><Level Name="Level 0" Number="0" Amount="${obj.HotSeatHit.Hit[0].Amount}"><Hit Amount="${obj.HotSeatHit.Hit[0].Amount}" Number="${obj.HotSeatHit.Hit[0].Machine[0].$.MachineNumber}" Name="Fever" Text="Congratulations"/></Level></Jackpot></MMC>`;
  } else {
    return `<MMC><Jackpot JackpotNumber="${obj.Jackpot[0].$.Id}" JackpotName="${obj.Jackpot[0].$.Name}"><Level Name="Level 0" Number="0" Amount="${obj.Jackpot[0].$.Value}"><Hit Amount="${obj.Hit[0].Amount[0]}" Number="${obj.Hit[0].Machine[0].$.MachineNumber}" Name="Fever" Text="Congratulations"/></Level></Jackpot></MMC>`;
  }
}

function lookupConf(jackpots, id) {
  for (let i in jackpots) {
    if (String(jackpots[i].id) === String(id)) {
      return {
        ...jackpots[i],
        port: Number(jackpots[i].port)
      };
    }
  }
  return undefined;
}
function readXML(msg, publisher, wss) {
  console.log("READXML PUBLISHER: ",publisher);
  let hotseats = nconf.get("hotseats");
  let jackpots = nconf.get("jackpots");
  parser.parseString(msg, function (err, result) {
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
        const xmlvb = createxml(newhit, 1);
        // send udp 5 times with an interval of 200ms
        let count = 0;
        const intervalId = setInterval(() => {
          socket.send(xmlvb, 0, xmlvb.length, jpconf.port, jpconf.address);
          console.log(`Sent UDP message to ${jpconf.address}:${jpconf.port}`);
          count++;
          if (count === 3) {
            clearInterval(intervalId); // Stop the interval after 4 calls
          }
        }, 200);

        if(logging) {
          // log hits
          console.log('wrote hit to file');
        }

        // Broadcast jackpot hit to all Socket.IO clients
        console.log('emit Jackpot Hit for ANY PRICES');
        io.emit('jackpotHit', {
          id: newhit.Jackpot[0].$.Id,
          name: newhit.Jackpot[0].$.Name,
          amount: newhit.Hit[0].Amount[0],
          machineNumber: newhit.Hit[0].Machine[0].$.MachineNumber,
          timestamp: new Date().toISOString()
        });
      }

      if ("InformationBroadcast" in result) {
        const jps = result.InformationBroadcast.JackpotList[0].Jackpot
        jps.forEach(async jp => { // added async here to fix calls to async functions
          if (hitsdb.indexOf(jp.$.Id) == -1) {
            const jpconf = lookupConf(jackpots, jp.$.Id)
            // create xml and udp it
            const xmlvb = createxml(jp, 0);
            socket.send(xmlvb, 0, xmlvb.length, jpconf.port, jpconf.address);
          }
          await publishData(publisher, jp, wss);
        })
        if(logging){
        }
      }

      if ("HotSeatHit" in result) {
        console.log("New Hotseat hit...");
        const hsconf = lookupConf(hotseats, result.HotSeatHit.HotSeat[0].Id[0]);
        const xmlvb = createxml(result, 2);

        // send udp 5 times with an interval of 200ms
        let count = 0;
        const intervalId = setInterval(() => {
          socket.send(xmlvb, 0, xmlvb.length, hsconf.port, hsconf.address);
          count++;
          if (count === 5) {
            // send fake jackpot
            let count1 = 0;
            const intervalId1 = setInterval(() => {
              if (count1 === 0) {
                count1++;
                return
              }
              if (count1 === 1) {
                count1++
                var str  = '<MMC><Jackpot JackpotNumber = "' + result.HotSeatHit.HotSeat[0].Id[0] + '" JackpotName = "' + result.HotSeatHit.HotSeat[0].PromotionName[0] + '"><Level Name = "Level 0" Number = "0" Amount = "0"/></Jackpot></MMC>';
                socket.send(str, 0, str.length, hsconf.port, hsconf.address);
              }
              if (count1 === 2) {
                count1++
                var str1 = '<MMC><Jackpot JackpotNumber = "' + result.HotSeatHit.HotSeat[0].Id[0] + '" JackpotName = "' + result.HotSeatHit.HotSeat[0].PromotionName[0] + '"><Level Name = "Level 0" Number = "0" Amount = "1"/></Jackpot></MMC>';
                socket.send(str1, 0, str1.length, hsconf.port, hsconf.address);
              }
              clearInterval(intervalId1); // Stop the interval after 3 calls

              clearInterval(intervalId); // Stop the main interval after 5 calls
            }, 400);
          }
        }, 200);

        if(logging){
          // log hotseats
          console.log('wrote hotseat to file');
        }
        // Broadcast hotseat hit to all Socket.IO clients
        console.log(`[${result.HotSeatHit.HotSeat[0].PromotionName[0]}] emit HotSeat Hit`);
        io.emit('jackpotHit', {
          id: result.HotSeatHit.HotSeat[0].Id[0],
          name: result.HotSeatHit.HotSeat[0].PromotionName[0],
          amount: result.HotSeatHit.Hit[0].Amount,
          machineNumber: result.HotSeatHit.Hit[0].Machine[0].$.MachineNumber,
          timestamp: new Date().toISOString()
        });
      }

    } catch(error) {
        console.log("Error in xml message : " + error)

    }
  });
}



app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log(`Worker ${process.pid} Socket.IO client connected`);
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
      console.error(`Worker ${process.pid} error: items is not an array.`);
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
      console.log(`Worker ${process.pid} error: Items is not an array for list ${listId}`);
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
