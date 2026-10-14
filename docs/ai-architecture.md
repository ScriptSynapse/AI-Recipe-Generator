# AI Architecture

## Providers

Five providers sit behind one interface, `LLMProvider` (`cpp-core/ai/`):

| Provider | Class | Key / setting | Default model |
|---|---|---|---|
| Claude | `ClaudeProvider` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | claude-sonnet-4-5 |
| Gemini | `GeminiProvider` | `GOOGLE_API_KEY`, `GOOGLE_MODEL` | gemini-2.5-flash |
| OpenAI | `OpenAIProvider` | `OPENAI_API_KEY`, `OPENAI_MODEL` | gpt-4o-mini |
| Groq | `GroqProvider` | `GROQ_API_KEY`, `GROQ_MODEL` | llama-3.3-70b-versatile |
| Local | `LocalProvider` | `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL` (no key) | llama3.2 at http://localhost:11434 |

`HttpLLMProvider` is the shared template: it builds the request, calls an injected `HttpClient` (`CurlHttpClient` in production, a fake in tests), checks status, and hands the body to the subclass to extract text. A provider with no key reports itself unavailable instead of failing. `LLMProviderFactory` creates providers by name.

## Normal generation: failover

`AIGenerator` holds a `ModelRouter`, itself an `LLMProvider` (Composite over Strategy). It tries providers one at a time in this order and skips any that are unavailable:

```
Claude -> Gemini -> OpenAI -> Groq -> Local -> offline template generator
```

Each provider's output goes through `AIOutputValidator` and `RecipeBuilder`. Invalid output counts as a failure and the chain moves on. If every provider is unavailable or rejected, `RecipeTemplateEngine` produces a recipe locally and the result is marked `usedFallback`. The response's `aiProvider` names the provider that actually answered.

When the database match is good enough (score threshold and ingredient coverage) the database recipe is used and no model is called at all; `forceAi` and regenerate can force the AI path.

## AI Model Lab: comparison

`ModelComparator` uses `AIOrchestrator` to send one prompt to every available provider at once with `std::async`; wall-clock time is bounded by the slowest provider. Per model it records, from real calls only:
- success or failure, and a sanitized error
- measured duration
- the parsed recipe and `RecipeEvaluator`'s score (ingredient, diet and safety compliance)
- `fastest` (lowest latency) and `best` (highest evaluator score), both chosen only among validated replies and null if no model produced one

Nothing is estimated: a provider without a key is shown as skipped, and a reply that fails validation is never scored or named fastest or best. Concurrency is checked with ThreadSanitizer (`tests/run_tsan.sh`).

Orchestration modes exist in C++ (`SingleModel`, `MultiModel`, `Fastest`, `BestQuality`, `CompareAll`), but the HTTP API exposes only the failover generate and the all-provider compare. Single-model and multi-model selection are not available through the generate endpoint.

## Analytics and benchmarks

`ModelAnalyticsStore` accumulates real per-model outcomes from comparisons (admin: `GET /api/admin/model-analytics`). `POST /api/admin/benchmark` repeats the real comparison 1 to 3 times (`runs`). With no data the figures are zero or "-", never invented.

## Prompt handling

Prompts are built by the engine from validated `RecipePreferences` only. Input passes the security pipeline first, so a flagged request never reaches a provider. Provider errors are reduced to fixed text before leaving the engine, so API keys and raw model output do not reach logs, events or responses.

## Failure handling

| Failure | Behavior |
|---|---|
| No key for a provider | Marked unavailable, skipped |
| Timeout / HTTP error | `MODEL_FAILURE` event (fixed text), next provider |
| Malformed or unsafe output | `AI_OUTPUT_REJECTED` event, next provider |
| All providers fail | Offline generator, `usedFallback: true` |
| Engine crash or timeout (`ENGINE_TIMEOUT_MS`, default 45 s) | Node returns a generic error; detail is logged server-side only |
