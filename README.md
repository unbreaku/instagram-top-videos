# Instagram Top Videos

App web en Next.js (TypeScript + Tailwind) que recibe handles de Instagram, llama al **Apify Instagram Scraper** y muestra los **top N videos** de cada cuenta en una tabla ordenable, con vistas, likes, comentarios, fecha, caption y link. Lista para desplegar en Vercel.

Demo handles por defecto: `andresbilbao`, `dylanrosemberg`.

---

## 1) Saca tu API token de Apify (gratis)

Apify es el servicio que hace el scraping. Tiene plan gratuito con USD 5 de crédito mensual, suficiente para varias cuentas/mes.

1. Entra a https://console.apify.com/sign-up y crea cuenta (con Google funciona en 10 segundos).
2. Una vez dentro, ve a **Settings → Integrations → API tokens**: https://console.apify.com/settings/integrations
3. Copia el token (empieza con `apify_api_...`). Lo vas a usar en el paso 3.
4. (Opcional pero recomendado) Visita el actor que usa la app y dale "Try for free" una vez para que quede asociado a tu cuenta: https://apify.com/apify/instagram-scraper

**Costo:** El actor cobra alrededor de USD 2.30 por cada 1.000 posts revisados. Si pides 80 posts por cuenta × 2 cuentas = 160 posts ≈ USD 0.37 por corrida. El crédito gratuito mensual te alcanza para ~13 corridas.

---

## 2) Correr en local

```bash
# Instala dependencias
npm install

# Crea tu archivo de variables de entorno
cp .env.example .env.local
# Edita .env.local y pega tu APIFY_API_TOKEN

# Arranca el server de desarrollo
npm run dev
```

Abre http://localhost:3000, escribe los handles separados por coma y dale "Obtener videos".

---

## 3) Desplegar a Vercel

### Opción A — Desde la web (más fácil)

1. Sube esta carpeta a un repo de GitHub (puedes crear uno nuevo en github.com).
2. Entra a https://vercel.com y haz "New Project" → importa el repo.
3. En la pantalla de configuración, expande **Environment Variables** y agrega:
   - Nombre: `APIFY_API_TOKEN`
   - Valor: tu token (`apify_api_...`)
4. Click **Deploy**. En ~1 minuto tienes una URL pública.

### Opción B — Desde la terminal con Vercel CLI

```bash
npm i -g vercel
vercel        # primer deploy (preview); te pedirá login
vercel --prod # deploy a producción
```

Después del primer deploy, configura la env var:

```bash
vercel env add APIFY_API_TOKEN
# elige Production, Preview, Development → pega el token
vercel --prod # redeploy para que tome la variable
```

---

## 4) Notas y limitaciones importantes

- **Cuentas privadas:** El scraper no puede leerlas. Solo cuentas públicas.
- **Vistas en Reels:** Instagram dejó de mostrar el contador público de vistas en algunos países / cuentas; cuando no esté disponible, la columna mostrará `0`. La app prioriza `videoPlayCount` (reels) sobre `videoViewCount` (videos de feed antiguos).
- **Posts vs. videos:** La app filtra automáticamente solo videos/reels/IGTV y descarta fotos y carruseles de imagen.
- **Timeouts en Vercel Hobby:** El plan gratuito de Vercel limita las funciones a 60 segundos. Si scrapeas muchas cuentas a la vez puede dar timeout. Soluciones:
  - Reducir cuentas por corrida (la app ya las corre en paralelo).
  - Bajar `APIFY_RESULTS_LIMIT` (env var opcional, default 80).
  - Pasar a Vercel Pro (300s) — la app ya declara `maxDuration = 300`.
- **Tope de seguridad:** El endpoint acepta máximo 10 handles por request para no quemar crédito de Apify por accidente.

---

## 5) Estructura del proyecto

```
.
├── app/
│   ├── api/scrape/route.ts   # POST /api/scrape — llama a Apify
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx              # UI con formulario + tabla ordenable
├── lib/
│   ├── apify.ts              # Cliente del actor Instagram Scraper
│   └── types.ts
├── .env.example
├── next.config.mjs
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 6) Endpoint API (por si quieres usarlo desde otro lado)

```http
POST /api/scrape
Content-Type: application/json

{
  "usernames": ["andresbilbao", "dylanrosemberg"],
  "topN": 20
}
```

Respuesta:

```json
{
  "fetchedAt": "2026-05-16T18:23:01.000Z",
  "perAccount": [
    { "username": "andresbilbao", "videoCount": 20 },
    { "username": "dylanrosemberg", "videoCount": 20 }
  ],
  "results": [
    {
      "username": "andresbilbao",
      "views": 1250000,
      "likes": 84320,
      "comments": 612,
      "caption": "…",
      "url": "https://www.instagram.com/p/Cxxx/",
      "timestamp": "2025-09-04T13:21:00.000Z",
      "type": "Reel"
    }
  ]
}
```
