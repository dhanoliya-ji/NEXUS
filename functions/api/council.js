// ============================================================
//  POST /api/council — ask several AIs, then combine the best answer
// ============================================================
//  Idea from the "Mixture-of-Agents" paper:
//   1. 3 different models answer the same question (at the same time)
//   2. a "judge" model reads all 3 answers and writes one best answer

import { json } from "../../lib/db.js";
import { getProvider, isReady, askModel, callModel } from "../../lib/providers.js";
import { prepare, infoHeaders } from "../../lib/prepare.js";

// Council members (first 3 that have keys are used)
const MEMBERS = ["groq", "nvidia", "cloudflare", "zai", "cerebras", "mistral", "gemini", "openrouter"];
// Who writes the final answer (first one with a key that works)
const JUDGES = ["gemini", "groq", "cloudflare", "nvidia", "zai", "mistral"];

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, tools, skill } = await context.request.json();

  const members = MEMBERS.map(getProvider).filter((p) => isReady(p, env)).slice(0, 3);
  if (members.length === 0) return json({ error: "No API keys found." }, 400);

  const prep = await prepare(env, chatId, messages, { tools: tools, skill: skill });

  // 1. Ask all members at once
  const results = await Promise.allSettled(
    members.map((p) => askModel(env, p, p.models[0], prep.fullMessages, 1500))
  );

  let answers = "";
  const names = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) {
      names.push(members[i].name);
      answers += "\n\n### Answer from " + members[i].name + "\n" + r.value;
    }
  });
  if (!answers) return json({ error: "No council member could answer." }, 502);

  // 2. The judge combines them, streamed back word by word
  const judgeMessages = prep.fullMessages.concat([
    {
      role: "user",
      content:
        "Several AI models answered my last message. Here are their answers:" + answers +
        "\n\nWrite ONE final answer that is better than each of them: keep what is correct, " +
        "fix mistakes, combine the best ideas. Do not mention the other models.",
    },
  ]);

  for (const judge of JUDGES.map(getProvider).filter((p) => isReady(p, env))) {
    try {
      const res = await callModel(env, judge, judge.models[0], judgeMessages, true);
      if (res.ok) {
        return new Response(res.body, { headers: infoHeaders("Council: " + names.join(", ") + " → " + judge.name, prep) });
      }
    } catch (e) {
      // try the next judge
    }
  }
  return json({ error: "No judge model available." }, 502);
}
