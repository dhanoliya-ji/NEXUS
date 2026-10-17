// ============================================================
//  tools.js — free tools NEXUS can use to get FRESH information
// ============================================================
//
//  AI models only know things up to their training date. Tools fix that:
//  before answering, NEXUS asks a small fast model "which tools does this
//  message need?" (idea from the Toolformer + ReAct papers), runs them,
//  and gives the results to the big model together with your question.
//
//  Every tool = a function that takes ONE text input and returns text.
//  All services below are free and need no key (from the public-apis list).
//
//  To add a tool: write a function, then add it to the TOOLS list at the bottom.

import { askHelper } from "./memory.js";

const HEADERS = { "User-Agent": "NEXUS/1.0 (personal AI assistant)" };

// Small helpers: download JSON or text, give up after 10 seconds
async function getJson(url, options) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000), ...options });
  if (!res.ok) throw new Error(new URL(url).hostname + " said " + res.status);
  return res.json();
}
async function getText(url, extraHeaders) {
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(new URL(url).hostname + " said " + res.status);
  return res.text();
}
const enc = encodeURIComponent;

// Try several ways to get the same data; return the first that works.
// (Free services sometimes block Cloudflare's servers, so every tool has backups.)
async function firstWorking(ways) {
  let lastError;
  for (const way of ways) {
    try {
      const result = await way();
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("no result");
}

// Safety guard: search engines sometimes send junk to servers they think are bots.
// Keep results only if most of them mention words from the question.
const SMALL_WORDS = new Set(["the", "and", "for", "who", "what", "how", "best", "latest", "new", "top", "with", "from", "about", "india"]);
function looksRelevant(results, query) {
  const words = (query.toLowerCase().match(/[a-zऀ-ॿ]{3,}/g) || []).filter((w) => !SMALL_WORDS.has(w));
  if (words.length === 0 || results.length === 0) return results.length > 0;
  const good = results.filter((r) => {
    const text = (r.title + " " + (r.snippet || "")).toLowerCase();
    return words.some((w) => text.includes(w));
  });
  return good.length >= Math.ceil(results.length / 2);
}

// Read <item> entries from an RSS feed (news sites, Bing) → [{title, url, date, snippet}]
function readRss(xml, max) {
  return xml.split("<item>").slice(1, max + 1).map((item) => {
    const get = (tag) => cleanHtml(((item.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">")) || [])[1] || "")
      .replace(/<!\[CDATA\[|\]\]>/g, ""));
    return { title: get("title"), url: get("link"), date: get("pubDate"), snippet: get("description") };
  });
}

// Remove HTML tags and turn &amp; etc. back into normal characters
function cleanHtml(text) {
  return text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

// ---------- Web search ----------
// Returns a list: [{title, url, snippet}, ...]
// Order: Tavily (free key, best) → Jina search (free key) → DuckDuckGo → Wikipedia (always works)
export async function searchWeb(query, env) {
  return firstWorking([
    async () => {
      if (!env.TAVILY_API_KEY) return null;
      const data = await getJson("https://api.tavily.com/search", {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", Authorization: "Bearer " + env.TAVILY_API_KEY },
        body: JSON.stringify({ query: query, max_results: 6 }),
      });
      return data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    },
    async () => {
      if (!env.JINA_API_KEY) return null;
      const data = await getJson("https://s.jina.ai/?q=" + enc(query), {
        headers: { ...HEADERS, Accept: "application/json", Authorization: "Bearer " + env.JINA_API_KEY, "X-Respond-With": "no-content" },
      });
      return data.data.slice(0, 6).map((r) => ({ title: r.title, url: r.url, snippet: r.description || "" }));
    },
    async () => {
      const html = await getText("https://html.duckduckgo.com/html/?q=" + enc(query));
      const results = [];
      const pattern = /class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = pattern.exec(html)) && results.length < 6) {
        const real = m[1].match(/uddg=([^&]+)/);   // DuckDuckGo hides the real link inside "uddg=..."
        results.push({ title: cleanHtml(m[2]), url: real ? decodeURIComponent(real[1]) : m[1], snippet: cleanHtml(m[3]) });
      }
      return looksRelevant(results, query) ? results : null;
    },
    async () => {
      const data = await getJson("https://en.wikipedia.org/w/rest.php/v1/search/page?limit=5&q=" + enc(query));
      return data.pages.map((p) => ({
        title: p.title, url: "https://en.wikipedia.org/wiki/" + p.key, snippet: cleanHtml(p.excerpt || p.description || ""),
      }));
    },
  ]);
}

async function webSearch(query, env) {
  const results = await searchWeb(query, env);
  return results.map((r, i) => (i + 1) + ". " + r.title + " — " + r.url + "\n   " +
    (r.snippet || "").replace(/\s+/g, " ").slice(0, 400)).join("\n");
}

// ---------- Read a web page ----------
// 1st: Jina Reader turns any web page into clean text (free; a free key gives higher limits)
// 2nd: download the page ourselves and strip the HTML
export async function readUrl(url, env) {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const jinaHeaders = { "X-Return-Format": "text" };
  if (env && env.JINA_API_KEY) jinaHeaders.Authorization = "Bearer " + env.JINA_API_KEY;

  const text = await firstWorking([
    () => getText("https://r.jina.ai/" + url, jinaHeaders),
    async () => {
      const html = (await getText(url)).slice(0, 300000);
      return cleanHtml(html.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " "));
    },
  ]);
  return text.slice(0, 6000);
}

// ---------- Wikipedia ----------
async function wikipedia(query) {
  const found = await getJson("https://en.wikipedia.org/w/rest.php/v1/search/page?limit=2&q=" + enc(query));
  const parts = [];
  for (const page of found.pages) {
    const s = await getJson("https://en.wikipedia.org/api/rest_v1/page/summary/" + enc(page.key));
    parts.push("**" + s.title + "** (" + s.content_urls.desktop.page + ")\n" + s.extract);
  }
  return parts.join("\n\n") || "Nothing found on Wikipedia.";
}

// ---------- Weather (Open-Meteo) ----------
const WEATHER = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "fog", 48: "fog", 51: "light drizzle",
  53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow",
  75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail" };

// 1st: Open-Meteo   2nd: wttr.in
async function weather(place) {
  return firstWorking([() => openMeteo(place), () => wttr(place)]);
}

async function wttr(place) {
  const w = await getJson("https://wttr.in/" + enc(place) + "?format=j1");
  const c = w.current_condition[0];
  let text = "Weather in " + place + ": now " + c.temp_C + "°C (feels " + c.FeelsLikeC + "°C), " +
    c.weatherDesc[0].value + ", humidity " + c.humidity + "%, wind " + c.windspeedKmph + " km/h\n";
  for (const d of w.weather) {
    const rain = Math.max(...d.hourly.map((h) => Number(h.chanceofrain)));
    text += d.date + ": " + d.mintempC + "–" + d.maxtempC + "°C, rain chance " + rain + "%\n";
  }
  return text + "(Source: wttr.in)";
}

async function openMeteo(place) {
  const geo = await getJson("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + enc(place));
  if (!geo.results) return "Place not found: " + place;
  const p = geo.results[0];
  const w = await getJson("https://api.open-meteo.com/v1/forecast?latitude=" + p.latitude + "&longitude=" + p.longitude +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=4");

  const c = w.current;
  let text = "Weather in " + p.name + ", " + (p.admin1 || "") + " " + (p.country || "") + " (local time " + c.time + "):\n" +
    "Now: " + c.temperature_2m + "°C (feels " + c.apparent_temperature + "°C), " + (WEATHER[c.weather_code] || "") +
    ", humidity " + c.relative_humidity_2m + "%, wind " + c.wind_speed_10m + " km/h\n";
  w.daily.time.forEach((day, i) => {
    text += day + ": " + w.daily.temperature_2m_min[i] + "–" + w.daily.temperature_2m_max[i] + "°C, " +
      (WEATHER[w.daily.weather_code[i]] || "") + ", rain chance " + w.daily.precipitation_probability_max[i] + "%\n";
  });
  return text + "(Source: open-meteo.com)";
}

// ---------- Currency (Frankfurter, European Central Bank rates) ----------
async function currency(input) {
  // understands "100 USD to INR", "usd inr", "50 eur in gbp"
  const m = input.match(/([\d.,]+)?\s*([a-z]{3})\s*(?:to|in|into|->|=)?\s*([a-z]{3})/i);
  if (!m) return "Write it like: 100 USD to INR";
  const amount = m[1] ? m[1].replace(/,/g, "") : "1";
  const from = m[2].toUpperCase(), to = m[3].toUpperCase();
  const data = await getJson("https://api.frankfurter.dev/v1/latest?amount=" + amount + "&from=" + from + "&to=" + to);
  return amount + " " + from + " = " + data.rates[to] + " " + to + " (rate date " + data.date + ", source: frankfurter.dev / ECB)";
}

// ---------- Crypto prices (CoinGecko) ----------
const COINS = { btc: "bitcoin", eth: "ethereum", sol: "solana", doge: "dogecoin", xrp: "ripple", bnb: "binancecoin", ada: "cardano", usdt: "tether" };

// 1st: CoinGecko   2nd: Coinpaprika
async function crypto(coin) {
  const name = coin.toLowerCase().trim();
  const id = COINS[name] || name.replace(/\s+/g, "-");
  return firstWorking([
    async () => {
      const data = await getJson("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd,inr&include_24hr_change=true&ids=" + enc(id));
      const p = data[id];
      if (!p) return null;
      return id + ": $" + p.usd + " / ₹" + p.inr + " (24h change " + p.usd_24h_change.toFixed(2) + "%, source: CoinGecko)";
    },
    async () => {
      const found = await getJson("https://api.coinpaprika.com/v1/search?c=currencies&limit=1&q=" + enc(id));
      const c = found.currencies[0];
      if (!c) return "Coin not found: " + coin;
      const t = await getJson("https://api.coinpaprika.com/v1/tickers/" + c.id);
      const q = t.quotes.USD;
      return c.name + ": $" + q.price.toFixed(2) + " (24h change " + q.percent_change_24h.toFixed(2) + "%, source: Coinpaprika)";
    },
  ]);
}

// ---------- Dictionary ----------
// 1st: Free Dictionary API   2nd: Wiktionary
async function dictionary(word) {
  word = word.trim().toLowerCase();
  return firstWorking([
    async () => {
      const entry = (await getJson("https://api.dictionaryapi.dev/api/v2/entries/en/" + enc(word)))[0];
      let text = entry.word + (entry.phonetic ? " " + entry.phonetic : "") + "\n";
      for (const m of entry.meanings.slice(0, 3)) {
        text += "(" + m.partOfSpeech + ") " + m.definitions.slice(0, 2).map((d) => d.definition).join(" / ") + "\n";
      }
      return text;
    },
    async () => {
      const data = await getJson("https://en.wiktionary.org/api/rest_v1/page/definition/" + enc(word));
      const english = data.en || [];
      return word + "\n" + english.slice(0, 3).map((m) =>
        "(" + m.partOfSpeech + ") " + m.definitions.slice(0, 2).map((d) => cleanHtml(d.definition)).join(" / ")).join("\n") +
        "\n(Source: Wiktionary)";
    },
  ]);
}

// ---------- News ----------
// 1st: Google News   2nd: Bing News   3rd: GDELT (world news database)
async function news(topic) {
  const relevant = (list) => (looksRelevant(list, topic) ? list : null);
  const list = await firstWorking([
    async () => relevant(readRss(await getText("https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q=" + enc(topic)), 7)),
    async () => relevant(readRss(await getText("https://www.bing.com/news/search?format=rss&mkt=en-IN&setlang=en&q=" + enc(topic)), 7)),
    async () => {
      const data = await getJson("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=7&sort=datedesc&query=" + enc(topic));
      return (data.articles || []).map((a) => ({ title: a.title, url: a.url, date: a.seendate }));
    },
  ]);
  return list.map((n, i) => (i + 1) + ". " + n.title + " (" + n.date + ") " + n.url).join("\n") || "No news found.";
}

// ---------- Research papers (arXiv) ----------
async function arxiv(query) {
  const xml = await getText("https://export.arxiv.org/api/query?max_results=5&sortBy=relevance&search_query=all:" + enc(query));
  const entries = xml.split("<entry>").slice(1);
  return entries.map((e, i) => {
    const get = (tag) => cleanHtml((e.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">")) || [])[1] || "");
    return (i + 1) + ". " + get("title") + " (" + get("published").slice(0, 10) + ") " + get("id") + "\n   " + get("summary").slice(0, 300);
  }).join("\n") || "No papers found.";
}

// ---------- Books (Open Library) ----------
async function books(query) {
  const data = await getJson("https://openlibrary.org/search.json?limit=5&fields=title,author_name,first_publish_year,key&q=" + enc(query));
  return data.docs.map((b, i) => (i + 1) + ". " + b.title + " by " + (b.author_name || ["?"]).join(", ") +
    " (" + (b.first_publish_year || "?") + ") https://openlibrary.org" + b.key).join("\n") || "No books found.";
}

// ============================================================
//  The list of tools (name → what it does + function)
// ============================================================
export const TOOLS = {
  web_search: { about: "search the internet: current events, recent facts, products, prices, anything after 2024", run: webSearch },
  read_url:   { about: "read the text of a web page (input = the URL)", run: readUrl },
  wikipedia:  { about: "encyclopedia facts about people, places, history, science", run: wikipedia },
  weather:    { about: "current weather + 4-day forecast (input = city name)", run: weather },
  currency:   { about: "convert money with today's rates (input like '100 USD to INR')", run: currency },
  crypto:     { about: "cryptocurrency price (input = coin name like bitcoin)", run: crypto },
  dictionary: { about: "meaning of an English word (input = the word)", run: dictionary },
  news:       { about: "latest news headlines on a topic (input = topic)", run: news },
  arxiv:      { about: "find scientific research papers (input = topic)", run: arxiv },
  books:      { about: "find books and authors (input = title or topic)", run: books },
};

// ============================================================
//  Decide which tools a message needs, run them, return the results
// ============================================================
export async function useTools(env, messages) {
  const list = Object.entries(TOOLS).map(([name, t]) => "- " + name + ": " + t.about).join("\n");
  const recent = messages.slice(-4).map((m) => m.role + ": " + m.content.slice(0, 800)).join("\n");

  const answer = await askHelper(env, [
    {
      role: "system",
      content:
        "You decide which tools an AI assistant should use before answering. Today is " + new Date().toDateString() + ".\n" +
        "TOOLS:\n" + list + "\n\n" +
        "Use tools when the answer needs fresh or exact data (news, weather, prices, recent events, a URL the user gave, " +
        "facts you are unsure about). Do NOT use tools for chatting, writing, coding, math, advice or general knowledge.\n" +
        'Reply with ONLY JSON, max 3 tools, like {"tools":[{"name":"weather","input":"Jaipur"}]} or {"tools":[]}',
    },
    { role: "user", content: "CONVERSATION:\n" + recent + "\n\nWhich tools for the LAST user message?" },
  ], 300);

  // Pull the JSON out of the answer (models sometimes add extra words)
  let picked = [];
  try {
    picked = JSON.parse(answer.match(/\{[\s\S]*\}/)[0]).tools || [];
  } catch (e) {
    return { used: [], text: "" };
  }
  picked = picked.filter((t) => TOOLS[t.name] && t.input).slice(0, 3);
  if (picked.length === 0) return { used: [], text: "" };

  // Run all chosen tools at the same time
  const results = await Promise.allSettled(picked.map((t) => TOOLS[t.name].run(String(t.input), env)));

  let text = "";
  results.forEach((r, i) => {
    text += "\n### " + picked[i].name + " (" + picked[i].input + ")\n" +
      (r.status === "fulfilled" ? r.value : "Tool failed: " + r.reason.message) + "\n";
  });
  return { used: picked.map((t) => t.name), text: text };
}
