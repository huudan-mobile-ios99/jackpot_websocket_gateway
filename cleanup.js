const schedule = require('node-schedule');

// Initialize cleanup after connecting to MongoDB
async function initializeCleanup() {
  try {
    // Connect to MongoDB
    require('./mongo_config').connectDB();
    const InfoModel = require('./model/information_model'); // For InformationBroadcast Schema
    const HitModel = require('./model/hit_model'); // For JackpotHit and HotSeatHit Schema

    // Schedule cleanup job to run every hour
    schedule.scheduleJob('0 0 * * * *', async () => {
      try {
        // Cleanup InformationBroadcast collection
        const broadcastCount = await InfoModel.countDocuments();
        if (broadcastCount > 100) {
          const excess = broadcastCount - 100;
          // Get the 10 latest records to exclude
          const latestBroadcasts = await InfoModel.find()
            .sort({ timestamp: -1 }) // Newest first
            .limit(10)
            .select('_id');
          const latestBroadcastIds = latestBroadcasts.map(b => b._id);
          // Delete oldest records, excluding the 10 latest
          const oldestBroadcasts = await InfoModel.find({
            _id: { $nin: latestBroadcastIds } // Exclude the 10 latest
          })
            .sort({ timestamp: 1 }) // Oldest first
            .limit(excess)
            .select('_id');
          await InfoModel.deleteMany({ _id: { $in: oldestBroadcasts.map(b => b._id) } });
          console.log(`Deleted ${excess} oldest InformationBroadcast records (preserving 10 latest) to maintain 200-record limit`);
        }

        // Cleanup Hit collection
        const hitCount = await HitModel.countDocuments();
        if (hitCount > 100) {
          const excess = hitCount - 100;
          // Get the 5 latest records to exclude
          const latestHits = await HitModel.find()
            .sort({ timestamp: -1 }) // Newest first
            .limit(10)
            .select('_id');
          const latestHitIds = latestHits.map(h => h._id);
          // Delete oldest records, excluding the 5 latest
          const oldestHits = await HitModel.find({
            _id: { $nin: latestHitIds } // Exclude the 5 latest
          })
            .sort({ timestamp: 1 }) // Oldest first
            .limit(excess)
            .select('_id');
          await HitModel.deleteMany({ _id: { $in: oldestHits.map(h => h._id) } });
          console.log(`Deleted ${excess} oldest Hit records (preserving 5 latest) to maintain 100-record limit`);
        }
      } catch (error) {
        console.error('Error during scheduled cleanup:', error);
      }
    });
    console.log('Cleanup job scheduled to run every hour');
  } catch (error) {
    console.error('Failed to initialize cleanup:', error);
    process.exit(1);
  }
}

// Export the initialize function
module.exports = { initializeCleanup };
