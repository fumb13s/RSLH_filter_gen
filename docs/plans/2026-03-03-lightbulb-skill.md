# Lightbulb Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a standalone Claude Code skill that takes a GitHub issue number and autonomously drives end-to-end development (plan → implement → review → PR) using subagents in an isolated worktree.

**Architecture:** Single SKILL.md file in `.claude/skills/lightbulb/`. Thin orchestrator that dispatches independent Agent tool subagents for each phase, relaying human-interactive bits (brainstorming questions) to the user. Reuses existing superpowers skills for planning, implementation, and worktree management.

**Tech Stack:** Claude Code skill (YAML frontmatter + Markdown), no code dependencies.

---

## Task 1: Create SKILL.md with frontmatter and overview

**Files:**
- Create: `.claude/skills/lightbulb/SKILL.md`

### Step 1: Create skill directory

Run: `mkdir -p .claude/skills/lightbulb`

### Step 2: Write SKILL.md with frontmatter, overview, and flow outline

Create `.claude/skills/lightbulb/SKILL.md` with this exact content:

````markdown
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
````

### Step 3: Verify file exists and frontmatter is valid

Run: `head -6 .claude/skills/lightbulb/SKILL.md`

Expected: YAML frontmatter with `name: lightbulb` and `description:` starting with "Use when".

### Step 4: Commit

```
feat: create lightbulb skill with frontmatter and overview
```

---

## Task 2: Add PLAN and IMPLEMENT phase instructions

**Files:**
- Modify: `.claude/skills/lightbulb/SKILL.md`

### Step 1: Append PLAN phase section

Append to SKILL.md after the Flow section:

````markdown

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
````

### Step 2: Verify the file reads coherently

Run: `wc -l .claude/skills/lightbulb/SKILL.md`

Expected: approximately 90-110 lines.

### Step 3: Commit

```
feat(lightbulb): add PLAN and IMPLEMENT phase instructions
```

---

## Task 3: Add REVIEW LOOP, CI CHECK, and COMPLETION phases

**Files:**
- Modify: `.claude/skills/lightbulb/SKILL.md`

### Step 1: Append review loop section

Append to SKILL.md:

````markdown

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
````

### Step 2: Verify line count

Run: `wc -l .claude/skills/lightbulb/SKILL.md`

Expected: approximately 200-240 lines.

### Step 3: Commit

```
feat(lightbulb): add review loop, CI check, and completion phases
```

---

## Task 4: Add error handling, red flags, and integration sections

**Files:**
- Modify: `.claude/skills/lightbulb/SKILL.md`

### Step 1: Append error handling and red flags

Append to SKILL.md:

````markdown

## Error Handling

If any subagent fails or returns an unexpected result:

1. Report the failure to the user with context (which phase, what happened).
2. Ask: Retry / Skip this phase / Abort entirely.
3. Never silently continue past a failed phase.

If a subagent needs user input but doesn't use the `USER_INPUT_NEEDED:` protocol, check its output for questions and relay them manually.

## Red Flags

**Never:**
- Write code yourself — always dispatch a subagent
- Skip the review loop — even if implementation "looks good"
- Continue past a failed phase without user acknowledgment
- Create a PR before implementation is complete
- Dispatch subagents in parallel — phases are sequential
- Post review comments without signing "— Claude"
- Merge without explicit user consent
- Run more review rounds than the configured max

**Always:**
- Relay brainstorming questions to the user — don't answer them yourself
- Commit after each phase (plan, implementation fixes, review fixes, CI fixes)
- Post every review on the PR as a comment
- Check CI after the review loop converges
- Ask the user before merging or marking ready

## Integration

**Skills called (via subagents):**
- `superpowers:using-git-worktrees` — worktree setup (orchestrator invokes directly)
- `superpowers:brainstorming` — design exploration (planning subagent)
- `superpowers:writing-plans` — plan creation (planning subagent)
- `superpowers:subagent-driven-development` — implementation (implementer subagent)

**Skills NOT called:**
- `superpowers:finishing-a-development-branch` — orchestrator handles PR lifecycle directly
- `superpowers:executing-plans` — SDD used instead
````

### Step 2: Verify complete file

Run: `wc -l .claude/skills/lightbulb/SKILL.md && head -5 .claude/skills/lightbulb/SKILL.md && tail -5 .claude/skills/lightbulb/SKILL.md`

Expected: ~250-280 lines, starts with YAML frontmatter, ends with integration section.

### Step 3: Commit

```
feat(lightbulb): add error handling, red flags, and integration
```

---

## Verification

After all tasks:

1. **Read the complete SKILL.md** end-to-end and verify:
   - Frontmatter is valid YAML with `name` and `description`
   - Description starts with "Use when" and doesn't summarize workflow
   - All 8 steps are present and in order
   - Subagent prompts are complete with placeholder syntax
   - Relay pattern is documented for each subagent that might need user input
   - Error handling covers all failure modes
   - Red flags cover all risky shortcuts

2. **Verify skill is discoverable:**
   Run: `ls -la .claude/skills/lightbulb/SKILL.md`
   Expected: file exists with non-zero size.
