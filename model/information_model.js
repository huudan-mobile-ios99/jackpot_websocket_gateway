
const mongoose = require('mongoose');
const { AutoIncrement } = require('../mongo_config');

const JackpotSchema = new mongoose.Schema({
  jackpotId: { type: String, required: true },
  jackpotName: { type: String },
  value: { type: Number, required: true },
});

const InformationBroadcastSchema = new mongoose.Schema({
  logId: { type: Number, unique: true }, // Auto-incremented ID
  jackpots: [JackpotSchema], // Array of jackpot updates
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

// Add index for efficient querying
InformationBroadcastSchema.index({ timestamp: -1 });

// Apply auto-increment plugin for logId
InformationBroadcastSchema.plugin(AutoIncrement, { inc_field: 'logId' });

// Prevent model redefinition
module.exports = mongoose.models.InformationBroadcast || mongoose.model('InformationBroadcast', InformationBroadcastSchema);
