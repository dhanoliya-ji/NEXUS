// ============================================================
//  POST /api/council — ask several AIs, then combine the best answer
// ============================================================
//  Idea from the "Mixture-of-Agents" paper:
//   1. 3 different models answer the same question (at the same time)
//   2. a "judge" model reads all 3 answers and writes one best answer

import { saveMessage, json } from "../../lib/db.js";
import { getProvider, isReady, askModel, callModel } from "../../lib/providers.js";
import { getProfile, searchMemory, buildSystemPrompt } from "../../lib/memory.js";

// Council members (first 3 that have keys are used)
const MEMBERS = ["groq", "zai", "nvidia", "cerebras", "mistral", "gemini", "openrouter"];
// Who writes the final answer (first one with a key)
const JUDGES = ["gemini", "groq", "zai", "mistral"];

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages } = await context.request.json();

  const last = messages[messages.length - 1];
  await saveMessage(env.DB, chatId, "user", last.content, "");

  const profile = await getProfile(env.DB);
  const memories = await searchMemory(env.DB, last.content, chatId);
  const fullMessages = [{ role: "system", content: buildSystemPrompt(profile, memories) }].concat(messages);

  // 1. Pick 3 members and ask them all at once
  const members = MEMBERS.map(getProvider).filter((p) => isReady(p, env)).slice(0, 3);
  if (members.length === 0) return json({ error: "No API keys found." }, 400);

  const results = await Promise.allSettled(
    members.map((p) => askModel(env, p, p.models[0], fullMessages, 1500))
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
  const judgeMessages = fullMessages.concat([
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
        return new Response(res.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "x-nexus-model": "Council: " + names.join(", ") + " → " + judge.name,
            "x-nexus-memories": String(memories.length),
          },
        });
      }
    } catch (e) {
      // try the next judge
    }
  }
  return json({ error: "No judge model available." }, 502);
}
