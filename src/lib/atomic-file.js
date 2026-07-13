const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function syncDir(dir) {
  if (process.platform === 'win32') return;
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_) {
    // Directory fsync is a best-effort durability guard and is unavailable on
    // some filesystems.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function resolveContainedPath(baseDir, filePath) {
  if (!baseDir) {
    throw new Error('Atomic writes require a baseDir');
  }
  if (typeof filePath !== 'string' || filePath.includes('\0')) {
    throw new Error('Invalid atomic write path');
  }

  const base = path.resolve(baseDir);
  const target = path.resolve(filePath);
  const relative = path.relative(base, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Atomic write path escapes baseDir');
  }

  return { target, dir: path.dirname(target) };
}

function writeFileAtomicSync(filePath, data, options = {}) {
  const { target, dir } = resolveContainedPath(options.baseDir, filePath);
  fs.mkdirSync(dir, { recursive: true });

  const mode = options.mode || 0o600;
  const tmp = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );

  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', mode);
    fs.writeFileSync(fd, data, options.encoding ? { encoding: options.encoding } : undefined);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, target);
    syncDir(dir);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch (_) {}
    throw err;
  }
}

function writeJsonAtomicSync(filePath, value, options = {}) {
  const spaces = options.spaces === undefined ? 2 : options.spaces;
  writeFileAtomicSync(filePath, `${JSON.stringify(value, null, spaces)}\n`, {
    baseDir: options.baseDir,
    mode: options.mode,
    encoding: 'utf8',
  });
}

module.exports = {
  resolveContainedPath,
  writeFileAtomicSync,
  writeJsonAtomicSync,
};
