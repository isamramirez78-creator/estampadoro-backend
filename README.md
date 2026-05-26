# ESTAMPADORO · Backend

Backend de pagos con Mercado Pago para la app de intercambio de estampas FIFA 2026.

## Deploy en Railway (5 minutos)

### 1. Sube el código a GitHub

```bash
git init
git add .
git commit -m "ESTAMPADORO backend inicial"
# Crea un repo en github.com y sigue las instrucciones
git remote add origin https://github.com/TU_USUARIO/estampadoro-backend.git
git push -u origin main
```

### 2. Crea el proyecto en Railway

1. Ve a **railway.app** e inicia sesión con GitHub
2. Click en **New Project → Deploy from GitHub repo**
3. Selecciona el repo `estampadoro-backend`
4. Railway detecta Node.js automáticamente ✅

### 3. Agrega las variables de entorno

En Railway → tu proyecto → **Variables** → agrega:

| Variable | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | `APP_USR-6898235559786366-...` |
| `NODE_ENV` | `production` |

### 4. Obtén tu URL pública

Railway genera automáticamente algo como:
```
https://estampadoro-backend-production.up.railway.app
```

### 5. Actualiza el artefacto

En el archivo `estampadoro.jsx` cambia:
```js
const MP_BACKEND_URL = "https://estampadoro-backend-production.up.railway.app";
```

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Health check |
| POST | `/crear-preferencia` | Crea preferencia MP |
| POST | `/procesar-pago` | Procesa pago del Brick |
| POST | `/webhook` | Notificaciones de MP |
| GET | `/saldo/:userId` | Consulta saldo |

## Flujo de pago

```
Usuario elige monto
     ↓
POST /crear-preferencia → preference_id
     ↓
MP Brick muestra formulario (tarjeta/OXXO/SPEI)
     ↓
POST /procesar-pago → { status: "approved" }
     ↓
acreditarSaldo(userId, monto) ✅
     ↓
Chat desbloqueado al completar intercambio 🔓
```
