---
name: enterprise-marketing-campaign
description: >-
  Plans enterprise product marketing campaigns and splits deliverables onto
  an infinite canvas (copy, hero, scene, banner). Use when the user asks for
  营销方案, 主图, 详情页, Banner, or campaign visual assets.
license: Apache-2.0
compatibility: Requires lnkpi Nest canvas tools and image generation.
metadata:
  author: lnkpi
  lnkpi.canvas_manifest: assets/canvas-manifest.yaml
  lnkpi.max_downstream: "12"
allowed-tools: upsert_prompt_node add_nodes_batch connect_nodes set_node_prompt attach_refs run_image_generation get_generation_status
---

# Enterprise marketing campaign

## Instructions

1. Clarify product category, sales channel, and placement (e.g. Tmall detail page, brand site hero).
2. Draft a structured marketing plan in Markdown: positioning, copy blocks, and visual asset list.
3. Ask the user to confirm or revise before splitting the canvas.

## Split and image generation

- Follow `assets/canvas-manifest.yaml` when splitting the canvas.
- Do not call `run_image_generation` during plan; only after user confirm → split → orchestrate_gen.
- Phase-1: do not auto-generate video nodes (`show_video` is skeleton only).

## Progressive disclosure

- Keep this file concise; put long brand rules in `references/`.
- See `assets/examples/sanitary-ware.md` for a sanitary-ware campaign outline.
