// models/Hit.js
const mongoose = require('mongoose');

const HitSchema = new mongoose.Schema({
  type: { type: String, enum: ['Jackpot', 'HotSeat'], required: true },
  jackpotId: { type: String, required: true },
  jackpotName: { type: String },
  value: { type: Number, required: true },
  machineNumber: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });


// Add unique compound index to prevent duplicates on machineNumber and value
HitSchema.index({ machineNumber: 1, value: 1 }, { unique: true });
// Indexes for efficient querying
HitSchema.index({ jackpotId: 1, type: 1, timestamp: -1 });


module.exports = mongoose.model('Hits', HitSchema);
