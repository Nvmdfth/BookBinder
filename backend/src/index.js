const { createApp } = require('./app');
const { initDb } = require('./db/db');

const PORT = process.env.PORT || 5000;

const app = createApp();

// Boot Initializations
async function startServer() {
  try {
    // 1. Initial migration checks & seeding
    await initDb();

    // 2. Start Listener
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 BookBinder Backend listening on HTTP port: ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Server startup failed due to database errors:', error);
    process.exit(1);
  }
}

startServer();
