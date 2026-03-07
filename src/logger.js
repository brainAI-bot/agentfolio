/**
 * AgentFolio Logger - Winston-based structured logging
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// JSON format for file output (structured logs)
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'agentfolio' },
  transports: [
    // Console output (colorized, human-readable)
    new winston.transports.Console({
      format: consoleFormat
    }),
    // Combined log file (all levels)
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),
    // Error log file (errors only)
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    }),
    // Access log (HTTP requests)
    new winston.transports.File({
      filename: path.join(logsDir, 'access.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

// HTTP request logging middleware
logger.httpMiddleware = (req, res, next) => {
  const start = Date.now();
  
  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')?.substring(0, 100)
    };
    
    // Log level based on status code
    if (res.statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });
  
  next();
};

// Log rotation cleanup (keep logs from last 7 days)
logger.cleanup = () => {
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(logsDir);
  
  files.forEach(file => {
    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);
    if (stats.mtimeMs < cutoff && file.endsWith('.log')) {
      fs.unlinkSync(filePath);
      logger.info('Cleaned up old log file', { file });
    }
  });
};

// Convenience methods for specific log categories
logger.api = (message, meta = {}) => {
  logger.info(message, { category: 'api', ...meta });
};

logger.db = (message, meta = {}) => {
  logger.debug(message, { category: 'database', ...meta });
};

logger.auth = (message, meta = {}) => {
  logger.info(message, { category: 'auth', ...meta });
};

logger.verification = (message, meta = {}) => {
  logger.info(message, { category: 'verification', ...meta });
};

logger.job = (message, meta = {}) => {
  logger.info(message, { category: 'job', ...meta });
};

module.exports = logger;
