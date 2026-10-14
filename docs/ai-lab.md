# AI Model Lab

The Lab asks **every configured model the same question** and compares what
comes back. It is built on the pieces from earlier phases:

```
POST /api/ai/compare
  → Node: login + AI_LAB_USE permission → rate limit ("compare") → body shape check
  → C++ `compare` command
       security pipeline (InputValidator → PromptInjectionDetector → XSSDetector)   ← same as /generate
       AIOrchestrator      calls all providers concurrently (std::async), measures each latency
       for each reply:  AIOutputValidator (closed schema) → Recipe → RecipeEvaluator (scores)
       offline template generator added as a labelled BASELINE
  → ModelComparator picks fastest / best from the VALIDATED results
  → Node records one row per model in data/model-analytics.json and returns the comparison
```

## What is real, and what is not

* **Latency** is the measured wall-clock time of each provider call.
* **Scores** come from `RecipeEvaluator` (ingredients, diet, instructions, nutrition,
  safety) run on the *validated, parsed* recipe — never on raw model text.
* **Statuses:** `SUCCESS` (valid recipe), `FAILED` (call failed; error kind given),
  `SKIPPED` (no API key — never called, never counted as a failure),
  `REJECTED` (reply failed output validation; the reply is **never** returned),
  `BASELINE` (the offline template generator, shown for reference).
* **Winners:** `fastest` = lowest latency among `SUCCESS`; `best` = highest overall
  score among `SUCCESS` (tie → faster). The baseline can never win. With no keys
  configured there is **no winner** — the Lab says so rather than inventing one.
* **Analytics / benchmarks** are computed only from recorded runs. An empty history is an
  empty table.

## Endpoints

| Method & path | Who | Purpose |
|---|---|---|
| `GET /api/ai/models` | logged-in user (`ai-lab:use`) | `[{provider, model, available}]` — no keys, no config |
| `POST /api/ai/compare` | logged-in user (`ai-lab:use`) | body `{preferences, mode?, provider?}` → `{comparison, comparisonId}` |
| `GET /api/admin/providers` | admin (`admin:provider-status:read`) | same list plus each provider's status |
| `POST /api/admin/benchmark` | admin (`admin:benchmark:run`) | body `{preferences, runs 1–3}` → per-provider averages for this run |
| `GET /api/admin/model-analytics` | admin (`admin:model-analytics:read`) | lifetime per-provider attempts, success rate, avg latency, avg score, wins |

`mode`: `all` (default), `fastest`, `best` (highlight a winner), or `single` (requires
`provider`; no baseline is added). Errors use the normal envelope:
`400` bad body / `INVALID_MODE` / `INVALID_PROVIDER` / `PROMPT_INJECTION_SUSPECTED` /
`XSS_SUSPECTED`, `401`, `403`, `429` (`Retry-After` header), `503`/`504` engine problems.

Rate limits (per minute, `.env.example`): compare 3 (user) / 10 (admin); benchmark 2.

## Safety properties (each covered by a test)

* Same input security pipeline as normal generation — injection/XSS are blocked (400)
  and audited with `action: "compare"`.
* Model output is untrusted: only schema-valid replies become recipes; a rejected reply
  raises an `AI_OUTPUT_REJECTED` audit event listing field names only.
* The provider list is never echoed back in errors; keys never leave the engine.
* Providers report failures from their own threads; `ResponseEventCollector` is
  mutex-protected (`bash tests/run_tsan.sh` verifies there are no data races).
* The page builds every element with `textContent`/DOM nodes — model text cannot become markup.
