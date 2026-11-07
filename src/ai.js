export function createAI(config, { fetchImpl = fetch } = {}) {
  const controllers = new Set();
  let closed = false;
  return {
    async complete(messages) {
      if (closed) throw new Error('AI closed');
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), config.timeout);
      try {
        const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages, max_tokens: 700, stream: false }),
        });
        // Never include provider body, request, token or prompt in errors/logs.
        if (!response.ok) { await response.body?.cancel(); throw new Error('AI request failed'); }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Missing AI response');
        const chunks = []; let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 65536) { await reader.cancel(); throw new Error('AI response too large'); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const text = body?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new Error('Invalid AI response');
        return [...text.trim()].slice(0, config.maxOutput).join('');
      } finally { clearTimeout(timer); controllers.delete(controller); }
    },
    close() { closed = true; for (const controller of controllers) controller.abort(); }
  };
}
