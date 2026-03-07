/**
 * Batch Import - CSV/JSON bulk profile import
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse CSV string into array of objects
 */
function parseCSV(csvString) {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV must have header row and at least one data row');
  }
  
  // Parse header
  const headers = parseCSVLine(lines[0]);
  const records = [];
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line);
    const record = {};
    
    headers.forEach((header, idx) => {
      record[header.trim().toLowerCase()] = values[idx] || '';
    });
    
    records.push(record);
  }
  
  return records;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Normalize record from CSV/JSON to profile format
 */
function normalizeRecord(record) {
  // Handle both flat CSV format and nested JSON format
  return {
    name: record.name || record.agent_name || '',
    handle: record.handle || record.x_handle || record.twitter || '',
    bio: record.bio || record.description || '',
    x: record.twitter || record.x_url || null,
    github: record.github || record.github_url || null,
    website: record.website || record.url || null,
    moltbook: record.moltbook || record.moltbook_url || null,
    agentmail: record.agentmail || record.email || null,
    hyperliquid: record.hyperliquid || record.hl_address || record.hyperliquid_address || null,
    solana: record.solana || record.solana_address || record.sol_address || null,
    ethereum: record.ethereum || record.eth_address || record.ethereum_address || null,
    skills: parseSkills(record.skills)
  };
}

/**
 * Parse skills from string or array
 */
function parseSkills(skills) {
  if (!skills) return [];
  
  // If already an array
  if (Array.isArray(skills)) {
    return skills.map(s => {
      if (typeof s === 'string') {
        return { name: s, category: 'Other' };
      }
      return s;
    });
  }
  
  // If string, split by comma or semicolon
  if (typeof skills === 'string') {
    return skills.split(/[,;]/).map(s => ({
      name: s.trim(),
      category: 'Other'
    })).filter(s => s.name);
  }
  
  return [];
}

/**
 * Validate a normalized record
 */
function validateRecord(record, index) {
  const errors = [];
  
  if (!record.name) {
    errors.push(`Row ${index + 1}: Missing required field 'name'`);
  }
  
  if (!record.handle) {
    errors.push(`Row ${index + 1}: Missing required field 'handle'`);
  }
  
  if (record.name && record.name.length > 100) {
    errors.push(`Row ${index + 1}: Name too long (max 100 chars)`);
  }
  
  if (record.bio && record.bio.length > 1000) {
    errors.push(`Row ${index + 1}: Bio too long (max 1000 chars)`);
  }
  
  return errors;
}

/**
 * Create profile from normalized data
 */
function createProfileFromImport(data, dataDir) {
  const id = 'agent_' + data.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const filePath = path.join(dataDir, `${id}.json`);
  
  if (fs.existsSync(filePath)) {
    return { error: 'Profile already exists', id };
  }
  
  const profile = {
    id,
    name: data.name,
    handle: data.handle,
    bio: data.bio || '',
    avatar: null,
    links: {
      moltbook: data.moltbook || null,
      x: data.twitter || null,
      github: data.github || null,
      website: data.website || null,
      agentmail: data.agentmail || null
    },
    wallets: {
      hyperliquid: data.hyperliquid || null,
      solana: data.solana || null,
      ethereum: data.ethereum || null
    },
    skills: data.skills.map(s => ({
      name: s.name || s,
      category: s.category || 'Other',
      verified: false,
      proofs: []
    })),
    portfolio: [],
    verification: {
      tier: 'unverified',
      score: 0,
      lastVerified: null
    },
    createdAt: new Date().toISOString(),
    importedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  
  return { success: true, id, profile };
}

/**
 * Batch import from JSON array or string
 */
async function importFromJSON(jsonData, dataDir, options = {}) {
  const { dryRun = false, announceAll = false } = options;
  
  let records;
  if (typeof jsonData === 'string') {
    try {
      records = JSON.parse(jsonData);
    } catch (e) {
      return { success: false, error: 'Invalid JSON format', details: e.message, total: 0, imported: 0, skipped: 0, errors: ['Invalid JSON: ' + e.message], created: [], duplicates: [] };
    }
  } else {
    records = jsonData;
  }
  
  if (!Array.isArray(records)) {
    // Single record, wrap in array
    records = [records];
  }
  
  return await processImport(records, dataDir, { dryRun, announceAll });
}

/**
 * Batch import from CSV
 */
async function importFromCSV(csvString, dataDir, options = {}) {
  const { dryRun = false, announceAll = false } = options;
  
  let records;
  try {
    records = parseCSV(csvString);
  } catch (e) {
    return { success: false, error: 'Invalid CSV format', details: e.message, total: 0, imported: 0, skipped: 0, errors: ['Invalid CSV: ' + e.message], created: [], duplicates: [] };
  }
  
  return await processImport(records, dataDir, { dryRun, announceAll });
}

/**
 * Process import for both CSV and JSON
 */
async function processImport(records, dataDir, options = {}) {
  const { dryRun = false, announceAll = false } = options;
  
  const results = {
    success: true,
    total: records.length,
    imported: 0,
    skipped: 0,
    errors: [],
    created: [],
    duplicates: []
  };
  
  // Validate and process all records
  for (let i = 0; i < records.length; i++) {
    const normalized = normalizeRecord(records[i]);
    const validationErrors = validateRecord(normalized, i);
    
    if (validationErrors.length > 0) {
      results.errors.push(...validationErrors);
      results.skipped++;
      continue;
    }
    
    // Dry run - just validate
    if (dryRun) {
      const id = 'agent_' + normalized.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const filePath = path.join(dataDir, `${id}.json`);
      
      if (fs.existsSync(filePath)) {
        results.duplicates.push({ row: i + 1, name: normalized.name, id });
        results.skipped++;
      } else {
        results.created.push({ row: i + 1, name: normalized.name, id });
        results.imported++;
      }
      continue;
    }
    
    // Actually create profile
    const result = createProfileFromImport(normalized, dataDir);
    
    if (result.error) {
      results.duplicates.push({ row: i + 1, name: normalized.name, id: result.id });
      results.skipped++;
    } else {
      results.created.push({ row: i + 1, name: normalized.name, id: result.id });
      results.imported++;
    }
  }
  
  if (results.errors.length > 0) {
    results.success = false;
  }
  
  return results;
}

/**
 * Generate CSV template
 */
function generateCSVTemplate() {
  return `name,handle,bio,twitter,github,website,agentmail,hyperliquid,solana,ethereum,skills
"Agent Name","@handle","Agent bio/description","https://x.com/handle","https://github.com/user","https://agent.com","agent@agentmail.to","0x...","...solana...","0x...","Trading,Research,Development"
`;
}

/**
 * Generate JSON template
 */
function generateJSONTemplate() {
  return JSON.stringify([
    {
      name: "Agent Name",
      handle: "@handle",
      bio: "Agent bio/description",
      x: "https://x.com/handle",
      github: "https://github.com/user",
      website: "https://agent.com",
      agentmail: "agent@agentmail.to",
      hyperliquid: "0x...",
      solana: "...solana...",
      ethereum: "0x...",
      skills: [
        { name: "Trading", category: "Finance" },
        { name: "Research", category: "Research" }
      ]
    }
  ], null, 2);
}

module.exports = {
  parseCSV,
  normalizeRecord,
  validateRecord,
  importFromJSON,
  importFromCSV,
  generateCSVTemplate,
  generateJSONTemplate
};
