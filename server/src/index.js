import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: false
  })
);

const StateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

const StateModel = mongoose.model('State', StateSchema);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', async (_req, res) => {
  const doc = await StateModel.findOne({ key: 'default' }).lean();
  if (!doc) {
    return res.json({
      holidays: [],
      bookings: {},
      releases: {},
      blockedNextDay: {}
    });
  }
  return res.json(doc.data);
});

app.put('/api/state', async (req, res) => {
  const { holidays, bookings, releases, blockedNextDay } = req.body ?? {};

  const payload = {
    holidays: Array.isArray(holidays) ? holidays : [],
    bookings: bookings && typeof bookings === 'object' ? bookings : {},
    releases: releases && typeof releases === 'object' ? releases : {},
    blockedNextDay: blockedNextDay && typeof blockedNextDay === 'object' ? blockedNextDay : {}
  };

  await StateModel.updateOne(
    { key: 'default' },
    { $set: { data: payload } },
    { upsert: true }
  );

  res.json({ ok: true });
});

async function main() {
  await mongoose.connect(MONGODB_URI, {
    dbName: process.env.MONGODB_DB || undefined
  });
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

