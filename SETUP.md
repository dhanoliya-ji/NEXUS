# NEXUS setup: everything is free, no credit card

## Step 1: Get your free API keys (about 30 minutes)

Open each link, sign up, create a key, and copy it somewhere safe. **Never share keys in chats or put them in code.**

| # | Provider | Where to get the key | Notes |
|---|---|---|---|
| 1 | **Groq** | https://console.groq.com/keys | Very fast. Most important |
| 2 | **Google Gemini** | https://aistudio.google.com/apikey | 1M-token memory. **Never enable billing** |
| 3 | **OpenRouter** | https://openrouter.ai/keys | Many free models. **Never add credits** |
| 4 | **Z.ai (GLM)** | https://z.ai → API Keys | Free GLM Flash models, good at code |
| 5 | **Mistral** | https://console.mistral.ai → choose the free **Experiment** plan → API Keys | Phone verification needed |
| 6 | **Cerebras** | https://cloud.cerebras.ai → API Keys | Super fast |
| 7 | **GitHub Models** | https://github.com/settings/personal-access-tokens → Fine-grained token → Permissions → **Models: Read** | Uses your GitHub account |
| 8 | NVIDIA *(optional)* | https://build.nvidia.com → Get API Key | Kimi K2, Qwen3 Coder |

## Step 2: Put the keys in `.dev.vars`

1. In `D:\NEXUS`, copy `.dev.vars.example` and name the copy `.dev.vars`.
2. Paste each key after its `=` sign.
3. Make up a password for `NEXUS_PASSWORD=`.

`.dev.vars` is never uploaded to GitHub, because `.gitignore` blocks it.

## Step 3: Try it on your laptop

```bash
cd D:\NEXUS
npm install
npm run dev
```

Open http://localhost:8788, then click **🩺 Doctor** to see which keys work.

## Step 4: Put it online (Cloudflare, free)

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. Run `npx wrangler login`. A browser tab opens; click **Allow**.
3. Create the database: `npx wrangler d1 create nexus-db`. Copy the `database_id` it prints into `wrangler.toml`.
4. Deploy: `npm run deploy`. You get a link like `https://nexus-xxx.pages.dev`.
5. Upload your keys to Cloudflare. Run this once for each line in `.dev.vars`:
   `npx wrangler pages secret put GROQ_API_KEY`
6. Open your link and enter your password. **Done: open the link from any device, anytime.**

On your phone, open the link, then choose **Add to Home screen**. NEXUS now works like an app.

## Step 5: Daily backup to the D drive

1. Add `NEXUS_URL=https://your-link.pages.dev` to `.dev.vars`.
2. Run once: `powershell -ExecutionPolicy Bypass -File D:\NEXUS\local\install-backup.ps1`

Every day, all chats and memory are saved to `D:\NEXUS\backup\`.

## Optional: Better offline model on your laptop

```bash
ollama pull qwen3:4b
```

When you run `npm run dev` on your laptop, NEXUS can also use Ollama models, so it works with no internet at all.
