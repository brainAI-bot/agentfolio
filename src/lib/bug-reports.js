/**
 * Bug Report System
 * Allows users to report bugs, issues, and problems with the platform
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const BUG_REPORTS_FILE = path.join(DATA_DIR, 'bug-reports.json');

// Bug report categories
const BUG_CATEGORIES = {
  UI_UX: 'ui_ux',
  FUNCTIONALITY: 'functionality',
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  MARKETPLACE: 'marketplace',
  VERIFICATION: 'verification',
  ESCROW: 'escrow',
  OTHER: 'other'
};

// Bug severity levels
const BUG_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Bug report status
const BUG_STATUS = {
  NEW: 'new',
  TRIAGED: 'triaged',
  IN_PROGRESS: 'in_progress',
  FIXED: 'fixed',
  WONT_FIX: 'wont_fix',
  DUPLICATE: 'duplicate',
  INVALID: 'invalid'
};

// Category labels for UI
const CATEGORY_LABELS = {
  ui_ux: '🎨 UI/UX Issue',
  functionality: '⚙️ Functionality Bug',
  performance: '🐢 Performance Problem',
  security: '🔒 Security Concern',
  marketplace: '🛒 Marketplace Issue',
  verification: '✅ Verification Problem',
  escrow: '💰 Escrow/Payment Issue',
  other: '📝 Other'
};

// Severity labels for UI
const SEVERITY_LABELS = {
  low: '🟢 Low',
  medium: '🟡 Medium',
  high: '🟠 High',
  critical: '🔴 Critical'
};

// Status labels for UI
const STATUS_LABELS = {
  new: '🆕 New',
  triaged: '📋 Triaged',
  in_progress: '🔧 In Progress',
  fixed: '✅ Fixed',
  wont_fix: '❌ Won\'t Fix',
  duplicate: '🔄 Duplicate',
  invalid: '⛔ Invalid'
};

// Load bug reports from file
function loadBugReports() {
  try {
    if (fs.existsSync(BUG_REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(BUG_REPORTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[BugReports] Error loading bug reports:', e.message);
  }
  return { reports: [], lastUpdated: null };
}

// Save bug reports to file
function saveBugReports(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(BUG_REPORTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Submit a bug report
 */
function submitBugReport({
  title,
  description,
  category,
  severity = BUG_SEVERITY.MEDIUM,
  pageUrl = null,
  browserInfo = null,
  steps = null,
  expectedBehavior = null,
  actualBehavior = null,
  reporterId = null,
  reporterEmail = null,
  reporterIp = null,
  screenshot = null
}) {
  // Validate required fields
  if (!title || title.trim().length < 5) {
    return { error: 'Title is required (minimum 5 characters)' };
  }
  
  if (!description || description.trim().length < 20) {
    return { error: 'Description is required (minimum 20 characters)' };
  }
  
  if (!category || !Object.values(BUG_CATEGORIES).includes(category)) {
    return { error: 'Valid category is required. Options: ' + Object.values(BUG_CATEGORIES).join(', ') };
  }
  
  if (severity && !Object.values(BUG_SEVERITY).includes(severity)) {
    return { error: 'Invalid severity level' };
  }
  
  const data = loadBugReports();
  
  // Rate limiting: max 5 reports per IP per day
  if (reporterIp) {
    const today = new Date().toDateString();
    const reportsFromIpToday = data.reports.filter(r => 
      r.reporterIp === reporterIp &&
      new Date(r.createdAt).toDateString() === today
    ).length;
    
    if (reportsFromIpToday >= 5) {
      return { error: 'Rate limit reached. Maximum 5 bug reports per day.' };
    }
  }
  
  const report = {
    id: uuidv4(),
    title: title.trim(),
    description: description.trim(),
    category,
    severity,
    status: BUG_STATUS.NEW,
    pageUrl: pageUrl || null,
    browserInfo: browserInfo || null,
    steps: steps || null,
    expectedBehavior: expectedBehavior || null,
    actualBehavior: actualBehavior || null,
    reporterId: reporterId || null,
    reporterEmail: reporterEmail || null,
    reporterIp: reporterIp || null,
    screenshot: screenshot || null,
    adminNotes: null,
    assignedTo: null,
    duplicateOf: null,
    fixedInVersion: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  data.reports.push(report);
  saveBugReports(data);
  
  console.log(`[BugReports] New bug report submitted: ${report.id} - ${title}`);
  
  return { success: true, reportId: report.id, report };
}

/**
 * Get bug reports with optional filters
 */
function getBugReports({ 
  category = null, 
  severity = null, 
  status = null, 
  reporterId = null,
  limit = 50, 
  offset = 0 
} = {}) {
  const data = loadBugReports();
  let reports = data.reports;
  
  // Apply filters
  if (category) {
    reports = reports.filter(r => r.category === category);
  }
  if (severity) {
    reports = reports.filter(r => r.severity === severity);
  }
  if (status) {
    reports = reports.filter(r => r.status === status);
  }
  if (reporterId) {
    reports = reports.filter(r => r.reporterId === reporterId);
  }
  
  // Sort by most recent first, then by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  reports.sort((a, b) => {
    if (a.status === BUG_STATUS.NEW && b.status !== BUG_STATUS.NEW) return -1;
    if (b.status === BUG_STATUS.NEW && a.status !== BUG_STATUS.NEW) return 1;
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  
  // Apply pagination
  const total = reports.length;
  reports = reports.slice(offset, offset + limit);
  
  return {
    reports,
    total,
    limit,
    offset
  };
}

/**
 * Get a single bug report by ID
 */
function getBugReport(reportId) {
  const data = loadBugReports();
  return data.reports.find(r => r.id === reportId) || null;
}

/**
 * Update bug report (admin action)
 */
function updateBugReport(reportId, updates) {
  const data = loadBugReports();
  const report = data.reports.find(r => r.id === reportId);
  
  if (!report) {
    return { error: 'Bug report not found' };
  }
  
  // Validate status if provided
  if (updates.status && !Object.values(BUG_STATUS).includes(updates.status)) {
    return { error: 'Invalid status' };
  }
  
  // Validate severity if provided
  if (updates.severity && !Object.values(BUG_SEVERITY).includes(updates.severity)) {
    return { error: 'Invalid severity' };
  }
  
  // Update allowed fields
  const allowedFields = [
    'status', 'severity', 'adminNotes', 'assignedTo', 
    'duplicateOf', 'fixedInVersion', 'category'
  ];
  
  allowedFields.forEach(field => {
    if (updates[field] !== undefined) {
      report[field] = updates[field];
    }
  });
  
  // Set resolved timestamp if status changed to fixed
  if (updates.status === BUG_STATUS.FIXED && !report.resolvedAt) {
    report.resolvedAt = new Date().toISOString();
  }
  
  report.updatedAt = new Date().toISOString();
  saveBugReports(data);
  
  console.log(`[BugReports] Bug report ${reportId} updated`);
  
  return { success: true, report };
}

/**
 * Get bug report statistics
 */
function getBugReportStats() {
  const data = loadBugReports();
  const reports = data.reports;
  
  const stats = {
    total: reports.length,
    byStatus: {},
    byCategory: {},
    bySeverity: {},
    openCount: 0,
    resolvedCount: 0,
    criticalOpen: 0,
    recentReports: reports.filter(r => 
      Date.now() - new Date(r.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
    ).length,
    avgResolutionTimeMs: 0
  };
  
  // Count by status
  Object.values(BUG_STATUS).forEach(s => {
    stats.byStatus[s] = reports.filter(r => r.status === s).length;
  });
  
  // Count by category
  Object.values(BUG_CATEGORIES).forEach(c => {
    stats.byCategory[c] = reports.filter(r => r.category === c).length;
  });
  
  // Count by severity
  Object.values(BUG_SEVERITY).forEach(s => {
    stats.bySeverity[s] = reports.filter(r => r.severity === s).length;
  });
  
  // Open vs resolved
  const openStatuses = [BUG_STATUS.NEW, BUG_STATUS.TRIAGED, BUG_STATUS.IN_PROGRESS];
  stats.openCount = reports.filter(r => openStatuses.includes(r.status)).length;
  stats.resolvedCount = reports.filter(r => 
    [BUG_STATUS.FIXED, BUG_STATUS.WONT_FIX, BUG_STATUS.DUPLICATE, BUG_STATUS.INVALID].includes(r.status)
  ).length;
  
  // Critical bugs still open
  stats.criticalOpen = reports.filter(r => 
    r.severity === BUG_SEVERITY.CRITICAL && openStatuses.includes(r.status)
  ).length;
  
  // Average resolution time
  const resolvedReports = reports.filter(r => r.resolvedAt);
  if (resolvedReports.length > 0) {
    const totalTime = resolvedReports.reduce((sum, r) => {
      return sum + (new Date(r.resolvedAt) - new Date(r.createdAt));
    }, 0);
    stats.avgResolutionTimeMs = Math.round(totalTime / resolvedReports.length);
    stats.avgResolutionTimeHours = Math.round(stats.avgResolutionTimeMs / (1000 * 60 * 60) * 10) / 10;
  }
  
  return stats;
}

/**
 * Add a comment to a bug report (for future expansion)
 */
function addComment(reportId, { text, authorId, authorName }) {
  const data = loadBugReports();
  const report = data.reports.find(r => r.id === reportId);
  
  if (!report) {
    return { error: 'Bug report not found' };
  }
  
  if (!report.comments) {
    report.comments = [];
  }
  
  const comment = {
    id: uuidv4(),
    text: text.trim(),
    authorId,
    authorName,
    createdAt: new Date().toISOString()
  };
  
  report.comments.push(comment);
  report.updatedAt = new Date().toISOString();
  saveBugReports(data);
  
  return { success: true, comment };
}

module.exports = {
  BUG_CATEGORIES,
  BUG_SEVERITY,
  BUG_STATUS,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  submitBugReport,
  getBugReports,
  getBugReport,
  updateBugReport,
  getBugReportStats,
  addComment
};
