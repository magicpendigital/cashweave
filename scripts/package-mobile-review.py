"""Offline exact-allowlist ZIP; no discovery, deployment or release authority."""
from contextlib import ExitStack, contextmanager
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import unicodedata
import zipfile

CHUNK = 64 * 1024
MAX_MANIFEST = 1024 * 1024
MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
REPARSE_POINT = 0x400
BLOCKED_PARTS = frozenset({
    'documents', 'data', 'private', 'secrets', 'backup', 'backups', 'save',
    'saves', 'userdata', '.aws', '.codex', '.ssh', '.git', '.npm-cache',
    '.gradle', '.gradle-home', '.gradle-desktop', '.android-sdk', 'cache',
    'caches', '__pycache__', 'node_modules', 'build',
})
BLOCKED_SUFFIXES = frozenset({
    '.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm', '.sqlite-wal',
    '.sqlite-shm', '.sqlite3-wal', '.sqlite3-shm', '.jks', '.keystore',
    '.pem', '.key', '.p12', '.pfx', '.apk', '.aab', '.zip', '.7z', '.log',
})
BLOCKED_NAMES = frozenset({'credentials', 'credential', 'credentials.json', 'local.properties',
                           'id_rsa', 'id_ed25519', 'tokens.json', '.npmrc', '.pypirc',
                           '.netrc', 'secrets.json', 'service-account.json'})


class PackagingError(ValueError):
    pass


def fail(message):
    raise PackagingError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def path_parts(value):
    if not isinstance(value, str) or not value or len(value) > 240:
        fail('Invalid relative input path')
    if value != unicodedata.normalize('NFC', value):
        fail('Noncanonical Unicode path')
    if any(ord(c) < 32 or c in '<>:"\\|?*' for c in value):
        fail('Invalid path character, drive or alternate data stream')
    parts = value.split('/')
    for part in parts:
        if not part or part in {'.', '..'} or part.endswith(('.', ' ')):
            fail('Absolute/traversal/noncanonical path')
        if re.fullmatch(r'(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part, re.I):
            fail('Reserved Windows path')
    return parts


def permitted(value):
    parts = path_parts(value)
    lower = [p.casefold() for p in parts]
    name = lower[-1]
    if any(p in BLOCKED_PARTS for p in lower):
        fail('Private data/cache directory is not a packaging input')
    if name.startswith('.env') or name in BLOCKED_NAMES:
        fail('Secret/machine-specific input is blocked')
    if any(name.endswith(ext) for ext in BLOCKED_SUFFIXES):
        fail('Database/key/archive/raw-log input is blocked')
    if name.endswith('.json') and ('backup' in name or name in {'save.json', 'personal.json'}):
        fail('Private save/backup input is blocked')
    return parts


def identity(info):
    # Windows st_ctime is deprecated and differs between stat/fstat after writes.
    # Bind object identity, length, mtime and birthtime there; SHA-256 binds bytes.
    stamp = info.st_birthtime_ns if os.name == 'nt' else info.st_ctime_ns
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, stamp)


def create_staged(parent):
    # Windows-only transaction: keep a write/delete-capable handle while denying
    # other writers/deletion. Never reopen the staging path to read ZIP content.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    create.restype = ctypes.c_void_p
    import msvcrt
    for _ in range(8):
        staged = parent / ('.cashweave-package-' + secrets.token_hex(16) + '.partial')
        handle = create(str(staged), 0xC0010000, 0x1, None, 1, 0x100, None)
        if handle == ctypes.c_void_p(-1).value:
            error = ctypes.get_last_error()
            if error in {80, 183}:
                continue
            raise ctypes.WinError(error)
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDWR | os.O_BINARY)
        except BaseException:
            close = kernel.CloseHandle
            close.argtypes = [ctypes.c_void_p]
            close(handle)
            raise
        return fd, staged
    fail('Cannot create a unique staging file')


def handle_information(fd, kind, buffer, length):
    import msvcrt
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    call = kernel.SetFileInformationByHandle
    call.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    call.restype = ctypes.c_int
    if not call(msvcrt.get_osfhandle(fd), kind, ctypes.byref(buffer), length):
        raise ctypes.WinError(ctypes.get_last_error())


def discard_staged(fd):
    # Mark this owned handle for deletion on close; never unlink a mutable path.
    disposition = ctypes.c_ubyte(1)
    handle_information(fd, 4, disposition, 1)


def publish_new(staged, output, fd):
    if staged.parent != output.parent:
        fail('Publication must stay in the validated output directory')
    if os.path.normcase(str(final_handle_path(fd))) != os.path.normcase(str(staged)):
        fail('Staging handle drift before publication')
    class RenameInfo(ctypes.Structure):
        _fields_ = [('flags', ctypes.c_uint32), ('root', ctypes.c_void_p),
                    ('length', ctypes.c_uint32), ('name', ctypes.c_wchar * 1)]
    encoded = str(output).encode('utf-16-le')
    offset = RenameInfo.name.offset
    buffer = ctypes.create_string_buffer(offset + len(encoded) + 2)
    info = RenameInfo.from_buffer(buffer)
    info.flags = 0  # ReplaceIfExists FALSE; no replacement flags/fallback.
    info.root = None
    info.length = len(encoded)
    ctypes.memmove(ctypes.addressof(buffer) + offset, encoded, len(encoded))
    handle_information(fd, 3, buffer, len(buffer))
    if os.path.normcase(str(final_handle_path(fd))) != os.path.normcase(str(output)):
        fail('Publication target drift')


def no_links(path, directory=False):
    """lstat explicit ancestors only: never enumerate root or sibling directories."""
    path = Path(os.path.abspath(path))
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & REPARSE_POINT:
            fail('Symlink/junction/reparse point is blocked')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                fail('Expected a real directory')
        elif not stat.S_ISREG(info.st_mode):
            fail('Expected a regular file')
    return path, info


def final_handle_path(fd):
    """Check the actual opened target before reading any content."""
    if os.name == 'nt':
        import msvcrt
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        call = kernel.GetFinalPathNameByHandleW
        call.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
        call.restype = ctypes.c_uint32
        buffer = ctypes.create_unicode_buffer(32768)
        size = call(msvcrt.get_osfhandle(fd), buffer, len(buffer), 0)
        if not size or size >= len(buffer):
            fail('Cannot validate opened file handle path')
        name = buffer.value
        if name.startswith('\\\\?\\UNC\\'):
            fail('UNC source is not supported')
        return Path(name.removeprefix('\\\\?\\'))
    proc = Path('/proc/self/fd') / str(fd)
    if proc.exists():
        return Path(os.readlink(proc))
    fail('Platform cannot validate opened file target')


def default_opener(path):
    if os.name == 'nt':
        import msvcrt
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        create = kernel.CreateFileW
        create.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
        create.restype = ctypes.c_void_p
        # Read sharing only: reject concurrent writers/deletion while held.
        handle = create(str(path), 0x80000000, 0x1, None, 3, 0x00200000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            close = kernel.CloseHandle
            close.argtypes = [ctypes.c_void_p]
            close(handle)
            raise
        return os.fdopen(fd, 'rb')
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    return os.fdopen(os.open(path, flags), 'rb')


def checked_open(path, expected, opener):
    file = opener(path)
    try:
        actual = final_handle_path(file.fileno())
        if os.path.normcase(str(actual)) != os.path.normcase(str(path)):
            fail('Opened file resolves outside its exact approved path')
        if identity(os.fstat(file.fileno())) != identity(expected):
            fail('Input identity changed before read')
        no_links(path)
        return file
    except BaseException:
        file.close()
        raise


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail('Duplicate JSON object key')
        result[key] = value
    return result


def load_allowlist(path, expected_hash, opener):
    if not re.fullmatch('[0-9a-f]{64}', expected_hash or ''):
        fail('Exact manifest SHA-256 is required')
    path = Path(os.path.abspath(path))
    # The bootstrap metadata is explicitly supplied and pinned, not discovered.
    if path.suffix.casefold() != '.json' or not re.search('manifest|allowlist', path.name, re.I):
        fail('Expected an explicit manifest/allowlist JSON filename')
    permitted(path.name)
    path, info = no_links(path)
    if info.st_size > MAX_MANIFEST or info.st_nlink != 1:
        fail('Manifest size/hardlink is not supported')
    with checked_open(path, info, opener) as file:
        raw = file.read(MAX_MANIFEST + 1)
        if identity(os.fstat(file.fileno())) != identity(info):
            fail('Manifest changed during read')
    if sha256(raw) != expected_hash:
        fail('Manifest hash drift')
    try:
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PackagingError('Invalid allowlist JSON') from error
    if not isinstance(data, dict) or set(data) != {'schemaVersion', 'snapshotId', 'files'}:
        fail('Unexpected manifest schema')
    if type(data['schemaVersion']) is not int or data['schemaVersion'] != 1:
        fail('Unsupported schema version')
    if not isinstance(data['snapshotId'], str) or not re.fullmatch('[A-Za-z0-9_-]{1,80}', data['snapshotId']):
        fail('Invalid snapshot identifier')
    files = data['files']
    if not isinstance(files, list) or not 1 <= len(files) <= 4096:
        fail('Expected a nonempty exact file allowlist')
    seen = set()
    total = 0
    # Validate the complete list before stat/open/hash of ANY source input.
    for item in files:
        if not isinstance(item, dict) or set(item) != {'path', 'sha256', 'bytes'}:
            fail('Unexpected file record')
        permitted(item['path'])
        key = item['path'].casefold()
        if key in seen:
            fail('Duplicate/case-colliding archive input')
        seen.add(key)
        if not isinstance(item['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            fail('Invalid file hash')
        if type(item['bytes']) is not int or not 0 <= item['bytes'] <= MAX_FILE:
            fail('Invalid/oversized file length')
        total += item['bytes']
    if total > MAX_TOTAL:
        fail('Snapshot exceeds bounded packaging size')
    return data, raw, path, info


@contextmanager
def lock_windows_directories(paths):
    """Prevent explicit ancestors being renamed/replaced during packaging."""
    if os.name != 'nt':
        yield
        return
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    create.restype = ctypes.c_void_p
    close = kernel.CloseHandle
    close.argtypes = [ctypes.c_void_p]
    close.restype = ctypes.c_int
    directories = set()
    for path in paths:
        directories.update([path, *path.parents])
    with ExitStack() as stack:
        for directory in sorted(directories, key=lambda p: (len(p.parts), str(p).casefold())):
            no_links(directory, directory=True)
            # Share read/write, NOT DELETE: ancestors cannot be moved/replaced.
            handle = create(str(directory), 0, 0x1 | 0x2, None, 3, 0x02000000 | 0x00200000, None)
            if handle == ctypes.c_void_p(-1).value:
                raise PackagingError('Cannot freeze explicit directory ancestors')
            stack.callback(close, handle)
            no_links(directory, directory=True)
        yield


def package_snapshot(root, manifest, manifest_sha256, output, *, opener=default_opener, after_chunk=None):
    if os.name != 'nt':
        fail('This handle-frozen transaction currently supports local Windows only')
    root = Path(os.path.abspath(root))
    output = Path(os.path.abspath(output))
    manifest = Path(os.path.abspath(manifest))
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    drive_type = kernel.GetDriveTypeW
    drive_type.argtypes = [ctypes.c_wchar_p]
    drive_type.restype = ctypes.c_uint32
    for path in [root, output, manifest]:
        if path.anchor.startswith('\\\\') or drive_type(path.anchor) not in {2, 3, 6}:
            fail('UNC/network/unknown drives are not supported')
    root, _ = no_links(root, directory=True)
    if output.suffix.casefold() != '.zip':
        fail('Output must be a new ZIP')
    path_parts(output.name)
    no_links(output.parent, directory=True)
    if os.path.lexists(output):
        fail('Output already exists')
    if output == root or root in output.parents:
        fail('Output must be outside source root')
    if Path(os.path.abspath(manifest)).parent != output.parent:
        fail('Pinned allowlist must be in the explicitly selected output directory')
    data, raw, manifest_path, manifest_info = load_allowlist(manifest, manifest_sha256, opener)
    plan = []
    ids = set()
    for item in sorted(data['files'], key=lambda f: f['path'].casefold()):
        path = root.joinpath(*path_parts(item['path']))
        try:
            path, info = no_links(path)
        except OSError as error:
            raise PackagingError('Missing/inaccessible exact input') from error
        if root not in path.parents or info.st_size != item['bytes'] or info.st_nlink != 1 or not info.st_ino:
            fail('Outside-root/size/hardlink mismatch')
        key = (info.st_dev, info.st_ino)
        if key in ids:
            fail('Duplicate physical input')
        ids.add(key)
        if path == manifest_path:
            fail('Manifest cannot also be a source input')
        plan.append((item, path, info))
    with (
        lock_windows_directories([root, output.parent, manifest_path.parent, *[p.parent for _, p, _ in plan]]),
        ExitStack() as input_handles,
    ):
        for _, path, info in plan:
            _, current = no_links(path)
            if identity(current) != identity(info):
                fail('Input changed during planning')
        if os.path.lexists(output):
            fail('Output appeared during planning')
        # Hold the exact manifest and every source handle until publication.
        held_manifest = input_handles.enter_context(checked_open(manifest_path, manifest_info, opener))
        if sha256(held_manifest.read(MAX_MANIFEST + 1)) != manifest_sha256:
            fail('Manifest changed before source read')
        held = {path: input_handles.enter_context(checked_open(path, info, opener)) for _, path, info in plan}
        fd, staged = create_staged(output.parent)
        temp_file = None
        published = False
        try:
            if os.path.normcase(str(final_handle_path(fd))) != os.path.normcase(str(staged)):
                fail('Staged output escaped its directory')
            temp_file = os.fdopen(fd, 'w+b')
            fd = None
            with zipfile.ZipFile(temp_file, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
                manifest_entry = zipfile.ZipInfo('SOURCE-MANIFEST.json', (2026, 1, 1, 0, 0, 0))
                manifest_entry.external_attr = 0o644 << 16
                archive.writestr(manifest_entry, raw)
                for item, path, info in plan:
                    digest = hashlib.sha256()
                    size = 0
                    source_file = held[path]
                    entry = zipfile.ZipInfo('financial-assistant/' + item['path'], (2026, 1, 1, 0, 0, 0))
                    entry.external_attr = 0o644 << 16
                    with archive.open(entry, 'w') as target:
                        while chunk := source_file.read(CHUNK):
                            size += len(chunk)
                            if size > item['bytes']:
                                fail('Input grew during read')
                            digest.update(chunk)
                            target.write(chunk)
                            if after_chunk is not None:
                                after_chunk(path, size)
                    if identity(os.fstat(source_file.fileno())) != identity(info):
                        fail('Input changed during read')
                    if size != item['bytes'] or digest.hexdigest() != item['sha256']:
                        fail('Input hash/length drift')
                    _, current = no_links(path)
                    if identity(current) != identity(info):
                        fail('Input replaced during read')
            temp_file.flush()
            os.fsync(temp_file.fileno())
            temp_file.seek(0)
            with zipfile.ZipFile(temp_file) as archive:
                expected = {'SOURCE-MANIFEST.json', *['financial-assistant/' + f['path'] for f in data['files']]}
                names = archive.namelist()
                if len(names) != len(expected) or set(names) != expected:
                    fail('Archive inventory parity failed')
                if archive.read('SOURCE-MANIFEST.json') != raw:
                    fail('Archive manifest drift')
                for item, _, _ in plan:
                    digest = hashlib.sha256()
                    with archive.open('financial-assistant/' + item['path']) as entry:
                        while chunk := entry.read(CHUNK):
                            digest.update(chunk)
                    if digest.hexdigest() != item['sha256']:
                        fail('Archive entry hash drift')
            for _, path, info in plan:
                _, current = no_links(path)
                if identity(current) != identity(info):
                    fail('Input changed before publication')
            for item, path, info in plan:
                file = held[path]
                file.seek(0)
                current_hash = hashlib.sha256()
                while chunk := file.read(CHUNK):
                    current_hash.update(chunk)
                if current_hash.hexdigest() != item['sha256'] or identity(os.fstat(file.fileno())) != identity(info):
                    fail('Input hash drift before publication')
            _, current_manifest = no_links(manifest_path)
            if identity(current_manifest) != identity(manifest_info):
                fail('Manifest changed before publication')
            # Atomic create-new: never overwrite/replace or fall back unsafely.
            digest = hashlib.sha256()
            temp_file.seek(0)
            while chunk := temp_file.read(CHUNK):
                digest.update(chunk)
            output_bytes = os.fstat(temp_file.fileno()).st_size
            publish_new(staged, output, temp_file.fileno())
            published = True
            return {'status': 'PASS', 'snapshotId': data['snapshotId'], 'manifestSha256': manifest_sha256,
                    'sourceFiles': len(plan), 'entries': len(plan) + 1, 'bytes': output_bytes,
                    'sha256': digest.hexdigest(), 'output': str(output), 'releaseAuthorized': False}
        finally:
            owned_fd = temp_file.fileno() if temp_file is not None else fd
            try:
                if not published:
                    discard_staged(owned_fd)
            finally:
                if temp_file is not None:
                    temp_file.close()
                elif fd is not None:
                    os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(package_snapshot(args.root, args.manifest, args.manifest_sha256, args.output), indent=2))
        return 0
    except (PackagingError, OSError, zipfile.BadZipFile) as error:
        print(json.dumps({'status': 'FAIL', 'reason': str(error), 'releaseAuthorized': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
