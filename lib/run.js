// ============================================================
//  run.js — "try models one by one until one works"
// ============================================================
//  plan = [{provider, model}, ...] from router.js
//  If a provider's key is wrong (401/403) or its daily limit is used up (429),
//  its other models are skipped too. A missing model (404) → try the next one.

import { callModel, askModel } from "./providers.js";

// Streaming: returns { res, step } for the first model that starts answering
export async function streamFirst(env, plan, messages) {
  const errors = [];
  const skip = new Set();
  for (const step of plan) {
    if (skip.has(step.provider.id)) continue;
    try {
      const res = await callModel(env, step.provider, step.model, messages, true);
      if (res.ok) return { res: res, step: step, errors: errors };
      errors.push(step.provider.name + " " + step.model + ": " + res.status);
      if ([401, 403, 429].includes(res.status)) skip.add(step.provider.id);
    } catch (e) {
      errors.push(step.provider.name + ": " + e.message);
      skip.add(step.provider.id);   // timeout / network down
    }
  }
  return { res: null, errors: errors };
}

// Not streaming: returns { text, step } for the first model that answers
export async function askFirst(env, plan, messages, maxTokens) {
  const skip = new Set();
  for (const step of plan) {
    if (skip.has(step.provider.id)) continue;
    try {
      const text = await askModel(env, step.provider, step.model, messages, maxTokens);
      if (text) return { text: text, step: step };
    } catch (e) {
      if (/(401|403|429|timeout)/.test(e.message)) skip.add(step.provider.id);
    }
  }
  return { text: "", step: null };
}
