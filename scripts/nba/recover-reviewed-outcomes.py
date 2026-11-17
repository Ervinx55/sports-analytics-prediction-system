"""Create a review manifest, then pinned insert-only SQL. Never executes SQL."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from ml.nba_reviewed_recovery import digest, packed, prepare_manifest, render_insert_sql, verified_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    prepare = sub.add_parser('prepare')
    prepare.add_argument('--workspace', type=Path, required=True)
    for arg in ('audit', 'observations', 'provider', 'identity-review'):
        prepare.add_argument('--'+arg, type=Path, required=True)
    prepare.add_argument('--as-of', required=True)
    prepare.add_argument('--pending', type=Path)
    prepare.add_argument('--existing', type=Path)
    prepare.add_argument('--output', type=Path, required=True)
    sql = sub.add_parser('sql')
    sql.add_argument('--workspace', type=Path, required=True)
    sql.add_argument('--manifest', type=Path, required=True)
    sql.add_argument('--reviewed-sha256', required=True)
    sql.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'prepare':
        manifest = prepare_manifest(args.workspace, audit_path=args.audit, observations_path=args.observations, provider_path=args.provider, identity_review_path=args.identity_review, as_of=args.as_of, pending_path=args.pending, existing_outcomes_path=args.existing)
        raw = (json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode('utf-8')
        args.output.write_bytes(raw)
        print(json.dumps({'manifest': str(args.output), 'sha256': digest(raw), 'scope': manifest['scope'], 'reviewRequired': True}))
    else:
        raw = args.manifest.read_bytes()
        if digest(raw) != args.reviewed_sha256:
            raise ValueError('REVIEW_HASH_MISMATCH')
        manifest = json.loads(raw)
        for ref in manifest['sources']: verified_bytes(args.workspace, ref)
        paths = {k: args.workspace / ref['path'] for k, ref in manifest['inputs'].items()}
        rebuilt = prepare_manifest(args.workspace, audit_path=paths['audit'], observations_path=paths['observations'], provider_path=paths['provider'], identity_review_path=paths['identityReview'], as_of=manifest['asOf'], pending_path=paths.get('pending'), existing_outcomes_path=paths.get('existing'))
        if packed(rebuilt) != packed(manifest): raise ValueError('REVIEWED_MANIFEST_REBUILD_MISMATCH')
        text = render_insert_sql(raw, args.reviewed_sha256)
        args.output.write_text(text, encoding='utf-8', newline='\n')
        print(json.dumps({'sql': str(args.output), 'sha256': digest(text.encode()), 'bytes': len(text.encode()), 'rows': len(manifest['rows']), 'executed': False}))


if __name__ == '__main__':
    main()
