/**
 * Report Profile System
 * Allows users to report spam, abuse, or inappropriate content
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

// Report reasons
const REPORT_REASONS = {
  SPAM: 'spam',
  IMPERSONATION: 'impersonation',
  FAKE_AGENT: 'fake_agent',
  INAPPROPRIATE: 'inappropriate',
  MISLEADING: 'misleading',
  SCAM: 'scam',
  OTHER: 'other'
};

// Report status
const REPORT_STATUS = {
  PENDING: 'pending',
  REVIEWED: 'reviewed',
  DISMISSED: 'dismissed',
  ACTION_TAKEN: 'action_taken'
};

// Load reports from file
function loadReports() {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Reports] Error loading reports:', e.message);
  }
  return { reports: [], lastUpdated: null };
}

// Save reports to file
function saveReports(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Submit a report against a profile
 */
function submitReport(profileId, { reason, details, reporterId = null, reporterIp = null }) {
  if (!profileId) {
    return { error: 'Profile ID is required' };
  }
  
  if (!reason || !Object.values(REPORT_REASONS).includes(reason)) {
    return { error: 'Valid reason is required. Options: ' + Object.values(REPORT_REASONS).join(', ') };
  }
  
  const data = loadReports();
  
  // Check for duplicate report from same IP in last 24 hours
  if (reporterIp) {
    const existingReport = data.reports.find(r => 
      r.profileId === profileId &&
      r.reporterIp === reporterIp &&
      r.status === REPORT_STATUS.PENDING &&
      Date.now() - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000
    );
    if (existingReport) {
      return { error: 'You have already reported this profile recently' };
    }
  }
  
  const report = {
    id: uuidv4(),
    profileId,
    reason,
    details: details || null,
    reporterId: reporterId || null,
    reporterIp: reporterIp || null,
    status: REPORT_STATUS.PENDING,
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString()
  };
  
  data.reports.push(report);
  saveReports(data);
  
  console.log(`[Reports] New report submitted for ${profileId}: ${reason}`);
  
  return { success: true, reportId: report.id };
}

/**
 * Get reports with optional filters
 */
function getReports({ profileId = null, status = null, limit = 50, offset = 0 } = {}) {
  const data = loadReports();
  let reports = data.reports;
  
  // Apply filters
  if (profileId) {
    reports = reports.filter(r => r.profileId === profileId);
  }
  if (status) {
    reports = reports.filter(r => r.status === status);
  }
  
  // Sort by most recent first
  reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
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
 * Get a single report by ID
 */
function getReport(reportId) {
  const data = loadReports();
  return data.reports.find(r => r.id === reportId) || null;
}

/**
 * Update report status (admin action)
 */
function updateReportStatus(reportId, { status, adminNotes = null, reviewedBy = null }) {
  if (!Object.values(REPORT_STATUS).includes(status)) {
    return { error: 'Invalid status' };
  }
  
  const data = loadReports();
  const report = data.reports.find(r => r.id === reportId);
  
  if (!report) {
    return { error: 'Report not found' };
  }
  
  report.status = status;
  report.adminNotes = adminNotes || report.adminNotes;
  report.reviewedBy = reviewedBy || 'admin';
  report.reviewedAt = new Date().toISOString();
  
  saveReports(data);
  
  console.log(`[Reports] Report ${reportId} updated to ${status}`);
  
  return { success: true, report };
}

/**
 * Get report statistics
 */
function getReportStats() {
  const data = loadReports();
  const reports = data.reports;
  
  const stats = {
    total: reports.length,
    byStatus: {},
    byReason: {},
    pendingCount: 0,
    recentReports: reports.filter(r => 
      Date.now() - new Date(r.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
    ).length,
    mostReported: []
  };
  
  // Count by status
  Object.values(REPORT_STATUS).forEach(s => {
    stats.byStatus[s] = reports.filter(r => r.status === s).length;
  });
  stats.pendingCount = stats.byStatus[REPORT_STATUS.PENDING] || 0;
  
  // Count by reason
  Object.values(REPORT_REASONS).forEach(r => {
    stats.byReason[r] = reports.filter(rep => rep.reason === r).length;
  });
  
  // Find most reported profiles
  const profileCounts = {};
  reports.forEach(r => {
    profileCounts[r.profileId] = (profileCounts[r.profileId] || 0) + 1;
  });
  stats.mostReported = Object.entries(profileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([profileId, count]) => ({ profileId, count }));
  
  return stats;
}

/**
 * Get report count for a specific profile
 */
function getProfileReportCount(profileId) {
  const data = loadReports();
  return data.reports.filter(r => r.profileId === profileId).length;
}

module.exports = {
  REPORT_REASONS,
  REPORT_STATUS,
  submitReport,
  getReports,
  getReport,
  updateReportStatus,
  getReportStats,
  getProfileReportCount
};
