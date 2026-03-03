---
name: lightbulb
description: >
  Use when the user provides a GitHub issue number and wants end-to-end
  autonomous development — planning, implementation, review, and PR creation —
  handled by subagents in an isolated worktree.
---

# Lightbulb

End-to-end autonomous development from a GitHub issue. Dispatches subagents for each phase: planning, implementation, review, and fix. All work happens in an isolated git worktree. The orchestrator (you) manages phase transitions, relays user interaction, and handles the PR lifecycle.

**Announce at start:** "I'm using the lightbulb skill to develop issue #N end-to-end."

## Input

- `issue_number` (required) — GitHub issue number in the current repo.
- `max_review_rounds` (optional, default 5) — cap on review-fix loop iterations.

Parse these from the user's message. If the issue number is ambiguous, ask.

## Flow

```
1. Parse input (issue number, optional max rounds)
2. Fetch issue from GitHub
3. Set up worktree — REQUIRED SUB-SKILL: superpowers:using-git-worktrees
4. PLAN — dispatch planning subagent
5. IMPLEMENT — dispatch implementation subagent
6. Create draft PR linked to the issue
7. REVIEW LOOP (up to N rounds)
8. Check CI pipelines
9. Ask user: mark PR ready (default) or merge
```
