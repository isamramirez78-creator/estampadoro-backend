require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = "https://estampadoro-backend-production.up.railway.app";

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Saldos en memoria (reemplazar por BD en producción)
const saldos = {};
const pagosAplicados = new Set();

async function acreditarSaldo(userId, monto, paymentId) {
  if (pagosAplicados.has(String(paymentId))) return;
  pagosAplicados.add(String(paymentId));
  saldos[userId] = (saldos[userId] || 0) + Number(monto);
  console.log(`✅ Acreditados $${monto} MXN → @${userId} | Total: $${saldos[userId]}`);
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ app: "ESTAMPADORO Backend", status: "online", version: "2.0.0" });
});

// ── GET /pagar?userId=xxx&monto=50 ───────────────────────────────────────────
// El artefacto abre esta URL en una nueva pestaña — aquí se crea la preferencia
// y se redirige directo al checkout de Mercado Pago
app.get("/pagar", async (req, res) => {
  const { userId, monto } = req.query;
  if (!userId || !monto) {
    return res.status(400).send("Faltan parámetros: userId y monto");
  }
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
    // Redirige directo al checkout — no hace falta JS ni fetch
    res.redirect(result.init_point);
  } catch (err) {
    console.error("[pagar]", err.message);
    res.status(500).send(`Error al crear el pago: ${err.message}`);
  }
});

// ── GET /pago-exitoso ─────────────────────────────────────────────────────────
app.get("/pago-exitoso", async (req, res) => {
  const { userId, monto, payment_id, status } = req.query;
  if (status === "approved" && userId && monto) {
    await acreditarSaldo(userId, monto, payment_id || `manual-${Date.now()}`);
  }
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Pago exitoso – ESTAMPADORO</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:sans-serif;background:#0B0F1A;color:#E8EDF7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#141929;border:1px solid #22C55E44;border-radius:16px;padding:36px 28px;max-width:360px;width:100%;text-align:center}
    .icon{font-size:56px;margin-bottom:16px}
    h1{font-size:22px;font-weight:700;color:#22C55E;margin-bottom:8px}
    p{font-size:14px;color:#8892AB;line-height:1.6;margin-bottom:6px}
    .amount{font-size:32px;font-weight:900;color:#FFD700;margin:12px 0}
    .btn{display:inline-block;margin-top:20px;background:#FF6B35;color:#fff;border:none;border-radius:10px;padding:12px 28px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none}
  </style></head><body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>¡Pago exitoso!</h1>
    <p>Se acreditaron</p>
    <div class="amount">$${monto} MXN</div>
    <p>a la cuenta <strong>@${userId}</strong></p>
    <p style="margin-top:12px;font-size:13px">Ya puedes cerrar esta pestaña y regresar a ESTAMPADORO</p>
    <a class="btn" href="javascript:window.close()">Cerrar esta pestaña</a>
  </div>
  </body></html>`);
});

// ── GET /pago-pendiente ───────────────────────────────────────────────────────
app.get("/pago-pendiente", (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pago pendiente</title>
  <style>body{font-family:sans-serif;background:#0B0F1A;color:#E8EDF7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#141929;border:1px solid #F59E0B44;border-radius:16px;padding:36px 28px;max-width:360px;width:100%;text-align:center}</style></head>
  <body><div class="card">
    <div style="font-size:56px;margin-bottom:16px">⏳</div>
    <h1 style="font-size:20px;color:#F59E0B;margin-bottom:8px">Pago pendiente</h1>
    <p style="font-size:14px;color:#8892AB;line-height:1.6">Tu pago está siendo procesado (OXXO/SPEI).<br>El saldo se acreditará automáticamente cuando se confirme.<br><br>Puedes cerrar esta pestaña.</p>
  </div></body></html>`);
});

// ── GET /pago-fallido ─────────────────────────────────────────────────────────
app.get("/pago-fallido", (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pago fallido</title>
  <style>body{font-family:sans-serif;background:#0B0F1A;color:#E8EDF7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#141929;border:1px solid #EF444444;border-radius:16px;padding:36px 28px;max-width:360px;width:100%;text-align:center}</style></head>
  <body><div class="card">
    <div style="font-size:56px;margin-bottom:16px">❌</div>
    <h1 style="font-size:20px;color:#EF4444;margin-bottom:8px">Pago no completado</h1>
    <p style="font-size:14px;color:#8892AB;line-height:1.6">No se realizó ningún cargo.<br>Cierra esta pestaña e intenta de nuevo desde ESTAMPADORO.</p>
  </div></body></html>`);
});

// ── POST /webhook ─────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const { type, data } = req.body;
    if (type !== "payment" || !data?.id) return;
    const payment = new Payment(client);
    const info = await payment.get({ id: data.id });
    if (info.status === "approved") {
      await acreditarSaldo(
        info.metadata?.user_id,
        info.metadata?.monto || info.transaction_amount,
        info.id
      );
    }
  } catch (err) { console.error("[webhook]", err.message); }
});

// ── GET /saldo/:userId ────────────────────────────────────────────────────────
app.get("/saldo/:userId", (req, res) => {
  const saldo = saldos[req.params.userId] ?? 0;
  res.json({ userId: req.params.userId, saldo });
});

app.listen(PORT, () => {
  console.log(`🚀 ESTAMPADORO Backend v2.0 en puerto ${PORT}`);
  console.log(`   MP Access Token: ${process.env.MP_ACCESS_TOKEN ? "✅" : "❌ FALTA"}`);
  console.log(`   Base URL: ${BASE}`);
});
