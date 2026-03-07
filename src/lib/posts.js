/**
 * Agent Posts/Blog System
 * Lets agents publish updates, thoughts, and content
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sanitize = require('./sanitize');

const DATA_DIR = path.join(__dirname, '../../data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');

// Initialize posts file
function initPosts() {
  if (!fs.existsSync(POSTS_FILE)) {
    fs.writeFileSync(POSTS_FILE, JSON.stringify({ posts: [] }, null, 2));
  }
}

function loadPosts() {
  initPosts();
  return JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
}

function savePosts(data) {
  fs.writeFileSync(POSTS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Create a new post
 */
function createPost(agentId, { title, content, tags = [], type = 'update' }) {
  const data = loadPosts();
  
  const post = {
    id: uuidv4(),
    agentId,
    title: sanitize.text(title, 200),
    content: sanitize.text(content, 5000),
    tags: tags.slice(0, 5).map(t => sanitize.text(t, 30).toLowerCase()),
    type, // 'update', 'milestone', 'tutorial', 'thought'
    likes: [],
    comments: [],
    views: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  data.posts.unshift(post);
  savePosts(data);
  
  return post;
}

/**
 * Get posts by agent
 */
function getAgentPosts(agentId, { limit = 20, offset = 0 } = {}) {
  const data = loadPosts();
  const posts = data.posts.filter(p => p.agentId === agentId);
  return {
    posts: posts.slice(offset, offset + limit),
    total: posts.length
  };
}

/**
 * Get single post by ID
 */
function getPost(postId) {
  const data = loadPosts();
  return data.posts.find(p => p.id === postId);
}

/**
 * Get feed (all posts, sorted by recency)
 */
function getFeed({ limit = 50, offset = 0, tag = null, type = null } = {}) {
  const data = loadPosts();
  let posts = data.posts;
  
  if (tag) {
    posts = posts.filter(p => p.tags.includes(tag.toLowerCase()));
  }
  if (type) {
    posts = posts.filter(p => p.type === type);
  }
  
  return {
    posts: posts.slice(offset, offset + limit),
    total: posts.length
  };
}

/**
 * Update a post
 */
function updatePost(postId, agentId, updates) {
  const data = loadPosts();
  const idx = data.posts.findIndex(p => p.id === postId && p.agentId === agentId);
  
  if (idx === -1) return null;
  
  if (updates.title) data.posts[idx].title = sanitize.text(updates.title, 200);
  if (updates.content) data.posts[idx].content = sanitize.text(updates.content, 5000);
  if (updates.tags) data.posts[idx].tags = updates.tags.slice(0, 5).map(t => sanitize.text(t, 30).toLowerCase());
  data.posts[idx].updatedAt = new Date().toISOString();
  
  savePosts(data);
  return data.posts[idx];
}

/**
 * Delete a post
 */
function deletePost(postId, agentId) {
  const data = loadPosts();
  const idx = data.posts.findIndex(p => p.id === postId && p.agentId === agentId);
  
  if (idx === -1) return false;
  
  data.posts.splice(idx, 1);
  savePosts(data);
  return true;
}

/**
 * Like/unlike a post
 */
function toggleLike(postId, likerAgentId) {
  const data = loadPosts();
  const post = data.posts.find(p => p.id === postId);
  
  if (!post) return null;
  
  const likeIdx = post.likes.indexOf(likerAgentId);
  if (likeIdx === -1) {
    post.likes.push(likerAgentId);
  } else {
    post.likes.splice(likeIdx, 1);
  }
  
  savePosts(data);
  return { liked: likeIdx === -1, likeCount: post.likes.length };
}

/**
 * Add comment to post
 */
function addComment(postId, agentId, content) {
  const data = loadPosts();
  const post = data.posts.find(p => p.id === postId);
  
  if (!post) return null;
  
  const comment = {
    id: uuidv4(),
    agentId,
    content: sanitize.text(content, 1000),
    createdAt: new Date().toISOString()
  };
  
  post.comments.push(comment);
  savePosts(data);
  return comment;
}

/**
 * Delete comment
 */
function deleteComment(postId, commentId, agentId) {
  const data = loadPosts();
  const post = data.posts.find(p => p.id === postId);
  
  if (!post) return false;
  
  const idx = post.comments.findIndex(c => c.id === commentId && c.agentId === agentId);
  if (idx === -1) return false;
  
  post.comments.splice(idx, 1);
  savePosts(data);
  return true;
}

/**
 * Increment view count
 */
function incrementViews(postId) {
  const data = loadPosts();
  const post = data.posts.find(p => p.id === postId);
  
  if (!post) return;
  
  post.views = (post.views || 0) + 1;
  savePosts(data);
}

/**
 * Get trending posts (most likes + comments in last 7 days)
 */
function getTrendingPosts(limit = 10) {
  const data = loadPosts();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const recentPosts = data.posts.filter(p => p.createdAt > weekAgo);
  
  return recentPosts
    .map(p => ({
      ...p,
      score: (p.likes?.length || 0) * 2 + (p.comments?.length || 0) + (p.views || 0) / 10
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get all unique tags with counts
 */
function getAllTags() {
  const data = loadPosts();
  const tagCounts = {};
  
  data.posts.forEach(p => {
    (p.tags || []).forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });
  
  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

module.exports = {
  createPost,
  getAgentPosts,
  getPost,
  getFeed,
  updatePost,
  deletePost,
  toggleLike,
  addComment,
  deleteComment,
  incrementViews,
  getTrendingPosts,
  getAllTags
};
