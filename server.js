require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const fs       = require("fs");
const path     = require("path");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = "https://estampadoro-backend-production.up.railway.app";

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── PERSISTENCIA EN ARCHIVO JSON ────────────────────────────────────────────
// Los saldos se guardan en disco — sobreviven reinicios del servidor
const DB_FILE = path.join(__dirname, "pagos_pendientes.json");

function leerDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { pagos: {}, aplicados: [] }; }
}
function guardarDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
  catch(e) { console.error("Error guardando DB:", e.message); }
}

async function acreditarSaldo(userId, monto, paymentId) {
  if (!userId || !monto) return;
  const db  = leerDB();
  const pid = String(paymentId || "");

  // Evitar duplicados — solo para IDs numéricos reales de MP
  if (pid && /^\d{10,}$/.test(pid) && db.aplicados.includes(pid)) {
    console.log(`[saldo] Pago ${pid} ya aplicado`);
    return;
  }
  if (pid && /^\d{10,}$/.test(pid)) db.aplicados.push(pid);

  db.pagos[userId] = (db.pagos[userId] || 0) + Number(monto);
  guardarDB(db);
  console.log(`✅ $${monto} MXN → @${userId} | Pendiente: $${db.pagos[userId]}`);
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ app: "ESTAMPADORO Backend", status: "online", version: "3.0.0" });
});

// ─── GET /pagar?userId=xxx&monto=50 ──────────────────────────────────────────
app.get("/pagar", async (req, res) => {
  const { userId, monto } = req.query;
  if (!userId || !monto) return res.status(400).send("Faltan parámetros");
  try {
    const preference = new Preference(client);
    const result = await preference.create({ body: {
      items: [{
        title:       `Recarga ESTAMPADORO · $${monto} MXN`,
        quantity:    1,
        currency_id: "MXN",
        unit_price:  Number(monto),
      }],
      metadata: { user_id: userId, monto: Number(monto) },
      back_urls: {
        success: `${BASE}/pago-exitoso?userId=${userId}&monto=${monto}`,
        failure: `${BASE}/pago-fallido`,
        pending: `${BASE}/pago-pendiente?userId=${userId}&monto=${monto}`,
      },
      notification_url: `${BASE}/webhook`,
    }});
    res.redirect(result.init_point);
  } catch (err) {
    console.error("[pagar]", err.message);
    res.status(500).send(`Error: ${err.message}`);
  }
});

// ─── GET /pago-exitoso ────────────────────────────────────────────────────────
app.get("/pago-exitoso", async (req, res) => {
  const { userId, monto, payment_id } = req.query;
  if (userId && monto) {
    await acreditarSaldo(userId, monto, payment_id || `redirect-${Date.now()}`);
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Pago exitoso – ESTAMPADORO</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:sans-serif;background:#0B0F1A;color:#E8EDF7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#141929;border:1px solid #22C55E44;border-radius:16px;padding:36px 28px;max-width:380px;width:100%;text-align:center;box-shadow:0 0 40px #22C55E15}
    h1{font-size:22px;font-weight:700;color:#22C55E;margin-bottom:8px}
    p{font-size:14px;color:#8892AB;line-height:1.6;margin-bottom:6px}
    .amount{font-size:36px;font-weight:900;color:#FFD700;margin:12px 0;font-family:sans-serif}
    .btn{display:inline-block;margin-top:20px;background:#FF6B35;color:#fff;border:none;border-radius:10px;padding:13px 28px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none}
    .note{margin-top:14px;font-size:12px;color:#4B5470}
  </style></head><body>
  <div class="card">
    <div style="font-size:56px;margin-bottom:16px">✅</div>
    <h1>¡Pago exitoso!</h1>
    <p>Se acreditaron</p>
    <div class="amount">$${monto} MXN</div>
    <p>a la cuenta <strong style="color:#E8EDF7">@${userId}</strong></p>
    <p class="note">Regresa a ESTAMPADORO y toca el botón<br><strong style="color:#009EE3">🔄 Verificar pago</strong> para ver tu nuevo saldo</p>
    <a class="btn" href="javascript:window.close()">Cerrar y regresar →</a>
  </div>
  <script>setTimeout(()=>window.close(),4000);</script>
  </body></html>`);
});

// ─── GET /pago-pendiente ──────────────────────────────────────────────────────
app.get("/pago-pendiente", async (req, res) => {
  const { userId, monto } = req.query;
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pago pendiente</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0B0F1A;color:#E8EDF7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#141929;border:1px solid #F59E0B44;border-radius:16px;padding:36px 28px;max-width:380px;width:100%;text-align:center}</style></head>
  <body><div class="card">
    <div style="font-size:56px;margin-bottom:16px">⏳</div>
    <h1 style="font-size:20px;color:#F59E0B;margin-bottom:10px">Pago en proceso</h1>
    <p style="font-size:14px;color:#8892AB;line-height:1.7">Tu pago de <strong style="color:#FFD700">$${monto} MXN</strong> está siendo procesado.<br>El saldo se acreditará automáticamente cuando se confirme (OXXO: hasta 24 hrs, SPEI: minutos).<br><br>Cierra esta pestaña y regresa a la app. Toca <strong style="color:#009EE3">🔄 Verificar pago</strong> cuando hayas completado el pago.</p>
  </div></body></html>`);
});

// ─── GET /pago-fallido ────────────────────────────────────────────────────────
app.get("/pago-fallido", (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pago fallido</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#0B0F1A;color:#E8EDF7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#141929;border:1px solid #EF444444;border-radius:16px;padding:36px 28px;max-width:380px;width:100%;text-align:center}</style></head>
  <body><div class="card">
    <div style="font-size:56px;margin-bottom:16px">❌</div>
    <h1 style="font-size:20px;color:#EF4444;margin-bottom:10px">Pago no completado</h1>
    <p style="font-size:14px;color:#8892AB;line-height:1.7">No se realizó ningún cargo a tu cuenta.<br>Cierra esta pestaña e intenta de nuevo desde ESTAMPADORO.</p>
  </div></body></html>`);
});

// ─── POST /webhook ────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const { type, data } = req.body;
    if (type !== "payment" || !data?.id) return;
    const payment = new Payment(client);
    const info    = await payment.get({ id: data.id });
    if (info.status === "approved") {
      await acreditarSaldo(
        info.metadata?.user_id,
        info.metadata?.monto || info.transaction_amount,
        String(info.id)
      );
    }
  } catch (err) { console.error("[webhook]", err.message); }
});

// ─── GET /saldo/:userId ───────────────────────────────────────────────────────
app.get("/saldo/:userId", (req, res) => {
  const db    = leerDB();
  const saldo = db.pagos[req.params.userId] || 0;
  res.json({ userId: req.params.userId, saldo });
});

// ─── POST /reset-saldo/:userId ────────────────────────────────────────────────
app.post("/reset-saldo/:userId", (req, res) => {
  const db        = leerDB();
  const prevSaldo = db.pagos[req.params.userId] || 0;
  db.pagos[req.params.userId] = 0;
  guardarDB(db);
  console.log(`🔄 @${req.params.userId} sincronizado ($${prevSaldo})`);
  res.json({ ok: true, synced: prevSaldo });
});

// ─── POST /soporte ────────────────────────────────────────────────────────────
app.post("/soporte", (req, res) => {
  const { userId, tipo, mensaje, email } = req.body;
  if (!userId || !mensaje) return res.status(400).json({ error: "Faltan campos" });
  const ticket = {
    id:      `TKT-${Date.now()}`,
    userId,
    tipo:    tipo || "general",
    mensaje,
    email:   email || "",
    fecha:   new Date().toISOString(),
    status:  "abierto",
  };
  // Guardar ticket en archivo
  const TICKETS_FILE = path.join(__dirname, "tickets_soporte.json");
  let tickets = [];
  try { tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf8")); } catch {}
  tickets.push(ticket);
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
  console.log(`🎫 Ticket ${ticket.id} de @${userId}: ${tipo}`);
  res.json({ ok: true, ticketId: ticket.id });
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ESTAMPADORO Backend v3.0 en puerto ${PORT}`);
  console.log(`   MP Access Token: ${process.env.MP_ACCESS_TOKEN ? "✅" : "❌ FALTA"}`);
  console.log(`   DB file: ${DB_FILE}`);
});
