var WebSocket = require('faye-websocket');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');
// socket.bind('9998');
var xml2js = require('xml2js');
var parser = new xml2js.Parser();
var builder = new xml2js.Builder();
const nconf = require('nconf');
nconf.file("config.json");
const fs = require('fs');
const zmq = require("zeromq");
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const path = require('path');
const WebSocket1 = require('ws');

var logging = true;
const softwareVersion = '1.0.5';
// List of WebSocket endpoints in order
const endpoints = [
  // 'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=ITTECH',
  // 'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Application',
  // 'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor',
  'ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=SUP-FLOOR',

];
let currentEndpointIndex = 0; // Start with first endpoint
let isConnecting = false; // Prevent multiple connection attempts
let reconnectTimer; // Timer for reconnection delay
const reconnectDelay = 1 * 60 * 1000; // 2 minutes in milliseconds
var hitsdb = [];
let publisher;
let wss;
let client; // Track the WebSocket client


// Create directories if they don't exist
['senthits', 'hits', 'hotseathits', 'rest', 'error'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
    console.log(`Created directory: ${dirPath}`);
  }
});


function connect() {
  if (isConnecting) return; // Avoid multiple connection attempts
  isConnecting = true;

  const endpoint = endpoints[currentEndpointIndex];
  console.log(`Attempting to connect to ${endpoint}`);
  client = new WebSocket.Client(endpoint);

  client.on('open', function() {
    console.log(`Connection established to ${endpoint}`);
    isConnecting = false;
    clearTimeout(reconnectTimer); // Clear any pending reconnect
  });

  client.on('message', function(message) {
    readXML(message.data, publisher, wss);
  });

  client.on('error', function(error) {
    console.log(`Error connecting to ${endpoint}: ${error}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });

  client.on('close', function(message) {
    console.log(`Connection closed to ${endpoint}: ${message.code} ${message.reason}`);
    isConnecting = false;
    scheduleNextEndpoint();
  });
}

function scheduleNextEndpoint() {
  // Move to the next endpoint
  currentEndpointIndex = (currentEndpointIndex + 1) % endpoints.length;
  console.log(`Scheduling switch to next endpoint: ${endpoints[currentEndpointIndex]} in ${reconnectDelay / 1000} seconds`);

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
  await publisher.bind("tcp://*:5556");
  console.log("Publisher bound to port 5556");
  return publisher;
}

function startWebSocketServer() {
  const wss = new WebSocket1.Server({ port: 8081 });
  console.log("Websocket Server started on port 8081");
  wss.on('connection', (ws) => {
    console.log('Client connected to server');
  });
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
  const message = JSON.stringify({ Id, Value });
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
    return `<MMC><Jackpot JackpotNumber="${obj.HotSeatHit.HotSeat[0].Id[0]}" JackpotName="${obj.HotSeatHit.HotSeat[0].PromotionName[0]}"><Level Name="Level 0" Number="0" Amount="${obj.HotSeatHit.Hit[0].Amount}"><Hit Amount="${obj.HotSeatHit.Hit[0].Amount}" Number="${obj.HotSeatHit.HotSeat[0].Machine[0].$.MachineNumber}" Name="Fever" Text="Congratulations"/></Level></Jackpot></MMC>`;
  } else {
    return `<MMC><Jackpot JackpotNumber="${obj.Jackpot[0].$.Id}" JackpotName="${obj.Jackpot[0].$.Name}"><Level Name="Level 0" Number="0" Amount="${obj.Jackpot[0].$.Value}"><Hit Amount="${obj.Hit[0].Amount[0]}" Number="${obj.Hit[0].Machine[0].$.MachineNumber}" Name="Fever" Text="Congratulations"/></Level></Jackpot></MMC>`;
  }
}

function lookupConf(jackpots, id) {
  for (let i in jackpots) {
    if (String(jackpots[i].id) === String(id)) {
      return { ...jackpots[i], port: Number(jackpots[i].port) };
    }
  }
  return undefined;
}

function readXML(msg, publisher, wss) {
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
        let count = 0;
        const intervalId = setInterval(() => {
          socket.send(xmlvb, 0, xmlvb.length, jpconf.port, jpconf.address);
          console.log(`Sent UDP message to ${jpconf.address}:${jpconf.port}`);
          count++;
          if (count === 5) clearInterval(intervalId);
        }, 200);
        if (logging) console.log('wrote hit to file');
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
        const jps = result.InformationBroadcast.JackpotList[0].Jackpot;
        jps.forEach(async jp => {
          if (hitsdb.indexOf(jp.$.Id) == -1) {
            const jpconf = lookupConf(jackpots, jp.$.Id);
            const xmlvb = createxml(jp, 0);
            socket.send(xmlvb, 0, xmlvb.length, jpconf.port, jpconf.address);
            await publishData(publisher, jp, wss);
          }
        });
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
          if (count === 3) {
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
          // fs.writeFile('./hotseathits/'+Date.now().toString()+'.xml', msg, err => {
          //   if (err) {
          //     console.error(err);
          //   }
          // });
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
    } catch (error) {
      console.log("Error in xml message: " + error);
    }
  });
}

console.log("Playtech Transmitter Version: ", softwareVersion);

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



// Handle test hit submission
socket.on('testHit', (testData) => {
  console.log('Received test hit data:', testData);
  // Determine the listId based on the testData
  const listId = testData.listId; // Assuming you send the listId along with the test data
  // Retrieve the list from the configuration
  const items = nconf.get(listId);
  // Find the corresponding item based on the testId
  const testItem = items.find((item) => item.id === testData.testId);
  if (testItem) {
    // Format XML data based on the listId
    let data;
    if (listId === 'jackpots') {
      // Format XML data for JackpotHit
      data = {
        JackpotHit: {
          $: {
            xmlns: 'http://IntelligentGaming/ThirdParty/Jackpots',
          },
          Jackpot: {
            $: {
              Id: testItem.id,
              Name: testItem.name,
              Value: testData.testAmount,
              Active: 'false',
              NextEventDateTime: '',
            },
          },
          Hit: {
            Amount: testData.testAmount,
            AmountPaidOut: testData.testAmount,
            CommunityPrizeValue: 0,
            CommunityPrizeAwardCount: 0,
            Time: new Date().toISOString(),
            Machine: {
              $: {
                MachineNumber: testData.testMachineNumber,
                CasinoId: '3',
                CasinoName: 'Vegas Club',
              },
              SerialNumber: 'DX138958V',
              Area: 'Slots',
              Bank: 'BK05',
              Location: testData.testMachineNumber,
              CabinetGameTheme: '5 Koi Legends',
              MachineManufacturer: 'Aristocrat',
            },
          },
        },
      };
    } else if (listId === 'hotseats') {
      // Format XML data for HotSeatHit
      data = {
        HotSeatHit: {
          $: {
            xmlns: 'http://IntelligentGaming/ThirdParty/Jackpots',
          },
          HotSeat: {
            Id: testItem.id,
            PromotionName: testItem.name,
            CasinoName: 'Vegas Club',
          },
          Hit: {
            Amount: testData.testAmount,
            AmountPaidOut: testData.testAmount,
            CommunityPrizeValue: 0,
            CommunityPrizeAwardCount: 0,
            Time: new Date().toISOString(),
            Machine: {
              $: {
                MachineNumber: testData.testMachineNumber,
                CasinoId: '0',
              },
              SerialNumber: 'DX138958V',
              Area: 'Slots',
              Bank: 'BK05',
              Location: testData.testMachineNumber,
              CabinetGameTheme: '5 Koi Legends',
              MachineManufacturer: 'Aristocrat',
            },
          },
        },
      };
    }
    // Convert data to XML
    const xmlData = builder.buildObject(data);
    // Log the formatted XML data
    //console.log('Formatted XML data:', xmlData);
    readXML(xmlData);
  } else {
    console.error(`Error: Item with id '${testData.testId}' not found in the list.`);
  }
});


const PORT = process.env.PORT || 8097;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

startServerAndPublishData();











// function checkAndEmitDefaultJackpotHit() {
//   const idList =[];
//   console.log('Emitting default jackpotHit');
//     io.emit('jackpotHit', {
//       id: 0,
//       name: "Frequent",
//       amount: 300,
//       machineNumber: "000",
//       timestamp: new Date().toISOString()
//     });
// }



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
