import json
from pathlib import Path

from scripts.supabase.production_drift import expected_function_inventory


def test_local_source_uses_remote_observation_not_local_bundle():
    item = {'slug': 'example', 'status': 'LOCAL_SOURCE',
            'verify_jwt': True, 'bundle_sha256': 'local',
            'deploymentObservation': {'status': 'ACTIVE', 'version': 4,
                'verify_jwt': True, 'bundle_sha256': 'remote',
                'localSourceParityVerified': False}}
    assert expected_function_inventory([item]) == [
        {'slug': 'example', 'status': 'ACTIVE', 'version': 4,
         'verify_jwt': True, 'ezbr_sha256': 'remote'}]


def test_local_source_without_deployment_observation_is_not_expected_live():
    assert expected_function_inventory([
        {'slug': 'unreleased', 'status': 'LOCAL_SOURCE'}]) == []


def test_repository_inventory_builds_drift_expectations():
    root = Path(__file__).resolve().parents[2]
    items = json.loads((root / 'supabase/manifests/edge-functions.json').read_text())['items']
    expected = expected_function_inventory(items)
    assert len(expected) == 54
    for item in items:
        actual = next(x for x in expected if x['slug'] == item['slug'])
        source = item.get('deploymentObservation', item)
        assert actual['version'] == source['version']
        assert actual['ezbr_sha256'] == source['bundle_sha256']
