import Capacitor
import Darwin
import Foundation
import UIKit
import WebKit

/// App-local JSON bridge. The only durable operation state is a boolean marker.
/// Payloads, filenames, URLs and security-scoped grants are never restored.
@objc(LocalBackupPlugin)
public final class LocalBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalBackupPlugin"
    public let jsName = "LocalBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveJson", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openJson", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeInterruption", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeBack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "minimize", returnType: CAPPluginReturnPromise)
    ]
    private static let maxBytes = 5 * 1024 * 1024
    private static let marker = "cashweaveBackupPending"
    private let ioQueue = DispatchQueue(label: "app.cashweave.backup.io", qos: .userInitiated)
    private var active: Operation?
    private weak var importChooser: UIAlertController?
    private weak var exportConfirmation: UIAlertController?
    private var observers: [NSObjectProtocol] = []

    private final class Operation {
        let call: CAPPluginCall
        let payload: Data?
        var timeout: DispatchWorkItem?
        private let lock = NSLock()
        private var finished = false
        init(_ call: CAPPluginCall, payload: Data?) {
            self.call = call; self.payload = payload
        }
        func settle() -> Bool {
            lock.lock(); defer { lock.unlock() }
            if finished { return false }; finished = true; return true
        }
        var isFinished: Bool { lock.lock(); defer { lock.unlock() }; return finished }
    }

    public override func load() {
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            self?.interrupt()
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            // Never replay an unconfirmed file operation after backgrounding.
            self?.interrupt()
        })
    }

    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    /// Capacitor otherwise opens external navigation in another application.
    /// Keep even hand-authored URLs inside the fixed local origin.
    public override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return NSNumber(value: true) }
        return NSNumber(value: url.scheme != "capacitor" || url.host != "localhost" ||
                        url.user != nil || url.password != nil || url.port != nil ||
                        url.path.hasPrefix("/_capacitor_http_interceptor_"))
    }

    private func begin(_ call: CAPPluginCall, payload: Data?) -> Operation? {
        guard active == nil else { call.reject("BACKUP_BUSY"); return nil }
        let operation = Operation(call, payload: payload)
        UserDefaults.standard.set(true, forKey: Self.marker)
        active = operation
        return operation
    }

    private func complete(_ operation: Operation, result: JSObject? = nil, error: String? = nil, interrupted: Bool = false) {
        // Every completion is serialized on main and atomically single-shot.
        DispatchQueue.main.async { [weak self] in
            guard operation.settle() else { return }
            operation.timeout?.cancel()
            if self?.active === operation { self?.active = nil }
            if !interrupted { UserDefaults.standard.set(false, forKey: Self.marker) }
            if let error { operation.call.reject(error) } else { operation.call.resolve(result ?? [:]) }
        }
    }

    private func interrupt() {
        guard let operation = active else { return }
        complete(operation, error: "BACKUP_WRITE_INTERRUPTED", interrupted: true)
        importChooser?.dismiss(animated: false)
        exportConfirmation?.dismiss(animated: false)
        notifyListeners("backupInterrupted", data: [:], retainUntilConsumed: true)
    }

    @objc public func saveJson(_ call: CAPPluginCall) {
        saveDocument(call, csv: false)
    }

    @objc public func saveText(_ call: CAPPluginCall) {
        guard call.getString("mimeType") == "text/csv" else { call.reject("BACKUP_TYPE_INVALID"); return }
        saveDocument(call, csv: true)
    }

    private func saveDocument(_ call: CAPPluginCall, csv: Bool) {
        guard let text = call.getString("text"), !text.isEmpty, let payload = text.data(using: .utf8, allowLossyConversion: false) else { call.reject("BACKUP_EMPTY"); return }
        guard payload.count <= Self.maxBytes else { call.reject("BACKUP_TOO_LARGE"); return }
        let filename = call.getString("filename") ?? "cashweave-backup.json"
        call.options = [:]
        let pattern = #"\A[A-Za-z0-9][A-Za-z0-9._-]{0,119}\."# + (csv ? "csv" : "json") + #"\z"#
        guard filename.range(of: pattern, options: .regularExpression) != nil else { call.reject("BACKUP_FILENAME_INVALID"); return }
        DispatchQueue.main.async { [weak self] in
            guard let self, let operation = self.begin(call, payload: payload) else { return }
            guard let host = self.bridge?.viewController, host.presentedViewController == nil else { self.complete(operation, error: "BACKUP_PICKER_UNAVAILABLE"); return }
            // Apple has no local-only export picker. Giving a payload to a Files
            // export provider could transmit it before its result is delivered.
            // Confirm a local sandbox save instead; Files exposes explicit
            // backups only, while the active dataset stays private in Library.
            let confirmation = UIAlertController(title: "Lưu tệp offline", message: "Lưu \(filename) trên thiết bị. Bạn có thể tìm tệp trong Files → On My iPhone/iPad → CashWeave Trial → Backups. Ứng dụng không gửi tệp tới nhà cung cấp hay iCloud.", preferredStyle: .alert)
            confirmation.addAction(UIAlertAction(title: "Hủy", style: .cancel) { [weak self] _ in self?.complete(operation, result: ["cancelled": true]) })
            confirmation.addAction(UIAlertAction(title: "Lưu cục bộ", style: .default) { [weak self] _ in self?.saveLocal(operation, filename: filename) })
            self.exportConfirmation = confirmation
            host.present(confirmation, animated: true)
        }
    }

    private enum ReadFailure: Error { case oversized, failed, interrupted }

    private func readBounded(_ url: URL, operation: Operation) throws -> Data {
        let descriptor = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw ReadFailure.failed }
        defer { Darwin.close(descriptor) }
        return try readBounded(descriptor: descriptor, operation: operation)
    }

    private func readBounded(descriptor: Int32, operation: Operation) throws -> Data {
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), metadata.st_nlink == 1 else { throw ReadFailure.failed }
        if metadata.st_size > off_t(Self.maxBytes) { throw ReadFailure.oversized }
        var bytes = Data(); var chunk = [UInt8](repeating: 0, count: 8192)
        while !operation.isFinished {
            let count = chunk.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 { throw ReadFailure.failed }
            if count == 0 { break }
            if bytes.count + count > Self.maxBytes { throw ReadFailure.oversized }
            bytes.append(contentsOf: chunk.prefix(count))
        }
        if operation.isFinished { throw ReadFailure.interrupted }
        return bytes
    }

    private func startTimeout(_ operation: Operation) {
        let timeout = DispatchWorkItem { [weak self] in self?.complete(operation, error: "BACKUP_IO_TIMEOUT", interrupted: true) }
        operation.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
    }

    private func saveLocal(_ operation: Operation, filename: String) {
        guard !operation.isFinished else { return }
        startTimeout(operation)
        ioQueue.async { [weak self] in
            guard let self, let payload = operation.payload, !operation.isFinished else { return }
            do {
                guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw ReadFailure.failed }
                var directory = documents.appendingPathComponent("Backups", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
                let destination = directory.appendingPathComponent(filename)
                guard !operation.isFinished else { return }
                try payload.write(to: destination, options: [.atomic, .completeFileProtection])
                let bytes = try self.readBounded(destination, operation: operation)
                guard bytes == operation.payload else { throw ReadFailure.failed }
                self.complete(operation, result: ["saved": true, "bytes": bytes.count])
            } catch { self.complete(operation, error: "BACKUP_WRITE_FAILED") }
        }
    }

    @objc public func openJson(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let operation = self.begin(call, payload: nil) else { return }
            self.startTimeout(operation)
            self.ioQueue.async { [weak self] in
                guard let self, !operation.isFinished else { return }
                do {
                    let names = try self.localImportNames()
                    DispatchQueue.main.async {
                        guard !operation.isFinished else { return }
                        operation.timeout?.cancel(); operation.timeout = nil
                        self.presentImportNames(names, operation: operation)
                    }
                } catch { self.complete(operation, error: "BACKUP_READ_FAILED") }
            }
        }
    }

    private func openImportsDirectory() throws -> Int32 {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw ReadFailure.failed }
        let path = documents.appendingPathComponent("Imports", isDirectory: true).path
        let descriptor = Darwin.open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw ReadFailure.failed }
        return descriptor
    }

    private func localImportNames() throws -> [String] {
        let descriptor = try openImportsDirectory()
        guard let listing = fdopendir(descriptor) else { Darwin.close(descriptor); throw ReadFailure.failed }
        defer { closedir(listing) }
        var names: [String] = []; var scanned = 0
        // Descriptor-based, top-level enumeration never traverses a provider,
        // symlink or child directory. Stop before an unbounded Files listing.
        while scanned < 250, names.count < 50, let entry = readdir(listing) {
            scanned += 1
            let name = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                String(cString: UnsafeRawPointer(pointer).assumingMemoryBound(to: CChar.self))
            }
            if name.hasPrefix(".") { continue }
            var metadata = stat()
            guard fstatat(dirfd(listing), name, &metadata, AT_SYMLINK_NOFOLLOW) == 0,
                  metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), metadata.st_nlink == 1,
                  metadata.st_size > 0, metadata.st_size <= off_t(Self.maxBytes) else { continue }
            names.append(name)
        }
        return names.sorted()
    }

    private func presentImportNames(_ names: [String], operation: Operation) {
        guard let host = bridge?.viewController, host.presentedViewController == nil else { complete(operation, error: "BACKUP_PICKER_UNAVAILABLE"); return }
        let message = names.isEmpty
            ? "Chưa có tệp hợp lệ. Dùng Files chép JSON/CSV từ On My iPhone/iPad vào CashWeave Trial → Imports, rồi thử lại. Ứng dụng chỉ đọc thư mục Imports cục bộ; không mở nhà cung cấp hoặc iCloud. Tệp tối đa 5 MiB."
            : "Chọn tệp đã chép vào thư mục Imports trên thiết bị. Hiển thị tối đa 50 tệp hợp lệ trong 250 mục đầu; không đọc thư mục con. Dữ liệu chỉ được kích hoạt sau khi bạn xem và xác nhận trong ứng dụng."
        let controller = UIAlertController(title: "Nhập tệp cục bộ", message: message, preferredStyle: .alert)
        for name in names {
            controller.addAction(UIAlertAction(title: String(name.prefix(80)), style: .default) { [weak self] _ in self?.readLocalImport(operation, name: name) })
        }
        controller.addAction(UIAlertAction(title: "Hủy", style: .cancel) { [weak self] _ in self?.complete(operation, result: ["cancelled": true]) })
        importChooser = controller
        host.present(controller, animated: true)
    }

    private func readLocalImport(_ operation: Operation, name: String) {
        guard !operation.isFinished, !name.isEmpty, !name.contains("/"), !name.hasPrefix(".") else { complete(operation, error: "BACKUP_LOCATION_INVALID"); return }
        startTimeout(operation)
        ioQueue.async { [weak self] in
            guard let self, !operation.isFinished else { return }
            do {
                let directory = try self.openImportsDirectory()
                defer { Darwin.close(directory) }
                // Re-open relative to the verified directory descriptor after
                // selection. O_NOFOLLOW/fstat reject file swaps to links/devices.
                let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
                guard descriptor >= 0 else { throw ReadFailure.failed }
                defer { Darwin.close(descriptor) }
                let bytes = try self.readBounded(descriptor: descriptor, operation: operation)
                guard !operation.isFinished else { return }
                guard !bytes.isEmpty, let text = String(data: bytes, encoding: .utf8) else { self.complete(operation, error: "BACKUP_READ_FAILED"); return }
                self.complete(operation, result: ["text": text, "bytes": bytes.count])
            } catch ReadFailure.oversized { self.complete(operation, error: "BACKUP_TOO_LARGE") }
            catch { self.complete(operation, error: "BACKUP_READ_FAILED") }
        }
    }

    @objc public func consumeInterruption(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            let interrupted = self?.active == nil && UserDefaults.standard.bool(forKey: Self.marker)
            if self?.active == nil { UserDefaults.standard.set(false, forKey: Self.marker) }
            call.resolve(["interrupted": interrupted])
        }
    }
    @objc public func ready(_ call: CAPPluginCall) { call.resolve() }
    @objc public func acknowledgeBack(_ call: CAPPluginCall) { call.resolve() }
    // iOS has no supported programmatic minimize/exit API. Back is handled by
    // the shared app UI; reaching its root never terminates or resets the app.
    @objc public func minimize(_ call: CAPPluginCall) { call.resolve(["minimized": false]) }
}
