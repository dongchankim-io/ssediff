# ssediff — Build Workflow (START HERE)

**You are at the entry point.** This file orchestrates the build of `ssediff` via an iterative two-agent loop: an **Implementer** writes code; a **Reviewer** critiques it. The loop continues per slice until the Reviewer reports zero CRITICAL or MAJOR findings. The project is done when every slice has been accepted **and** a final whole-codebase pass is clean.

If you are an **AI agent** reading this file, route to your role:
- **Implementer agent** → load `ssediff-implementer.md` + `ssediff-spec.md` and follow them.
- **Reviewer agent** → load `ssediff-reviewer.md` + `ssediff-spec.md` and follow them.
- **Orchestrator / human** → keep reading.

---

## 1. The Cast

| File | Purpose | Read by |
|---|---|---|
| `ssediff-workflow.md` *(this file)* | The protocol — how the loop runs. | Human orchestrator. Agents read once for routing. |
| `ssediff-spec.md` | What to build. Product + quality + verification spec. The single source of truth for *requirements*. | Both agents. |
| `ssediff-implementer.md` | Implementer role, slice plan, per-file reasoning scratchpad, iteration output format. | Implementer agent. |
| `ssediff-reviewer.md` | Reviewer role, severity rubric, anti-rubber-stamp rules, review report format. | Reviewer agent. |

The two agents never read each other's role files. The spec is shared and authoritative.

---

## 2. The Loop

For each slice in the Implementer's slice plan (see `ssediff-implementer.md` Section 3):

1. **Implement.** Implementer reads the spec, the slice description, and the prior REVIEW.md if this is a revision. It emits:
   - The slice's source files (each preceded by the per-file scratchpad in implementer.md Section 4).
   - `iterations/<NNN>-<slice-name>/ITERATION_NOTES.md` — a short summary of what was implemented and, on revisions, how each prior CRITICAL/MAJOR finding was addressed.
2. **Review.** Reviewer reads the spec, the current codebase, the iteration notes, and the prior REVIEW.md if any. It writes:
   - `iterations/<NNN>-<slice-name>/REVIEW.md` — findings categorized as CRITICAL / MAJOR / MINOR / NIT, with an "Items explicitly audited" list of at least 5 entries and at least one adversarial input attempted.
3. **Decide.**
   - If any CRITICAL or MAJOR finding remains → loop back to step 1 with the new review as input.
   - Otherwise → the slice is **accepted**. Move to the next slice and return to step 1.

```
        ┌───────────────────────┐
        │ Implementer           │
   ┌───►│  reads spec + review  │
   │    │  emits slice + notes  │
   │    └────────────┬──────────┘
   │                 ▼
   │    ┌───────────────────────┐
   │    │ Reviewer              │
   │    │  reads spec + slice   │
   │    │  emits REVIEW.md      │
   │    └────────────┬──────────┘
   │                 ▼
   │        CRITICAL or MAJOR?
   │            ┌──┴──┐
   └── yes ─────┘     └─── no ──► next slice (or → FINAL PASS → DONE)
```

When all slices are accepted, the Reviewer performs one **final whole-codebase pass** against the entire Verification Checklist (spec Section 6). The project is **DONE** when that pass reports zero CRITICAL/MAJOR.

---

## 3. Stop Conditions

- **Slice accepted.** REVIEW.md has zero CRITICAL and zero MAJOR findings, lists ≥ 5 distinct items audited, and records at least one adversarial input.
- **Project done.** All slices accepted **and** the final whole-codebase pass is clean.
- **Escalation.** If a single slice exceeds **5 revision cycles**, the Reviewer sets `**Verdict:** ESCALATE` at the top of `REVIEW.md` and halts the loop. The human orchestrator triages. Typical causes: ambiguous spec, conflicting requirements, scope creep — fix at the spec level, not by relaxing the review.

---

## 4. Cross-Slice Fix Rule

A finding in the current review may identify a defect in a previously accepted file. Handle as follows:

- **Local to the current slice** → fix in this iteration.
- **In a prior-slice file** → open a new patch iteration folder (`iterations/<NNN+1>-fix-<topic>/`) just for those files; the slice plan resumes immediately after.

Never silently mutate a prior-slice file without an iteration folder explaining it.

---

## 5. Artifact Layout

```
iterations/
├── 001-scaffolding/
│   ├── ITERATION_NOTES.md   ← written by Implementer
│   └── REVIEW.md            ← written by Reviewer (overwritten on each re-review)
├── 002-engine/
│   ├── ITERATION_NOTES.md
│   └── REVIEW.md
├── ...
└── FINAL-REVIEW.md          ← written once by Reviewer after the last slice is accepted; the project-done signal
```

`iterations/` may be `.gitignore`d (ephemeral) or committed (auditable trail). The loop works either way. Either way, `FINAL-REVIEW.md` should be retained as the acceptance record.

---

## 6. Driving the Loop — Manual (single human, two chats)

In a tool like Cursor:

1. Open two chat sessions: **Implementer** and **Reviewer**.
2. Attach to each:
   - Implementer: `ssediff-workflow.md` + `ssediff-spec.md` + `ssediff-implementer.md`.
   - Reviewer: `ssediff-workflow.md` + `ssediff-spec.md` + `ssediff-reviewer.md`.
3. To **Implementer**: *"Begin Slice 001."* It emits files + `ITERATION_NOTES.md`.
4. To **Reviewer**: *"Review Slice 001 (`iterations/001-scaffolding/`)."* It emits `REVIEW.md`.
5. If `REVIEW.md` begins with `**Verdict:** CHANGES REQUIRED` → to Implementer: *"Address review findings for Slice 001 and re-emit."* The Implementer re-emits, then return to step 4 (re-review).
6. If `**Verdict:** ACCEPTED` → to Implementer: *"Slice 001 accepted. Begin Slice 002."* Continue from step 3.
7. If `**Verdict:** ESCALATE` → triage the cause yourself (usually a spec ambiguity); update the spec or relax the slice scope, then resume.
8. After the last slice is accepted → to Reviewer: *"Run final whole-codebase pass."* The Reviewer writes `iterations/FINAL-REVIEW.md`. Project is DONE when that report has `**Verdict:** ACCEPTED`.

---

## 7. Driving the Loop — Automated (script or SDK)

A driver script can:

1. Spawn the Implementer agent with the appropriate file set + prompt.
2. Block until it produces files + `ITERATION_NOTES.md`.
3. Spawn the Reviewer agent.
4. Block until it produces `REVIEW.md`.
5. Parse REVIEW.md for the line that begins with `**Verdict:**` (always present per the reviewer template). The value is `ACCEPTED`, `CHANGES REQUIRED`, or `ESCALATE`. On `ACCEPTED` → advance to the next slice. On `CHANGES REQUIRED` → re-spawn Implementer with the review as additional input. On `ESCALATE` → halt and surface to the human. Practical one-liner: `grep -m1 '^\*\*Verdict:\*\*' REVIEW.md`.
6. Enforce the 5-revisions-per-slice cap independently in the driver as a safety net.

If you use the Cursor TypeScript SDK, `Agent.create` / `Agent.prompt` / `Agent.resume` map directly onto this loop (one persistent agent per role, resumed each turn).

---

## 8. Conventions

- Iteration folders are zero-padded three-digit numbers (`001`, `002`, …) followed by a kebab-case slice name.
- Re-reviews **overwrite** REVIEW.md in place; the git history (if committed) preserves prior reviews. If you want every revision preserved as a distinct file, name them `REVIEW.v1.md`, `REVIEW.v2.md`, etc.
- Both agents address each other only through written artifacts in `iterations/`. They do not need synchronous chat.
- The Implementer never edits REVIEW.md. The Reviewer never edits source files or ITERATION_NOTES.md.
