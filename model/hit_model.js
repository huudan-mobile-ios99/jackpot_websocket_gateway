// models/Hit.js
const mongoose = require('mongoose');
const { AutoIncrement } = require('../mongo_config');

const HitSchema = new mongoose.Schema({
  logId: { type: Number, unique: true },
  type: { type: String, enum: ['Jackpot', 'HotSeat'], required: true },
  jackpotId: { type: String, required: true },
  jackpotName: { type: String },
  value: { type: Number, required: true },
  machineNumber: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

// Add index for efficient querying
HitSchema.index({ jackpotId: 1, type: 1, timestamp: -1 });

// Apply auto-increment plugin for hitId
HitSchema.plugin(AutoIncrement, { inc_field: 'hitId' });

module.exports = mongoose.model('Hits', HitSchema);
