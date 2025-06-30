// models/InformationBroadcast.js
const mongoose = require('mongoose');
const { AutoIncrement } = require('../mongo_config');

const InformationBroadcastSchema = new mongoose.Schema({
  logId: { type: Number, unique: true }, // Auto-incremented ID
  jackpotId: { type: String, required: true }, // Jackpot ID (e.g., "0", "1", "34")
  jackpotName: { type: String }, // Jackpot name
  value: { type: Number, required: true }, // Jackpot value
  timestamp: { type: Date, default: Date.now }, // Timestamp of the update
}, { timestamps: true });

// Add index for efficient querying
InformationBroadcastSchema.index({ jackpotId: 1, timestamp: -1 });

// Apply auto-increment plugin for logId
InformationBroadcastSchema.plugin(AutoIncrement, { inc_field: 'logId' });

module.exports = mongoose.model('InformationBroadcasts', InformationBroadcastSchema);

