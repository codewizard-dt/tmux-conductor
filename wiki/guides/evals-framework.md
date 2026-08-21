# Evals That Actually Work: A 5-Stage Framework for Production AI Quality

> A generic, project-agnostic guide to building an evaluation suite for any production AI system. Distills the "Evals That Actually Work" framework into the test types, artifacts, cadences, and anti-patterns a team needs to go from *"we tested it manually"* to *"is this better?" is a question we answer with data*.

This guide is **not specific to any one codebase**. Drop it into any project that ships LLM-backed features (agents, RAG systems, classifiers, summarizers, judges) and use it as a blueprint for what to build and in what order.

---

## 1. Why evals

Without evals you:

- Guess whether changes helped
- Find regressions in production
- Debate quality subjectively
- Ship and hope

With evals you:

- Measure whether changes helped
- Catch regressions before shipping
- Compare quality with data
- Ship and know

If your answer to *"how do you know your AI is good?"* is *"we tested it manually"* or *"it looked fine in review,"* you don't have an eval strategy — you have vibes.

---

## 2. The framework: five stages, each builds on the last

| # | Stage | Purpose | When it runs |
|---|-------|---------|--------------|
| 1 | **Golden Sets** | Baseline correctness | Every commit |
| 2 | **Labeled Scenarios** | Coverage mapping | Every release |
| 3 | **Replay Harnesses** | Reproducibility + ML metrics | Weekly / nightly |
| 4 | **Rubrics** | Multi-dimensional quality scoring | Before shipping |
| 5 | **Experiments** | Data-driven decisions on changes | On any change |

**Start at Stage 1. Add stages as your system matures.** Do not try to build all five at once. A team with 15 good golden cases is shipping better software than a team with a half-finished rubric harness and no regression suite.

These stages map cleanly to test layers:

- **Unit-grade** → Stage 1 (deterministic, fast, zero LLM cost)
- **Integration-grade** → Stages 2–3 (recorded fixtures, no live model calls)
- **E2E-grade** → Stages 4–5 (live system, real cost, release gates)

---

## 3. Stage 1 — Golden Sets

**Goal:** A small, curated set of canonical cases that define what "correct" looks like. If these fail, something is fundamentally broken.

### Shape

- **Size:** 10–20 cases. Quality > quantity.
- **Format:** YAML or JSON, one record per case. Lives in a top-level `evals/golden/` directory, *separate from the code under test*, so the eval substrate stays portable.
- **Cost:** Zero LLM calls. Pure code evals — assertions over the system's recorded output.
- **Cadence:** Every commit, in CI.

### Schema

```yaml
- id: "gs-001"
  query: "What is our remote work policy?"
  expected_tools:
    - vector_search
  expected_sources:
    - remote_work_policy.md
  must_contain:
    - "remote"
    - "core hours"
  must_not_contain:
    - "I don't know"
    - "no information"
```

### The four check types

| Check | What it catches |
|---|---|
| **Tool selection** | Agent used the wrong tool |
| **Source citation** | Agent cited the wrong document |
| **Content validation** (`must_contain`) | Response is missing key facts |
| **Negative validation** (`must_not_contain`) | Agent hallucinated or gave up |

All four are **deterministic, binary, no LLM needed**. They run as plain `assert` statements over recorded system output.

```python
# Tool selection
assert "vector_search" in actual_tools

# Source citation
assert "refund_policy.md" in response_text

# Content validation
assert "30-day" in response_text
assert "$500" in response_text

# Negative validation
assert "I don't know" not in response_text
```

### Four rules for golden sets that stay useful

| Rule | Detail |
|---|---|
| **Start small** | 10–20 quality cases beats 100 sloppy ones |
| **Run on every commit** | These *are* your regression tests |
| **Add from production bugs** | Every confirmed prod bug becomes a new case |
| **Never** | Change expected output just to make tests pass |

### Artifacts

Every run emits per-case verdict files (JSON) and a summary (Markdown). Diffs vs. the baseline surface regressions immediately on PR review.

---

## 4. Stage 2 — Labeled Scenarios

**Goal:** Answer *"does it work for **all types**?"* not just *"does it work?"* Golden sets prove correctness on the canonical happy path. Labeled scenarios prove **coverage** across the full input space.

### Shape

- **Size:** 30–100+ cases.
- **Format:** Same as golden sets, plus **tags** for category, subcategory, and difficulty.
- **Cadence:** Every release (not every commit — too slow / too expensive).
- **All must pass?** No. You watch pass-rate *trends* per cell, not a binary gate.

### Schema

```yaml
- id: "sc-m-001"
  query: "What's our refund policy and how many refunds last quarter?"
  expected_tools: ["vector_search", "sql_query"]
  category:    multi_tool
  subcategory: vector_and_sql
  difficulty:  straightforward
```

The tags don't change *how the test runs* — they change *what the results tell you.*

### Coverage matrix

Aggregate pass-rate by `category × difficulty` (or any two tag axes). Empty cells show you where to write tests next.

```
                  | vector | sql  | jira | slack | multi |
------------------|--------|------|------|-------|-------|
straightforward   |  3/3   | 2/3  | 2/2  |  2/2  |  1/1  |
ambiguous         |  1/1   | 1/2  | 0/1  |  1/1  |  0/1  |
edge_case         |  1/1   | 1/1  | 1/1  |  --   |  --   |
```

The empty cells are your test-writing backlog.

### Difficulty bands (suggested)

- **straightforward** — single-tool, unambiguous query, golden-path inputs
- **ambiguous** — multiple plausible interpretations, requires disambiguation
- **edge_case** — adversarial inputs, rare paths, known-hard examples from production

### Golden Sets vs. Labeled Scenarios

| | Golden Sets | Labeled Scenarios |
|---|---|---|
| **Question** | "Does it work?" | "Does it work for all types?" |
| **Size** | 10–20 | 30–100+ |
| **All must pass?** | Yes | No |
| **When to run** | Every commit | Every release |

---

## 5. Stage 3 — Replay Harnesses

**Goal:** **Record once. Score anytime.** Capture a real session against the live system to a JSON fixture; evaluate that frozen snapshot whenever you want — immediately, next week, or after a human has annotated ground truth.

### Shape

```python
# Record once (costs tokens)
session = record_session(
    query="What's our refund policy and how many refunds in Q4?",
    session_id="refund-001",
)
# → saves to fixtures/refund-001.json

# Replay forever (costs nothing)
replayed = replay_session("refund-001")
scores   = evaluate_session(replayed)
```

**Record real production examples.** Real queries make the best test cases — synthetic queries don't surface the weird ways users actually phrase things.

### ML-grade metrics this unlocks

| Metric | What it measures |
|---|---|
| **Precision** | How many retrieved docs are relevant? |
| **Recall** | How many relevant docs were retrieved? |
| **Groundedness** | Is the response grounded in sources? |
| **Faithfulness** | Does it stay true to sources (no hallucination)? |
| **Tool accuracy** | Did it use the correct tools? |

Precision, recall, and tool accuracy are deterministic. **Groundedness and faithfulness require an LLM judge** — which is where Stage 4 (rubrics) earns its keep.

### Why this is integration-grade

Replays let your full pipeline (retrieval → tool calls → generation → judging) run end-to-end against frozen inputs. You exercise the system's wiring without paying live LLM cost per CI run. **Add a cost-per-replay assertion** to catch token-usage regressions automatically.

### Fixture hygiene

- Store fixtures under version control alongside the eval suite.
- Re-record fixtures on a schedule (e.g., monthly) so the test set tracks real system behavior, not a 2024-vintage snapshot.
- When the system's I/O schema changes, fixtures must be re-recorded — flag this in CI.

---

## 6. Stage 4 — Rubrics & LLM-as-Judge

**Goal:** Move from binary (pass/fail) to multi-dimensional *quality* scoring. Use an LLM judge — but **only after calibrating it against humans**.

### When to reach for an LLM judge

After you have exhausted code evals. **Use binary checks where you can; reserve LLM judges for what can't be checked programmatically** (groundedness, faithfulness, coherence, helpfulness).

### Anchor every claim against its source

The judge's core operation is **claim → source verification**, not free-form rating:

```
claim:   "We offer 30-day refunds"
source:  refund_policy.md → "...30-day refund window..."
result:  ✅ grounded

claim:   "We offer 60-day refunds"
source:  refund_policy.md → "...30-day refund window..."
result:  ❌ not grounded (hallucination)
```

The judge makes a binary call **per claim**, then aggregates into a groundedness score.

### Rubrics: weighted dimensions

A rubric is a set of weighted, named quality dimensions. A reasonable starting shape:

| Dimension | Weight | Question |
|---|---|---|
| Relevance | 30% | Does it address the question? |
| Accuracy | 40% | Are the facts correct? |
| Completeness | 20% | Does it fully answer? |
| Clarity | 10% | Is it easy to understand? |

Weighted average → single quality score. Track *trends* across releases. A 5% drop in accuracy is a red flag even if overall pass-rate holds.

Domain-specific rubrics swap these dimensions for what matters in your domain (e.g., a medical-advice judge might use *safety / accuracy / scope-adherence / clarity*).

### Every score needs an explicit anchor

```yaml
accuracy:
  weight: 0.4
  scores:
    5: "All facts correct and verifiable from cited sources"
    3: "Mostly correct with one minor inaccuracy"
    1: "Contains significant errors or misleading information"
    0: "Completely incorrect or fabricated"
```

**No anchor = no consistency.** A judge that interprets "3" differently each run is useless. If you can't write down what a 5 looks like in concrete terms, neither the judge nor a human can score it.

### Score thresholds → action policy

| Score | Quality | Action |
|---|---|---|
| 4.5–5.0 | Excellent | Ship it |
| 3.5–4.4 | Good | Minor tweaks |
| 2.5–3.4 | Acceptable | Review and improve |
| 1.5–2.4 | Poor | Significant work needed |
| 0–1.4 | Critical | Stop. Fix now. |

Wire these thresholds into your release gate or orchestrator so the action is automatic, not a meeting.

### Calibration: validate the judge before you trust it

```python
# Step 1: Score 20 examples by hand
human_scores = [4, 3, 5, 2, 5, 4, 3, ...]

# Step 2: Run the LLM judge on the same examples
llm_scores   = [4, 4, 5, 3, 5, 3, 3, ...]

# Step 3: Check correlation
correlation(human_scores, llm_scores)
# If < 0.8, your rubric is broken — fix it before trusting the judge
```

**A judge with a bad rubric produces confident, wrong scores.** Calibration must happen *before* you let the judge gate releases.

---

## 7. Stage 5 — Experiments

**Goal:** Replace intuition with evidence. Run two variants (prompts, models, retrieval configs, agent topologies) against the same test set; report deltas in pass-rate, rubric score, latency, and cost.

### Shape

```
| Variant     | Pass % | Rubric | Latency | Cost   |
|-------------|--------|--------|---------|--------|
| baseline    | 87%    | 4.1/5  | 1.2s    | $0.003 |
| gpt-4o      | 93%    | 4.5/5  | 2.1s    | $0.015 |
| new_prompt  | 91%    | 4.3/5  | 1.3s    | $0.003 |
```

→ `new_prompt` gets 91% of `gpt-4o` quality at 20% of the cost. That's a data-driven decision.

### Four rules

| Rule | Why |
|---|---|
| **One change per experiment** | Isolate variables to understand impact |
| **Same test set every time** | Apples to apples |
| **Track cost** | 6% quality gain at 5× cost may not be worth it |
| **Version your prompts** | Store them as files; commit to git |

### Statistical significance

For small test sets the variance per run can swamp the effect you're trying to measure. Either (a) run each variant N times and report mean ± stddev, or (b) grow the test set until the delta is statistically meaningful. Don't ship a 1% rubric bump from a 30-case run as a "win."

### Release gate

Combine experiment outputs into a gate: **rubric pass-rate above threshold AND cost-per-run below ceiling**. Both must hold. This is where Stages 1, 4, and 5 meet — and where evals start paying for themselves.

---

## 8. The three eval anti-patterns

### 1. The Likert trap

> *"Rate the quality of this response: 1 (poor) to 5 (excellent)"*

**What happens:** Human A gives "3" for adequate answers. Human B gives "4". Aggregated scores are noise, not signal.
**Fix:** Define every point on the scale with a concrete anchor. If you can't write the anchor, you haven't done the work.

### 2. Vague criteria

> *"The response demonstrates strategic thinking"*

**Problems:** "Strategic thinking" is undefined. Two evaluators will score it differently. An LLM judge will hallucinate a definition. You can't tell what improvement looks like.
**Fix:** Make it falsifiable: *"Response identifies ≥2 explicit trade-offs with concrete examples."*

### 3. Ambiguous ranges

> *"The response length should be between 300 and 500 tokens"*

**Problem:** A 450-token response that misses the question passes. A 250-token response that perfectly answers it fails. This criterion measures **form, not quality**.
**Fix:** Describe what good looks like: *"Answers all parts of the question; does not include unrequested information."*

### The underlying rule

Length, scale labels, and vague terms are **proxies for quality, not quality itself.**

> **A criterion is done when you can write a concrete example that unambiguously passes and one that unambiguously fails.** If you can't do that, keep writing.

---

## 9. Good practices

### Use binary checks where you can

```python
# Specific. Deterministic. Fast.
assert "vector_search" in actual_tools
assert "refund_policy.md" in response
assert "I don't know" not in response
assert "$500 annual stipend" in response
```

Binary checks have **zero calibration cost, zero API cost, and produce the same result every run.** Reserve LLM judges for what can't be checked programmatically.

### Write rubric anchors *before* you run any evals

| Step | Why |
|---|---|
| 1. Write score anchors (0, 3, 5 minimum) | Forces you to define quality |
| 2. Score 20 examples by hand | Creates ground truth |
| 3. Run LLM judge on same examples | Measures calibration |
| 4. Adjust until correlation ≥ 0.8 | Validates the judge |
| 5. Then run at scale | Now you can trust it |

### Match the eval to the moment

```
Every commit     → Golden sets         (5 min, catch regressions)
Every release    → Labeled scenarios   (coverage check)
Weekly           → Replay harnesses    (deep quality analysis)
Before shipping  → Rubric evals        (multi-dimensional scoring)
On any change    → Experiment          (validate the hypothesis)
```

The earlier you catch a regression, the cheaper it is to fix.

### Cost tracking is a first-class eval

Every run should emit per-call token usage and dollar cost. Without cost as a tracked metric, "we improved quality" can secretly mean "we 5×'d the bill." Cost projections at multiple scales (100 / 1K / 10K / 100K runs) make the budget conversation honest.

---

## 10. Build your eval stack in six steps

1. **Write 10–15 golden cases today.** Tools, sources, content checks, negative validation.
2. **Label them by query type and difficulty.** Category, subcategory, complexity.
3. **Record real production sessions as fixtures.** Real queries make the best test cases.
4. **Define rubrics with explicit anchors.** Every score point needs a concrete description.
5. **Calibrate your LLM judge against human scores.** Target correlation ≥ 0.8 before running at scale.
6. **A/B test every meaningful change.** One variable at a time.

---

## 11. Test-layer mapping (for repo planning)

If you're laying out a test suite around this framework, a natural mapping:

| Layer | Lives in | Maps to | Cost per CI run |
|---|---|---|---|
| **unit** | `tests/unit/` | Stage 1 golden sets, schema validators, deterministic asserts | $0 |
| **integration** | `tests/integration/` | Stage 2–3 replay-based pipeline tests | $0 (fixtures) |
| **e2e** | `tests/e2e/` | Stage 5 single-case live smoke test | small, gated |
| **golden** | `evals/golden/` | Stage 1 corpus + runner | $0 |
| **scenarios** | `evals/scenarios/` | Stage 2 corpus + coverage report | $0 |
| **replays** | `evals/replays/` | Stage 3 fixtures + ML metrics | $0 to replay, $$ to record |
| **rubrics** | `evals/rubrics/` | Stage 4 YAML rubric + calibration set | $ per release |

Keep `evals/` separate from your application package. The eval substrate must be portable, independently versionable, and clearly distinct from the system under test.

---

## 12. The goal

**Before:** *"I think the new prompt is better, it felt more accurate."*

**After:** *"The new prompt scored 4.3/5 vs 4.1/5 on accuracy, passed 91% of golden cases vs 87%, with no change in latency or cost."*

That's the difference between guessing and shipping with confidence.

---

## 13. Start at Stage 1

10–15 golden cases, run after every commit. Add stages as your system matures. Do not skip ahead.

The team that ships Stage 1 next week beats the team that's still designing Stage 4 next quarter.
