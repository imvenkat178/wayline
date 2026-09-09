"""Create a source checkpoint with compiled assets and all documentation."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
target = root / 'artifacts' / 'wayline-ai-complete.zip'
target.parent.mkdir(exist_ok=True)
excluded = {'.git', 'node_modules', 'data', 'artifacts', 'coverage', '__pycache__', 'models'}
files = []
for path in sorted(root.rglob('*')):
    relative = path.relative_to(root)
    if not path.is_file() or path.is_symlink() or any(part in excluded for part in relative.parts):
        continue
    if (path.name.startswith('.env') and path.name != '.env.example') or path.name.endswith('.tsbuildinfo') or path.name in {'vite.config.js', 'vite.config.d.ts'}:
        continue
    files.append((path, relative))
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path, relative in files:
        archive.write(path, Path('wayline-ai') / relative)
print(f'{target}: {len(files)} files, {target.stat().st_size} bytes')
