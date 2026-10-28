const mongoose = require("mongoose");

const CAP = parseInt(process.env.CAP || "3", 10);

let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function connect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGO_URI, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

const Row =
  mongoose.models.Row ||
  mongoose.model(
    "Row",
    new mongoose.Schema({
      id: { type: String, unique: true, index: true },
      name: String,
      day: Number,
      ts: Number,
    })
  );

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await connect();

    if (req.method === "GET") {
      const me = String((req.query && req.query.me) || "");
      const rows = await Row.find({}).sort({ ts: 1 }).lean();
      return res.status(200).json(
        rows.map((r) => ({ name: r.name, day: r.day, ts: r.ts, mine: r.id === me }))
      );
    }

    const body = req.body || {};

    if (req.method === "POST") {
      const id = String(body.id || "").slice(0, 40);
      const name = String(body.name || "").trim().slice(0, 30);
      const day = Number(body.day);
      if (!id || !name || !Number.isInteger(day) || day < 0 || day > 4) {
        return res.status(400).json({ error: "بيانات غير صحيحة" });
      }
      const all = await Row.find({}).lean();
      const dup = all.some(
        (r) => r.id !== id && r.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (dup) return res.status(409).json({ error: "هذا الاسم مسجّل مسبقًا. أضف حرفًا من اسم الأب للتمييز." });
      const inDay = all.filter((r) => r.day === day && r.id !== id).length;
      if (inDay >= CAP) return res.status(409).json({ error: "اكتمل هذا اليوم." });
      await Row.findOneAndUpdate({ id }, { id, name, day, ts: Date.now() }, { upsert: true });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "بيانات غير صحيحة" });
      await Row.deleteOne({ id });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "خطأ بالسيرفر" });
  }
};
