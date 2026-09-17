function normalizeRegistrationHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function findExistingWalletHandleProfile(database, wallet, handle) {
  const normalizedWallet = String(wallet || '').trim();
  const normalizedHandle = normalizeRegistrationHandle(handle);
  if (!normalizedWallet || !normalizedHandle) return null;

  return database.prepare(`
    SELECT id
    FROM profiles
    WHERE wallet = ?
      AND LOWER(LTRIM(TRIM(handle), '@')) = ?
      AND (status IS NULL OR LOWER(status) = 'active')
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(normalizedWallet, normalizedHandle) || null;
}

module.exports = { normalizeRegistrationHandle, findExistingWalletHandleProfile };