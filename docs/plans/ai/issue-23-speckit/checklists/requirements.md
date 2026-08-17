# Specification Quality Checklist: Gear Movement Diff

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Validated on first pass; no remediation iterations required.

Three items warranted a deliberate judgement rather than a mechanical check:

- **"No implementation details"** — the source material for this spec is unusually
  implementation-specific, because the constraints were derived by measuring a real dataset.
  Those findings were translated into behaviour rather than carried over verbatim. FR-003 is the
  clearest case: the underlying finding is that one particular stored field goes stale on unequip,
  but the requirement states the observable consequence ("MUST NOT rely on any record the source
  system is known to leave stale", plus a zero-false-moves test) and leaves the field-level detail
  to planning. The same translation was applied to item identification and to the description
  timing rules.
- **"Success criteria are technology-agnostic"** — SC-006 cites concrete counts against a specific
  pair of snapshots, which is closer to a fixture than a user outcome. It is retained because it is
  the only hard oracle available and it caught real defects during review, but it is explicitly
  marked conditional on data that is absent from a fresh checkout, and SC-001 through SC-005 carry
  the criterion set on their own if it cannot be run.
- **"Requirements are testable"** — FR-005 lists the attributes an item description must carry, so
  it is checkable against output; the weaker phrasing "identified by what the user can see" would
  not have been.

Zero [NEEDS CLARIFICATION] markers were emitted. One question genuinely arose during drafting —
what the tool should do when the two snapshots are supplied in the wrong order — and it was
resolved to a default (warn and proceed, FR-013) rather than raised, because an inverted report is
internally consistent and therefore undetectable by a reader, which makes silence the only clearly
wrong answer.

## Re-validation: 2026-08-17 amendment

Re-checked after User Story 4 (per-holder view), FR-016 to FR-018, SC-007 and SC-008 were added.
Every box above still holds. Three notes:

- **Clarifications are now recorded in the spec**, under `## Clarifications` → Session 2026-08-17.
  Two questions were asked and answered rather than defaulted: what to do with a vault-sourced piece
  whose slot cannot be refilled (keep it, and say why), and where the new view sits in the fixed
  output order (third). Both changed the requirements — FR-017 gained its third case and FR-016 its
  placement clause — so neither was cosmetic.
- **SC-008 repeats SC-006's tradeoff**, citing counts against a second specific pair of snapshots.
  Retained on the same grounds and with the same conditional marking: it is a real oracle, it is not
  runnable in a fresh checkout, and SC-001 through SC-005 and SC-007 stand without it.
- **Two of the four dispositions in FR-017 (`unequip`, `keep`) occur in neither reference pair.**
  That is recorded in tasks.md rather than left implicit, because it means running the tool can
  never demonstrate them and the unit tests are their only coverage.
