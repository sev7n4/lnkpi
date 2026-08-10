from pathlib import Path

from app.skills.loader import discover_skills

SKILLS = Path(__file__).resolve().parents[1] / "skills"


def test_ecommerce_product_visual_skill_discovered():
    ids = {s.skill_id for s in discover_skills(SKILLS)}
    assert "ecommerce-product-visual" in ids
