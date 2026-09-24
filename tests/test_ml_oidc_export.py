from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def test_ml_workflow_uses_oidc_not_supabase_repository_secrets():
    workflow = (
        ROOT / ".github" / "workflows" / "ml-shadow.yml"
    ).read_text()
    assert "id-token: write" in workflow
    assert 'branches:' in workflow
    assert '- "master"' in workflow
    assert "supabase_live_oidc" in workflow
    assert "secrets.SUPABASE_URL" not in workflow
    assert "secrets.SUPABASE_SECRET_KEY" not in workflow
    assert "secrets.SUPABASE_SERVICE_ROLE_KEY" not in workflow


def test_github_ml_export_function_has_narrow_oidc_trust():
    source = (
        ROOT
        / "supabase"
        / "functions"
        / "github-ml-training-export"
        / "index.ts"
    ).read_text()
    assert "createRemoteJWKSet" in source
    assert 'https://token.actions.githubusercontent.com' in source
    assert 'edge-lab-supabase-ml-export' in source
    assert 'Ervinx55/sports-analytics-prediction-system' in source
    assert '.github/workflows/ml-shadow.yml@refs/heads/master' in source
    assert 'refs/heads/master' in source
    assert 'player_prop_training_export' in source
    assert 'SUPABASE_SECRET_KEYS' in source

    config = tomllib.loads(
        (ROOT / "supabase" / "config.toml").read_text()
    )
    assert (
        config["functions"]["github-ml-training-export"]["verify_jwt"]
        is False
    )


def test_oidc_exporter_pages_without_long_lived_database_secret():
    source = (ROOT / "ml" / "export_player_prop_snapshot.py").read_text()
    assert "ACTIONS_ID_TOKEN_REQUEST_URL" in source
    assert "ACTIONS_ID_TOKEN_REQUEST_TOKEN" in source
    assert 'PAGE_SIZE = 500' in source
    assert 'github-ml-training-export' in source
    assert 'SUPABASE_LIVE_OIDC' in source
