# Tutor AX
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Korean academy students checking scores and practising English vocabulary and reading. Inferred use scene from the delegated brief: short study sessions on a phone, with desktop review at home. No user interview was available in this subagent; defaults come from the explicit approved brief and repository.

## Product Purpose
Connect weekly score review with vocabulary practice and sentence-by-sentence reading. Success is finding the relevant result and starting or reviewing practice without losing context.

## Capabilities and Constraints
React/Vite demo with synthetic score fixtures, local vocabulary favorites and wrong-answer records, and local passage reading progress. No production authentication, DB, AI grading or messaging connections. Preserve existing data semantics, missing scores, retests, absence, keyboard interactions and storage failure handling. README production roadmap remains authoritative.

## Brand Commitments
Keep the academy SVG logo. Student surfaces are explicitly approved for full redesign toward a personal study notebook. Admin must retain its existing design and behavior, but render standalone: the user's reported nested student shell is a bug, not a design constraint.

## Evidence on Hand
src/data/demo-score.json and src/vocab/model.ts are synthetic fixtures, not real student achievements. No real streaks, progress claims, testimonials or backend capabilities may be invented.

## Product Principles
- Show recorded results, never imply missing data is zero.
- Keep practice and review reachable on small screens.
- Explain demo and local storage boundaries plainly.
- Keep admin and student layouts separate.
