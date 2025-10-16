import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import * as Y from 'yjs';
import fetch from 'node-fetch';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(cookieParser());

// In-memory stores
const docs = new Map(); // projectId -> Y.Doc
const cursors = new Map(); // socketId -> { x, y, username, typing, mouseDown }
const chatHistory = new Map(); // projectId -> [{id, username, text, timestamp}]
const logs = []; // simple log array

// --- Helpers ---
async function validateUser(ssid) {
  try {
    if (!ssid) return null;
    const res = await fetch('https://ampmod.vercel.app/internalapi/session', {
      method: 'GET',
      headers: { Cookie: `ssid=${ssid}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.username;
  } catch (e) {
    logs.push(`[Auth Error] ${e.message}`);
    return null;
  }
}

async function isCollaborator(projectId, username) {
  try {
    const res = await fetch(`https://ampmod.vercel.app/internalapi/projects/${projectId}`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.collaborators?.includes(username);
  } catch (e) {
    logs.push(`[Project Check Error] ${e.message}`);
    return false;
  }
}

// --- Routes ---

// Simple login route for testing / example
app.post('/login', async (req, res) => {
  const { ssid } = req.body;
  const username = await validateUser(ssid);
  if (!username) {
    logs.push(`[Login Failed] ssid=${ssid}`);
    return res.status(401).json({ error: 'Invalid session' });
  }
  logs.push(`[Login Success] ${username}`);
  res.cookie('ssid', ssid, { httpOnly: true });
  return res.json({ message: 'Login successful', username });
});

// Show logs
app.get('/logs', (req, res) => {
  res.json({ logs });
});

// Health check
app.get('/', (req, res) => res.send('Collab server running (cookie-based auth + logs)'));

// --- Socket.IO ---
io.on('connection', (socket) => {
  logs.push(`[Socket Connected] ${socket.id}`);
  let currentDoc;
  let username;
  let projectId;

  socket.on('join-room', async ({ pid, ssid }) => {
    username = await validateUser(ssid);
    projectId = pid;

    if (!username) {
      logs.push(`[Join Failed Auth] socket=${socket.id} pid=${pid}`);
      return socket.emit('auth-failed');
    }

    const allowed = await isCollaborator(projectId, username);
    if (!allowed) {
      logs.push(`[Join Failed Collab] ${username} not allowed on project ${pid}`);
      return socket.emit('not-allowed');
    }

    logs.push(`[Join Success] ${username} joined project ${pid}`);

    if (!docs.has(projectId)) docs.set(projectId, new Y.Doc());
    currentDoc = docs.get(projectId);

    socket.join(projectId);

    socket.emit('init', Y.encodeStateAsUpdate(currentDoc));

    if (!chatHistory.has(projectId)) chatHistory.set(projectId, []);
    socket.emit('chat-history', chatHistory.get(projectId));

    socket.to(projectId).emit('user-joined', { username, id: socket.id });
  });

  socket.on('update', (update) => {
    if (!currentDoc) return;
    Y.applyUpdate(currentDoc, update);
    socket.to(projectId).emit('update', update);
  });

  socket.on('cursor', (data) => {
    cursors.set(socket.id, { ...data, username });
    socket.to(projectId).emit('cursor', { id: socket.id, ...data, username });
  });

  socket.on('chat', (text) => {
    if (!projectId || !username) return;
    const msg = { id: uuidv4(), username, text, timestamp: Date.now() };
    chatHistory.get(projectId).push(msg);
    io.to(projectId).emit('chat', msg);
  });

  socket.on('disconnect', () => {
    cursors.delete(socket.id);
    if (projectId && username) {
      socket.to(projectId).emit('user-left', { id: socket.id, username });
    }
    logs.push(`[Socket Disconnected] ${socket.id}`);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Collab server running on http://localhost:${PORT}`));
