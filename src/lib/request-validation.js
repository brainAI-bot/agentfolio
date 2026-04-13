const { z } = require('zod');

function formatIssues(issues = []) {
  return issues.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path || ''),
    message: issue.message,
  }));
}

function validateBody(schema, req, res) {
  const result = schema.safeParse(req.body || {});
  if (!result.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: formatIssues(result.error.issues),
    });
    return null;
  }
  return result.data;
}

module.exports = {
  z,
  validateBody,
};
