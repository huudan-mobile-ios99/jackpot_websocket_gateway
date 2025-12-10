
// "use strict";
// const mongoose = require('mongoose');
// const AutoIncrementFactory = require('mongoose-sequence');
// const username = "LeHuuDan99";
// const password = "3lyIxDXEzwCtzw2i";
// const database = "JPDesktop_Hit";
// const URL = `mongodb+srv://${username}:${password}@clustervegas.ym3zd.mongodb.net/${database}?retryWrites=true&w=majority`;
// const DB_OPTIONS = {
// };

// // 🔥 Use createConnection for AutoIncrement
// const connection = mongoose.createConnection(URL, DB_OPTIONS);
// const AutoIncrement = AutoIncrementFactory(connection);

// async function connectDB() {
//   const connectWithRetry = async () => {
//     try {
//       await mongoose.connect(URL, DB_OPTIONS);
//       console.log('✅ Connected to MongoDB JPDisplay U');

//       // Start Heartbeat
//       setInterval(async () => {
//         try {
//           await mongoose.connection.db.admin().ping();
//           console.log('[Heartbeat] MongoDB ping successful');
//         } catch (err) {
//           console.error('[Heartbeat] MongoDB ping failed:', err);
//         }
//       }, 60 * 60 * 1000); // every 30 min
//     } catch (err) {
//       console.error('❌ MongoDB connection failed. Retrying in 5 seconds...', err);
//       setTimeout(connectWithRetry, 5000);
//     }
//   };

//   connectWithRetry();

//   mongoose.connection.on('disconnected', () => {
//     console.warn('⚠️ MongoDB disconnected. Trying to reconnect...');
//   });

//   mongoose.connection.on('reconnected', () => {
//     console.log('✅ MongoDB reconnected U');
//   });

//   mongoose.connection.on('error', err => {
//     console.error('❌ MongoDB connection error:', err);
//   });
// }

// module.exports = {
//   connectDB,
//   URL,
//   AutoIncrement,
// };





















//NEW VERSION
"use strict";
const mongoose = require("mongoose");
const AutoIncrementFactory = require("mongoose-sequence");


// const username = "LeHuuDan99";
// const password = "3lyIxDXEzwCtzw2i";
// const database = "JPDesktop";
// const URL = `mongodb+srv://${username}:${password}@clustervegas.ym3zd.mongodb.net/${database}?retryWrites=true&w=majority`;








// const username = "huudanstorage_db_user";
// const password = "VouZvBqdKLuxiVtS";
// const database = "JPDesktop";
// const URL = `mongodb+srv://${username}:${password}@cluster0.qpzcnil.mongodb.net/${database}?retryWrites=true&w=majority&appName=Cluster0`;


const username = "lehuudan99";
const password = "iYMlvnLT5GxsNL0f";
const database = "JPDesktop1";
const URL = `mongodb+srv://${username}:${password}@cluster0.ys8vqbz.mongodb.net/${database}?retryWrites=true&w=majority&appName=Cluster0`;

const DB_OPTIONS = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // wait up to 30s for initial connect
  socketTimeoutMS: 60000,          // close sockets after 60s idle
  heartbeatFrequencyMS: 10000,     // heartbeat every 10s
  maxPoolSize: 20,                 // reasonable pool size
};

let AutoIncrement;

async function connectDB() {
  try {
    // 👇 ACTUALLY CONNECT TO DATABASE
    await mongoose.connect(URL, DB_OPTIONS);
    mongoose.set("debug", true);


    // 👇 INIT AUTO INCREMENT PLUGIN (after connect)
    AutoIncrement = AutoIncrementFactory(mongoose);
    console.log("✅ Connected to MongoDB JPDesktop SUB");

    // Optional: Start a heartbeat ping
    setInterval(async () => {
      try {
          await mongoose.connection.db.admin().ping();
          console.log("[Heartbeat] MongoDB SUB ping successful");
        } catch (err) {
          console.error("[Heartbeat] MongoDB SUB ping failed:", err.message);
        }
    }, 25 * 60 * 1000);

    // Connection lifecycle logs
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB SUB disconnected. Retrying...");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB SUB reconnected");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB SUB connection error:", err.message);
    });
  } catch (err) {
    console.error("❌ MongoDB SUB connection failed:", err.message);
    setTimeout(connectDB, 25000); // Retry after 25 seconds
  }
}

function getAutoIncrement() {
  return AutoIncrement;
}

module.exports = {
  connectDB,
  getAutoIncrement,
};
