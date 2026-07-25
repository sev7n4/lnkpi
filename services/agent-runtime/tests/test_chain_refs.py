from app.graph.chain_refs import build_chain_ref_order


def test_downstream_includes_seed_and_turnaround():
    by_key = {
        "white_bg": {"key": "white_bg", "role": "seed", "chain": "product", "node_id": "n-seed"},
        "product_turnaround": {
            "key": "product_turnaround",
            "role": "turnaround",
            "chain": "product",
            "node_id": "n-ta",
            "depends_on": ["white_bg"],
        },
        "hero_main": {
            "key": "hero_main",
            "role": "downstream",
            "chain": "product",
            "node_id": "n-hero",
            "depends_on": ["product_turnaround", "white_bg"],
        },
    }
    order = build_chain_ref_order(
        item=by_key["hero_main"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order == ["n-plan", "n-seed", "n-ta"]


def test_video_lifestyle_appends_cross_chain_deps():
    by_key = {
        "white_bg": {"key": "white_bg", "role": "seed", "chain": "product", "node_id": "n-w"},
        "product_turnaround": {
            "key": "product_turnaround",
            "role": "turnaround",
            "chain": "product",
            "node_id": "n-pta",
        },
        "scene": {"key": "scene", "role": "downstream", "chain": "product", "node_id": "n-sc"},
        "model_portrait": {
            "key": "model_portrait",
            "role": "seed",
            "chain": "model",
            "node_id": "n-mp",
        },
        "model_turnaround": {
            "key": "model_turnaround",
            "role": "turnaround",
            "chain": "model",
            "node_id": "n-mta",
        },
        "model_lifestyle": {
            "key": "model_lifestyle",
            "role": "downstream",
            "chain": "model",
            "node_id": "n-ml",
        },
        "video_lifestyle": {
            "key": "video_lifestyle",
            "role": "downstream",
            "chain": "model",
            "node_id": "n-vl",
            "depends_on": ["model_lifestyle", "product_turnaround", "scene"],
        },
    }
    order = build_chain_ref_order(
        item=by_key["video_lifestyle"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order[0] == "n-plan"
    assert order[1:3] == ["n-mp", "n-mta"]
    assert "n-ml" in order and "n-pta" in order and "n-sc" in order


def test_no_chain_uses_depends_on():
    by_key = {
        "copy_main": {"key": "copy_main", "node_id": "n-copy", "depends_on": []},
    }
    order = build_chain_ref_order(
        item=by_key["copy_main"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order == ["n-plan"]


def test_turnaround_includes_seed_only():
    by_key = {
        "white_bg": {"key": "white_bg", "role": "seed", "chain": "product", "node_id": "n-seed"},
        "product_turnaround": {
            "key": "product_turnaround",
            "role": "turnaround",
            "chain": "product",
            "node_id": "n-ta",
            "depends_on": ["white_bg"],
        },
    }
    order = build_chain_ref_order(
        item=by_key["product_turnaround"], by_key=by_key, plan_node_id="n-plan"
    )
    assert order == ["n-plan", "n-seed"]
