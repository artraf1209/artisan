from artisan.db.client import get_client


def test_supabase_reachable() -> None:
    db = get_client()
    response = db.table("strategies").select("id, name").limit(1).execute()

    assert len(response.data) == 1
    assert response.data[0]["name"] == "long_term_v0"
