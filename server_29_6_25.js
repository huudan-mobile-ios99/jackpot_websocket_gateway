var WebSocket = require('faye-websocket');
const dgram = require('dgram');
const socket = dgram.createSocket('udp4');
// socket.bind('9999');
socket.bind('9998');
var xml2js = require('xml2js');
var parser = new xml2js.Parser();
var builder = new xml2js.Builder();
const nconf = require('nconf');
nconf.file("config.json");
// const jackpots = nconf.get("jackpots");
// console.log("Loaded jackpots:", jackpots);
const fs = require('fs');
const { version } = require('os');
const zmq = require("zeromq");

var logging = true;
const softwareVersion = '1.0.5';

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const path =require('path');
const WebSocket1 = require('ws');
// Create directories if they don't exist
['senthits', 'hits', 'hotseathits', 'rest', 'error'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
    console.log(`Created directory: ${dirPath}`);
  }
});


var hitsdb = [];
var db;
// UDP Server

socket.on('listening', function () {
	socket.setBroadcast(true);
});

// Define publisher in a scope accessible to both connect and readXML functions
let publisher;
let wss;

function connect() {
  // var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Application');// var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor');
  // var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor');// var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor');
  var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=ITTECH');// var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor');
    // var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor');// var client = new WebSocket.Client('ws://192.168.100.202/Interfaces/Media/JackpotsGateway?COMPUTERNAME=Floor');


  // Websocket server stuff
  client.on('error', function(message) {
    console.log("Error connecting to websocket .... " + message)
  });
  client.on('open', function(message) {
    console.log('Connection established to websocket!');
  });
  client.on('message', function(message) {
    readXML(message.data, publisher, wss);
  });
  client.on('close', function(message) {
    console.log('Connection closed!', message.code, message.reason);
    // reconnect to server on disconnect and retry every 5 seconds...
    setTimeout(function() {
      connect();
    }, 5 * 60 * 1000); // 5 minutes
  });
}

// Start the server and publish data for signs4u components odometer clients
// startServerAndPublishData();
// Call startServerAndPublishData to initialize the publisher
startServerAndPublishData()
    .then(() => {
        connect(); // Call connect function after publisher is initialized
        // setInterval(checkAndEmitDefaultJackpotHit,30000); // Check every 10 seconds
    })
    .catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });

async function startServerAndPublishData() {
    try {
        publisher = await startPublisherServer();
        wss = startWebSocketServer();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}
// setup a publisher for odometer values to send to html-item clients
async function startPublisherServer() {
  const publisher = new zmq.Publisher();

  // Bind the publisher to a TCP port
  await publisher.bind("tcp://*:5556");
  console.log("Publisher bound to port 5556");
  // await publisher.bind("tcp://*:5555");
  // console.log("Publisher bound to port 5555");

  return publisher;
}
// Function to start WebSocket server
function startWebSocketServer() {
  wss = new WebSocket1.Server({ port: 8081 });
  console.log("Websocket Server started on port 8081");
  // wss = new WebSocket1.Server({ port: 8080 });
  // console.log("Websocket Server started on port 8080");

  wss.on('connection', (ws) => {
      console.log('Client connected to server');
  });

  return wss;
}

// Maintain a queue for pending messages
const messageQueue = [];
let isSending = false; // Flag to track whether a message is currently being sent

// Function to handle sending messages
async function sendNextMessage(publisher, wss) {
    // If no messages in the queue or already sending a message, return
    if (messageQueue.length === 0 || isSending) {
        return;
    }

    // Set the flag to indicate that a message is being sent
    isSending = true;

    // Get the next message from the queue
    const [topic, message] = messageQueue.shift();

    // Send the message
    try {
        await publisher.send([topic, message]);
        //console.log("Message sent:", message);
    } catch (error) {
        console.error("Error sending message:", error);
    }

    // Reset the flag since the message sending is complete
    isSending = false;

    // Send the next message in the queue recursively
    sendNextMessage(publisher, wss);
}

// function that sends odometer values to the Cnario html item
async function publishData(publisher, obj, wss) {
  if (!publisher) {
    throw new Error("Publisher is not initialized. Please start the publisher server first.");
  }
  // console.log("object in publish data: ",obj);
  const Id = obj.$.Id;
    const Value = obj.$.Value;

    const message = JSON.stringify({ Id, Value });
    // console.log("object in message: ",message);
    // console.log("Adding message to queue:", message);
    messageQueue.push(["topic", message]);
    // console.log("message queue: ",messageQueue);
    // If not currently sending a message, start sending messages
    if (!isSending) {
        sendNextMessage(publisher, wss);
    }
    //console.log("wss : ",wss)
    // Broadcast message to all WebSocket clients
    if (wss) {
      // console.log("sending message: ",message);
      wss.clients.forEach((client) => {
          if (client.readyState === WebSocket1.OPEN) {
            // console.log("send mesaage to client: ",client)
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
    // log hits
    // fs.writeFile('./senthits/HotSeat'+Date.now().toString()+'.xml', str, err => {
    //   if (err) {
    //     console.error(err);
    //   }
    // });
    return str

  } else {

    var str='<MMC><Jackpot JackpotNumber = "' + obj.Jackpot[0].$.Id + '" JackpotName = "' + obj.Jackpot[0].$.Name + '"><Level Name = "Level 0" Number = "0" Amount = "' + obj.Jackpot[0].$.Value + '"><Hit Amount = "' + obj.Hit[0].Amount[0] + '" Number = "' + obj.Hit[0].Machine[0].$.MachineNumber + '" Name = "Fever" Text = "Congratulations"/></Level></Jackpot></MMC>';
    // log hits
    // fs.writeFile('./senthits/Hit'+Date.now().toString()+'.xml', str, err => {
    //   if (err) {
    //     console.error(err);
    //   }
    // });
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
// function lookupConf(jackpots, id) {
//   for (i in jackpots) {
//     if (jackpots[i].id == id) return jackpots[i];
//   }
// }

// function for reading the incomming messages and process the data accordingly
function readXML(msg, publisher, wss) {
  // console.log("READXML PUBLISHER: ",publisher);
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
          if (count === 5) {
            clearInterval(intervalId); // Stop the interval after 4 calls
          }
        }, 200);

        if(logging) {
          // log hits
          console.log('wrote hit to file');
          fs.writeFile('./hits/'+Date.now().toString()+'.xml', msg, err => {
            if (err) {
              console.error(err);
            }
          });
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
          // publish data to html-item clients
          //const publisher = await startPublisherServer();
          // console.log("wss in readxml: ",wss);
          // Publish data
          await publishData(publisher, jp, wss);
        })
        if(logging){
          // log hotseats
          // console.log('wrote informationbroadcast to file');
          fs.writeFile('./rest/'+Date.now().toString()+'.xml', msg, err => {
            if (err) {
              console.error(err);
            }
          });
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
            // clearInterval(intervalId); // Stop the interval after 5 calls
          }
        }, 200);

        if(logging){
          // log hotseats
          console.log('wrote hotseat to file');
          fs.writeFile('./hotseathits/'+Date.now().toString()+'.xml', msg, err => {
            if (err) {
              console.error(err);
            }
          });
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
        fs.writeFile('./error/'+Date.now().toString()+'.xml', msg, err => {
          if (err) {
            console.error(err);
          }
        });
    }
  });
}


console.log("Playtech Transmitter Version: ", softwareVersion);

// connect to the websocket...
//connect();

// testje = fs.readFile('test.xml', 'utf-8', function(error, data){
//   console.log(data);
//   readXML(data);
// });

// Serve static files (e.g., Bootstrap)
app.use(express.static('public'));

// Socket.io connection handling
io.on('connection', (socket) => {
  // Send the initial configuration to the client
  socket.emit('initialConfig', {
    jackpots: nconf.get('jackpots'),
    hotseats: nconf.get('hotseats'),
  });

  // Handle updates to the configuration
  socket.on('updateConfig', ({ listId, oldItemId, newItemId, name, address, port }) => {
    // Retrieve the list from the configuration
    const items = nconf.get(listId);

    // Log the received data
    console.log('Received updateConfig event with data:', { listId, oldItemId, newItemId, name, address, port });

    // Check if items is an array before mapping over it
    if (Array.isArray(items)) {
      // Update the specified item
      const updatedItems = items.map((item) => {
        if (item.id === oldItemId) {
          return {
            id: newItemId,
            name: name,
            address: address,
            port: port,
          };
        }
        return item;
      });

      // Log the updated items
      console.log('Updated items:', updatedItems);

      // Update the configuration with the modified list
      nconf.set(listId, updatedItems);
      nconf.save();

      // Broadcast the updated configuration to all clients
      io.emit('updatedConfig', {
        jackpots: nconf.get('jackpots'),
        hotseats: nconf.get('hotseats'),
      });
    } else {
      // Log an error if items is not an array
      console.error('Error: items is not an array.');
    }
  });


  // Handle item deletion from the configuration
  socket.on('deleteConfig', ({ listId, itemId }, callback) => {
    console.log(`Received deleteConfig request for item with ID ${itemId} from list ${listId}`);

    // Retrieve the list from the configuration
    const items = nconf.get(listId);

    // Check if items is an array before filtering it
    if (Array.isArray(items)) {
      // Filter out the item to be deleted
      const updatedItems = items.filter((item) => item.id !== itemId);

      // Update the configuration with the modified list
      nconf.set(listId, updatedItems);
      nconf.save();

      // Broadcast the updated configuration to all clients
      io.emit('updatedConfig', {
        jackpots: nconf.get('jackpots'),
        hotseats: nconf.get('hotseats'),
      });

      console.log(`Item with ID ${itemId} deleted successfully from list ${listId}`);
      callback({ success: true, message: 'Item deleted successfully.' });
    } else {
      console.log(`Error: Items is not an array for list ${listId}`);
      callback({ success: false, message: 'Error deleting item.' });
    }
  });


  // Handle adding a new item to the configuration
  socket.on('addConfig', ({ listId, id, name, address, port }) => {
    console.log(`Received addConfig event. List ID: ${listId}, ID: ${id}, Name: ${name}, Address: ${address}, Port: ${port}`);

    // Retrieve the list from the configuration
    const items = nconf.get(listId);

    // Check if items is an array before pushing a new item
    if (Array.isArray(items)) {
      // Create the new item
      const newItem = {
        id: id,
        name: name,
        address: address,
        port: port,
      };

      // Add the new item to the list
      items.push(newItem);

      // Update the configuration with the modified list
      nconf.set(listId, items);
      nconf.save();

      // Broadcast the updated configuration to all clients
      io.emit('updatedConfig', {
        jackpots: nconf.get('jackpots'),
        hotseats: nconf.get('hotseats'),
      });
    }
  });



// Handle test hit submission
socket.on('testHit', (testData) => {
  // console.log('Received test hit data:', testData);

  // // Determine the listId based on the testData
  // const listId = testData.listId; // Assuming you send the listId along with the test data

  // // Retrieve the list from the configuration
  // const items = nconf.get(listId);

  // // Find the corresponding item based on the testId
  // const testItem = items.find((item) => item.id === testData.testId);

  // if (testItem) {
  //   // Format XML data based on the listId
  //   let data;
  //   if (listId === 'jackpots') {
  //     // Format XML data for JackpotHit
  //     data = {
  //       JackpotHit: {
  //         $: {
  //           xmlns: 'http://IntelligentGaming/ThirdParty/Jackpots',
  //         },
  //         Jackpot: {
  //           $: {
  //             Id: testItem.id,
  //             Name: testItem.name,
  //             Value: testData.testAmount,
  //             Active: 'false',
  //             NextEventDateTime: '',
  //           },
  //         },
  //         Hit: {
  //           Amount: testData.testAmount,
  //           AmountPaidOut: testData.testAmount,
  //           CommunityPrizeValue: 0,
  //           CommunityPrizeAwardCount: 0,
  //           Time: new Date().toISOString(),
  //           Machine: {
  //             $: {
  //               MachineNumber: testData.testMachineNumber,
  //               CasinoId: '3',
  //               CasinoName: 'Vegas Club',
  //             },
  //             SerialNumber: 'DX138958V',
  //             Area: 'Slots',
  //             Bank: 'BK05',
  //             Location: testData.testMachineNumber,
  //             CabinetGameTheme: '5 Koi Legends',
  //             MachineManufacturer: 'Aristocrat',
  //           },
  //         },
  //       },
  //     };
  //   } else if (listId === 'hotseats') {
  //     // Format XML data for HotSeatHit
  //     data = {
  //       HotSeatHit: {
  //         $: {
  //           xmlns: 'http://IntelligentGaming/ThirdParty/Jackpots',
  //         },
  //         HotSeat: {
  //           Id: testItem.id,
  //           PromotionName: testItem.name,
  //           CasinoName: 'Vegas Club',
  //         },
  //         Hit: {
  //           Amount: testData.testAmount,
  //           AmountPaidOut: testData.testAmount,
  //           CommunityPrizeValue: 0,
  //           CommunityPrizeAwardCount: 0,
  //           Time: new Date().toISOString(),
  //           Machine: {
  //             $: {
  //               MachineNumber: testData.testMachineNumber,
  //               CasinoId: '0',
  //             },
  //             SerialNumber: 'DX138958V',
  //             Area: 'Slots',
  //             Bank: 'BK05',
  //             Location: testData.testMachineNumber,
  //             CabinetGameTheme: '5 Koi Legends',
  //             MachineManufacturer: 'Aristocrat',
  //           },
  //         },
  //       },
  //     };
  //   }

  //   // Convert data to XML
  //   const xmlData = builder.buildObject(data);

  //   // Log the formatted XML data
  //   //console.log('Formatted XML data:', xmlData);
  //   readXML(xmlData);


  // } else {
  //   console.error(`Error: Item with id '${testData.testId}' not found in the list.`);
  // }
});

});
// Start the server
const PORT = process.env.PORT || 8097;
// const PORT = process.env.PORT || 8097;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});



// function checkAndEmitDefaultJackpotHit() {
//   const idList =[];
//   console.log('Emitting default jackpotHit');
//     io.emit('jackpotHit', {
//       id: 0,
//       name: "Frequent",
//       amount: 333,
//       machineNumber: "0000",
//       timestamp: new Date().toISOString()
//     });
// }



function checkAndEmitDefaultJackpotHit() {
  console.log('Emitting default jackpotHit');
  let availableIds = [0];
  // let availableIds = [80,81,88,89,109,119]; //TEST HOTSEAT

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
    amount: 322.11,
    machineNumber: "0000",
    timestamp: new Date().toISOString()
  });
}
