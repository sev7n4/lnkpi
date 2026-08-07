# Task 12 — Deploy smoke script for sidebar attachments

## Delivered

- Added `deploy/prod-sidebar-attachments-verify.py` following the `prod-atomic-studio-verify.py` pattern.
- **Section A (unit smoke):** runs agent-runtime pytest for:
  - `normalize_sidebar_attachments` (`test_sidebar_attachments.py`)
  - atomic `localRefs` apply path (`test_atomic_sidebar_refs.py`)
  - campaign `apply_sidebar_refs` wiring (`test_campaign_sidebar_refs.py`)
- **Section B (production integration):** SSE conversation with mock image attachment:
  1. atomic — asserts image node `localRefs` / `refOrder` after create
  2. campaign — plan + confirm split, asserts `mediaInput` materialization and seed image ref edges

Environment knobs: `SKIP_UNIT=1`, `SKIP_PROD=1`, `SIDEBAR_MOCK_REF_URL`, `BASE_URL`.

## Verification

```bash
# Local unit gate (passes without prod deployment)
SKIP_PROD=1 python3 deploy/prod-sidebar-attachments-verify.py

# Full smoke (unit + prod integration)
python3 deploy/prod-sidebar-attachments-verify.py
```

Results (2026-08-07):

| Run | Result |
|-----|--------|
| `SKIP_PROD=1` | **PASS** — 11 pytest cases green |
| Full against `http://119.29.173.89:8888` | Unit **PASS**; prod integration **FAIL** — server not yet running sidebar-attachment apply path (`localRefs=0`, no `mediaInput` nodes). Expected until Tasks 1–11 are deployed. |

## Commit

```
test(deploy): sidebar attachments smoke verify
```
