// ─────────────────────────────────────────────────────────────────────────────
//  ESTAMPADORO · Backend  –  Mercado Pago + saldos
//  Deploy en Railway: railway up
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Mercado Pago client ───────────────────────────────────────────────────────
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,   // ← viene de Railway Variables
  options: { timeout: 5000 },
});

// ── CORS: permite peticiones desde claude.ai y tu dominio ────────────────────
const ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://www.claude.ai",
  process.env.FRONTEND_URL,   // opcional: tu propio dominio
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Permitir sin origin (Postman, Railway health-check)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS bloqueado: ${origin}`));
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.use(express.json());

// ── Health check (Railway lo usa para saber que el server vive) ───────────────
app.get("/", (_req, res) => {
  res.json({
    app: "ESTAMPADORO Backend",
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /crear-preferencia
//  El frontend pide esta preferencia antes de montar el Brick de MP.
//  Recibe: { monto: Number, userId: String }
//  Devuelve: { preference_id: String }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/crear-preferencia", async (req, res) => {
  try {
    const { monto, userId } = req.body;

    if (!monto || !userId) {
      return res.status(400).json({ error: "Faltan campos: monto y userId" });
    }

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{
          id:           `recarga-${userId}-${Date.now()}`,
          title:        `Recarga ESTAMPADORO · $${monto} MXN`,
          description:  `${monto} créditos para intercambios de estampas FIFA 2026`,
          quantity:     1,
          currency_id:  "MXN",
          unit_price:   Number(monto),
        }],
        metadata: {
          user_id: userId,   // lo recuperamos en el webhook
          monto:   Number(monto),
        },
        // URLs de retorno (opcionales, el Brick no las necesita)
        back_urls: {
          success: `${process.env.FRONTEND_URL || "https://claude.ai"}/pago-exitoso`,
          failure: `${process.env.FRONTEND_URL || "https://claude.ai"}/pago-fallido`,
          pending: `${process.env.FRONTEND_URL || "https://claude.ai"}/pago-pendiente`,
        },
        // Webhook: MP notifica aquí cuando el pago se aprueba
        notification_url: `${process.env.RAILWAY_PUBLIC_DOMAIN
          ? "https://"+process.env.RAILWAY_PUBLIC_DOMAIN
          : process.env.BACKEND_URL}/webhook`,
        auto_return: "approved",
      },
    });

    console.log(`[preferencia] user=${userId} monto=${monto} id=${result.id}`);
    res.json({
      preference_id: result.id,
      init_point:    result.init_point,       // URL de pago Checkout Pro
      sandbox_init_point: result.sandbox_init_point, // URL de pruebas
    });

  } catch (err) {
    console.error("[preferencia] Error:", err.message);
    res.status(500).json({ error: "No se pudo crear la preferencia", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /procesar-pago
//  Llamado por el MP Brick al enviar el formulario.
//  Recibe: los formData del Brick + { userId, monto }
//  Devuelve: { status, status_detail, payment_id }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/procesar-pago", async (req, res) => {
  try {
    const { userId, monto, ...formData } = req.body;

    const payment = new Payment(client);
    const result  = await payment.create({
      body: {
        ...formData,
        metadata: { user_id: userId, monto: Number(monto) },
      },
    });

    console.log(`[pago] user=${userId} status=${result.status} id=${result.id}`);

    if (result.status === "approved") {
      // ✅ Pago aprobado al instante (tarjeta)
      await acreditarSaldo(userId, Number(monto), result.id);
    }
    // "in_process" = OXXO / SPEI pendiente → se acredita vía webhook

    res.json({
      status:        result.status,
      status_detail: result.status_detail,
      payment_id:    result.id,
    });

  } catch (err) {
    console.error("[pago] Error:", err.message);
    res.status(500).json({ error: "Error al procesar el pago", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /webhook
//  Mercado Pago llama aquí cuando el estado de un pago cambia.
//  Maneja OXXO / SPEI que se pagan después.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Responder 200 inmediatamente (MP lo requiere en < 5 seg)
  res.sendStatus(200);

  try {
    const { type, data } = req.body;
    if (type !== "payment" || !data?.id) return;

    const payment = new Payment(client);
    const info    = await payment.get({ id: data.id });

    console.log(`[webhook] payment_id=${info.id} status=${info.status}`);

    if (info.status === "approved") {
      const userId = info.metadata?.user_id;
      const monto  = info.metadata?.monto || info.transaction_amount;

      if (userId && monto) {
        await acreditarSaldo(userId, Number(monto), info.id);
      }
    }

  } catch (err) {
    console.error("[webhook] Error:", err.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /saldo/:userId
//  El frontend puede consultar el saldo actualizado después del pago.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/saldo/:userId", (req, res) => {
  const { userId } = req.params;
  const saldo = saldos[userId] ?? 0;
  res.json({ userId, saldo });
});

// ─────────────────────────────────────────────────────────────────────────────
//  SALDO EN MEMORIA  (reemplaza por tu base de datos real)
//  Para producción usa: PostgreSQL / MySQL / Firebase / MongoDB
// ─────────────────────────────────────────────────────────────────────────────
const saldos = {};   // { userId: Number }
const pagosAplicados = new Set();  // evita aplicar el mismo pago dos veces

async function acreditarSaldo(userId, monto, paymentId) {
  if (pagosAplicados.has(String(paymentId))) {
    console.log(`[saldo] Pago ${paymentId} ya aplicado, ignorando`);
    return;
  }
  pagosAplicados.add(String(paymentId));

  saldos[userId] = (saldos[userId] || 0) + monto;
  console.log(`✅ [saldo] Acreditados $${monto} MXN → usuario ${userId} | saldo total: $${saldos[userId]}`);

  // TODO: aquí persiste en tu BD real, por ejemplo:
  // await db.query('UPDATE users SET saldo = saldo + ? WHERE id = ?', [monto, userId]);
}

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 ESTAMPADORO Backend corriendo en puerto ${PORT}`);
  console.log(`   MP Access Token: ${process.env.MP_ACCESS_TOKEN ? "✅ cargado" : "❌ FALTA en variables"}`);
  console.log(`   Entorno: ${process.env.NODE_ENV || "development"}\n`);
});
