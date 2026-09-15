from app.graph.canvas_recipe_hydrate import hydrate_gen_by_key_from_canvas
from app.graph.chain_refs import build_chain_ref_order


def test_hydrate_from_node_data():
    nodes = [{
        "id": "image-1",
        "data": {"recipeKey": "hero_main", "chain": "product", "role": "downstream", "title": "主图"},
    }]
    by_key = hydrate_gen_by_key_from_canvas(nodes)
    assert by_key["hero_main"]["node_id"] == "image-1"
    assert by_key["hero_main"]["chain"] == "product"


def test_hydrate_uses_mentioned_keys_as_depends_on():
    nodes = [{
        "id": "image-hero",
        "data": {
            "recipeKey": "hero_main",
            "chain": "product",
            "role": "downstream",
            "title": "主图",
            "mentionedKeys": ["product_turnaround", "white_bg"],
        },
    }]
    by_key = hydrate_gen_by_key_from_canvas(nodes)
    assert by_key["hero_main"]["depends_on"] == ["product_turnaround", "white_bg"]
    assert by_key["hero_main"]["role"] == "downstream"
    assert by_key["hero_main"]["title"] == "主图"


def test_hydrated_imported_nodes_attach_turnaround_by_role():
    nodes = [
        {
            "id": "image-seed",
            "data": {"recipeKey": "seed", "chain": "outfit", "role": "seed", "title": "定妆"},
        },
        {
            "id": "image-ta",
            "data": {
                "recipeKey": "ta",
                "chain": "outfit",
                "role": "turnaround",
                "title": "四视图",
                "mentionedKeys": ["seed"],
            },
        },
        {
            "id": "image-down",
            "data": {
                "recipeKey": "down",
                "chain": "outfit",
                "role": "downstream",
                "title": "穿搭",
                "mentionedKeys": ["ta"],
            },
        },
    ]
    by_key = hydrate_gen_by_key_from_canvas(nodes)
    order = build_chain_ref_order(item=by_key["down"], by_key=by_key, plan_node_id=None)
    assert order == ["image-seed", "image-ta"]
