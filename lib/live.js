// ============================================================
//  live.js — answer the browser IMMEDIATELY, then keep talking
// ============================================================
//  Before: the browser waited (memory, tools, web search…) and saw nothing.
//  Now:    we open the stream at once and send small status messages
//          ("🔎 Searching the web…"), then the AI's words as they come.
//
//  Everything we send is one line of "Server-Sent Events":
//     data: {"nexus_status": "🔎 Searching the web…"}   ← what NEXUS is doing
//     data: {"nexus_info": {model, memories, docs, tools}} ← who answered
//     data: {"nexus_error": "...", "details": [...]}     ← something failed
//     data: {"choices":[{"delta":{"content":"Hel"}}]}    ← the AI's words (from the provider)

export function liveStream(context, work) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const tools = {
    send: (obj) => writer.write(encoder.encode("data: " + JSON.stringify(obj) + "\n\n")),
    status: (text) => tools.send({ nexus_status: text }),
    // Copy the AI provider's stream into ours, piece by piece
    pipe: async (body) => {
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    },
  };

  const task = work(tools)
    .catch((e) => tools.send({ nexus_error: e.message }))
    .finally(() => writer.close());
  context.waitUntil(task);   // keep working after the first bytes are sent

  return new Response(readable, { headers: { "Content-Type": "text/event-stream" } });
}

// The "who answered" info for the browser (step = {provider, model}, used by 👍👎 ratings)
export function infoOf(modelName, prep, step) {
  return {
    nexus_info: {
      model: modelName,
      providerId: step ? step.provider.id : "",
      modelId: step ? step.model : "",
      memories: prep ? prep.memories.length : 0,
      docs: prep ? [...new Set(prep.docs.map((d) => d.name))].join(", ") : "",
      tools: prep ? prep.toolsUsed.join(", ") : "",
    },
  };
}
