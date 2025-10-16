import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
cors: { origin: "*" } // allow all origins for testing
});

let latestSnapshots = [];

io.on('connection', socket => {
console.log(`Client connected: ${socket.id}`);

socket.on('save-data', snapshots => {
if (!Array.isArray(snapshots)) return;
latestSnapshots = snapshots;
console.log(`[SERVER] Received ${snapshots.length} snapshots from ${socket.id}`);
socket.broadcast.emit('load-data', latestSnapshots);
});

socket.on('disconnect', () => {
console.log(`Client disconnected: ${socket.id}`);
});
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
console.log(`Collab server running on http://localhost:${PORT}`);
});
