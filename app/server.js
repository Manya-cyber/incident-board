require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('redis');
const { pool, createTable } = require('./models/Incident');
const authRoutes = require('./routes/auth'); // We'll make this next

// 1. Initialize Express App
const app = express();
const server = http.createServer(app);

// 2. Initialize Socket.io (with CORS for local testing)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 3. Connect to Redis
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});
redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.connect().then(() => console.log('✅ Connected to Redis'));

// 4. Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static('public'));

// 5. Import Routes (Auth)
app.use('/api/auth', authRoutes);

// 6. Initialize Database Table
createTable();

// 7. Socket.io Logic (The core real-time feature)
io.on('connection', async (socket) => {
  console.log('🟢 New client connected:', socket.id);

  // --- Send current state to the new user ---
  try {
    const data = await redisClient.get('incidents');
    if (data) {
      socket.emit('incidents:init', JSON.parse(data));
    } else {
      // If Redis is empty, load from PostgreSQL (for disaster recovery resilience)
      const res = await pool.query('SELECT * FROM incidents ORDER BY updated_at DESC');
      const incidents = res.rows;
      if (incidents.length > 0) {
        await redisClient.set('incidents', JSON.stringify(incidents));
        socket.emit('incidents:init', incidents);
      } else {
        socket.emit('incidents:init', []);
      }
    }
  } catch (err) {
    console.error('Error fetching initial data:', err);
    socket.emit('incidents:init', []);
  }

  // --- Listen for "CREATE" incident ---
  // --- Listen for "CREATE" incident ---
  socket.on('incident:create', async (data) => {
    try {
      // data now includes { id, title, status, description, created_by }
      const newIncident = {
        ...data,
        updated_at: new Date().toISOString()
      };

      // 1. Save to PostgreSQL (durable storage) - NOW INCLUDES created_by
      await pool.query(
        'INSERT INTO incidents (id, title, status, description, created_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET title = $2, status = $3, description = $4, created_by = $5, updated_at = $6',
        [newIncident.id, newIncident.title, newIncident.status, newIncident.description, newIncident.created_by, newIncident.updated_at]
      );

      // 2. Update Redis (fast shared state)
      let currentIncidents = await redisClient.get('incidents');
      let incidentsArray = currentIncidents ? JSON.parse(currentIncidents) : [];
      
      // Replace or add
      const existingIndex = incidentsArray.findIndex(inc => inc.id === newIncident.id);
      if (existingIndex !== -1) {
        incidentsArray[existingIndex] = newIncident;
      } else {
        incidentsArray.unshift(newIncident); // Add to top
      }
      await redisClient.set('incidents', JSON.stringify(incidentsArray));

      // 3. Broadcast to everyone EXCEPT the sender
      socket.broadcast.emit('incident:updated', newIncident);

    } catch (error) {
      console.error('Error in incident:create:', error);
      socket.emit('error', { message: 'Failed to create incident' });
    }
  });

  // --- Handle Disconnect ---
  socket.on('disconnect', () => {
    console.log('🔴 Client disconnected:', socket.id);
  });
});

// 8. Health Check (for AWS)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// 9. Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});