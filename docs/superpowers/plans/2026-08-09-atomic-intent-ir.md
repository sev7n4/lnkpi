# Atomic Intent IR Implementation Plan

> **Goal:** Replace substring modality routing with Action×Output×Sources IR; align Agent with canvas text→video/image Dock behavior.

**Architecture:** Single module `atomic_intent_ir.py` owns resolution; `atomic_intent.py` delegates; guards in `planning_guard` + `atomic_parse_schema`; harness caps fast-path for conflict utterances.

## Completed in this change

- [x] `atomic_intent_ir.py` — IR resolver, source-backed gen, text-product disambiguation
- [x] Remove `_has_prompt_explicit` blanket rule
- [x] `planning_guard.detect_action` — generate before expand when source-backed
- [x] `validate_parse_result` — IR rewrite guard
- [x] `rule_parse_confidence` — conflict cap 0.84
- [x] `atomic_parse.py` — pass `mentioned_keys` to rule parse
- [x] LLM system prompts updated
- [x] eval-intent-set + unit tests

## Follow-up (optional)

- [ ] Enable `INTENT_LLM_PARSE=true` in production after shadow eval
- [ ] Graph compiler: attach_edges for explicit text→video topology reuse
