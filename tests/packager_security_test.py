"""Synthetic-only privacy/transaction tests; no real project is packaged."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'package-mobile-review.py'
spec = importlib.util.spec_from_file_location('cashweave_packager', SCRIPT)
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class PackagerSecurityTests(unittest.TestCase):
    def setUp(self):
        # Retain synthetic fixtures for reviewer inspection; never delete user files.
        self.directory = Path(tempfile.mkdtemp(prefix='cashweave-packager-test-', dir=os.environ.get('CASHWEAVE_PACKAGER_FIXTURE_DIR')))
        self.root = self.directory / 'source'
        self.root.mkdir()
        self.manifest = self.directory / 'allowlist.json'
        self.output = self.directory / 'candidate.zip'
        self.opens = []

    def write(self, name, data=b'SYNTHETIC ONLY\n'):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return {'path': name, 'sha256': digest(data), 'bytes': len(data)}

    def allow(self, files):
        raw = json.dumps({'schemaVersion': 1, 'snapshotId': 'synthetic-fixture', 'files': files}, sort_keys=True).encode()
        self.manifest.write_bytes(raw)
        self.manifest_hash = digest(raw)

    def spy(self, path):
        self.opens.append(Path(path))
        return packager.default_opener(path)

    def run_package(self, **extra):
        return packager.package_snapshot(self.root, self.manifest, self.manifest_hash, self.output, opener=self.spy, **extra)

    def assert_no_source_reads(self):
        self.assertEqual(self.opens, [self.manifest])
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('.cashweave-package-*.partial')), [])

    def test_exact_inventory_and_no_discovery_or_unlisted_private_reads(self):
        files = [self.write('app.js'), self.write('android/app/src/main/AndroidManifest.xml')]
        self.write('documents/financial.csv')
        self.write('.aws/credentials')
        self.write('unlisted.txt')
        sibling = self.directory / 'financial-assistant-deliverables'
        sibling.mkdir()
        (sibling / 'private.csv').write_bytes(b'SYNTHETIC SIBLING\n')
        self.allow(files)
        with patch.object(Path, 'rglob', side_effect=AssertionError('No recursive discovery')), patch.object(Path, 'iterdir', side_effect=AssertionError('No enumeration')):
            receipt = self.run_package()
        self.assertEqual(receipt['entries'], 3)
        self.assertFalse(receipt['releaseAuthorized'])
        self.assertEqual(set(self.opens), {self.manifest, *(self.root / f['path'] for f in files)})
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(set(z.namelist()), {'SOURCE-MANIFEST.json', *('financial-assistant/' + f['path'] for f in files)})
            self.assertEqual(z.read('SOURCE-MANIFEST.json'), self.manifest.read_bytes())
            for file in files:
                self.assertEqual(digest(z.read('financial-assistant/' + file['path'])), file['sha256'])
        self.assertEqual(receipt['sha256'], digest(self.output.read_bytes()))

    def test_private_secret_database_case_variants_rejected_before_any_source_open(self):
        dangerous = ['documents/private.csv', 'DoCuMeNtS/private.csv', '.AWS/credentials', '.CoDeX/config.toml', '.ssh/id_rsa', 'data/save.json', 'backups/x.json', 'userdata/x.txt', '.ENV', '.EnV.local', 'credentials', 'LOCAL.PROPERTIES', 'x.DB', 'x.SQLITE3', 'x.db-wal', 'x.sqlite-shm', 'x.JKS', 'x.KEYSTORE', 'x.PEM', 'x.P12', 'x.PFX', 'tokens.json', '.NPMRC', '.NETRC', 'credentials.JSON', 'secrets.json', 'service-account.json', 'evidence/provider-output.LOG', 'mobile-www/user-backup.json', 'node_modules/private.json', 'android/build/private.json']
        good = self.write('app.js')
        for name in dangerous:
            with self.subTest(path=name):
                self.opens.clear()
                bad = self.write(name)
                self.allow([good, bad])
                with self.assertRaises(packager.PackagingError):
                    self.run_package()
                self.assert_no_source_reads()

    def test_path_traversal_absolute_ads_reserved_and_unicode_aliases(self):
        paths = ['../outside.js', 'a/../../outside.js', '/outside.js', 'C:/outside.js', 'C:outside.js', '\\\\server\\share\\x.js', 'a\\b.js', 'a//b.js', './app.js', 'app.js:secret', 'app.js.', 'app.js ', 'NUL.txt', 'COM1.js', 'caf\u0065\u0301.js', 'a\x00.js']
        for name in paths:
            with self.subTest(path=name):
                self.opens.clear()
                self.allow([{'path': name, 'sha256': digest(b'x'), 'bytes': 1}])
                with self.assertRaises(packager.PackagingError):
                    self.run_package()
                self.assert_no_source_reads()

    def test_duplicate_and_case_collision_rejected_before_read(self):
        good = self.write('app.js')
        for second in [good, {**good, 'path': 'APP.JS'}]:
            self.opens.clear()
            self.allow([good, second])
            with self.assertRaises(packager.PackagingError):
                self.run_package()
            self.assert_no_source_reads()

    def test_missing_input_rejects_whole_plan_before_good_file_open(self):
        good = self.write('app.js')
        self.allow([good, {'path': 'missing.js', 'sha256': digest(b'x'), 'bytes': 1}])
        with self.assertRaises(packager.PackagingError):
            self.run_package()
        self.assert_no_source_reads()

    def test_hash_drift_and_size_drift_leave_no_output(self):
        good = self.write('app.js', b'old')
        self.allow([good])
        (self.root / 'app.js').write_bytes(b'new')
        with self.assertRaisesRegex(packager.PackagingError, 'hash'):
            self.run_package()
        self.assertFalse(self.output.exists())
        self.opens.clear()
        (self.root / 'app.js').write_bytes(b'longer')
        with self.assertRaises(packager.PackagingError):
            self.run_package()
        self.assert_no_source_reads()

    def test_change_during_read_never_publishes_partial(self):
        good = self.write('app.js', b'a' * (packager.CHUNK + 1))
        self.allow([good])
        changed = False
        def change(path, size):
            nonlocal changed
            if not changed:
                changed = True
                with open(path, 'r+b') as f:
                    f.write(b'b')
        # Inject an unlocked fixture handle to exercise change detection in
        # addition to the production Windows read-sharing locks.
        def unlocked(path):
            self.opens.append(Path(path))
            return os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_BINARY', 0)), 'rb')
        with self.assertRaises(packager.PackagingError):
            packager.package_snapshot(self.root, self.manifest, self.manifest_hash, self.output, opener=unlocked, after_chunk=change)
        self.assertTrue(changed)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('*.partial')), [])

    def test_interrupted_write_cleans_only_own_partial_and_preserves_input(self):
        good = self.write('app.js')
        self.allow([good])
        marker = self.directory / 'other.partial'
        marker.write_bytes(b'KEEP SYNTHETIC MARKER')
        def interrupt(path, size):
            raise OSError('synthetic interrupted write')
        with self.assertRaisesRegex(OSError, 'interrupted'):
            self.run_package(after_chunk=interrupt)
        self.assertFalse(self.output.exists())
        self.assertEqual((self.root / 'app.js').read_bytes(), b'SYNTHETIC ONLY\n')
        self.assertEqual(marker.read_bytes(), b'KEEP SYNTHETIC MARKER')
        self.assertEqual(list(self.directory.glob('.cashweave-package-*.partial')), [])

    def test_existing_output_not_opened_or_overwritten(self):
        self.allow([self.write('app.js')])
        self.output.write_bytes(b'KEEP EXISTING SYNTHETIC OUTPUT')
        with self.assertRaisesRegex(packager.PackagingError, 'exists'):
            self.run_package()
        self.assertEqual(self.opens, [])
        self.assertEqual(self.output.read_bytes(), b'KEEP EXISTING SYNTHETIC OUTPUT')

    def test_output_created_during_write_is_preserved(self):
        self.allow([self.write('app.js')])
        def race(path, size):
            self.output.write_bytes(b'KEEP COMPETING SYNTHETIC OUTPUT')
        with self.assertRaises(FileExistsError):
            self.run_package(after_chunk=race)
        self.assertEqual(self.output.read_bytes(), b'KEEP COMPETING SYNTHETIC OUTPUT')
        self.assertEqual(list(self.directory.glob('.cashweave-package-*.partial')), [])

    def test_output_inside_root_rejected_before_manifest_read(self):
        self.allow([self.write('app.js')])
        self.output = self.root / 'new.zip'
        with self.assertRaises(packager.PackagingError):
            self.run_package()
        self.assertEqual(self.opens, [])

    def test_hardlink_to_outside_and_duplicate_physical_input_rejected_before_open(self):
        outside = self.directory / 'outside.js'
        outside.write_bytes(b'SYNTHETIC OUTSIDE')
        linked = self.root / 'linked.js'
        os.link(outside, linked)
        self.allow([{'path': 'linked.js', 'sha256': digest(b'SYNTHETIC OUTSIDE'), 'bytes': len(b'SYNTHETIC OUTSIDE')}])
        with self.assertRaises(packager.PackagingError):
            self.run_package()
        self.assert_no_source_reads()

    def test_junction_or_directory_symlink_outside_rejected_before_open(self):
        outside = self.directory / 'external'
        outside.mkdir()
        (outside / 'outside.js').write_bytes(b'SYNTHETIC OUTSIDE')
        linked = self.root / 'linked'
        if os.name == 'nt':
            result = subprocess.run([os.environ.get('ComSpec', 'C:\\Windows\\System32\\cmd.exe'), '/d', '/c', 'mklink', '/J', str(linked), str(outside)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            linked.symlink_to(outside, target_is_directory=True)
        self.allow([{'path': 'linked/outside.js', 'sha256': digest(b'SYNTHETIC OUTSIDE'), 'bytes': len(b'SYNTHETIC OUTSIDE')}])
        with self.assertRaisesRegex(packager.PackagingError, 'reparse|Symlink'):
            self.run_package()
        self.assert_no_source_reads()

    def test_file_symlink_rejected_before_open_without_requiring_creation_privilege(self):
        good = self.write('app.js')
        self.allow([good])
        original = Path.lstat
        def metadata(path):
            info = original(path)
            if path == self.root / 'app.js':
                values = list(info)
                values[0] = 0o120777
                return os.stat_result(values)
            return info
        with patch.object(Path, 'lstat', metadata), self.assertRaisesRegex(packager.PackagingError, 'Symlink'):
            self.run_package()
        self.assert_no_source_reads()

    def test_opener_swapped_outside_handle_is_rejected_before_content_read(self):
        good = self.write('app.js')
        self.allow([good])
        outside = self.directory / 'outside.js'
        outside.write_bytes(b'SYNTHETIC ONLY\n')
        class ReadSpy:
            def __init__(self, file): self.file = file
            def fileno(self): return self.file.fileno()
            def close(self): return self.file.close()
            def read(self, *args): raise AssertionError('Outside file content must never be read')
        def swap(path):
            if path == self.manifest:
                return packager.default_opener(path)
            return ReadSpy(packager.default_opener(outside))
        with self.assertRaisesRegex(packager.PackagingError, 'exact approved path'):
            packager.package_snapshot(self.root, self.manifest, self.manifest_hash, self.output, opener=swap)
        self.assertFalse(self.output.exists())

    def test_manifest_hash_schema_and_duplicate_json_keys_fail_closed(self):
        self.allow([self.write('app.js')])
        with self.assertRaisesRegex(packager.PackagingError, 'Manifest hash'):
            packager.package_snapshot(self.root, self.manifest, '0' * 64, self.output, opener=self.spy)
        self.assert_no_source_reads()
        self.opens.clear()
        raw = b'{"schemaVersion":1,"schemaVersion":1,"snapshotId":"fixture","files":[]}'
        self.manifest.write_bytes(raw)
        self.manifest_hash = digest(raw)
        with self.assertRaisesRegex(packager.PackagingError, 'Duplicate JSON'):
            self.run_package()
        self.assert_no_source_reads()

    def test_atomic_publish_not_supported_fails_without_fallback(self):
        self.allow([self.write('app.js')])
        with patch.object(packager, 'publish_new', side_effect=OSError('synthetic atomic publish unsupported')), self.assertRaises(OSError):
            self.run_package()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('.cashweave-package-*.partial')), [])

    def test_held_input_handle_prevents_concurrent_write_on_windows(self):
        self.allow([self.write('app.js')])
        attempts = []
        def mutate(path, size):
            with self.assertRaises(PermissionError):
                with open(path, 'r+b') as file:
                    file.write(b'X')
            attempts.append(True)
        self.assertEqual(self.run_package(after_chunk=mutate)['status'], 'PASS')
        self.assertTrue(attempts)
        self.assertEqual((self.root / 'app.js').read_bytes(), b'SYNTHETIC ONLY\n')

    def test_owned_partial_cannot_be_replaced_or_modified_during_write(self):
        self.allow([self.write('app.js')])
        attempts = []
        def tamper(path, size):
            partials = list(self.directory.glob('.cashweave-package-*.partial'))
            self.assertEqual(len(partials), 1)
            partial = partials[0]
            with self.assertRaises(PermissionError):
                partial.write_bytes(b'SYNTHETIC TAMPER')
            with self.assertRaises(PermissionError):
                partial.unlink()
            attempts.append(True)
        self.assertEqual(self.run_package(after_chunk=tamper)['status'], 'PASS')
        self.assertTrue(attempts)
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.read('financial-assistant/app.js'), b'SYNTHETIC ONLY\n')

    def test_source_and_output_directory_ancestors_cannot_move_during_write(self):
        self.allow([self.write('app.js')])
        def move(path, size):
            with self.assertRaises(PermissionError):
                self.root.rename(self.directory / 'moved-source')
        self.assertEqual(self.run_package(after_chunk=move)['status'], 'PASS')
        self.assertTrue(self.root.exists())
        self.assertFalse((self.directory / 'moved-source').exists())

    def test_byte_change_with_restored_mtime_still_fails_rehash(self):
        good = self.write('app.js', b'a' * (packager.CHUNK + 1))
        self.allow([good])
        initial = (self.root / 'app.js').stat()
        changed = False
        def unlocked(path):
            return os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_BINARY', 0)), 'rb')
        def change(path, size):
            nonlocal changed
            if not changed:
                changed = True
                with open(path, 'r+b') as file:
                    file.write(b'b')
                os.utime(path, ns=(initial.st_atime_ns, initial.st_mtime_ns))
        with self.assertRaisesRegex(packager.PackagingError, 'hash drift before publication'):
            packager.package_snapshot(self.root, self.manifest, self.manifest_hash, self.output, opener=unlocked, after_chunk=change)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('.cashweave-package-*.partial')), [])

    def test_root_and_output_junctions_rejected_before_manifest_open(self):
        self.allow([self.write('app.js')])
        link = self.directory / 'root-junction'
        result = subprocess.run([os.environ.get('ComSpec', 'C:\\Windows\\System32\\cmd.exe'), '/d', '/c', 'mklink', '/J', str(link), str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.assertRaises(packager.PackagingError):
            packager.package_snapshot(link, self.manifest, self.manifest_hash, self.output, opener=self.spy)
        self.assertEqual(self.opens, [])
        with self.assertRaises(packager.PackagingError):
            packager.package_snapshot(self.root, self.manifest, self.manifest_hash, link / 'candidate.zip', opener=self.spy)
        self.assertEqual(self.opens, [])

    def test_manifest_in_unapproved_directory_not_opened(self):
        self.allow([self.write('app.js')])
        manifest = self.root / 'documents' / 'allowlist.json'
        manifest.parent.mkdir()
        manifest.write_bytes(self.manifest.read_bytes())
        with self.assertRaises(packager.PackagingError):
            packager.package_snapshot(self.root, manifest, self.manifest_hash, self.output, opener=self.spy)
        self.assertEqual(self.opens, [])

    def test_unexpected_archive_entry_fails_inventory_parity(self):
        self.allow([self.write('app.js')])
        real = zipfile.ZipFile.writestr
        def inject(archive, name, data, *args, **kwargs):
            result = real(archive, name, data, *args, **kwargs)
            if (name.filename if isinstance(name, zipfile.ZipInfo) else name) == 'SOURCE-MANIFEST.json':
                real(archive, 'financial-assistant/documents/synthetic.csv', b'SYNTHETIC UNLISTED ENTRY')
            return result
        with patch.object(zipfile.ZipFile, 'writestr', inject), self.assertRaisesRegex(packager.PackagingError, 'inventory parity'):
            self.run_package()
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.glob('.cashweave-package-*.partial')), [])

    def test_oversized_declared_inventory_fails_before_source_open(self):
        good = self.write('app.js')
        for bad in [{**good, 'bytes': True}, {**good, 'bytes': packager.MAX_FILE + 1}, {**good, 'extra': 'forbidden'}]:
            self.opens.clear()
            self.allow([bad])
            with self.assertRaises(packager.PackagingError):
                self.run_package()
            self.assert_no_source_reads()

    def test_cli_only_fixture_requires_explicit_inputs_and_returns_inventory_hash(self):
        self.allow([self.write('app.js')])
        no_args = subprocess.run([sys.executable, '-B', str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(no_args.returncode, 2)
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--root', str(self.root), '--manifest', str(self.manifest), '--manifest-sha256', self.manifest_hash, '--output', str(self.output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['sha256'], digest(self.output.read_bytes()))
        self.assertEqual(receipt['entries'], 2)

    def test_identical_reviewed_fixture_produces_identical_archive_bytes(self):
        self.allow([self.write('app.js')])
        first = self.run_package()
        self.output = self.directory / 'second.zip'
        second = self.run_package()
        self.assertEqual(first['sha256'], second['sha256'])
        self.assertEqual(first['manifestSha256'], second['manifestSha256'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
