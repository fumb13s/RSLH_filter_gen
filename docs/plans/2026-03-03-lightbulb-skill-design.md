# Lightbulb Skill — Design Document

**Goal:** A standalone Claude Code skill (`lightbulb`) that takes a GitHub issue number and autonomously drives end-to-end development: planning, implementation, review, and PR creation — all in an isolated worktree, all via subagents.

---

## Skill Identity

- **Name:** `lightbulb`
- **Location:** `.claude/skills/lightbulb/SKILL.md`
- **Not** part of the superpowers group — standalone skill.
- **Trigger:** User provides a GitHub issue number and wants autonomous development.
- **Parameters:**
  - `issue_number` (required) — GitHub issue number in the current repo.
  - `max_review_rounds` (optional, default 5) — cap on review loop iterations.

---

## Overall Flow

```
1. Parse input (issue number, optional max rounds)
2. Fetch issue from GitHub
3. Set up worktree (superpowers:using-git-worktrees)
4. PLAN — subagent brainstorms then writes plan
   - Brainstorming questions relayed to user via orchestrator
   - Commit plan to branch
5. IMPLEMENT — subagent uses superpowers:subagent-driven-development
   - Follows the plan, commits per task
   - Skips finishing-a-development-branch (orchestrator handles that)
6. Create draft PR linked to the issue
7. REVIEW LOOP — up to N rounds (default 5):
   a. Subagent reviews full diff (combined spec + quality)
   b. Post review as PR comment
   c. If critical/important issues → subagent fixes, commit, goto (a)
   d. If only cosmetics remain → ask user whether to fix those too
      - Yes and rounds remain → subagent fixes, commit, goto (a)
      - No → exit loop
8. Check CI pipelines — if broken, fix and commit
9. Ask user: mark PR ready for review (default) or merge directly
```

---

## Phase Details

### PLAN

The orchestrator spawns a planning subagent with the issue body and codebase context.

1. Subagent uses `superpowers:brainstorming` — explores codebase, formulates questions.
2. When brainstorming needs user input, the subagent returns questions to the orchestrator, which relays them to the user via `AskUserQuestion`, then resumes the subagent with answers.
3. Once design is settled, subagent uses `superpowers:writing-plans` to produce `docs/plans/YYYY-MM-DD-<topic>.md`.
4. Orchestrator commits the plan.

**Key constraint:** The planning subagent cannot interact with the user directly. The orchestrator is the relay.

### IMPLEMENT

The orchestrator spawns an implementation subagent with the plan text.

1. Subagent uses `superpowers:subagent-driven-development` internally (dispatches its own sub-subagents for implementation + per-task spec/quality reviews).
2. Does NOT invoke `superpowers:finishing-a-development-branch` — the orchestrator handles PR/merge lifecycle.
3. Commits happen per-task within SDD.

### CREATE DRAFT PR

Orchestrator creates a draft PR:
- Branch: the worktree branch
- Title: from issue title
- Body: summary of the plan + "Closes #N"
- Linked to the issue

### REVIEW LOOP

The orchestrator spawns a reviewer subagent with the full diff (`git diff main...HEAD`) and the plan text.

1. Reviewer checks spec compliance AND code quality in a single pass.
2. Returns a structured report: issues categorized as critical / important / cosmetic.
3. Orchestrator posts the review as a PR comment (signed "— Claude").

If critical/important issues exist, orchestrator spawns a fixer subagent with the review comments. The fixer commits fixes. Then back to review.

Loop exit conditions:
- Reviewer finds only cosmetic issues → ask user whether to fix those too.
- Max rounds (default 5) reached → post remaining issues, stop.

### CI CHECK

After review loop converges:
1. Check CI pipelines (`gh run list` or equivalent).
2. If failures, spawn a fixer subagent to diagnose and fix.
3. Re-check until green or report to user.

### COMPLETION

Ask user:
- Mark PR ready for review (default)
- Merge directly

---

## Orchestrator Responsibilities

The orchestrator (main Claude instance) handles everything that crosses phase boundaries:

1. **State management** — tracks current phase, review round count, issue metadata.
2. **User relay** — relays brainstorming questions from planning subagent to user and back.
3. **Git operations** — commits after each phase.
4. **GitHub operations** — fetches issue, creates draft PR, posts review comments, marks ready/merges.
5. **Decision points** — asks user about fixing cosmetics, final PR disposition.
6. **Subagent dispatch** — spawns each phase's agent with appropriate context, always sequential.

The orchestrator does NOT:
- Write code itself (subagents do that).
- Run tests itself (subagents verify their own work; CI check is the exception).
- Make design decisions (relays to user).

### Error Handling

If a subagent fails or returns an error:
- Orchestrator reports the failure to the user.
- Asks whether to retry, skip, or abort.
- Never silently continues past a failed phase.

### Subagent Context Passing

Each subagent gets:
- **Planner:** issue title + body, repo structure overview.
- **Implementer:** full plan text, instruction to use SDD but skip finishing-a-development-branch.
- **Reviewer:** plan text + full diff + PR context.
- **Fixer:** review comments + relevant file contents.

---

## Skill Structure

Single file — thin orchestrator with maximum skill reuse:

```
.claude/skills/lightbulb/SKILL.md
```

No prompt templates initially. Subagents get natural-language prompts referencing the skills they should use. Templates can be added later if subagent behavior needs tuning.

### Skills Called (downstream)

- `superpowers:using-git-worktrees` — worktree setup
- `superpowers:brainstorming` — design exploration (via planning subagent)
- `superpowers:writing-plans` — plan creation (via planning subagent)
- `superpowers:subagent-driven-development` — implementation (via implementer subagent)

### Skills NOT Called

- `superpowers:finishing-a-development-branch` — orchestrator handles PR lifecycle directly.
- `superpowers:executing-plans` — SDD is used instead.
