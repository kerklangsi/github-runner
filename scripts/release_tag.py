import os, sys, json, subprocess
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.insert(0, str(Path(__file__).parent.resolve()))
from sync_version import sync_files

# Computes next semantic version string according to bump level
def bump_version(ver, bump_type='patch'):
    clean = ver.lstrip('v').strip()
    parts = ([int(x) if x.isdigit() else 0 for x in clean.split('.')] + [0, 0])[:3]
    if bump_type == 'major':
        return f"{parts[0] + 1}.0.0"
    if bump_type == 'minor':
        return f"{parts[0]}.{parts[1] + 1}.0"
    return f"{parts[0]}.{parts[1]}.{parts[2] + 1}"

# Resolves release tag, increments version from commit context, and syncs files
def release_tag(repo_root, override=None, dry_run=False):
    pkg_file = Path(repo_root) / 'backend' / 'package.json'
    cur_ver = '3.2.0'
    if pkg_file.exists():
        try:
            cur_ver = json.loads(pkg_file.read_text(encoding='utf-8')).get('version', '3.2.0')
        except Exception:
            pass

    override_val = (override or '').strip()
    if not override_val and os.environ.get('GITHUB_REF_TYPE') == 'tag':
        override_val = os.environ.get('GITHUB_REF_NAME', '').strip()

    if override_val and override_val.lower() not in ('latest', 'none', ''):
        if dry_run:
            ver = override_val.lstrip('v').strip()
            return f"v{ver}", ver != cur_ver, ver
        ver, updated = sync_files(override_val, Path(repo_root))
        return f"v{ver}", bool(updated), ver

    try:
        last_msg = subprocess.check_output(
            ['git', 'log', '-1', '--pretty=%B'],
            cwd=repo_root
        ).decode('utf-8', errors='ignore').strip()
    except Exception:
        last_msg = ''

    if 'chore(release):' in last_msg or '[skip ci]' in last_msg.lower():
        return f"v{cur_ver}", False, cur_ver

    bump_type = 'major' if '[major]' in last_msg.lower() else ('minor' if '[minor]' in last_msg.lower() else 'patch')
    new_ver = bump_version(cur_ver, bump_type)
    if dry_run:
        return f"v{new_ver}", True, new_ver

    _, updated = sync_files(new_ver, Path(repo_root))
    print(f"[VERSION] Bumped version: {cur_ver} -> {new_ver} ({bump_type})", file=sys.stderr)
    return f"v{new_ver}", True, new_ver

# Program entry point to determine tag and manage version updates for CI release workflow
def main():
    repo_root = Path(__file__).parent.parent.resolve()
    is_ci = '--ci' in sys.argv
    dry_run = '--dry-run' in sys.argv or '--check' in sys.argv
    override = next((a for a in sys.argv[1:] if not a.startswith('--')), None)
    tag, bumped, pkg_ver = release_tag(repo_root, override, dry_run=dry_run)
    if is_ci:
        print(f"tag={tag}\npkg_version={pkg_ver}\nbumped={str(bumped).lower()}")
    else:
        print(tag)

if __name__ == '__main__':
    main()
