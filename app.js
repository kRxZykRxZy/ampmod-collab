import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import * as Y from 'yjs';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// In-memory Yjs documents (per project)
const ydocs = new Map();
function getYDoc(projectId) {
  if (!ydocs.has(projectId)) ydocs.set(projectId, new Y.Doc());
  return ydocs.get(projectId);
}

io.on('connection', socket => {
  console.log(`Client connected: ${socket.id}`);
  let currentProjectId = null;

  // Join project room
  socket.on('join-project', projectId => {
    currentProjectId = projectId;
    const ydoc = getYDoc(projectId);

    // Send initial state to client
    socket.emit('init', Y.encodeStateAsUpdate(ydoc));

    // Receive Yjs updates from client
    socket.on('update', update => {
      Y.applyUpdate(ydoc, update);
      socket.broadcast.emit('update', { projectId, update });
    });
  });

  // --- Chat support ---
  socket.on('chat-message', ({ projectId, username, message }) => {
    if (!projectId || !message) return;
    socket.broadcast.emit('chat-message', { projectId, username, message });
    console.log(`[Chat] ${username}: ${message}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Collab server running on http://localhost:${PORT}`);
});
