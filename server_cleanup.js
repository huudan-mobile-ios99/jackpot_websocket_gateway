const schedule = require('node-schedule');

async function initializeCleanup(mongoose) {
  try {
    const InfoModel = require('./model/information_model');
    const HitModel = require('./model/hit_model');
    // Schedule cleanup job to run every 30 minutes
    schedule.scheduleJob('*/30 * * * *', async () => {
      try {
        if (mongoose.connection.readyState !== 1) {
          console.warn('⚠️ DB not connected. Skipping cleanup...');
          return; // Don't try to reconnect, let server handle it
        }

        // Cleanup InformationBroadcast collection
        const broadcastCount = await InfoModel.countDocuments();
        if (broadcastCount > 10) {
          const excessBroadcasts = broadcastCount - 10;
          const latestBroadcasts = await InfoModel.find()
            .sort({ timestamp: -1 })
            .limit(10)
            .select('_id');
          const latestBroadcastIds = latestBroadcasts.map(b => b._id);
          await InfoModel.deleteMany({ _id: { $nin: latestBroadcastIds } });
          console.log(`🗑 Deleted ${excessBroadcasts} old InformationBroadcast records`);
        } else {
          console.log('✅ No cleanup needed: InformationBroadcast has 10 or fewer records');
        }

        // Cleanup Hits collection
        const hitCount = await HitModel.countDocuments();
        if (hitCount > 10) {
          const excessHits = hitCount - 10;
          const latestHits = await HitModel.find()
            .sort({ timestamp: -1 })
            .limit(10)
            .select('_id');
          const latestHitIds = latestHits.map(h => h._id);
          await HitModel.deleteMany({ _id: { $nin: latestHitIds } });
          console.log(`🗑 Deleted ${excessHits} old Hits records`);
        } else {
          console.log('✅ No cleanup needed: Hits has 10 or fewer records');
        }

      } catch (error) {
        console.error('❌ Error during scheduled cleanup:', error);
      }
    });

    console.log('⏳ Cleanup job scheduled every 30 minutes');

  } catch (error) {
    console.error('❌ Failed to initialize cleanup:', error);
    process.exit(1);
  }
}

module.exports = { initializeCleanup };
