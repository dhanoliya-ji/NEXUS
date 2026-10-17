// ============================================================
//  understand.js — ONE fast model call that prepares everything
// ============================================================
//  Before answering, a small fast model reads the conversation and returns:
//   • query      — your last message rewritten as a complete question.
//                  "what about the second one?" → "What is the price of the iPhone 18 Pro?"
//                  Memory and document search use this (papers: Rewrite-Retrieve-Read, HyDE).
//   • complexity — 0 = small talk ("hi", "thanks"): skip searching, answer fast
//                  1 = normal question
//                  2 = hard / multi-step: worth extra checking   (paper: Adaptive-RAG)
//   • tools      — which tools to run (papers: Toolformer, ReAct)

import { askHelper } from "./memory.js";
import { toolList } from "./tools.js";
import { nowIndia } from "./reminders.js";

export async function understand(env, messages, toolsOn) {
  const last = messages[messages.length - 1].content;
  const simple = { query: last, complexity: 1, tools: [] };

  // Greetings and thanks: no searching needed, and no need to ask a model
  if (/^\s*(hi+|hello+|hey+|hii+|yo|thanks?|thank you|thx|ok(ay)?|cool|nice|great|bye|good (morning|night|evening|afternoon)|namaste|gm|gn)[\s!.🙂😊👍]*$/i.test(last)) {
    return { query: last, complexity: 0, tools: [] };
  }
  // First message and no tools → nothing to rewrite, nothing to pick: skip the call
  if (messages.length === 1 && !toolsOn) return simple;

  const recent = messages.slice(-6).map((m) => m.role + ": " + m.content.slice(0, 700)).join("\n");
  const answer = await askHelper(env, [
    {
      role: "system",
      content:
        "You prepare a message for an AI assistant. Current India time: " + nowIndia() + ".\n" +
        "Return ONLY JSON with:\n" +
        '"query": the LAST user message rewritten as a complete, standalone question (replace "it", "that", ' +
        '"the second one" with what they mean; keep the user\'s language; same as the message if already clear).\n' +
        '"complexity": 0 for greetings/thanks/small talk, 1 for normal questions, 2 for hard multi-step reasoning, ' +
        "math, coding, planning or comparisons.\n" +
        (toolsOn
          ? '"tools": max 3 tools from this list, only when fresh or exact data is needed (news, weather, prices, recent ' +
            "events, a URL given, facts you're unsure about). Not for chatting, writing, coding, math or general knowledge. " +
            "For reminders use set_reminder with the exact date/time ('tomorrow 9am' → tomorrow 09:00; no time → 09:00).\n" +
            "TOOLS:\n" + toolList() + "\n" +
            'Example: {"query":"What is the weather in Jaipur today?","complexity":1,"tools":[{"name":"weather","input":"Jaipur"}]}'
          : '"tools": always []. Example: {"query":"...","complexity":1,"tools":[]}'),
    },
    { role: "user", content: "CONVERSATION:\n" + recent },
  ], 400, ["groq", "gemini", "cloudflare"]);

  try {
    const result = JSON.parse(answer.match(/\{[\s\S]*\}/)[0]);
    return {
      query: typeof result.query === "string" && result.query.trim() ? result.query.trim() : last,
      complexity: [0, 1, 2].includes(result.complexity) ? result.complexity : 1,
      tools: toolsOn && Array.isArray(result.tools) ? result.tools : [],
    };
  } catch (e) {
    return simple;
  }
}
