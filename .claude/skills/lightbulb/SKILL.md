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

## Step 1: Fetch Issue

Use `gh issue view <number> --json title,body,labels` or the GitHub MCP tool to fetch the issue. Store the title and body — you'll pass these to subagents.

If the issue doesn't exist or is closed, tell the user and stop.

## Step 2: Set Up Worktree

**REQUIRED SUB-SKILL:** Use `superpowers:using-git-worktrees` to create an isolated workspace.

The worktree branch name should be derived from the issue: `feature/issue-<number>-<slug>` where `<slug>` is a short kebab-case summary of the issue title.

## Step 3: PLAN Phase

Dispatch a planning subagent (Agent tool, `subagent_type: "general-purpose"`) with this prompt structure:

> You are a planning agent. Your job is to design and plan the implementation for a GitHub issue.
>
> **Issue #N: {ISSUE_TITLE}**
>
> {ISSUE_BODY}
>
> Use `superpowers:brainstorming` to explore the codebase, understand the problem, and design a solution. When brainstorming needs user input (clarifying questions, design choices), return them to me — I will relay to the user and resume you with answers.
>
> After brainstorming is complete, use `superpowers:writing-plans` to write a detailed implementation plan to `docs/plans/YYYY-MM-DD-<topic>.md`.
>
> Do NOT proceed to implementation. Do NOT invoke finishing-a-development-branch. Your job ends when the plan file is written.
>
> When you need user input, return a message starting with `USER_INPUT_NEEDED:` followed by the question.
>
> When the plan is complete, return a message starting with `PLAN_COMPLETE:` followed by the plan file path.

**Relay pattern:** When the planning subagent returns `USER_INPUT_NEEDED:`, use `AskUserQuestion` to relay the question to the user, then resume the subagent (Agent tool with `resume` parameter) with the user's answer.

**When PLAN_COMPLETE:** Read the plan file, commit it, and proceed to Step 4.

```
git add docs/plans/*.md
git commit -m "docs: add implementation plan for issue #N"
```

## Step 4: IMPLEMENT Phase

Read the plan file to get the full plan text.

Dispatch an implementation subagent (Agent tool, `subagent_type: "general-purpose"`) with this prompt structure:

> You are an implementation agent. Implement the following plan using `superpowers:subagent-driven-development`.
>
> **Plan:**
>
> {FULL_PLAN_TEXT}
>
> Follow the plan task by task. SDD will handle per-task reviews (spec + quality).
>
> **IMPORTANT:** Do NOT invoke `superpowers:finishing-a-development-branch` when done. The orchestrator handles the PR lifecycle. When all tasks are complete, just report back.
>
> When you need clarification, return a message starting with `USER_INPUT_NEEDED:` followed by the question.
>
> When implementation is complete, return a message starting with `IMPLEMENTATION_COMPLETE:` followed by a summary of what was implemented.

**Relay pattern:** Same as planning — relay `USER_INPUT_NEEDED:` to the user, resume with answers.

**When IMPLEMENTATION_COMPLETE:** Proceed to Step 5.

## Step 5: Create Draft PR

Push the worktree branch and create a draft PR:

```
git push -u origin <branch-name>
gh pr create --draft --title "<issue-title>" --body "$(cat <<'EOF'
## Summary

<2-3 bullets summarizing the implementation>

Closes #<issue-number>

---

Autonomously developed with the lightbulb skill.

— Claude
EOF
)"
```

Store the PR number for posting review comments.

## Step 6: Review Loop

Track the current round number (starting at 1) and the max rounds (default 5).

**For each round:**

1. Get the full diff:

```
git diff main...HEAD
```

2. Read the plan file for spec context.

3. Dispatch a reviewer subagent (Agent tool, `subagent_type: "general-purpose"`) with:

> You are a code reviewer. Review the following implementation for BOTH spec compliance and code quality.
>
> **Plan (spec):**
>
> {FULL_PLAN_TEXT}
>
> **Diff:**
>
> {FULL_DIFF}
>
> Review for:
> - **Spec compliance:** Does the implementation match the plan? Anything missing or extra?
> - **Code quality:** Is the code well-structured, tested, maintainable? Any bugs, security issues, performance problems?
>
> Categorize each issue as:
> - **Critical:** Must fix — bugs, security issues, missing requirements
> - **Important:** Should fix — poor patterns, missing tests, unclear code
> - **Cosmetic:** Nice to have — style, naming, minor improvements
>
> Return your review in this format:
>
> ```
> REVIEW_RESULT:
> Status: APPROVED | NEEDS_FIXES
> Critical: <count>
> Important: <count>
> Cosmetic: <count>
>
> ## Issues
> ### Critical
> - ...
> ### Important
> - ...
> ### Cosmetic
> - ...
>
> ## Strengths
> - ...
> ```

4. Post the review as a PR comment (signed "— Claude"):

```
gh pr comment <pr-number> --body "<review-content>

— Claude"
```

5. **If Status is NEEDS_FIXES** (critical or important issues):

   Dispatch a fixer subagent (Agent tool, `subagent_type: "general-purpose"`) with:

   > You are a code fixer. Fix the following review issues:
   >
   > {REVIEW_ISSUES — critical and important only}
   >
   > Fix each issue, run tests to verify, and commit your changes.
   >
   > When done, return `FIXES_COMPLETE:` followed by a summary.

   After fixes, increment round counter and loop back to step 1.

6. **If Status is APPROVED** (only cosmetic issues remain):

   If cosmetic issues exist and rounds remain, ask the user:

   > The reviewer approved with N cosmetic suggestions. Would you like to fix those too?
   > 1. Yes, fix cosmetics (Recommended)
   > 2. No, move on

   If yes: dispatch fixer with cosmetic issues, increment round, re-review.
   If no: exit loop.

7. **If max rounds reached:** Post remaining issues as a PR comment and exit loop.

## Step 7: CI Check

After the review loop converges:

```
gh pr checks <pr-number> --watch
```

If checks fail, dispatch a fixer subagent with the failure output:

> CI pipeline failed. Diagnose and fix:
>
> {FAILURE_OUTPUT}
>
> Fix the issue, run tests locally to verify, and commit.

Re-check after fixes. If CI still fails after 2 fix attempts, report to user and stop.

## Step 8: Completion

All review rounds passed and CI is green. Ask the user:

> Development complete for issue #N.
> 1. Mark PR ready for review (Recommended)
> 2. Merge directly

If mark ready: `gh pr ready <pr-number>`
If merge: `gh pr merge <pr-number> --squash`
