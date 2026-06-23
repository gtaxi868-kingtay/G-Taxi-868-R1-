import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config";
import { getRedis, closeRedis } from "./redis-client";
import { getWalletBalance, bustWalletCache } from "./wallet-cache";
import { findNearbyDrivers, markDriverOffline } from "./driver-matching";
import { loadGeofenceZones, isInZone, findClosestZone } from "./geofence";
import { ingestGpsUpdate, persistGpsUpdate } from "./gps-ingest";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), memory: process.memoryUsage().rss });
});

app.get("/wallet/:userId", async (req, res) => {
  try {
    const balance = await getWalletBalance(req.params.userId);
    res.json({ user_id: req.params.userId, balance_cents: balance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/wallet/:userId/bust", async (req, res) => {
  try {
    await bustWalletCache(req.params.userId);
    res.json({ busted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/drivers/nearby", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseInt(req.query.radius as string, 10) || 5000;

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "lat and lng query params required" });
      return;
    }

    const drivers = await findNearbyDrivers(lat, lng, radius);
    res.json({ drivers, count: drivers.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/drivers/:driverId/offline", async (req, res) => {
  try {
    await markDriverOffline(req.params.driverId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/gps", async (req, res) => {
  try {
    const { driverId, lat, lng, heading } = req.body;
    if (!driverId || lat == null || lng == null) {
      res.status(400).json({ error: "driverId, lat, lng required" });
      return;
    }

    const update = { driverId, lat, lng, heading: heading || 0, timestamp: Date.now() };
    if (!ingestGpsUpdate(update)) {
      res.json({ deduplicated: true });
      return;
    }

    await persistGpsUpdate(driverId, lat, lng, heading || 0);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/geofence/zones", async (_req, res) => {
  try {
    const zones = await loadGeofenceZones();
    res.json({ zones });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/geofence/check", async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      res.status(400).json({ error: "lat, lng required" });
      return;
    }

    const zones = await loadGeofenceZones();
    const inZones = zones.filter((z) => isInZone(lat, lng, z)).map((z) => z.name);
    const closest = findClosestZone(lat, lng);

    res.json({ in_zones: inZones, closest_zone: closest?.name || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const wsClients = new Map<string, WebSocket>();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const driverId = url.searchParams.get("driverId");

  if (driverId) {
    wsClients.set(driverId, ws);
    console.log(`[WS] Driver ${driverId} connected`);

    ws.on("close", () => {
      wsClients.delete(driverId);
      console.log(`[WS] Driver ${driverId} disconnected`);
    });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "gps") {
          const update = { driverId, lat: msg.lat, lng: msg.lng, heading: msg.heading || 0, timestamp: Date.now() };
          if (ingestGpsUpdate(update)) {
            await persistGpsUpdate(driverId, msg.lat, msg.lng, msg.heading || 0);
          }
        }
      } catch {
        // ignore bad messages
      }
    });
  } else {
    ws.close(4000, "driverId query param required");
  }
});

export function broadcastDriverLocation(driverId: string, lat: number, lng: number, heading: number): void {
  const payload = JSON.stringify({ type: "driver_location", driverId, lat, lng, heading });
  for (const [id, ws] of wsClients) {
    if (id !== driverId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

async function warmUp(): Promise<void> {
  try {
    const redis = getRedis();
    await redis.ping();
    console.log("[Warm] Redis connected and ready");
    await loadGeofenceZones();
    console.log("[Warm] Geofence zones loaded");
  } catch (err) {
    console.warn("[Warm] Redis not available yet (will retry on demand):", err);
  }
}

server.listen(config.port, () => {
  console.log(`[WarmBrain] Listening on port ${config.port}`);
  warmUp();
});

process.on("SIGTERM", async () => {
  console.log("[WarmBrain] Shutting down...");
  wss.close();
  await closeRedis();
  server.close(() => process.exit(0));
});

process.on("SIGINT", async () => {
  console.log("[WarmBrain] Shutting down...");
  wss.close();
  await closeRedis();
  server.close(() => process.exit(0));
});

export { app, server };
