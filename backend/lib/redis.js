const { createClient } = require("redis");

// Local Redis by default (redis://localhost:6379); override with REDIS_URL
const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  // Fail fast when Redis is down instead of queueing commands forever
  disableOfflineQueue: true,
  socket: {
    keepAlive: 5000, // Sends a TCP keep-alive every 5 seconds
    reconnectStrategy: (retries) => {
      console.log(`🔄 Redis Reconnecting... Attempt: ${retries}`);
      return Math.min(retries * 200, 5000); // Wait longer between attempts
    },
  },
});

client.on("error", (err) => console.log("❌ Redis Client Error:", err));

// Connect without blocking the whole app start
client
  .connect()
  .then(() => {
    console.log("🚀 Redis Connected and Ready!");
  })
  .catch((err) => {
    console.error("🔴 Failed to connect to Redis:", err);
  });

module.exports = client; // Export so controllers can use it
