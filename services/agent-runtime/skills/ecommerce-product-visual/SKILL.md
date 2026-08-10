---
name: ecommerce-product-visual
description: >-
  Product photo QA → dynamic visual plan → parallel image gen → per-type delivery.
  Use when user uploads product photos and asks for listing, packaging, or multi-type visuals.
metadata:
  author: lnkpi
  lnkpi.canvas_manifest: assets/canvas-manifest.yaml
  lnkpi.max_downstream: "12"
  lnkpi.prompt_version: "1.0.0"
  lnkpi.topology_mode_default: trimmed
allowed-tools: upsert_prompt_node add_nodes_batch connect_nodes set_node_prompt attach_refs run_image_generation get_generation_status
---

# Ecommerce product visual

## Instructions

1. Run image QA on uploaded product photos; block or remediate before planning.
2. Draft a dynamic visual plan from QA pass and user intent (listing, packaging, multi-type).
3. Ask the user to confirm or revise the scheme before canvas split and image generation.

## Split and image generation

- Follow `assets/canvas-manifest.yaml` when splitting the canvas.
- Phase 1: product chain seed only — white_bg → product_turnaround; no video nodes.
- Do not call `run_image_generation` during plan; only after user confirms the scheme.
