/**
 * AgentFolio Projects Library
 * Manages project showcases for agent profiles
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Project categories/types
const PROJECT_TYPES = [
  'Bot',
  'DApp',
  'Smart Contract',
  'Tool',
  'Library',
  'Research',
  'Trading System',
  'Integration',
  'Content',
  'Other'
];

const MAX_PROJECTS = 10;
const MAX_LINKS = 5;

/**
 * Generate a unique project ID
 */
function generateProjectId() {
  return 'proj_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Validate project data
 */
function validateProject(project) {
  const errors = [];
  
  if (!project.title || typeof project.title !== 'string') {
    errors.push('Title is required');
  } else if (project.title.length > 100) {
    errors.push('Title must be 100 characters or less');
  }
  
  if (project.description && project.description.length > 1000) {
    errors.push('Description must be 1000 characters or less');
  }
  
  if (project.type && !PROJECT_TYPES.includes(project.type)) {
    errors.push(`Invalid type. Must be one of: ${PROJECT_TYPES.join(', ')}`);
  }
  
  if (project.links && Array.isArray(project.links)) {
    if (project.links.length > MAX_LINKS) {
      errors.push(`Maximum ${MAX_LINKS} links allowed`);
    }
    for (const link of project.links) {
      if (!link.url || typeof link.url !== 'string') {
        errors.push('Each link must have a URL');
      } else if (!isValidUrl(link.url)) {
        errors.push(`Invalid URL: ${link.url}`);
      }
    }
  }
  
  if (project.thumbnail && !isValidUrl(project.thumbnail)) {
    errors.push('Invalid thumbnail URL');
  }
  
  return errors;
}

/**
 * Check if a string is a valid URL
 */
function isValidUrl(str) {
  try {
    const url = new URL(str);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitize project data
 */
function sanitizeProject(project) {
  return {
    title: (project.title || '').trim().slice(0, 100),
    description: (project.description || '').trim().slice(0, 1000),
    type: PROJECT_TYPES.includes(project.type) ? project.type : 'Other',
    thumbnail: isValidUrl(project.thumbnail) ? project.thumbnail : null,
    links: (project.links || []).slice(0, MAX_LINKS).map(link => ({
      label: (link.label || link.url || '').trim().slice(0, 50),
      url: link.url || '',
      type: link.type || 'website' // website, github, demo, docs, etc.
    })).filter(l => isValidUrl(l.url)),
    tags: (project.tags || []).slice(0, 5).map(t => t.trim().slice(0, 30)),
    featured: !!project.featured,
    status: ['active', 'completed', 'archived'].includes(project.status) ? project.status : 'active'
  };
}

/**
 * Get all projects for a profile
 */
function getProjects(profileId, dataDir) {
  const filePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    return { error: 'Profile not found', projects: [] };
  }
  
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const projects = profile.portfolio || [];
  
  return {
    count: projects.length,
    maxProjects: MAX_PROJECTS,
    projects: projects.sort((a, b) => {
      // Featured first, then by date
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    })
  };
}

/**
 * Add a new project to a profile
 */
function addProject(profileId, projectData, dataDir) {
  const filePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    return { error: 'Profile not found' };
  }
  
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  // Initialize portfolio if not exists
  if (!profile.portfolio) {
    profile.portfolio = [];
  }
  
  // Check max projects limit
  if (profile.portfolio.length >= MAX_PROJECTS) {
    return { error: `Maximum ${MAX_PROJECTS} projects allowed. Remove one to add more.` };
  }
  
  // Validate
  const errors = validateProject(projectData);
  if (errors.length > 0) {
    return { error: errors.join('; ') };
  }
  
  // Sanitize and create project
  const sanitized = sanitizeProject(projectData);
  const project = {
    id: generateProjectId(),
    ...sanitized,
    verified: false,
    verifiedGithub: null, // Will be populated if links to verified GitHub repo
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  // Check if any GitHub link matches verified GitHub
  if (profile.verificationData?.github?.verified && project.links) {
    const verifiedGithub = profile.links?.github?.toLowerCase();
    for (const link of project.links) {
      if (link.url.toLowerCase().includes('github.com') && 
          verifiedGithub && 
          link.url.toLowerCase().includes(verifiedGithub.replace('https://github.com/', ''))) {
        project.verifiedGithub = link.url;
        break;
      }
    }
  }
  
  profile.portfolio.push(project);
  profile.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  
  return { success: true, project };
}

/**
 * Update an existing project
 */
function updateProject(profileId, projectId, updates, dataDir) {
  const filePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    return { error: 'Profile not found' };
  }
  
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!profile.portfolio) {
    return { error: 'Project not found' };
  }
  
  const projectIndex = profile.portfolio.findIndex(p => p.id === projectId);
  if (projectIndex === -1) {
    return { error: 'Project not found' };
  }
  
  // Validate updates
  const merged = { ...profile.portfolio[projectIndex], ...updates };
  const errors = validateProject(merged);
  if (errors.length > 0) {
    return { error: errors.join('; ') };
  }
  
  // Sanitize and update
  const sanitized = sanitizeProject(updates);
  const project = {
    ...profile.portfolio[projectIndex],
    ...sanitized,
    updatedAt: new Date().toISOString()
  };
  
  // Re-check GitHub verification
  if (profile.verificationData?.github?.verified && project.links) {
    const verifiedGithub = profile.links?.github?.toLowerCase();
    project.verifiedGithub = null;
    for (const link of project.links) {
      if (link.url.toLowerCase().includes('github.com') && 
          verifiedGithub && 
          link.url.toLowerCase().includes(verifiedGithub.replace('https://github.com/', ''))) {
        project.verifiedGithub = link.url;
        break;
      }
    }
  }
  
  profile.portfolio[projectIndex] = project;
  profile.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  
  return { success: true, project };
}

/**
 * Delete a project
 */
function deleteProject(profileId, projectId, dataDir) {
  const filePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    return { error: 'Profile not found' };
  }
  
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!profile.portfolio) {
    return { error: 'Project not found' };
  }
  
  const projectIndex = profile.portfolio.findIndex(p => p.id === projectId);
  if (projectIndex === -1) {
    return { error: 'Project not found' };
  }
  
  const removed = profile.portfolio.splice(projectIndex, 1)[0];
  profile.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  
  return { success: true, removed };
}

/**
 * Reorder projects (move to position)
 */
function reorderProject(profileId, projectId, newPosition, dataDir) {
  const filePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    return { error: 'Profile not found' };
  }
  
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!profile.portfolio || profile.portfolio.length === 0) {
    return { error: 'No projects found' };
  }
  
  const currentIndex = profile.portfolio.findIndex(p => p.id === projectId);
  if (currentIndex === -1) {
    return { error: 'Project not found' };
  }
  
  // Clamp position
  const targetIndex = Math.max(0, Math.min(newPosition, profile.portfolio.length - 1));
  
  // Move project
  const [project] = profile.portfolio.splice(currentIndex, 1);
  profile.portfolio.splice(targetIndex, 0, project);
  profile.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  
  return { success: true, projects: profile.portfolio };
}

/**
 * Toggle featured status
 */
function toggleFeatured(profileId, projectId, dataDir) {
  const filePath = path.join(dataDir, `${profileId}.json`);
  if (!fs.existsSync(filePath)) {
    return { error: 'Profile not found' };
  }
  
  const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!profile.portfolio) {
    return { error: 'Project not found' };
  }
  
  const project = profile.portfolio.find(p => p.id === projectId);
  if (!project) {
    return { error: 'Project not found' };
  }
  
  project.featured = !project.featured;
  project.updatedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2));
  
  return { success: true, featured: project.featured, project };
}

/**
 * Generate HTML for project card display
 */
function renderProjectCard(project, isOwner = false) {
  const links = (project.links || []).map(link => {
    const icon = link.type === 'github' ? '📂' : 
                 link.type === 'demo' ? '🎮' : 
                 link.type === 'docs' ? '📄' : '🔗';
    return `<a href="${link.url}" target="_blank" rel="noopener" class="project-link" title="${link.label || link.url}">${icon} ${link.label || 'Link'}</a>`;
  }).join('');
  
  const tags = (project.tags || []).map(tag => 
    `<span class="project-tag">${tag}</span>`
  ).join('');
  
  const statusBadge = project.status === 'completed' ? 
    '<span class="project-status completed">✓ Completed</span>' :
    project.status === 'archived' ? 
    '<span class="project-status archived">📦 Archived</span>' : '';
  
  const verifiedBadge = project.verifiedGithub ? 
    '<span class="project-verified" title="Links to verified GitHub">✓ Verified Repo</span>' : '';
  
  const featuredBadge = project.featured ? 
    '<span class="project-featured">⭐ Featured</span>' : '';
  
  const thumbnail = project.thumbnail ? 
    `<div class="project-thumbnail" style="background-image: url('${project.thumbnail}')"></div>` : '';
  
  const ownerControls = isOwner ? `
    <div class="project-controls">
      <button class="project-edit-btn" data-id="${project.id}" title="Edit">✏️</button>
      <button class="project-delete-btn" data-id="${project.id}" title="Delete">🗑️</button>
      <button class="project-feature-btn" data-id="${project.id}" title="${project.featured ? 'Unfeature' : 'Feature'}">
        ${project.featured ? '⭐' : '☆'}
      </button>
    </div>
  ` : '';
  
  return `
    <div class="project-card ${project.featured ? 'featured' : ''}" data-id="${project.id}">
      ${thumbnail}
      <div class="project-content">
        <div class="project-header">
          <h3 class="project-title">${project.title}</h3>
          <span class="project-type">${project.type || 'Project'}</span>
        </div>
        ${project.description ? `<p class="project-desc">${project.description}</p>` : ''}
        <div class="project-meta">
          ${featuredBadge}
          ${verifiedBadge}
          ${statusBadge}
        </div>
        ${tags ? `<div class="project-tags">${tags}</div>` : ''}
        ${links ? `<div class="project-links">${links}</div>` : ''}
        ${ownerControls}
      </div>
    </div>
  `;
}

/**
 * Get CSS styles for project display
 */
function getProjectStyles() {
  return `
    .projects-section {
      margin-top: 24px;
    }
    .projects-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }
    .project-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s;
    }
    .project-card:hover {
      border-color: #3f3f46;
      transform: translateY(-2px);
    }
    .project-card.featured {
      border-color: #a78bfa;
      box-shadow: 0 0 20px rgba(167, 139, 250, 0.15);
    }
    .project-thumbnail {
      height: 160px;
      background-size: cover;
      background-position: center;
      background-color: #27272a;
    }
    .project-content {
      padding: 16px;
    }
    .project-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
    }
    .project-title {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      margin: 0;
    }
    .project-type {
      font-size: 11px;
      padding: 3px 8px;
      background: #27272a;
      border-radius: 4px;
      color: #a1a1aa;
      white-space: nowrap;
    }
    .project-desc {
      font-size: 14px;
      color: #a1a1aa;
      margin: 0 0 12px 0;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .project-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .project-verified {
      font-size: 11px;
      padding: 3px 8px;
      background: rgba(34, 197, 94, 0.15);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 4px;
      color: #22c55e;
    }
    .project-featured {
      font-size: 11px;
      padding: 3px 8px;
      background: rgba(167, 139, 250, 0.15);
      border: 1px solid rgba(167, 139, 250, 0.3);
      border-radius: 4px;
      color: #a78bfa;
    }
    .project-status {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
    }
    .project-status.completed {
      background: rgba(34, 197, 94, 0.1);
      color: #22c55e;
    }
    .project-status.archived {
      background: rgba(113, 113, 122, 0.2);
      color: #71717a;
    }
    .project-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 12px;
    }
    .project-tag {
      font-size: 11px;
      padding: 2px 8px;
      background: #27272a;
      border-radius: 4px;
      color: #71717a;
    }
    .project-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .project-link {
      font-size: 13px;
      color: #a78bfa;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .project-link:hover {
      color: #c4b5fd;
    }
    .project-controls {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #27272a;
    }
    .project-controls button {
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .project-controls button:hover {
      background: #3f3f46;
    }
    .add-project-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: linear-gradient(135deg, #a78bfa, #ec4899);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .add-project-btn:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }
    .empty-projects {
      text-align: center;
      padding: 40px 20px;
      color: #71717a;
    }
    .empty-projects p {
      margin-bottom: 16px;
    }
  `;
}

module.exports = {
  PROJECT_TYPES,
  MAX_PROJECTS,
  MAX_LINKS,
  generateProjectId,
  validateProject,
  sanitizeProject,
  getProjects,
  addProject,
  updateProject,
  deleteProject,
  reorderProject,
  toggleFeatured,
  renderProjectCard,
  getProjectStyles
};
